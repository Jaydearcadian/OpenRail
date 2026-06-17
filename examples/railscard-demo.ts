/**
 * RailsCard Demo — Outbound grant flow via SealedVault
 *
 * Flow:
 *   1. Payer creates a SealedVault (deposits funds + public key on-chain)
 *   2. Payer signs vault parameters off-chain → produces bearer token
 *   3. Token is passed to recipient (agent, service, AI node, etc.)
 *   4. Recipient calls unseal_and_mint → signature verified on-chain → Paycard minted
 *   5. Recipient claims streaming balance via claim_settlement_round
 *
 * start_timestamp modes:
 *   START_DYNAMIC (0) → stream starts the moment recipient unseals
 *   Unix timestamp    → stream starts at payer's fixed time
 */

import {
  Ed25519Keypair,
  decodeSuiPrivateKey,
  SuiClient,
  OpenRailsSDK,
  bytesToHex,
  signEnvelopeEd25519,
  signVaultEd25519,
  buildCreateVaultPTB,
  buildUnsealVaultPTB,
  buildClaimPTB,
  prepareForSponsorship,
  executeSponsoredTx,
  uploadEnvelope,
  fetchEnvelope,
  buildShortLink,
  NETWORKS,
  WALRUS_ENDPOINTS,
  COIN_TYPES,
  START_DYNAMIC,
  CURVE_ED25519,
  type OpenRailsIntentV1,
  type RailsCardPayload,
  type VaultParams,
} from "../sdk/dist/index.js";

// Run: sui keytool export --key-identity <your-address>
// Copy the "exportedPrivateKey: **************" value into env vars only:
//   export PAYER_PRIVATE_KEY="**************"
// Optional funded-wallet proof run:
//   export RECIPIENT_PRIVATE_KEY="**************"
const PACKAGE_ID            = process.env.PACKAGE_ID            ?? "REPLACE_WITH_DEPLOYED_PACKAGE_ID";
const PAYER_COIN_OBJECT_ID  = process.env.PAYER_COIN_OBJECT_ID  ?? "REPLACE_WITH_PAYER_COIN_OBJECT_ID";
// Tier-2: a SECOND SUI coin object (distinct from PAYER_COIN_OBJECT_ID) to fund the gas reserve
const PAYER_GAS_COIN_OBJECT_ID = process.env.PAYER_GAS_COIN_OBJECT_ID ?? "REPLACE_WITH_PAYER_GAS_COIN_OBJECT_ID";

const ALLOCATION = 1_050_000_000n; // 1.05 SUI — 5% safety buffer
const GAS_RESERVE = 20_000_000n;   // 0.02 SUI — recipient's future claim gas
const RATE = 1_000_000n;           // 0.001 SUI/s
const DURATION = 1000;
const TX_OPTIONS = { showObjectChanges: true, showEvents: true, showEffects: true };
const PRINT_TOKENS = process.env.OPENRAILS_PRINT_TOKENS === "1";

function requireObjectId(name: string, value: string) {
  if (!value || value.startsWith("REPLACE_WITH")) {
    throw new Error(`Set ${name}=0x... before running this demo.`);
  }
  if (!/^0x[0-9a-fA-F]+$/.test(value)) {
    throw new Error(`${name} must be a Sui object ID or package ID beginning with 0x.`);
  }
}

function keypairFromEnv(envName: string): Ed25519Keypair | undefined {
  const privateKey = process.env[envName];
  if (!privateKey) return undefined;

  const parsed = decodeSuiPrivateKey(privateKey);
  if (parsed.scheme !== "ED25519") {
    throw new Error(`${envName} must be an Ed25519 Sui private key.`);
  }

  return Ed25519Keypair.fromSecretKey(parsed.secretKey);
}

async function hasSuiBalance(client: SuiClient, owner: string): Promise<boolean> {
  const balance = await client.getBalance({ owner, coinType: COIN_TYPES.SUI });
  return BigInt(balance.totalBalance) > 0n;
}

function explorerUrl(digest: string): string {
  return `https://suiexplorer.com/txblock/${digest}?network=testnet`;
}

function logTx(label: string, digest: string) {
  console.log(`${label}:`, digest);
  console.log("  Explorer:", explorerUrl(digest));
}

async function waitForClaimableAccrual() {
  console.log("[RECIPIENT] Waiting for at least one second of stream accrual...");
  await new Promise((resolve) => setTimeout(resolve, 2_000));
}

