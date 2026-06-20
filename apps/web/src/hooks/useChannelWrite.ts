import { useCallback, useState } from "react";
import { useCurrentAccount, useSignAndExecuteTransaction, useSuiClient } from "@mysten/dapp-kit";
import {
  buildMintPTB,
  buildClaimPTB,
  buildCancelPTB,
  buildResolvePTB,
  buildCreateNonceAccountPTB,
  createNonceEngine,
} from "@openrails/sdk";
import { OPENRAILS_PACKAGE_ID, SUI_NETWORK, SUI_COIN_TYPE } from "../config";

/** The public write state machine surfaced to the UI (V1.2 write UX states). */
export type WriteStatus =
  | { kind: "idle" }
  | { kind: "disconnected" }
  | { kind: "wrong-network" }
  | { kind: "insufficient-balance"; need: bigint; have: bigint }
  | { kind: "pending-signature" }
  | { kind: "submitted"; digest: string }
  | { kind: "finalizing"; digest: string }
  | { kind: "confirmed"; digest: string; objectId?: string }
  | { kind: "stale-nonce" }
  | { kind: "rejected" }
  | { kind: "failed"; message: string };

export interface OpenRailParams {
  amount: bigint;
  rate: bigint;
  recipient: string;
  durationSeconds: number;
  recovery: string;
  metadataHash?: Uint8Array;
  nonceChannel?: bigint;
}

type TxResult = Awaited<ReturnType<ReturnType<typeof useSuiClient>["waitForTransaction"]>>;

function createdObjectId(res: TxResult, typeSuffix: string): string | undefined {
  const changes = (res.objectChanges ?? []) as Array<{ type?: string; objectType?: string; objectId?: string }>;
  return changes.find((c) => c.type === "created" && typeof c.objectType === "string" && c.objectType.includes(typeSuffix))
    ?.objectId;
}

function nonceKey(address: string): string {
  return `openrails:nonceAccount:${SUI_NETWORK}:${OPENRAILS_PACKAGE_ID}:${address}`;
}

function classifyError(error: unknown): WriteStatus {
  const message = error instanceof Error ? error.message : String(error);
  if (/reject|denied|cancel/i.test(message)) return { kind: "rejected" };
  if (/E_NONCE_MISMATCH|402|nonce/i.test(message)) return { kind: "stale-nonce" };
  return { kind: "failed", message };
}

export function useChannelWrite() {
  const account = useCurrentAccount();
  const client = useSuiClient();
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();
  const [status, setStatus] = useState<WriteStatus>({ kind: "idle" });

  const reset = useCallback(() => setStatus({ kind: "idle" }), []);

  const connected = Boolean(account);
  const onNetwork = !account || account.chains.some((c) => c === `sui:${SUI_NETWORK}`);

  /** Sign + execute, then wait for parsed effects/objectChanges. Threads UX states. */
  const exec = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (transaction: any): Promise<TxResult> => {
      setStatus({ kind: "pending-signature" });
      const signed = await signAndExecute({ transaction });
      setStatus({ kind: "submitted", digest: signed.digest });
      setStatus({ kind: "finalizing", digest: signed.digest });
      const res = await client.waitForTransaction({
        digest: signed.digest,
        options: { showEffects: true, showObjectChanges: true, showEvents: true },
      });
      return res;
    },
    [client, signAndExecute],
  );

  const ensureNonceAccount = useCallback(
    async (address: string): Promise<string> => {
      const cached = typeof localStorage !== "undefined" ? localStorage.getItem(nonceKey(address)) : null;
      if (cached) return cached;
      const res = await exec(buildCreateNonceAccountPTB(OPENRAILS_PACKAGE_ID));
      const id = createdObjectId(res, "::nonce_account::NonceAccount");
      if (!id) throw new Error("Could not read the created NonceAccount id from effects.");
      if (typeof localStorage !== "undefined") localStorage.setItem(nonceKey(address), id);
      return id;
    },
    [exec],
  );

  const open = useCallback(
    async (params: OpenRailParams): Promise<{ paycardId?: string; digest: string } | null> => {
      if (!account) {
        setStatus({ kind: "disconnected" });
        return null;
      }
      if (!onNetwork) {
        setStatus({ kind: "wrong-network" });
        return null;
      }
      try {
        // Funding coin: a SUI coin object the payer owns (Move splits `amount` from it).
        const coins = await client.getCoins({ owner: account.address, coinType: SUI_COIN_TYPE });
        const total = coins.data.reduce((sum, c) => sum + BigInt(c.balance), 0n);
        if (total < params.amount) {
          setStatus({ kind: "insufficient-balance", need: params.amount, have: total });
          return null;
        }
        const funding = [...coins.data].sort((a, b) => (BigInt(b.balance) > BigInt(a.balance) ? 1 : -1))[0];

        const channel = params.nonceChannel ?? 0n;
        const nonceAccountObjectId = await ensureNonceAccount(account.address);
        const engine = createNonceEngine({
          client,
          packageId: OPENRAILS_PACKAGE_ID,
          payer: account.address,
          nonceAccountId: nonceAccountObjectId,
        });

        const runOpen = async (nonceValue: bigint) => {
          const tx = buildMintPTB({
            packageId: OPENRAILS_PACKAGE_ID,
            coinObjectId: funding.coinObjectId,
            totalProvisionAmount: params.amount,
            maxFlowRatePerSecond: params.rate,
            recipient: params.recipient,
            startTimestamp: 0,
            durationSeconds: params.durationSeconds,
            recoveryTarget: params.recovery,
            typeArgument: SUI_COIN_TYPE,
            nonceAccountObjectId,
            nonceChannel: channel,
            nonceValue,
            metadataHash: params.metadataHash,
          });
          return exec(tx);
        };

        let res: TxResult;
        try {
          res = await runOpen((await engine.next({ nonceChannel: channel })).value);
        } catch (error) {
          const classified = classifyError(error);
          if (classified.kind !== "stale-nonce") throw error;
          engine.reset();
          res = await runOpen((await engine.next({ nonceChannel: channel })).value);
        }

        const paycardId = createdObjectId(res, "::paycard_v1::Paycard");
        setStatus({ kind: "confirmed", digest: res.digest, objectId: paycardId });
        return { paycardId, digest: res.digest };
      } catch (error) {
        setStatus(classifyError(error));
        return null;
      }
    },
    [account, client, ensureNonceAccount, exec, onNetwork],
  );

  const lifecycle = useCallback(
    async (
      action: "claim" | "cancel" | "resolve",
      paycardId: string,
      typeArgument = SUI_COIN_TYPE,
    ): Promise<{ digest: string } | null> => {
      if (!account) {
        setStatus({ kind: "disconnected" });
        return null;
      }
      try {
        const common = { packageId: OPENRAILS_PACKAGE_ID, paycardObjectId: paycardId, typeArgument };
        const tx =
          action === "claim" ? buildClaimPTB(common) : action === "cancel" ? buildCancelPTB(common) : buildResolvePTB(common);
        const res = await exec(tx);
        setStatus({ kind: "confirmed", digest: res.digest });
        return { digest: res.digest };
      } catch (error) {
        setStatus(classifyError(error));
        return null;
      }
    },
    [account, exec],
  );

  return {
    status,
    reset,
    connected,
    onNetwork,
    address: account?.address,
    open,
    claim: (id: string, type?: string) => lifecycle("claim", id, type),
    cancel: (id: string, type?: string) => lifecycle("cancel", id, type),
    resolve: (id: string, type?: string) => lifecycle("resolve", id, type),
  };
}
