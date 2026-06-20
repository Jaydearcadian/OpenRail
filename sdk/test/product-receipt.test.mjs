import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  computeMetadataHash,
  metadataHashHex,
  verifyMetadataHash,
  createPaymentReceipt,
  createSettlementReceipt,
  createResidualRecoveryReceipt,
} = require("../dist/product-receipt.js");

const metadata = {
  invoiceId: "inv-001",
  merchant: "0xmerchant",
  productId: "sku-42",
  amount: "100000000",
  token: "0x2::sui::SUI",
  description: "API usage — June",
  expiresAt: "2026-07-01T00:00:00.000Z",
};

const sampleReceipt = {
  packageId: "0xpkg",
  paycardId: "0xpaycard",
  payer: "0xpayer",
  recipient: "0xrecipient",
  totalPaidToRecipient: "90000000",
  residualReturnedToPayer: "10000000",
  residualDeltaAmount: "10000000",
  settlementType: 1,
  closedAtSeconds: 1750000000,
  transactionDigest: "DIGEST123",
  eventSeq: "7",
  eventId: { txDigest: "DIGEST123", eventSeq: "7" },
};

const ISSUED = "2026-06-20T00:00:00.000Z";

test("metadata hash is deterministic and order-independent", async () => {
  const a = await metadataHashHex(metadata);
  const reordered = {
    token: metadata.token,
    amount: metadata.amount,
    merchant: metadata.merchant,
    invoiceId: metadata.invoiceId,
    productId: metadata.productId,
    description: metadata.description,
    expiresAt: metadata.expiresAt,
  };
  const b = await metadataHashHex(reordered);
  assert.equal(a, b);
  assert.match(a, /^0x[0-9a-f]{64}$/);
  assert.ok(await verifyMetadataHash(metadata, a));
});

test("changing any term changes the hash", async () => {
  const base = await metadataHashHex(metadata);
  const changed = await metadataHashHex({ ...metadata, amount: "100000001" });
  assert.notEqual(base, changed);
  assert.equal(await verifyMetadataHash({ ...metadata, amount: "100000001" }, base), false);
});

test("createSettlementReceipt binds chain evidence", async () => {
  const hash = await metadataHashHex(metadata);
  const receipt = await createSettlementReceipt({
    metadata,
    metadataHash: hash,
    receipt: sampleReceipt,
    issuedAt: ISSUED,
    proofRef: "https://proof.example/0xpaycard",
  });

  assert.equal(receipt.schemaVersion, "1.0");
  assert.equal(receipt.receiptType, "settlement");
  assert.equal(receipt.paycardId, "0xpaycard");
  assert.equal(receipt.merchant, "0xmerchant");
  assert.equal(receipt.productId, "sku-42");
  assert.equal(receipt.metadataHash, hash);
  assert.deepEqual(receipt.settlementBinding, {
    transactionDigest: "DIGEST123",
    eventSeq: "7",
    settlementType: 1,
    totalPaidToRecipient: "90000000",
    residualDeltaAmount: "10000000",
  });
  assert.match(receipt.receiptId, /^openrails_receipt_[0-9a-f]{64}$/);
});

test("receiptId is stable for identical inputs and changes with content", async () => {
  const hash = await metadataHashHex(metadata);
  const a = await createSettlementReceipt({ metadata, metadataHash: hash, receipt: sampleReceipt, issuedAt: ISSUED });
  const b = await createSettlementReceipt({ metadata, metadataHash: hash, receipt: sampleReceipt, issuedAt: ISSUED });
  assert.equal(a.receiptId, b.receiptId);

  const c = await createSettlementReceipt({
    metadata,
    metadataHash: hash,
    receipt: { ...sampleReceipt, totalPaidToRecipient: "1" },
    issuedAt: ISSUED,
  });
  assert.notEqual(a.receiptId, c.receiptId);
});

test("payment receipt has no settlement binding; residual recovery is typed", async () => {
  const hash = await metadataHashHex(metadata);
  const payment = await createPaymentReceipt({
    metadata,
    metadataHash: hash,
    paycardId: "0xpaycard",
    payer: "0xpayer",
    recipient: "0xrecipient",
    issuedAt: ISSUED,
  });
  assert.equal(payment.receiptType, "payment");
  assert.equal(payment.settlementBinding, undefined);

  const residual = await createResidualRecoveryReceipt({
    metadata,
    metadataHash: hash,
    receipt: sampleReceipt,
    issuedAt: ISSUED,
  });
  assert.equal(residual.receiptType, "residual_recovery");
  assert.equal(residual.settlementBinding.residualDeltaAmount, "10000000");
});
