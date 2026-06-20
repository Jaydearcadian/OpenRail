import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { DEFAULT_OPENRAILS_API_BASE_URL, runOpenRailsCli } = require("../dist/cli.js");
const { OpenRailsApiError } = require("../dist/api.js");

function createIo(env = {}) {
  const output = {
    stdout: "",
    stderr: "",
  };
  return {
    output,
    io: {
      env,
      stdout: {
        write(chunk) {
          output.stdout += String(chunk);
          return true;
        },
      },
      stderr: {
        write(chunk) {
          output.stderr += String(chunk);
          return true;
        },
      },
    },
  };
}

function createClient(overrides) {
  const fail = (method) => async () => {
    throw new Error(`Unexpected ${method} call`);
  };
  return {
    health: fail("health"),
    listReceipts: fail("listReceipts"),
    getReceipt: fail("getReceipt"),
    getStream: fail("getStream"),
    listStreamEvents: fail("listStreamEvents"),
    getProof: fail("getProof"),
    ...overrides,
  };
}

function createFactory(client, baseUrls) {
  return (baseUrl) => {
    baseUrls.push(baseUrl);
    return client;
  };
}

test("health uses the default base URL and writes pretty JSON", async () => {
  const { io, output } = createIo({});
  const baseUrls = [];
  const client = createClient({
    health: async () => ({ ok: true }),
  });

  const exitCode = await runOpenRailsCli(["health"], io, createFactory(client, baseUrls));

  assert.equal(exitCode, 0);
  assert.deepEqual(baseUrls, [DEFAULT_OPENRAILS_API_BASE_URL]);
  assert.equal(output.stdout, `${JSON.stringify({ ok: true }, null, 2)}\n`);
  assert.equal(output.stderr, "");
});

test("base URL flag overrides OPENRAILS_API_BASE_URL", async () => {
  const { io } = createIo({ OPENRAILS_API_BASE_URL: "https://env.example" });
  const baseUrls = [];
  const client = createClient({
    health: async () => ({ ok: true }),
  });

  const exitCode = await runOpenRailsCli(
    ["health", "--base-url", "https://flag.example"],
    io,
    createFactory(client, baseUrls)
  );

  assert.equal(exitCode, 0);
  assert.deepEqual(baseUrls, ["https://flag.example"]);
});

test("receipts list passes filters and cursor options to the API client", async () => {
  const { io, output } = createIo({});
  const calls = [];
  const response = { data: [{ paycardId: "pc1" }], nextCursor: null, hasNextPage: false };
  const client = createClient({
    listReceipts: async (params) => {
      calls.push(params);
      return response;
    },
  });

  const exitCode = await runOpenRailsCli(
    [
      "receipts",
      "list",
      "--limit",
      "25",
      "--order",
      "ascending",
      "--paycard-id",
      "pc1",
      "--payer",
      "payer1",
      "--recipient",
      "recipient1",
      "--settlement-type",
      "2",
      "--cursor-tx-digest",
      "digest1",
      "--cursor-event-seq",
      "7",
    ],
    io,
    createFactory(client, [])
  );

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [
    {
      limit: 25,
      order: "ascending",
      paycardId: "pc1",
      payer: "payer1",
      recipient: "recipient1",
      settlementType: 2,
      cursorTxDigest: "digest1",
      cursorEventSeq: "7",
    },
  ]);
  assert.equal(output.stdout, `${JSON.stringify(response, null, 2)}\n`);
  assert.equal(output.stderr, "");
});

test("receipts get returns not found when the API client returns null", async () => {
  const { io, output } = createIo({});
  const client = createClient({
    getReceipt: async () => null,
  });

  const exitCode = await runOpenRailsCli(["receipts", "get", "missing"], io, createFactory(client, []));

  assert.equal(exitCode, 1);
  assert.equal(output.stdout, "");
  assert.match(output.stderr, /Not found: receipt for paycardId missing/);
});

test("streams and proof commands pass paycard IDs and options to the API client", async () => {
  const calls = [];
  const client = createClient({
    getStream: async (paycardId) => {
      calls.push(["getStream", paycardId]);
      return { paycardId, latestEventId: "event1" };
    },
    listStreamEvents: async (paycardId, params) => {
      calls.push(["listStreamEvents", paycardId, params]);
      return { data: [], nextCursor: null, hasNextPage: false };
    },
    getProof: async (paycardId, params) => {
      calls.push(["getProof", paycardId, params]);
      return { paycardId, receipts: [] };
    },
  });

  let context = createIo({});
  assert.equal(await runOpenRailsCli(["streams", "get", "pc1"], context.io, createFactory(client, [])), 0);

  context = createIo({});
  assert.equal(
    await runOpenRailsCli(
      ["streams", "events", "pc1", "--limit=5", "--cursor", "event0"],
      context.io,
      createFactory(client, [])
    ),
    0
  );

  context = createIo({});
  assert.equal(
    await runOpenRailsCli(
      ["proof", "pc1", "--limit", "3", "--receipt-limit", "2", "--max-pages", "4"],
      context.io,
      createFactory(client, [])
    ),
    0
  );

  assert.deepEqual(calls, [
    ["getStream", "pc1"],
    ["listStreamEvents", "pc1", { limit: 5, cursor: "event0" }],
    ["getProof", "pc1", { limit: 3, receiptLimit: 2, maxPages: 4 }],
  ]);
});

test("usage errors write stderr and return exit code 2", async () => {
  const { io, output } = createIo({});
  const client = createClient({});

  const exitCode = await runOpenRailsCli(
    ["receipts", "list", "--cursor-tx-digest", "digest1"],
    io,
    createFactory(client, [])
  );

  assert.equal(exitCode, 2);
  assert.equal(output.stdout, "");
  assert.match(output.stderr, /Usage error: --cursor-tx-digest and --cursor-event-seq must be provided together/);
});

test("proof requires a paycard ID", async () => {
  const { io, output } = createIo({});
  const client = createClient({});

  const exitCode = await runOpenRailsCli(["proof"], io, createFactory(client, []));

  assert.equal(exitCode, 2);
  assert.equal(output.stdout, "");
  assert.match(output.stderr, /Usage error: proof requires <paycardId>/);
});

test("API failures write clear stderr and return non-zero", async () => {
  const { io, output } = createIo({});
  const client = createClient({
    health: async () => {
      throw new OpenRailsApiError(503, "unavailable", "service unavailable");
    },
  });

  const exitCode = await runOpenRailsCli(["health"], io, createFactory(client, []));

  assert.equal(exitCode, 1);
  assert.equal(output.stdout, "");
  assert.match(output.stderr, /OpenRails API error \(503 unavailable\): service unavailable/);
});

test("help writes usage text and exits successfully", async () => {
  const { io, output } = createIo({});

  const exitCode = await runOpenRailsCli(["--help"], io, () => {
    throw new Error("client factory should not be called");
  });

  assert.equal(exitCode, 0);
  assert.match(output.stdout, /Usage:/);
  assert.equal(output.stderr, "");
});
