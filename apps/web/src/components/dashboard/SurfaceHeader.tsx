import type { ReactNode } from "react";

interface SurfaceHeaderProps {
  eyebrow: string;
  title: string;
  description: string;
  children?: ReactNode;
}

export function SurfaceHeader({ eyebrow, title, description, children }: SurfaceHeaderProps) {
  return (
    <div className="surface-header">
      <div>
        <span>{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {children ? <div className="surface-actions">{children}</div> : null}
    </div>
  );
}