async function main() {
  requireObjectId("PACKAGE_ID", PACKAGE_ID);
  requireObjectId("PAYER_COIN_OBJECT_ID", PAYER_COIN_OBJECT_ID);
  requireObjectId("PAYER_GAS_COIN_OBJECT_ID", PAYER_GAS_COIN_OBJECT_ID);
  if (PAYER_COIN_OBJECT_ID === PAYER_GAS_COIN_OBJECT_ID) {
    throw new Error("PAYER_GAS_COIN_OBJECT_ID must be distinct from PAYER_COIN_OBJECT_ID.");
  }

  const payerKeypair = keypairFromEnv("PAYER_PRIVATE_KEY");
  if (!payerKeypair) throw new Error("Set PAYER_PRIVATE_KEY=************** (run: sui keytool export --key-identity <address>)");

  const recipientKeypairFromEnv = keypairFromEnv("RECIPIENT_PRIVATE_KEY");
  const recipientKeypair = recipientKeypairFromEnv ?? Ed25519Keypair.generate();

  const payerAddress = payerKeypair.getPublicKey().toSuiAddress();
  const recipientAddress = recipientKeypair.getPublicKey().toSuiAddress();
  const payerPubkeyHex = Buffer.from(payerKeypair.getPublicKey().toRawBytes()).toString("hex");

  const client = new SuiClient({ url: NETWORKS.testnet.rpc });
  const sponsorUnseal = !recipientKeypairFromEnv || !(await hasSuiBalance(client, recipientAddress));

  console.log("Payer:     ", payerAddress);
  console.log("Recipient: ", recipientAddress, sponsorUnseal ? "(payer-sponsored unseal)" : "(self-funded)");

  // --- Step 1: Payer creates SealedVault ---
  const nonce = BigInt(Date.now()); // unique per vault

  const createVaultTx = buildCreateVaultPTB({
    packageId: PACKAGE_ID,
    coinObjectId: PAYER_COIN_OBJECT_ID,
    allocationAmount: ALLOCATION,
    gasCoinObjectId: PAYER_GAS_COIN_OBJECT_ID, // distinct SUI coin for the gas reserve
    gasAmount: GAS_RESERVE,                     // Tier-2: dispensed to recipient at unseal
    payerPubkeyHex,
    maxFlowRatePerSecond: RATE,
    durationSeconds: DURATION,
    startTimestamp: START_DYNAMIC,         // stream starts when recipient unseals
    recoveryTarget: payerAddress,
    nonce,
    curve: CURVE_ED25519,
    typeArgument: COIN_TYPES.SUI,
  });

  const createResult = await client.signAndExecuteTransaction({
    signer: payerKeypair,
    transaction: createVaultTx,
    options: TX_OPTIONS,
  });

  console.log("\n[PAYER] Vault created");
  logTx("[PAYER] TX", createResult.digest);

  const vaultObj = createResult.objectChanges?.find(
    (c) => c.type === "created" && (c as { objectType?: string }).objectType?.includes("SealedVault")
  );

  if (!vaultObj || vaultObj.type !== "created") {
    throw new Error("SealedVault not found in TX changes.");
  }

  const vaultObjectId = vaultObj.objectId;
  console.log("[PAYER] SealedVault object ID:", vaultObjectId);

  // --- Step 2: Payer signs vault parameters → bearer token ---
  const vaultParams: VaultParams = {
    payerPubkey: payerKeypair.getPublicKey().toRawBytes(),
    allocationAmount: ALLOCATION,
    gasAmount: GAS_RESERVE,
    maxFlowRatePerSecond: RATE,
    durationSeconds: DURATION,
    startTimestamp: START_DYNAMIC,
    recoveryTarget: payerAddress,
    nonce,
    curve: CURVE_ED25519,
  };

  const vaultSignature = await signVaultEd25519(vaultParams, payerKeypair);

  // Encode into intent for bearer token transport
  const now = Math.floor(Date.now() / 1000);
  const intent: OpenRailsIntentV1 = {
    paycardId: vaultObjectId,
    asset: { packageId: "0x2", moduleName: "sui", typeArgument: COIN_TYPES.SUI },
    allocationPoolSize: "1050000000",
    maxFlowRatePerSecond: "1000000",
    startTimestamp: now,
    durationSeconds: 1000,
    residualDeltaRecipient: payerAddress,
  };

  const envelope = await signEnvelopeEd25519(intent, payerKeypair);
  const railsCardToken = OpenRailsSDK.serializePayload({
    linkType: "railscard",
    vaultObjectId,
    vaultSignature: bytesToHex(vaultSignature),
    envelope,
    intent,
    recipientAddress: undefined, // wildcard — recipient fills in their own address
  } as RailsCardPayload);

  if (PRINT_TOKENS) {
    console.log("\n[PAYER] RailsCard bearer token:\n", railsCardToken);
  } else {
    console.log("\n[PAYER] RailsCard bearer token prepared (hidden; set OPENRAILS_PRINT_TOKENS=1 to print).");
  }
  console.log("[PAYER] → token + vaultObjectId passed to recipient out-of-band");

  // --- Step 2b (optional): Publish envelope to Walrus — short link replaces the Base64 token ---
  //
  // Instead of sharing the raw Base64 token, the payer can upload the envelope to Walrus
  // and share a compact rails.to/v1/{blobId} short link. The recipient fetches the envelope
  // gaslessly from a Walrus aggregator over plain HTTP — no Sui RPC, no gas.
  //
  // epochs=1: blob auto-purges after one Walrus epoch (short-lived — matches link lifetime).
  // Uncomment to run against live Walrus testnet:
  //
  // const payload: RailsCardPayload = {
  //   linkType: "railscard",
  //   vaultObjectId,
  //   vaultSignature: bytesToHex(vaultSignature),
  //   envelope,
  //   intent,
  //   recipientAddress: undefined,
  // };
  // const { blobId, shortLink } = await uploadEnvelope(
  //   payload,
  //   WALRUS_ENDPOINTS.testnet.publisher,
  //   { epochs: 1 }
  // );
  // console.log("\n[PAYER]  Short link:", shortLink);
  //
  // // Recipient resolves the short link (gasless aggregator GET):
  // const resolvedPayload = await fetchEnvelope(blobId, WALRUS_ENDPOINTS.testnet.aggregator);
  // console.log("[RECIPIENT] Resolved linkType:", resolvedPayload.linkType);
  //
  // Offline sanity check — pure function, no network:
  const offlineBlobId = "0x" + "ab".repeat(32);
  console.log("\n[DEMO]   Short link format check:", buildShortLink(offlineBlobId));

  // --- Step 3: Recipient receives token, calls unseal_and_mint ---
  // (In production: recipient decodes token, fetches vault, submits their own address)
  //
  // TIER-2 GASLESS: this is the ONLY call the recipient needs external gas for.
  // This demo sponsors it by default for an ephemeral or unfunded recipient. The vault
  // dispenses its gas reserve to the recipient here, so every subsequent
  // claim_settlement_round (Step 4+) is self-funded — no sponsor needed again.
  console.log("\n[RECIPIENT] Unsealing vault...");

  const unsealTx = buildUnsealVaultPTB({
    packageId: PACKAGE_ID,
    vaultObjectId,
    signature: vaultSignature,
    recipient: recipientAddress,
    typeArgument: COIN_TYPES.SUI,
  });

  const unsealResult = sponsorUnseal
    ? await (async () => {
        const txBytes = await prepareForSponsorship(unsealTx, recipientAddress, payerAddress, client);
        const { signature: userSig } = await recipientKeypair.signTransaction(txBytes);
        const sponsored = await executeSponsoredTx(txBytes, userSig, payerKeypair, client);
        return await client.waitForTransaction({ digest: sponsored.digest, options: TX_OPTIONS });
      })()
    : await client.signAndExecuteTransaction({
        signer: recipientKeypair,
        transaction: unsealTx,
        options: TX_OPTIONS,
      });

  console.log("[RECIPIENT] Vault unsealed");
  logTx("[RECIPIENT] TX", unsealResult.digest);

  const paycardObj = unsealResult.objectChanges?.find(
    (c) => c.type === "created" && (c as { objectType?: string }).objectType?.includes("Paycard")
  );

  if (!paycardObj || paycardObj.type !== "created") {
    throw new Error("Paycard not found after unseal.");
  }

  console.log("[RECIPIENT] Paycard minted:", paycardObj.objectId);
  console.log("  Stream started at: unseal time (dynamic)");
  console.log("  Rate:              0.001 SUI/s");
  console.log("  Duration:          1000s");
  console.log("  Gas reserve:       0.02 SUI dispensed → recipient self-funds future claims");

  // --- Step 4: Recipient claims accrued balance (funded by dispensed gas reserve) ---
  await waitForClaimableAccrual();
  console.log("\n[RECIPIENT] Claiming settlement (gas from dispensed reserve)...");

  const claimTx = buildClaimPTB({
    packageId: PACKAGE_ID,
    paycardObjectId: paycardObj.objectId,
    typeArgument: COIN_TYPES.SUI,
  });

  const claimResult = await client.signAndExecuteTransaction({
    signer: recipientKeypair,
    transaction: claimTx,
    options: TX_OPTIONS,
  });

  logTx("[RECIPIENT] Claim TX", claimResult.digest);
}

main().catch(console.error);
