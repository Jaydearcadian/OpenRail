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

import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
import { SuiClient } from "@mysten/sui/client";
import {
  OpenRailsSDK,
  signEnvelopeEd25519,
  buildMintPTB,
  buildClaimPTB,
  NETWORKS,
  COIN_TYPES,
  type OpenRailsIntentV1,
  type RailsFlowPayload,
} from "../src/index.js";

// Run: sui keytool export --key-identity <your-address>
// Copy the "exportedPrivateKey: suiprivkey1..." value and set it here:
//   export PAYER_PRIVATE_KEY="suiprivkey1..."
const PACKAGE_ID             = process.env.PACKAGE_ID             ?? "REPLACE_WITH_DEPLOYED_PACKAGE_ID";
const FUNDING_COIN_OBJECT_ID = process.env.FUNDING_COIN_OBJECT_ID ?? "REPLACE_WITH_PAYER_COIN_OBJECT_ID";

async function main() {
  const payerPrivKey = process.env.PAYER_PRIVATE_KEY;
  if (!payerPrivKey) throw new Error("Set PAYER_PRIVATE_KEY=suiprivkey1... (run: sui keytool export --key-identity <address>)");
  const { keypair: payerKeypair } = decodeSuiPrivateKey(payerPrivKey) as { keypair: Ed25519Keypair };
  // In RailsFlow the merchant is the fixed recipient — their address is embedded in the billing memo.
  // For the demo, the merchant keypair is ephemeral; in production it would be a real funded wallet.
  const merchantKeypair = Ed25519Keypair.generate();

  const merchantAddress = merchantKeypair.getPublicKey().toSuiAddress();
  const payerAddress = payerKeypair.getPublicKey().toSuiAddress();

  const client = new SuiClient({ url: NETWORKS.testnet.rpc });

  console.log("Merchant address:", merchantAddress);
  console.log("Payer address:   ", payerAddress);

  // --- Step 1: Merchant creates billing memo ---
  const now = Math.floor(Date.now() / 1000);
  const intent: OpenRailsIntentV1 = {
    paycardId: crypto.randomUUID().replace(/-/g, ""),
    asset: {
      packageId: "0x2",
      moduleName: "sui",
      typeArgument: COIN_TYPES.SUI,
    },
    allocationPoolSize: "105000000",  // 0.105 SUI — 0.1 SUI invoice + 5% buffer
    maxFlowRatePerSecond: "100000",   // ~0.0001 SUI/s → drains in 1000s
    startTimestamp: now,
    durationSeconds: 1000,
    residualDeltaRecipient: payerAddress, // STN-Delta: buffer returns to payer
  };

  // Merchant signs — locks in hardcoded merchant address
  const merchantEnvelope = await signEnvelopeEd25519(intent, merchantKeypair);

  const billingMemo: RailsFlowPayload = {
    linkType: "railsflow",
    envelope: merchantEnvelope,
    intent,
    merchantAddress,
    invoiceDescription: "API compute node usage — 1000s stream",
  };

  const token = OpenRailsSDK.serializePayload(billingMemo);
  console.log("\n[MERCHANT] RailsFlow billing token:\n", token);

  // --- Step 2: Payer receives and validates token ---
  const parsed = OpenRailsSDK.deserializePayload(token) as RailsFlowPayload;
  if (parsed.linkType !== "railsflow") throw new Error("Expected railsflow token");

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
    options: { showObjectChanges: true },
  });

  console.log("\n[PAYER] Mint TX digest:", mintResult.digest);

  const paycardObj = mintResult.objectChanges?.find(
    (c) => c.type === "created" && (c as { objectType?: string }).objectType?.includes("Paycard")
  );

  if (!paycardObj || paycardObj.type !== "created") {
    console.log("Paycard not found in TX changes.");
    return;
  }

  console.log("[PAYER] Paycard funded:", paycardObj.objectId);

  // --- Step 4: Merchant claims settlement ---
  // (In production: merchant calls this after some time has elapsed)
  console.log("\n[MERCHANT] Claiming settlement...");

  const claimTx = buildClaimPTB({
    packageId: PACKAGE_ID,
    paycardObjectId: paycardObj.objectId,
    typeArgument: COIN_TYPES.SUI,
  });

  const claimResult = await client.signAndExecuteTransaction({
    signer: merchantKeypair,
    transaction: claimTx,
  });

  console.log("[MERCHANT] Settlement claimed, TX:", claimResult.digest);
}

main().catch(console.error);
