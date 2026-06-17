/**
 * RailsFlow Demo — Inbound billing memo flow
 *
 * Flow:
 *   1. Merchant creates a RailsFlow billing memo with hardcoded payout address
 *   2. Serializes to Base64 token and shares with payer
 *   3. Payer deserializes, reviews fixed parameters, signs envelope
 *   4. Payer executes mint PTB — funds the Paycard stream to merchant
 *   5. Merchant calls claim_settlement_round to draw down accrued balance
 */

import {
  Ed25519Keypair,
  decodeSuiPrivateKey,
  SuiClient,
  OpenRailsSDK,
  bindRailsFlowMerchant,
  signEnvelopeEd25519,
  verifyRailsFlowMerchantEnvelope,
  buildMintPTB,
  buildClaimPTB,
  prepareForSponsorship,
  executeSponsoredTx,
  NETWORKS,
  COIN_TYPES,
  type OpenRailsIntentV1,
  type RailsFlowPayload,
} from "../sdk/dist/index.js";

// Run: sui keytool export --key-identity <your-address>
// Copy the "exportedPrivateKey: **************" value into env vars only:
//   export PAYER_PRIVATE_KEY="**************"
// Optional funded-wallet proof run:
//   export MERCHANT_PRIVATE_KEY="**************"
const PACKAGE_ID             = process.env.PACKAGE_ID             ?? "REPLACE_WITH_DEPLOYED_PACKAGE_ID";
const FUNDING_COIN_OBJECT_ID = process.env.FUNDING_COIN_OBJECT_ID ?? "REPLACE_WITH_PAYER_COIN_OBJECT_ID";
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

