import {
  GITHUB_REPO_URL,
  GITHUB_DOCS_URL,
  GITHUB_SDK_URL,
  OPENRAILS_PACKAGE_ID,
  explorerObjectUrl,
} from "../config";
import { shortId } from "../lib/format";

const LAYERS = [
  { ln: "layer 5", h: "Frontend", p: "Console operator UI — RailsCard / RailsFlow creation, live rails, receipts.", items: ["· console", "· wallet + zkLogin"] },
  { ln: "layer 4", h: "SDK", p: "Canonical signing, PTB builders, nonce engine, receipt parsing.", items: ["· buildMintPTB", "· queryReceipts"] },
  { ln: "layer 3", h: "Services", p: "Receipt API + gateway projection on Cloudflare Workers.", items: ["· receipt api", "· gateway"] },
  { ln: "layer 2", h: "Storage", p: "D1 receipt index + optional Walrus metadata anchor.", items: ["· receipt index", "· walrus blob"] },
  { ln: "layer 1", h: "Sui Move", p: "Paycard channels, nonce lanes, STN-Delta settlement events.", items: ["· enforceable", "· receipts"] },
];

const PRIMS = [
  { nm: "RailsCard", badge: "b-stream", label: "outbound", p: "A funded grant link. The payer opens a bounded Paycard now; the recipient claims what streams over time.", sig: "card.create({ alloc, rate, recipient }) → link" },
  { nm: "RailsFlow", badge: "b-stream", label: "inbound", p: "A merchant invoice. Signed terms, no on-chain object until the payer funds it from the shared link.", sig: "flow.invoice({ alloc, payer, terms }) → link" },
  { nm: "Paycard<T>", badge: "b-proven", label: "on-chain", p: "The V1.2 channel object. Lazy accrual, capital-bounded — never pays beyond its pool.", sig: "buildClaimPTB(channel) → testnet tx" },
  { nm: "STN-Delta", badge: "b-proven", label: "authoritative", p: "Zero-waste settlement: paid + residual = allocation, routed atomically into a SettlementReceipt.", sig: "querySettlementReceipts(paycardId)" },
];

export function Landing({ onLaunch }: { onLaunch: () => void }) {
  return (
    <div className="grid-bg landing-root">
      <div className="land">
        <nav className="lnav">
          <div className="brand"><span className="glyph" />openrails</div>
          <div className="lnav-links">
            <a href={GITHUB_REPO_URL} target="_blank" rel="noreferrer">github</a>
            <a href={GITHUB_DOCS_URL} target="_blank" rel="noreferrer">docs</a>
            <a href={GITHUB_SDK_URL} target="_blank" rel="noreferrer">sdk</a>
            <a href={explorerObjectUrl(OPENRAILS_PACKAGE_ID)} target="_blank" rel="noreferrer">package</a>
          </div>
          <button type="button" className="btn btn-primary" onClick={onLaunch}>open console →</button>
        </nav>

        <section className="hero">
          <div className="hero-inner">
            <span className="kbadge"><span className="dot live" style={{ background: "var(--blue)" }} />v1.2 live on sui testnet · pkg {shortId(OPENRAILS_PACKAGE_ID, 6, 4)}</span>
            <h1>Payment links,<br />compiled into <span>rails</span>.</h1>
            <p>
              A signed intent becomes an on-chain Paycard channel. Value accrues by lazy
              evaluation — start × rate × elapsed — and closes with a deterministic STN-Delta
              receipt. Real testnet package, public receipt API, open SDK. Build on the proof.
            </p>
            <div className="hero-cta">
              <button type="button" className="btn btn-primary" onClick={onLaunch}>Open the console</button>
              <a className="btn btn-ghost" href={GITHUB_REPO_URL} target="_blank" rel="noreferrer">View on GitHub →</a>
            </div>
          </div>
          <div className="term">
            <div className="term-bar"><i /><i /><i /><span className="ttl">openrails — open channel</span></div>
            <div className="term-body mono">
              <div><span className="c1">$</span> rails card create <span className="a">--alloc</span> 0.05 <span className="a">--rate</span> 0.0005/s</div>
              <div><span className="g">✓</span> envelope <span className="k">signed</span> <span className="c1">(canonical json)</span></div>
              <div><span className="g">✓</span> nonce lane <span className="k">consumed</span> <span className="c1">(replay-safe)</span></div>
              <div><span className="g">✓</span> channel <span className="k">opened</span> <span className="c1">→ paycard 0x…</span></div>
              <div><span className="g">→</span> link: openrails…/r/<span className="k">0x…</span></div>
            </div>
          </div>
        </section>

        <div className="stack">
          {LAYERS.map((l) => (
            <div className="layer" key={l.ln}>
              <div className="ln">{l.ln}</div>
              <h4>{l.h}</h4>
              <p>{l.p}</p>
              <ul>{l.items.map((i) => <li key={i}>{i}</li>)}</ul>
            </div>
          ))}
        </div>

        <div className="shead"><div className="ey">// primitives</div><h2>The objects you build with.</h2></div>
        <div className="prims">
          {PRIMS.map((p) => (
            <div className="prim" key={p.nm}>
              <div className="h"><span className="nm">{p.nm}</span><span className={`badge ${p.badge}`}>{p.label}</span></div>
              <p>{p.p}</p>
              <div className="sig mono">{p.sig}</div>
            </div>
          ))}
        </div>

        <div className="lcta">
          <h2>Open a real streaming channel on Sui testnet.</h2>
          <div className="hero-cta">
            <button type="button" className="btn btn-primary" onClick={onLaunch}>Launch console →</button>
            <a className="btn btn-ghost" href={GITHUB_DOCS_URL} target="_blank" rel="noreferrer">Read the docs</a>
          </div>
        </div>

        <footer>
          <span>openrails · intent-driven settlement on sui</span>
          <span className="lnav-links">
            <a href={GITHUB_REPO_URL} target="_blank" rel="noreferrer">github</a>
            <a href={GITHUB_DOCS_URL} target="_blank" rel="noreferrer">docs</a>
            <a href={explorerObjectUrl(OPENRAILS_PACKAGE_ID)} target="_blank" rel="noreferrer">testnet package</a>
          </span>
        </footer>
      </div>
    </div>
  );
}
