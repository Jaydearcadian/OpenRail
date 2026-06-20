import type { LifecycleStep } from "../../types/dashboard";

export function LifecycleTimeline({ steps }: { steps: LifecycleStep[] }) {
  return (
    <section className="panel lifecycle-panel" aria-labelledby="lifecycle-title">
      <div className="panel-heading compact">
        <span>Payment rail lifecycle</span>
        <h2 id="lifecycle-title">From private link to terminal receipt</h2>
      </div>
      <div className="lifecycle-rail">
        {steps.map((step) => (
          <article key={step.label} className={`lifecycle-step lifecycle-${step.boundary}`}>
            <span>{step.label}</span>
            <h3>{step.title}</h3>
            <p>{step.description}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
