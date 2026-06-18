import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { handleRequest } from '../dist/handler.js';

const PACKAGE_ID = '0x' + '0'.repeat(64);
const PAYCARD_ID = '0x' + '1'.repeat(64);
const PAYER = '0x' + '2'.repeat(64);
const RECIPIENT = '0x' + '3'.repeat(64);
const env = { OPENRAILS_PACKAGE_ID: PACKAGE_ID, SUI_NETWORK: 'testnet' };

function receiptEvent(overrides = {}) {
  return {
    id: { txDigest: 'digest1', eventSeq: '0' },
    packageId: PACKAGE_ID,
    transactionModule: 'paycard_v1',
    sender: PAYER,
    type: `${PACKAGE_ID}::events::SettlementReceipt`,
    parsedJson: {
      paycard_id: PAYCARD_ID,
      payer: PAYER,
      recipient: RECIPIENT,
      total_paid_to_recipient: '1000',
      residual_returned_to_payer: '0',
      settlement_type: '0',
      closed_at_seconds: '123',
    },
    timestampMs: '123000',
    ...overrides,
  };
}

function mockClient(page) {
  return {
    calls: [],
    async queryEvents(query) {
      this.calls.push(query);
      if (page instanceof Error) throw page;
      return page;
    },
  };
}

async function json(response) {
  return JSON.parse(await response.text());
}

test('health does not require receipt configuration', async () => {
  const response = await handleRequest(new Request('https://api.openrails.test/health'));
  assert.equal(response.status, 200);
  assert.deepEqual(await json(response), { ok: true });
});

test('worker fetch ignores Cloudflare execution context argument', async () => {
  const response = await worker.fetch(
    new Request('https://api.openrails.test/health'),
    {},
    { waitUntil() {}, passThroughOnException() {} }
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await json(response), { ok: true });
});

test('lists normalized settlement receipts', async () => {
  const client = mockClient({
    data: [receiptEvent()],
    nextCursor: { txDigest: 'digest1', eventSeq: '0' },
    hasNextPage: false,
  });

  const response = await handleRequest(
    new Request(`https://api.openrails.test/v1/receipts?limit=25&order=ascending&paycardId=${PAYCARD_ID}`),
    env,
    client
  );
  const body = await json(response);

  assert.equal(response.status, 200);
  assert.equal(body.data.length, 1);
  assert.equal(body.data[0].paycardId, PAYCARD_ID);
  assert.equal(body.data[0].transactionDigest, 'digest1');
  assert.deepEqual(client.calls[0].query, { MoveEventType: `${PACKAGE_ID}::events::SettlementReceipt` });
  assert.equal(client.calls[0].limit, 25);
  assert.equal(client.calls[0].order, 'ascending');
});

test('rejects invalid query parameters', async () => {
  const response = await handleRequest(
    new Request('https://api.openrails.test/v1/receipts?limit=101'),
    env,
    mockClient({ data: [], nextCursor: null, hasNextPage: false })
  );
  const body = await json(response);

  assert.equal(response.status, 400);
  assert.equal(body.error.code, 'invalid_request');
});

test('requires cursor fields together', async () => {
  const response = await handleRequest(
    new Request('https://api.openrails.test/v1/receipts?cursorTxDigest=digest1'),
    env,
    mockClient({ data: [], nextCursor: null, hasNextPage: false })
  );

  assert.equal(response.status, 400);
});

test('returns a single paycard receipt', async () => {
  const client = mockClient({
    data: [receiptEvent()],
    nextCursor: null,
    hasNextPage: false,
  });

  const response = await handleRequest(
    new Request(`https://api.openrails.test/v1/receipts/${PAYCARD_ID}`),
    env,
    client
  );
  const body = await json(response);

  assert.equal(response.status, 200);
  assert.equal(body.data.paycardId, PAYCARD_ID);
});

test('returns 404 when paycard receipt is not found', async () => {
  const response = await handleRequest(
    new Request(`https://api.openrails.test/v1/receipts/${PAYCARD_ID}`),
    env,
    mockClient({ data: [], nextCursor: null, hasNextPage: false })
  );
  const body = await json(response);

  assert.equal(response.status, 404);
  assert.equal(body.error.code, 'receipt_not_found');
});

test('maps Sui RPC failures to 502', async () => {
  const response = await handleRequest(
    new Request('https://api.openrails.test/v1/receipts'),
    env,
    mockClient(new Error('rpc unavailable'))
  );
  const body = await json(response);

  assert.equal(response.status, 502);
  assert.equal(body.error.code, 'sui_rpc_unavailable');
});

test('requires package configuration for receipt routes', async () => {
  const response = await handleRequest(new Request('https://api.openrails.test/v1/receipts'));
  const body = await json(response);

  assert.equal(response.status, 500);
  assert.equal(body.error.code, 'configuration_error');
});
