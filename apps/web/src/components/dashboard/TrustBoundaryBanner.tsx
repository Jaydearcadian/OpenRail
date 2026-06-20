export function TrustBoundaryBanner() {
  return (
    <section className="trust-banner" aria-label="OpenRails trust boundary">
      <div>
        <span>Demo boundary</span>
        <strong>Live Worker reads, no wallet writes.</strong>
      </div>
      <p>
        This webapp does not request wallet signatures, submit Sui transactions, upload to
        Walrus, or mutate chain state. Gateway values are signed projections. Terminal
        receipts from the Worker remain the authoritative settlement source.
      </p>
    </section>
  );
}
