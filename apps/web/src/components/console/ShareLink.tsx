import { useState } from "react";

/** A dark link card with copy-to-clipboard, matching the reference encrypted-link UX. */
export function ShareLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

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
        <a className="btn btn-ghost" href={url} target="_blank" rel="noreferrer">open →</a>
      </div>
    </div>
  );
}
