import { useState } from "react";
import {
  useWallets,
  useConnectWallet,
  useCurrentAccount,
  useDisconnectWallet,
  useSuiClientQuery,
} from "@mysten/dapp-kit";
import { isEnokiWallet } from "@mysten/enoki";
import type { WalletWithRequiredFeatures } from "@mysten/wallet-standard";

function short(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function formatSui(mist: string | undefined): string {
  if (!mist) return "0";
  const v = BigInt(mist);
  const whole = v / 1_000_000_000n;
  const frac = (v % 1_000_000_000n).toString().padStart(9, "0").replace(/0+$/, "").slice(0, 4);
  return frac ? `${whole}.${frac}` : whole.toString();
}

function ConnectedChip({ address }: { address: string }) {
  const { data } = useSuiClientQuery("getBalance", { owner: address });
  const { mutate: disconnect } = useDisconnectWallet();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  function copy() {
    navigator.clipboard.writeText(address).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div className="connect-wrap">
      <button type="button" className="connect-chip" onClick={() => setOpen((v) => !v)}>
        <span className="connect-dot" aria-hidden="true" />
        <span className="mono">{short(address)}</span>
        <span className="connect-bal">◎ {formatSui(data?.totalBalance)}</span>
      </button>
      {open ? (
        <div className="connect-menu" role="menu">
          <div className="connect-menu-head mono" style={{ userSelect: "all" }}>{address}</div>
          <button type="button" className="connect-menu-item" onClick={copy}>
            {copied ? "Copied!" : "Copy address"}
          </button>
          <button type="button" className="connect-menu-item" onClick={() => { disconnect(); setOpen(false); }}>
            Disconnect
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function ConnectMenu() {
  const wallets = useWallets();
  const account = useCurrentAccount();
  const { mutate: connect, isPending, error } = useConnectWallet();
  const [open, setOpen] = useState(false);

  if (account) return <ConnectedChip address={account.address} />;

  const enokiWallets = wallets.filter(isEnokiWallet);
  const standardWallets = wallets.filter((w) => !isEnokiWallet(w)) as WalletWithRequiredFeatures[];

  const choose = (wallet: WalletWithRequiredFeatures) => {
    connect({ wallet });
    setOpen(false);
  };

  const errMsg = error
    ? ((error as { cause?: Error }).cause?.message ?? (error as Error).message ?? String(error))
    : null;

  return (
    <div className="connect-wrap">
      <button type="button" className="btn btn-primary connect-btn" onClick={() => setOpen((v) => !v)} disabled={isPending}>
        {isPending ? "Connecting…" : "Connect"}
      </button>
      {errMsg ? (
        <div style={{ position: "absolute", top: "100%", right: 0, marginTop: 4, background: "#1a0a0a", border: "1px solid #c0392b", color: "#e74c3c", padding: "6px 10px", borderRadius: 4, fontSize: 11, fontFamily: "var(--font-mono, monospace)", maxWidth: 280, zIndex: 200, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
          {errMsg}
        </div>
      ) : null}
      {open ? (
        <div className="connect-menu" role="menu">
          {enokiWallets.length > 0 ? (
            <>
              <div className="connect-menu-label">Sign in</div>
              {enokiWallets.map((wallet) => (
                <button key={wallet.name} type="button" className="connect-menu-item" onClick={() => choose(wallet as WalletWithRequiredFeatures)}>
                  {wallet.icon ? <img src={wallet.icon} alt="" width={18} height={18} /> : null}
                  {wallet.name}
                </button>
              ))}
            </>
          ) : null}

          <div className="connect-menu-label">Wallets</div>
          {standardWallets.length === 0 ? (
            <div className="connect-menu-empty">No Sui wallet detected. Install Slush or Suiet.</div>
          ) : (
            standardWallets.map((wallet) => (
              <button key={wallet.name} type="button" className="connect-menu-item" onClick={() => choose(wallet)}>
                {wallet.icon ? <img src={wallet.icon} alt="" width={18} height={18} /> : null}
                {wallet.name}
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
