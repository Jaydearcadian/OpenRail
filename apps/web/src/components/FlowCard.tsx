interface FlowCardProps {
  title: string;
  eyebrow: string;
  description: string;
  action: string;
  onPreview?: () => void;
}

export function FlowCard({ title, eyebrow, description, action, onPreview }: FlowCardProps) {
  return (
    <article className="flow-card">
      <span>{eyebrow}</span>
      <h3>{title}</h3>
      <p>{description}</p>
      <button
        type="button"
        className="preview-button"
        onClick={onPreview}
        aria-label={`${action}, preview only`}
      >
        {action}
      </button>
      <small className="mock-action-note">Preview only. Wallet signing and Sui writes are not connected.</small>
    </article>
  );
}