async function main() {
  requireObjectId("PACKAGE_ID", PACKAGE_ID);
  requireObjectId("FUNDING_COIN_OBJECT_ID", FUNDING_COIN_OBJECT_ID);

  const payerKeypair = keypairFromEnv("PAYER_PRIVATE_KEY");
  if (!payerKeypair) throw new Error("Set PAYER_PRIVATE_KEY=************** (run: sui keytool export --key-identity <address>)");

  // In RailsFlow the merchant is the fixed recipient — their address is embedded in the billing memo.
  // By default the merchant keypair is ephemeral for a gasless proof. Set MERCHANT_PRIVATE_KEY for a
  // funded-wallet proof run instead.
  const merchantKeypairFromEnv = keypairFromEnv("MERCHANT_PRIVATE_KEY");
  const merchantKeypair = merchantKeypairFromEnv ?? Ed25519Keypair.generate();

  const merchantAddress = merchantKeypair.getPublicKey().toSuiAddress();
  const payerAddress = payerKeypair.getPublicKey().toSuiAddress();

  const client = new SuiClient({ url: NETWORKS.testnet.rpc });
  const sponsorMerchantClaim = !merchantKeypairFromEnv || !(await hasSuiBalance(client, merchantAddress));

  console.log("Merchant address:", merchantAddress, sponsorMerchantClaim ? "(payer-sponsored claim)" : "(self-funded)");
  console.log("Payer address:   ", payerAddress);

  // --- Step 1: Merchant creates billing memo ---
  const now = Math.floor(Date.now() / 1000);
  const streamStart = now - 10;
  const intent: OpenRailsIntentV1 = {
    paycardId: crypto.randomUUID().replace(/-/g, ""),
    asset: {
      packageId: "0x2",
      moduleName: "sui",
      typeArgument: COIN_TYPES.SUI,
    },
    allocationPoolSize: "105000000",  // 0.105 SUI — 0.1 SUI invoice + 5% buffer
    maxFlowRatePerSecond: "100000",   // ~0.0001 SUI/s → drains in 1000s
    startTimestamp: streamStart,
    durationSeconds: 1000,
    residualDeltaRecipient: payerAddress, // STN-Delta: buffer returns to payer
  };

  // Merchant signs — locks in hardcoded merchant address
  const merchantEnvelope = await signEnvelopeEd25519(
    bindRailsFlowMerchant(intent, merchantAddress),
    merchantKeypair
  );

  const billingMemo: RailsFlowPayload = {
    linkType: "railsflow",
    envelope: merchantEnvelope,
    intent,
    merchantAddress,
    invoiceDescription: "API compute node usage — 1000s stream",
  };

  const token = OpenRailsSDK.serializePayload(billingMemo);
  if (PRINT_TOKENS) {
    console.log("\n[MERCHANT] RailsFlow billing token:\n", token);
  } else {
    console.log("\n[MERCHANT] RailsFlow billing token prepared (hidden; set OPENRAILS_PRINT_TOKENS=1 to print).");
  }

  // --- Step 2: Payer receives and validates token ---
  const parsed = OpenRailsSDK.deserializePayload(token) as RailsFlowPayload;
  if (parsed.linkType !== "railsflow") throw new Error("Expected railsflow token");
  if (!(await verifyRailsFlowMerchantEnvelope(parsed))) {
    throw new Error("Invalid RailsFlow merchant signature.");
  }

  console.log("\n[PAYER] Validates billing memo:");
  console.log("  Merchant payout:", parsed.merchantAddress);
  console.log("  Amount:         ", parsed.intent.allocationPoolSize, "units");
  console.log("  Rate:           ", parsed.intent.maxFlowRatePerSecond, "units/s");
  console.log("  Duration:       ", parsed.intent.durationSeconds, "seconds");
  console.log("  STN-Delta vault:", parsed.intent.residualDeltaRecipient);

  // Payer co-signs to authorize the stream
  const payerEnvelope = await signEnvelopeEd25519(parsed.intent, payerKeypair);
  console.log("\n[PAYER] Co-signed. Envelope curve:", payerEnvelope.curve);

  // --- Step 3: Payer mints and funds the Paycard ---
  const mintTx = buildMintPTB({
    packageId: PACKAGE_ID,
    coinObjectId: FUNDING_COIN_OBJECT_ID,
    totalProvisionAmount: BigInt(parsed.intent.allocationPoolSize),
    maxFlowRatePerSecond: BigInt(parsed.intent.maxFlowRatePerSecond),
    recipient: parsed.merchantAddress,  // Hardcoded — payer cannot redirect funds
    startTimestamp: parsed.intent.startTimestamp,
    durationSeconds: parsed.intent.durationSeconds,
    recoveryTarget: parsed.intent.residualDeltaRecipient,
    typeArgument: COIN_TYPES.SUI,
  });

  const mintResult = await client.signAndExecuteTransaction({
    signer: payerKeypair,
    transaction: mintTx,
    options: TX_OPTIONS,
  });

  console.log("\n[PAYER] Paycard minted");
  logTx("[PAYER] Mint TX", mintResult.digest);

  const paycardObj = mintResult.objectChanges?.find(
    (c) => c.type === "created" && (c as { objectType?: string }).objectType?.includes("Paycard")
  );

  if (!paycardObj || paycardObj.type !== "created") {
    console.log("Paycard not found in TX changes.");
    return;
  }

  console.log("[PAYER] Paycard funded:", paycardObj.objectId);

  // --- Step 4: Merchant claims settlement ---
  // The payer sponsors this claim by default when the merchant wallet is ephemeral or unfunded.
  console.log("\n[MERCHANT] Claiming settlement...");

  const claimTx = buildClaimPTB({
    packageId: PACKAGE_ID,
    paycardObjectId: paycardObj.objectId,
    typeArgument: COIN_TYPES.SUI,
  });

  const claimResult = sponsorMerchantClaim
    ? await (async () => {
        const txBytes = await prepareForSponsorship(claimTx, merchantAddress, payerAddress, client);
        const { signature: userSig } = await merchantKeypair.signTransaction(txBytes);
        const sponsored = await executeSponsoredTx(txBytes, userSig, payerKeypair, client);
        return await client.waitForTransaction({ digest: sponsored.digest, options: TX_OPTIONS });
      })()
    : await client.signAndExecuteTransaction({
        signer: merchantKeypair,
        transaction: claimTx,
        options: TX_OPTIONS,
      });

  logTx("[MERCHANT] Settlement claimed, TX", claimResult.digest);
}

main().catch(console.error);
