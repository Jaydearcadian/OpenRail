import { useEffect, useState } from "react";
import { cockpitProof, mockDataMeta, proofLinks, proofStats } from "../data/mock";

interface LandingPageProps {
  onLaunch: () => void;
}

const PACKAGE_HREF =
  "https://suiexplorer.com/object/0x7cb4ca17166b7999223d665db2e43991288b1fd8466b930e4c2a345e847aaf55?network=testnet";
const PROOF_HREF = proofLinks[0]?.href ?? PACKAGE_HREF;

const navItems = [
  { label: "How it works", href: "#how" },
  { label: "Primitives", href: "#primitives" },
  { label: "Use cases", href: "#usecases" },
  { label: "Proof", href: "#proof" },
];

const ribbonSteps = [
  { ri: "i", title: "Intent", copy: "You sign exactly what's authorized — terms, rate, and allocation." },
  { ri: "ii", title: "Channel", copy: "The intent opens a bounded Paycard channel on Sui." },
  { ri: "iii", title: "Accrual", copy: "Value flows by time × rate, projected live by the gateway." },
  { ri: "iv", title: "STN-Delta", copy: "Earned and residual route automatically — nothing is wasted." },
  { ri: "v", title: "Receipt", copy: "A terminal SettlementReceipt proves the on-chain outcome." },
];

const primitives = [
  { ic: "C", tone: "clay", name: "RailsCard", copy: "An outbound funded grant. A sealed link the recipient unseals into a bounded channel.", ex: "grants · allowances · agent access" },
  { ic: "F", tone: "sage", name: "RailsFlow", copy: "An inbound invoice. Request payment under signed terms, claimed over elapsed time.", ex: "invoices · subscriptions · checkout" },
  { ic: "P", tone: "sky", name: "Paycard channel", copy: "The on-chain pipe. Value accrues lazily and can never drain past its allocation.", ex: "bounded · lazy · capital-safe" },
  { ic: "R", tone: "plum", name: "STN-Delta receipt", copy: "Zero-waste settlement: earned + residual = initial. Proof of what paid and what returned.", ex: "depleted · expired · cancelled" },
];

const useCases = [
  { uic: "i", title: "Agent compute", copy: "Grant an AI agent a bounded compute allowance that streams as it works." },
  { uic: "ii", title: "AI usage invoices", copy: "Bill metered inference over elapsed time, settled by receipt." },
  { uic: "iii", title: "Creator access", copy: "Subscriptions and access passes that flow while they're active." },
  { uic: "iv", title: "Pay-over-time", copy: "Checkout where value is claimed gradually, not all at once." },
];

const trustRows = [
  { ic: "🌿", lead: "Testnet-proven:", body: "the V1.1 package, live channels, claim, STN-Delta settlement and receipts all run on Sui testnet." },
  { ic: "🟠", lead: "Simulated here:", body: "wallet connect and live submission are mocked in this read-only dashboard — no signatures, no writes." },
  { ic: "💧", lead: "Projections are gentle:", body: "signed gateway heartbeats estimate accrual for UX. The SettlementReceipt is the truth." },
];

function Wave() {
  return (
    <div className="wave" aria-hidden="true">
      <svg viewBox="0 0 400 54" preserveAspectRatio="none">
        <path d="M0 34 Q50 14 100 30 T200 28 T300 32 T400 26 V54 H0 Z" fill="oklch(0.64 0.12 45 / 0.5)" />
        <path d="M0 40 Q50 24 100 36 T200 34 T300 38 T400 32 V54 H0 Z" fill="oklch(0.62 0.08 232 / 0.32)" />
      </svg>
    </div>
  );
}

