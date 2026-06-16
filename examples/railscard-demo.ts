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
// Copy the "exportedPrivateKey: suiprivkey1..." value and set it here:
//   export PAYER_PRIVATE_KEY="suiprivkey1..."
const PACKAGE_ID            = process.env.PACKAGE_ID            ?? "REPLACE_WITH_DEPLOYED_PACKAGE_ID";
const PAYER_COIN_OBJECT_ID  = process.env.PAYER_COIN_OBJECT_ID  ?? "REPLACE_WITH_PAYER_COIN_OBJECT_ID";
// Tier-2: a SECOND SUI coin object (distinct from PAYER_COIN_OBJECT_ID) to fund the gas reserve
const PAYER_GAS_COIN_OBJECT_ID = process.env.PAYER_GAS_COIN_OBJECT_ID ?? "REPLACE_WITH_PAYER_GAS_COIN_OBJECT_ID";

const ALLOCATION = 1_050_000_000n; // 1.05 SUI — 5% safety buffer
const GAS_RESERVE = 20_000_000n;   // 0.02 SUI — recipient's future claim gas
const RATE = 1_000_000n;           // 0.001 SUI/s
const DURATION = 1000;

async function main() {
  const payerPrivKey = process.env.PAYER_PRIVATE_KEY;
  if (!payerPrivKey) throw new Error("Set PAYER_PRIVATE_KEY=suiprivkey1... (run: sui keytool export --key-identity <address>)");
  const { keypair: payerKeypair } = decodeSuiPrivateKey(payerPrivKey) as { keypair: Ed25519Keypair };
  const recipientKeypair = Ed25519Keypair.generate(); // recipient stays ephemeral for demo

  const payerAddress = payerKeypair.getPublicKey().toSuiAddress();
  const recipientAddress = recipientKeypair.getPublicKey().toSuiAddress();
  const payerPubkeyHex = Buffer.from(payerKeypair.getPublicKey().toRawBytes()).toString("hex");

  const client = new SuiClient({ url: NETWORKS.testnet.rpc });

  console.log("Payer:     ", payerAddress);
  console.log("Recipient: ", recipientAddress);

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
    options: { showObjectChanges: true },
  });

  console.log("\n[PAYER] Vault created, TX:", createResult.digest);

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

  console.log("\n[PAYER] RailsCard bearer token:\n", railsCardToken);
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
  // To make it fully gasless, the protocol sponsors it instead of the recipient:
  //
  //   import { prepareForSponsorship, executeSponsoredTx } from "../sdk/dist/index.js";
  //   const txBytes = await prepareForSponsorship(unsealTx, recipientAddress, sponsorAddress, client);
  //   const { signature: userSig } = await recipientKeypair.signTransaction(txBytes);
  //   await executeSponsoredTx(txBytes, userSig, sponsorKeypair, client);
  //
  // Either way, the vault dispenses its gas reserve to the recipient here, so every
  // subsequent claim_settlement_round (Step 4+) is self-funded — no sponsor needed again.
  console.log("\n[RECIPIENT] Unsealing vault...");

  const unsealTx = buildUnsealVaultPTB({
    packageId: PACKAGE_ID,
    vaultObjectId,
    signature: vaultSignature,
    recipient: recipientAddress,
    typeArgument: COIN_TYPES.SUI,
  });

  const unsealResult = await client.signAndExecuteTransaction({
    signer: recipientKeypair,
    transaction: unsealTx,
    options: { showObjectChanges: true },
  });

  console.log("[RECIPIENT] Vault unsealed, TX:", unsealResult.digest);

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
  console.log("\n[RECIPIENT] Claiming settlement (gas from dispensed reserve)...");

  const claimTx = buildClaimPTB({
    packageId: PACKAGE_ID,
    paycardObjectId: paycardObj.objectId,
    typeArgument: COIN_TYPES.SUI,
  });

  const claimResult = await client.signAndExecuteTransaction({
    signer: recipientKeypair,
    transaction: claimTx,
  });

  console.log("[RECIPIENT] Claim TX:", claimResult.digest);
}

main().catch(console.error);
