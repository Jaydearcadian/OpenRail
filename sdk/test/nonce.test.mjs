import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createNonceEngine } = require("../dist/nonce.js");

function u64le(n) {
  const bytes = new Array(8).fill(0);
  let v = BigInt(n);
  for (let i = 0; i < 8; i += 1) {
    bytes[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return bytes;
}

// Stub Sui client whose devInspect always returns `onChain` as the lane's next value.
function stubClient(onChain) {
  return {
    async devInspectTransactionBlock() {
      return { results: [{ returnValues: [[u64le(onChain), "u64"]] }] };
    },
  };
}

test("peek returns the on-chain next value", async () => {
  const engine = createNonceEngine({
    client: stubClient(4),
    packageId: "0xpkg",
    payer: "0xpayer",
    nonceAccountId: "0xacct",
  });
  assert.equal(await engine.peek({ nonceChannel: 0n }), 4n);
});

test("next reserves locally above the on-chain value, reset re-reads", async () => {
  const engine = createNonceEngine({
    client: stubClient(4),
    packageId: "0xpkg",
    payer: "0xpayer",
    nonceAccountId: "0xacct",
  });

  // On-chain stays 4; consecutive reservations climb 4, 5, 6.
  assert.deepEqual(await engine.next({ nonceChannel: 0n }), { channel: 0n, value: 4n });
  assert.deepEqual(await engine.next({ nonceChannel: 0n }), { channel: 0n, value: 5n });
  assert.deepEqual(await engine.next({ nonceChannel: 0n }), { channel: 0n, value: 6n });

  // A different lane is independent.
  assert.deepEqual(await engine.next({ nonceChannel: 9n }), { channel: 9n, value: 4n });

  // reset drops reservations → back to the on-chain value.
  engine.reset();
  assert.deepEqual(await engine.next({ nonceChannel: 0n }), { channel: 0n, value: 4n });
});
