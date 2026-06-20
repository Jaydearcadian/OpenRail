import test from 'node:test';
import assert from 'node:assert/strict';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { buildHeartbeat, parseSettlementReceiptEvent } from '@openrails/sdk';
import worker, { handleRequest } from '../dist/handler.js';
import { createInMemoryReceiptStorage } from '../dist/storage.js';

const PACKAGE_ID = '0x' + '0'.repeat(64);
const PAYCARD_ID = '0x' + '1'.repeat(64);
const PAYER = '0x' + '2'.repeat(64);
const RECIPIENT = '0x' + '3'.repeat(64);
const env = { OPENRAILS_PACKAGE_ID: PACKAGE_ID, SUI_NETWORK: 'testnet' };

function toHex(bytes) {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

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

async function signedHeartbeat(keypair, overrides = {}) {
  return buildHeartbeat(
    {
      paycardId: PAYCARD_ID,
      poolBalance: 1000n,
      initialAllocation: 1000n,
      maxFlowRatePerSecond: 10n,
      startTimestamp: 1000,
      durationSeconds: 100,
      lastCheckpointTimestamp: 1000,
      status: 'active',
    },
    overrides.timestamp ?? 1010,
    keypair,
    overrides.sequence ?? 1,
    overrides.eventId
  );
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

test('collects signed gateway events idempotently and indexes latest stream state', async () => {
  const keypair = Ed25519Keypair.generate();
  const storage = createInMemoryReceiptStorage();
  const collectorEnv = {
    GATEWAY_PUBLIC_KEY_HEX: toHex(keypair.getPublicKey().toRawBytes()),
    RECEIPT_STORAGE: storage,
  };
  const firstEvent = await signedHeartbeat(keypair, { eventId: 'event-1', sequence: 1, timestamp: 1010 });

  const firstResponse = await handleRequest(
    new Request('https://api.openrails.test/v1/gateway/events', {
      method: 'POST',
      body: JSON.stringify(firstEvent),
      headers: { 'Content-Type': 'application/json' },
    }),
    collectorEnv
  );
  assert.equal(firstResponse.status, 202);
  assert.equal((await json(firstResponse)).data.stateUpdated, true);

  const duplicateResponse = await handleRequest(
    new Request('https://api.openrails.test/v1/gateway/events', {
      method: 'POST',
      body: JSON.stringify(firstEvent),
      headers: { 'Content-Type': 'application/json' },
    }),
    collectorEnv
  );
  assert.equal(duplicateResponse.status, 200);
  assert.equal((await json(duplicateResponse)).data.duplicate, true);

  const conflictEvent = await signedHeartbeat(keypair, { eventId: 'event-1', sequence: 2, timestamp: 1020 });
  const conflictResponse = await handleRequest(
    new Request('https://api.openrails.test/v1/gateway/events', {
      method: 'POST',
      body: JSON.stringify(conflictEvent),
      headers: { 'Content-Type': 'application/json' },
    }),
    collectorEnv
  );
  assert.equal(conflictResponse.status, 409);
});

test('preserves stale gateway events without overwriting newer paycard state', async () => {
  const keypair = Ed25519Keypair.generate();
  const storage = createInMemoryReceiptStorage();
  const collectorEnv = {
    GATEWAY_PUBLIC_KEY_HEX: toHex(keypair.getPublicKey().toRawBytes()),
    RECEIPT_STORAGE: storage,
  };
  const newerEvent = await signedHeartbeat(keypair, { eventId: 'event-10', sequence: 10, timestamp: 1100 });
  const staleEvent = await signedHeartbeat(keypair, { eventId: 'event-5', sequence: 5, timestamp: 1050 });

  for (const event of [newerEvent, staleEvent]) {
    const response = await handleRequest(
      new Request('https://api.openrails.test/v1/gateway/events', {
        method: 'POST',
        body: JSON.stringify(event),
        headers: { 'Content-Type': 'application/json' },
      }),
      collectorEnv
    );
    assert.equal(response.status, 202);
  }

  const streamResponse = await handleRequest(
    new Request(`https://api.openrails.test/v1/streams/${PAYCARD_ID}`),
    collectorEnv
  );
  const streamBody = await json(streamResponse);
  assert.equal(streamResponse.status, 200);
  assert.equal(streamBody.data.latestEventId, 'event-10');

  const eventsResponse = await handleRequest(
    new Request(`https://api.openrails.test/v1/streams/${PAYCARD_ID}/events?limit=1`),
    collectorEnv
  );
  const eventsBody = await json(eventsResponse);
  assert.equal(eventsResponse.status, 200);
  assert.equal(eventsBody.data.length, 1);
  assert.equal(eventsBody.data[0].eventId, 'event-5');
  assert.equal(eventsBody.hasNextPage, true);

  const nextEventsResponse = await handleRequest(
    new Request(`https://api.openrails.test/v1/streams/${PAYCARD_ID}/events?cursor=${eventsBody.nextCursor}`),
    collectorEnv
  );
  const nextEventsBody = await json(nextEventsResponse);
  assert.equal(nextEventsResponse.status, 200);
  assert.equal(nextEventsBody.data[0].eventId, 'event-10');
});

test('returns active public proof data for an indexed stream', async () => {
  const keypair = Ed25519Keypair.generate();
  const storage = createInMemoryReceiptStorage();
  const proofEnv = {
    ...env,
    GATEWAY_PUBLIC_KEY_HEX: toHex(keypair.getPublicKey().toRawBytes()),
    RECEIPT_STORAGE: storage,
  };
  const event = await signedHeartbeat(keypair, { eventId: 'proof-active', sequence: 3, timestamp: 1030 });
  const eventResponse = await handleRequest(
    new Request('https://api.openrails.test/v1/gateway/events', {
      method: 'POST',
      body: JSON.stringify(event),
      headers: { 'Content-Type': 'application/json' },
    }),
    proofEnv
  );
  assert.equal(eventResponse.status, 202);

  const response = await handleRequest(
    new Request(`https://api.openrails.test/v1/proofs/${PAYCARD_ID}`),
    proofEnv
  );
  const body = await json(response);

  assert.equal(response.status, 200);
  assert.equal(body.data.protocolVersion, '1.1');
  assert.equal(body.data.status, 'active');
  assert.equal(body.data.packageId, PACKAGE_ID);
  assert.equal(body.data.paycardId, PAYCARD_ID);
  assert.equal(body.data.latestStreamState.latestEventId, 'proof-active');
  assert.equal(body.data.recentStreamEvents[0].signaturePresent, true);
  assert.equal(body.data.terminalReceipt, null);
  assert.equal(body.data.explorerLinks.paycard.includes(PAYCARD_ID), true);
  assert.equal(body.data.trustBoundaries.some((label) => label.id === 'gateway_projection'), true);
});

test('returns settled public proof data when a terminal receipt exists', async () => {
  const storage = createInMemoryReceiptStorage();
  const receipt = parseSettlementReceiptEvent(receiptEvent({ id: { txDigest: 'settledDigest', eventSeq: '4' } }));
  assert.ok(receipt);
  await storage.putSettlementReceipts([receipt]);

  const response = await handleRequest(
    new Request(`https://api.openrails.test/v1/proofs/${PAYCARD_ID}`),
    { ...env, RECEIPT_STORAGE: storage }
  );
  const body = await json(response);

  assert.equal(response.status, 200);
  assert.equal(body.data.status, 'settled');
  assert.equal(body.data.terminalReceipt.transactionDigest, 'settledDigest');
  assert.equal(body.data.explorerLinks.terminalReceipt.includes('settledDigest'), true);
  assert.equal(body.data.trustBoundaries.some((label) => label.id === 'settlement_receipt'), true);
});

test('returns 404 when public proof data is missing', async () => {
  const response = await handleRequest(
    new Request(`https://api.openrails.test/v1/proofs/${'0x' + '4'.repeat(64)}`),
    { ...env, RECEIPT_STORAGE: createInMemoryReceiptStorage() }
  );
  const body = await json(response);

  assert.equal(response.status, 404);
  assert.equal(body.error.code, 'proof_not_found');
});

test('rejects malformed public proof paycard ids', async () => {
  const response = await handleRequest(
    new Request('https://api.openrails.test/v1/proofs/not-a-paycard'),
    { ...env, RECEIPT_STORAGE: createInMemoryReceiptStorage() }
  );
  const body = await json(response);

  assert.equal(response.status, 400);
  assert.equal(body.error.code, 'invalid_request');
});

test('rejects gateway events with invalid signatures', async () => {
  const keypair = Ed25519Keypair.generate();
  const otherKeypair = Ed25519Keypair.generate();
  const event = await signedHeartbeat(keypair, { eventId: 'event-invalid' });
  const response = await handleRequest(
    new Request('https://api.openrails.test/v1/gateway/events', {
      method: 'POST',
      body: JSON.stringify(event),
      headers: { 'Content-Type': 'application/json' },
    }),
    {
      GATEWAY_PUBLIC_KEY_HEX: toHex(otherKeypair.getPublicKey().toRawBytes()),
      RECEIPT_STORAGE: createInMemoryReceiptStorage(),
    }
  );

  assert.equal(response.status, 401);
  assert.equal((await json(response)).error.code, 'invalid_signature');
});

test('admin receipt indexer persists receipts and receipt routes read indexed storage', async () => {
  const storage = createInMemoryReceiptStorage();
  const indexerEnv = { ...env, ADMIN_TOKEN: 'secret', RECEIPT_STORAGE: storage };
  const client = mockClient({
    data: [receiptEvent({ id: { txDigest: 'digest2', eventSeq: '1' } })],
    nextCursor: null,
    hasNextPage: false,
  });

  const indexResponse = await handleRequest(
    new Request('https://api.openrails.test/admin/index/receipts/run', {
      method: 'POST',
      headers: { Authorization: 'Bearer secret' },
    }),
    indexerEnv,
    client
  );
  const indexBody = await json(indexResponse);
  assert.equal(indexResponse.status, 200);
  assert.equal(indexBody.data.indexed, 1);
  assert.deepEqual(indexBody.data.cursor, { txDigest: 'digest2', eventSeq: '1' });

  const listResponse = await handleRequest(
    new Request('https://api.openrails.test/v1/receipts'),
    indexerEnv,
    mockClient(new Error('live rpc should not be called when storage is configured'))
  );
  const listBody = await json(listResponse);
  assert.equal(listResponse.status, 200);
  assert.equal(listBody.data.length, 1);
  assert.equal(listBody.data[0].transactionDigest, 'digest2');

  const getResponse = await handleRequest(
    new Request(`https://api.openrails.test/v1/receipts/${PAYCARD_ID}`),
    indexerEnv
  );
  const getBody = await json(getResponse);
  assert.equal(getResponse.status, 200);
  assert.equal(getBody.data.paycardId, PAYCARD_ID);
});

test('admin receipt indexer leaves cursor unchanged when storage write fails', async () => {
  const storage = createInMemoryReceiptStorage();
  const failingStorage = {
    ...storage,
    async putSettlementReceipts() {
      throw new Error('write failed');
    },
  };
  const response = await handleRequest(
    new Request('https://api.openrails.test/admin/index/receipts/run', {
      method: 'POST',
      headers: { Authorization: 'Bearer secret' },
    }),
    { ...env, ADMIN_TOKEN: 'secret', RECEIPT_STORAGE: failingStorage },
    mockClient({
      data: [receiptEvent({ id: { txDigest: 'digest3', eventSeq: '2' } })],
      nextCursor: null,
      hasNextPage: false,
    })
  );

  assert.equal(response.status, 502);
  assert.equal(await storage.getIndexerState('settlement_receipts_v1'), null);
});

test('admin receipt indexer requires admin token', async () => {
  const response = await handleRequest(
    new Request('https://api.openrails.test/admin/index/receipts/run', { method: 'POST' }),
    { ...env, ADMIN_TOKEN: 'secret', RECEIPT_STORAGE: createInMemoryReceiptStorage() },
    mockClient({ data: [], nextCursor: null, hasNextPage: false })
  );
  const body = await json(response);

  assert.equal(response.status, 401);
  assert.equal(body.error.code, 'unauthorized');
});

function u64le(n) {
  const bytes = new Array(8).fill(0);
  let v = BigInt(n);
  for (let i = 0; i < 8; i += 1) {
    bytes[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return bytes;
}

function inspectStub(nextValue) {
  return {
    async devInspectTransactionBlock() {
      return { results: [{ returnValues: [[u64le(nextValue), 'u64']] }] };
    },
  };
}

const ACCT = '0x' + 'a'.repeat(64);

test('GET /v1/nonces/:id/:lane returns the lane next value', async () => {
  const response = await handleRequest(
    new Request(`https://api.openrails.test/v1/nonces/${ACCT}/0`),
    env,
    undefined,
    inspectStub(5)
  );
  const body = await json(response);
  assert.equal(response.status, 200);
  assert.equal(body.nonceAccountId, ACCT);
  assert.equal(body.lane, '0');
  assert.equal(body.nextNonce, '5');
});

test('GET /v1/nonces rejects a non-integer lane', async () => {
  const response = await handleRequest(
    new Request(`https://api.openrails.test/v1/nonces/${ACCT}/abc`),
    env,
    undefined,
    inspectStub(5)
  );
  const body = await json(response);
  assert.equal(response.status, 400);
  assert.equal(body.error.code, 'invalid_request');
});

test('GET /v1/nonces rejects a non-hex account id', async () => {
  const response = await handleRequest(
    new Request('https://api.openrails.test/v1/nonces/notanid/0'),
    env,
    undefined,
    inspectStub(5)
  );
  assert.equal(response.status, 400);
});
