import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";

/** A dark link card with copy-to-clipboard + a scannable QR, matching the reference encrypted-link UX. */
export function ShareLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  const [showQr, setShowQr] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="sharelink">
      <div className="sharelink-url mono">{url}</div>
      <div className="sharelink-actions">
        <button type="button" className="btn btn-ghost" onClick={copy}>{copied ? "copied!" : "copy link"}</button>
        <button type="button" className="btn btn-ghost" onClick={() => setShowQr((v) => !v)}>{showQr ? "hide QR" : "QR code"}</button>
        <a className="btn btn-ghost" href={url} target="_blank" rel="noreferrer">open →</a>
      </div>
      {showQr ? (
        <div className="sharelink-qr">
          <QRCodeSVG value={url} size={168} level="M" marginSize={2} bgColor="#ffffff" fgColor="#0b0b0c" />
          <span>scan to open on a phone</span>
        </div>
      ) : null}
    </div>
  );
}