export function LandingPage({ onLaunch }: LandingPageProps) {
  const [scrolled, setScrolled] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    let val = 0.009612;
    const el = document.getElementById("heroLiveValue");
    const iv = setInterval(() => {
      val += 0.000043 + Math.random() * 0.000015;
      if (el) el.textContent = val.toFixed(6);
    }, 900);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    const els = Array.from(document.querySelectorAll<HTMLElement>(".reveal"));
    if (!("IntersectionObserver" in window)) {
      els.forEach((el) => el.classList.add("in"));
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("in");
            obs.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -40px 0px" },
    );
    els.forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, []);

  const closeSheet = () => setSheetOpen(false);

  return (
    <main className="land">
      <nav className={`lnav ${scrolled ? "scrolled" : ""}`} aria-label="Primary">
        <a className="brand" href="#top" aria-label="OpenRails home">
          <span className="mark" aria-hidden="true" />
          OpenRails
        </a>
        <div className="lnav-links">
          {navItems.map((item) => (
            <a key={item.href} href={item.href}>{item.label}</a>
          ))}
        </div>
        <div className="lnav-right">
          <a className="secondary" href={PROOF_HREF} target="_blank" rel="noreferrer">View testnet proof</a>
          <button type="button" className="btn btn-primary" onClick={onLaunch}>Open dashboard</button>
          <button type="button" className="lnav-burger" aria-label="Open menu" onClick={() => setSheetOpen(true)}>☰</button>
        </div>
      </nav>

      <div className={`lnav-sheet ${sheetOpen ? "open" : ""}`}>
        <div className="sheet-top">
          <a className="brand" href="#top" onClick={closeSheet}><span className="mark" aria-hidden="true" />OpenRails</a>
          <button type="button" className="lnav-burger" aria-label="Close menu" onClick={closeSheet}>×</button>
        </div>
        <nav aria-label="Mobile">
          {navItems.map((item) => (
            <a key={item.href} href={item.href} onClick={closeSheet}>{item.label}</a>
          ))}
        </nav>
        <button type="button" className="btn btn-primary" onClick={() => { closeSheet(); onLaunch(); }}>Open dashboard</button>
      </div>

      <section id="top" className="hero">
        <div>
          <span className="chip c-testnet"><span className="acc-dot" />V1.1 · Live on Sui Testnet</span>
          <h1 className="serif">Money that <span className="it">flows</span>, with proof of where it went.</h1>
          <p className="hero-copy">
            OpenRails turns a payment link into a bounded Paycard channel on Sui. Value accrues by
            time × rate, can never drain past its allocation, and closes with an STN-Delta receipt
            that proves exactly what was paid and what came back.
          </p>
          <div className="hero-actions">
            <button type="button" onClick={onLaunch}>Open the dashboard</button>
            <a href="#how">How it works</a>
          </div>
          <p className="prototype-note">Read-only UI preview. {mockDataMeta.liveIntegrations}.</p>
        </div>
        <div className="hero-art">
          <div className="flowcard">
            <div className="ft">RailsCard · channel {cockpitProof.paycardId}</div>
            <div className="fb">◎ <span id="heroLiveValue">0.009612</span><small> SUI</small></div>
            <Wave />
            <div className="meta">
              <span>+ 0.00005 SUI / sec</span>
              <span>64% of 0.015</span>
            </div>
          </div>
          <div className="mini a"><span className="dot" style={{ background: "var(--sage)" }} />Receipt verified</div>
          <div className="mini b"><span className="dot" style={{ background: "var(--sky)" }} />Encrypted link</div>
        </div>
      </section>

      <section id="how" className="ribbon reveal" aria-label="How it works">
        {ribbonSteps.map((step) => (
          <div key={step.ri} className="rstep">
            <div className="ri">{step.ri}</div>
            <h4>{step.title}</h4>
            <p>{step.copy}</p>
          </div>
        ))}
      </section>

      <section id="primitives">
        <div className="shead reveal">
          <span className="eyebrow">Primitives</span>
          <h2 className="serif">Two kinds of links.<br />One trail of <span className="it">proof.</span></h2>
          <p>Whether you send an allowance or bill a customer, every channel carries signed terms and a value-conserving receipt.</p>
        </div>
        <div className="prims reveal">
          {primitives.map((p) => (
            <article key={p.name} className="prim">
              <div className="ic" style={{ background: `var(--${p.tone}-soft)`, color: `var(--${p.tone})` }}>{p.ic}</div>
              <h3 className="serif">{p.name}</h3>
              <p>{p.copy}</p>
              <div className="ex">{p.ex}</div>
            </article>
          ))}
        </div>
      </section>

      <section>
        <div className="shead reveal">
          <span className="eyebrow">Trust boundary</span>
          <h2 className="serif">What's real, <span className="it">honestly.</span></h2>
        </div>
        <div className="trust-card reveal">
          {trustRows.map((row) => (
            <div key={row.lead} className="row">
              <span className="ic" aria-hidden="true">{row.ic}</span>
              <div><b>{row.lead}</b> {row.body}</div>
            </div>
          ))}
        </div>
      </section>

      <section id="usecases">
        <div className="shead reveal">
          <span className="eyebrow">Use cases</span>
          <h2 className="serif">Rails for the <span className="it">machine economy.</span></h2>
          <p>Bounded, streaming payments for agents, APIs, and creators — settled by receipt, not trust.</p>
        </div>
        <div className="usecases reveal">
          {useCases.map((u) => (
            <article key={u.title} className="usecase">
              <div className="uic">{u.uic}</div>
              <h4>{u.title}</h4>
              <p>{u.copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="proof">
        <div className="shead reveal">
          <span className="eyebrow">Proof</span>
          <h2 className="serif">Testnet events exist. The UI stays <span className="it">honest.</span></h2>
        </div>
        <div className="proof-strip reveal">
          {proofStats.map((item) => (
            <span key={item}>{item}</span>
          ))}
        </div>
        <div className="proof-links reveal">
          {proofLinks.map((proof) => (
            proof.href ? (
              <a key={proof.label} href={proof.href} target="_blank" rel="noreferrer">
                <strong>{proof.label}</strong>
                <span>{proof.detail}</span>
              </a>
            ) : (
              <span key={proof.label}>
                <strong>{proof.label}</strong>
                <span>{proof.detail}</span>
              </span>
            )
          ))}
        </div>
      </section>

      <section className="lcta reveal">
        <h2 className="serif">Watch a rail <span className="it">flow.</span></h2>
        <p>Step inside the cockpit — live channels, gentle projections, and receipts you can verify.</p>
        <button type="button" className="btn btn-primary" onClick={onLaunch}>Open the dashboard →</button>
      </section>

      <footer className="land-footer">
        <div className="footer-cols">
          <div className="footer-brand">
            <a className="brand" href="#top"><span className="mark" aria-hidden="true" />OpenRails</a>
            <p>Streaming payment rails on Sui. Bounded Paycard channels that accrue by time × rate and close with verifiable STN-Delta receipts.</p>
            <div className="footer-badges">
              <span className="chip c-testnet"><span className="dot" style={{ background: "var(--sage)" }} />Sui Testnet</span>
              <span className="chip c-mock"><span className="dot" style={{ background: "var(--clay)" }} />Read-only UI</span>
            </div>
          </div>
          <div className="footer-col">
            <h5>Product</h5>
            <a href="#how">How it works</a>
            <a href="#primitives">Primitives</a>
            <a href="#usecases">Use cases</a>
            <button type="button" className="footer-linkbtn" onClick={onLaunch} style={{ color: "inherit", textAlign: "left", padding: "5px 0", fontSize: 14 }}>Open dashboard</button>
          </div>
          <div className="footer-col">
            <h5>Proof &amp; Protocol</h5>
            <a href={PACKAGE_HREF} target="_blank" rel="noreferrer">Package on Sui Explorer</a>
            {proofLinks.map((proof) => (
              proof.href ? <a key={proof.label} href={proof.href} target="_blank" rel="noreferrer">{proof.label}</a> : null
            ))}
          </div>
        </div>
        <div className="footer-bottom">
          <span>Built for Sui · V1.1 testnet prototype · © 2026</span>
          <span>Testnet only — do not send mainnet funds.</span>
        </div>
      </footer>
    </main>
  );
}
