import { bcs } from "@mysten/sui/bcs";
import { Transaction } from "@mysten/sui/transactions";
import type { SuiClient } from "@mysten/sui/client";

/**
 * NonceEngine — sources replay-safe nonce values for a payer's V1.2 channel opens.
 *
 * On-chain state (the per-payer `NonceAccount`) is always authoritative. The engine
 * reads the next expected value for a lane via a read-only devInspect of
 * `nonce_account::next_nonce`, and adds a thin local reservation so a burst of opens
 * fired before the chain advances don't collide. If an open fails with a stale nonce
 * (someone else advanced the lane), call `reset()` and request again.
 */
export interface NonceEngineConfig {
  client: SuiClient;
  packageId: string;
  /** Address used as the devInspect sender; should be the NonceAccount's payer. */
  payer: string;
  /** Object id of the payer's shared NonceAccount. */
  nonceAccountId: string;
}

export interface NonceReservation {
  channel: bigint;
  value: bigint;
}

export interface NonceEngine {
  /** Authoritative next value for a lane, read from chain (no reservation). */
  peek(opts: { nonceChannel: bigint }): Promise<bigint>;
  /** Next value to sign with, max(on-chain next, last local reservation + 1). */
  next(opts: { nonceChannel: bigint }): Promise<NonceReservation>;
  /** Drop local reservations (after a stale-nonce error or external advance). */
  reset(): void;
}

export function createNonceEngine(config: NonceEngineConfig): NonceEngine {
  const reserved = new Map<string, bigint>(); // channel(string) -> last reserved value

  async function peek({ nonceChannel }: { nonceChannel: bigint }): Promise<bigint> {
    const tx = new Transaction();
    tx.moveCall({
      target: `${config.packageId}::nonce_account::next_nonce`,
      arguments: [tx.object(config.nonceAccountId), tx.pure.u64(nonceChannel)],
    });

    const res = await config.client.devInspectTransactionBlock({
      sender: config.payer,
      transactionBlock: tx,
    });

    const ret = res.results?.[0]?.returnValues?.[0];
    if (!ret) {
      throw new Error("NonceEngine: next_nonce returned no value (check packageId / nonceAccountId)");
    }
    const [bytes] = ret as [number[], string];
    return BigInt(bcs.u64().parse(Uint8Array.from(bytes)));
  }

  async function next({ nonceChannel }: { nonceChannel: bigint }): Promise<NonceReservation> {
    const key = nonceChannel.toString();
    const onChain = await peek({ nonceChannel });
    const lastReserved = reserved.get(key);
    const candidate = lastReserved === undefined ? onChain : lastReserved + 1n;
    const value = candidate > onChain ? candidate : onChain;
    reserved.set(key, value);
    return { channel: nonceChannel, value };
  }

  function reset(): void {
    reserved.clear();
  }

  return { peek, next, reset };
}
