import { cockpitProof, mockDataMeta, proofLinks, proofStats } from "../data/mock";

interface LandingPageProps {
  onLaunch: () => void;
}

const navItems = [
  { label: "Product", href: "#product" },
  { label: "Protocol", href: "#how" },
  { label: "Receipts", href: "#receipts" },
  { label: "Gateway", href: "#gateway" },
  { label: "Proof", href: "#proof" },
  { label: "Dashboard", href: "#dashboard" },
];

export function LandingPage({ onLaunch }: LandingPageProps) {
  return (
    <main className="landing-page">
      <div className="landing-bg" aria-hidden="true" />

      <nav className="landing-nav" aria-label="Landing navigation">
        <a className="brand-lockup" href="#top" aria-label="OpenRails home">
          <span className="brand-glyph">OR</span>
          <span className="brand-mark">OpenRails</span>
        </a>
        <div className="nav-links">
          {navItems.map((item) => (
            <a key={item.href} href={item.href}>{item.label}</a>
          ))}
        </div>
        <div className="nav-actions">
          <a
            className="secondary-nav"
            href="https://suiexplorer.com/object/0x1809f38156fb5f2724708523ebcce13f04c8bda613c9e9b87ed8ace9b632e627?network=testnet"
            target="_blank"
            rel="noreferrer"
          >
            View proof
          </a>
          <button type="button" onClick={onLaunch}>Open live dashboard</button>
        </div>
      </nav>

      <section id="top" className="hero hero-redesign">
        <div className="hero-copy-block">
          <p className="eyebrow">OpenRails V1 clearing cockpit</p>
          <h1>Signed rails for private Sui payment streams.</h1>
          <p className="hero-copy">
            OpenRails converts payment links into encrypted Permission Envelopes, sealed
            Sui funding objects, gateway-projected streams, and terminal settlement receipts.
            This cockpit keeps read-only Worker data and every proof boundary visible.
          </p>
          <div className="protocol-line" aria-label="OpenRails protocol sequence">
            <span>sign</span>
            <i aria-hidden="true" />
            <span>seal</span>
            <i aria-hidden="true" />
            <span>stream</span>
            <i aria-hidden="true" />
            <span>settle</span>
            <i aria-hidden="true" />
            <span>verify</span>
          </div>
          <div className="hero-actions">
            <button type="button" onClick={onLaunch}>Open live dashboard</button>
            <a
              href="https://suiexplorer.com/object/0x1809f38156fb5f2724708523ebcce13f04c8bda613c9e9b87ed8ace9b632e627?network=testnet"
              target="_blank"
              rel="noreferrer"
            >
              View testnet proof
            </a>
          </div>
          <p className="prototype-note">
            Read-only UI preview. {mockDataMeta.liveIntegrations}.
          </p>
        </div>

        <aside className="hero-proof-object" aria-labelledby="hero-proof-title">
          <span className="proof-object-kicker">Audit object</span>
          <h2 id="hero-proof-title">RailsCard proof packet</h2>
          <dl>
            <div>
              <dt>Envelope</dt>
              <dd>{cockpitProof.envelope}</dd>
            </div>
            <div>
              <dt>Walrus blob</dt>
              <dd>{cockpitProof.walrusBlob}</dd>
            </div>
            <div>
              <dt>Paycard</dt>
              <dd>{cockpitProof.paycardId}</dd>
            </div>
            <div>
              <dt>Receipt digest</dt>
              <dd>{cockpitProof.receiptDigest}</dd>
            </div>
          </dl>
          <p>{cockpitProof.boundary}</p>
        </aside>
      </section>

      <section className="proof-strip" aria-label="OpenRails V1 proof points">
        {proofStats.map((item) => (
          <span key={item}>{item}</span>
        ))}
      </section>

      <section id="product" className="landing-section product-grid" aria-labelledby="product-title">
        <div className="section-copy">
          <p className="eyebrow">Product</p>
          <h2 id="product-title">Payment links with real settlement boundaries.</h2>
          <p>
            The old payment link is a static URL. OpenRails makes it signed, encrypted,
            streamable, and receipt-backed, so payers and merchants can reason about what
            is funded, what is projected, and what finally settled.
          </p>
        </div>
        <div className="primitive-grid">
          <article>
            <span>01</span>
            <h3>RailsCard</h3>
            <p>Outbound grants backed by a SealedVault and private link metadata.</p>
          </article>
          <article>
            <span>02</span>
            <h3>RailsFlow</h3>
            <p>Merchant invoice flow with signed terms, funding state, and payout intent.</p>
          </article>
          <article>
            <span>03</span>
            <h3>Gateway</h3>
            <p>Off-chain stream projections that stay below terminal on-chain receipts.</p>
          </article>
          <article>
            <span>04</span>
            <h3>Receipts</h3>
            <p>Final accounting records for depleted, expired, or cancelled streams.</p>
          </article>
        </div>
      </section>

      <section id="how" className="landing-section rail-flow" aria-labelledby="how-title">
        <div>
          <p className="eyebrow">Protocol</p>
          <h2 id="how-title">Sign, seal, stream, settle, verify.</h2>
        </div>
        <ol className="steps">
          <li><strong>Sign</strong><span>Bind terms into a canonical permission envelope.</span></li>
          <li><strong>Seal</strong><span>Fund a Sui SealedVault and encrypt link metadata for Walrus.</span></li>
          <li><strong>Stream</strong><span>Use signed gateway heartbeats for live accrual projections.</span></li>
          <li><strong>Settle</strong><span>Verify terminal on-chain receipts instead of trusting UI balances.</span></li>
          <li><strong>Verify</strong><span>Trace digest, blob, paycard, and receipt IDs through the proof center.</span></li>
        </ol>
      </section>

      <section id="gateway" className="landing-section demo-panel" aria-labelledby="gateway-title">
        <div>
          <p className="eyebrow">Gateway</p>
          <h2 id="gateway-title">Projected streams below authoritative settlement.</h2>
          <p>
            Gateway heartbeats make active rails legible for operators and merchants.
            They remain explicitly below terminal SettlementReceipt events.
          </p>
        </div>
        <button type="button" onClick={onLaunch}>Open live dashboard</button>
      </section>

      <section id="receipts" className="landing-section rail-flow receipts-narrative" aria-labelledby="receipts-title">
        <div>
          <p className="eyebrow">Receipts</p>
          <h2 id="receipts-title">One event closes the accounting loop.</h2>
        </div>
        <p>
          Depleted, expired, and cancelled streams collapse into audit-grade receipt records.
          The dashboard reads the public Worker and labels every digest and data source
          so finance teams can tell projection from final settlement.
        </p>
      </section>

      <section id="dashboard" className="landing-section demo-panel" aria-labelledby="dashboard-title">
        <div>
          <p className="eyebrow">Dashboard</p>
          <h2 id="dashboard-title">A cockpit for rails, proofs, receipts, and trust boundaries.</h2>
          <p>
            Review lifecycle state, selected stream details, proof links, and Worker data
            states without connecting a wallet or submitting Sui writes.
          </p>
        </div>
        <button type="button" onClick={onLaunch}>Launch cockpit</button>
      </section>

      <section id="proof" className="landing-section proof-panel" aria-labelledby="proof-title">
        <div>
          <p className="eyebrow">Proof</p>
          <h2 id="proof-title">Testnet events exist. The UI stays honest.</h2>
        </div>
        <div className="proof-links">
          {proofLinks.map((proof) => (
            proof.href ? (
              <a key={proof.label} href={proof.href} target="_blank" rel="noreferrer">
                <strong>{proof.label}</strong>
                <span>{proof.detail}</span>
              </a>
            ) : (
              <span key={proof.label}>
                <strong>{proof.label}</strong>
                <small>{proof.detail}</small>
              </span>
            )
          ))}
        </div>
      </section>

      <footer id="developers" className="site-footer">
        <div className="footer-brand">
          <span className="brand-glyph">OR</span>
          <h2>OpenRails</h2>
          <p>Encrypted, signed payment links that stream on Sui and settle with verifiable receipts.</p>
          <div>
            <span className="footer-badge">Sui Testnet</span>
            <span className="footer-badge">Read-only UI</span>
          </div>
        </div>
        <div className="footer-columns">
          <div>
            <h3>Product</h3>
            <a href="#product">RailsCard grants</a>
            <a href="#product">RailsFlow invoices</a>
            <a href="#product">Gateway projections</a>
            <a href="#product">Terminal receipts</a>
          </div>
          <div>
            <h3>Proof</h3>
            <a href="#proof">Testnet mint</a>
            <a href="#proof">Encrypted Walrus link</a>
            <a href="#proof">Settlement receipt</a>
            <a href="#proof">Receipt API in dashboard</a>
          </div>
          <div>
            <h3>Build</h3>
            <span>SDK helpers</span>
            <span>Gateway store</span>
            <span>Receipt API</span>
            <span>Contracts on testnet</span>
          </div>
          <div>
            <h3>Status</h3>
            <span>Wallet not connected</span>
            <span>No live writes</span>
            <span>Live Worker reads</span>
            <span>Do not send mainnet funds</span>
          </div>
        </div>
        <div className="footer-bottom">
          <span>OpenRails V1 testnet prototype.</span>
          <span>Private links. Gateway projections. Terminal receipts.</span>
        </div>
      </footer>
    </main>
  );
}
