import { useCallback, useMemo, useState } from "react";
import {
  useCurrentAccount,
  useCurrentWallet,
  useSignAndExecuteTransaction,
  useSignTransaction,
  useSuiClient,
} from "@mysten/dapp-kit";
import { EnokiClient, isEnokiWallet, getSession } from "@mysten/enoki";
import { Transaction } from "@mysten/sui/transactions";
import { fromBase64, toBase64 } from "@mysten/sui/utils";
import {
  buildMintPTB,
  buildClaimPTB,
  buildCancelPTB,
  buildResolvePTB,
  buildCreateNonceAccountPTB,
  createNonceEngine,
} from "@openrails/sdk";
import {
  OPENRAILS_PACKAGE_ID,
  SUI_NETWORK,
  SUI_COIN_TYPE,
  ENOKI_API_KEY,
  ENOKI_SPONSORED_WRITES,
} from "../config";

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
  if (/no valid gas|gas coin|insufficient.*gas|InsufficientGas|gas budget/i.test(message)) {
    return { kind: "failed", message: "No testnet SUI for gas. Fund this address at faucet.sui.io (testnet), switch your wallet to Sui Testnet, or sign in with Google for sponsored gas." };
  }
  if (/redefine property: ethereum|cannot set property ethereum|provider injection|isZerion|window\.ethereum/i.test(message)) {
    return { kind: "failed", message: "A browser wallet-extension conflict blocked signing. Disable extra wallet extensions (MetaMask / Zerion / Rabby) or use Google sign-in, then retry." };
  }
  return { kind: "failed", message };
}

export function useChannelWrite() {
  const account = useCurrentAccount();
  const client = useSuiClient();
  const { currentWallet } = useCurrentWallet();
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();
  const { mutateAsync: signTransaction } = useSignTransaction();
  const [status, setStatus] = useState<WriteStatus>({ kind: "idle" });

  const reset = useCallback(() => setStatus({ kind: "idle" }), []);

  const connected = Boolean(account);
  const onNetwork = !account || account.chains.some((c) => c === `sui:${SUI_NETWORK}`);

  // zkLogin (Enoki) wallets sign silently; when an Enoki key is configured we
  // route their writes through Enoki gas sponsorship so they pay no network fee.
  const isZkLogin = Boolean(currentWallet && isEnokiWallet(currentWallet));
  const sponsored = isZkLogin && ENOKI_SPONSORED_WRITES;
  const enokiClient = useMemo(
    () => (ENOKI_SPONSORED_WRITES ? new EnokiClient({ apiKey: ENOKI_API_KEY }) : null),
    [],
  );

  /** Sign + execute, then wait for parsed effects/objectChanges. Threads UX states. */
  const exec = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (transaction: any): Promise<TxResult> => {
      setStatus({ kind: "pending-signature" });

      // Direct path: the connected wallet (zkLogin or standard) signs & pays gas.
      const runDirect = async (): Promise<string> => {
        const signed = await signAndExecute({ transaction, chain: `sui:${SUI_NETWORK}` });
        setStatus({ kind: "submitted", digest: signed.digest });
        setStatus({ kind: "finalizing", digest: signed.digest });
        return signed.digest;
      };

      let digest: string;
      if (sponsored && enokiClient && currentWallet) {
        // Enoki zkLogin sponsorship (JWT mode): Enoki derives the sender from the
        // authenticated Google identity and applies the *portal* allowlist — no
        // per-user address registration. Any signed-in Gmail user is sponsored.
        try {
          const session = await getSession(currentWallet);
          const jwt = session?.jwt;
          if (!jwt) throw new Error("No zkLogin session — sign in with Google again.");
          // Clone for kind-only build so the original tx stays pristine for fallback.
          const kindBytes = await Transaction.from(transaction).build({ client, onlyTransactionKind: true });
          const created = await enokiClient.createSponsoredTransaction({
            network: SUI_NETWORK,
            transactionKindBytes: toBase64(kindBytes),
            jwt,
          });
          const { signature } = await signTransaction({
            transaction: Transaction.from(fromBase64(created.bytes)),
            chain: `sui:${SUI_NETWORK}`,
          });
          setStatus({ kind: "submitted", digest: created.digest });
          setStatus({ kind: "finalizing", digest: created.digest });
          await enokiClient.executeSponsoredTransaction({ digest: created.digest, signature });
          digest = created.digest;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (/reject|denied|cancel/i.test(msg)) throw err; // user cancelled — don't retry
          // Sponsorship unavailable (e.g. Enoki 403 — portal not yet configured).
          // Fall back to the zkLogin user paying their own gas, if they hold SUI.
          digest = await runDirect();
        }
      } else {
        digest = await runDirect();
      }

      const res = await client.waitForTransaction({
        digest,
        options: { showEffects: true, showObjectChanges: true, showEvents: true },
      });
      return res;
    },
    [account, client, currentWallet, enokiClient, signAndExecute, signTransaction, sponsored],
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
        // Non-sponsored writes also pay gas from this balance, so require a small
        // headroom on top of the allocation; sponsored (zkLogin) writes pay no gas.
        const gasBuffer = sponsored ? 0n : 20_000_000n; // ~0.02 SUI for nonce + mint gas
        const coins = await client.getCoins({ owner: account.address, coinType: SUI_COIN_TYPE });
        const total = coins.data.reduce((sum, c) => sum + BigInt(c.balance), 0n);
        if (total < params.amount + gasBuffer) {
          setStatus({ kind: "insufficient-balance", need: params.amount + gasBuffer, have: total });
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
    [account, client, ensureNonceAccount, exec, onNetwork, sponsored],
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
    isZkLogin,
    sponsored,
    address: account?.address,
    open,
    claim: (id: string, type?: string) => lifecycle("claim", id, type),
    cancel: (id: string, type?: string) => lifecycle("cancel", id, type),
    resolve: (id: string, type?: string) => lifecycle("resolve", id, type),
  };
}
