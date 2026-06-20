import type { ScenarioState } from "../../types/dashboard";

interface StateBlockProps {
  scenario: ScenarioState;
  title: string;
}

export function StateBlock({ scenario, title }: StateBlockProps) {
  if (scenario === "normal") return null;

  const copy = {
    loading: {
      heading: `Loading ${title} region`,
      body: "This dashboard region is waiting for live Worker data. Static product copy remains visible.",
    },
    empty: {
      heading: `No ${title} records in this region`,
      body: "The Worker returned no records for this view, so the dashboard keeps the surrounding navigation available.",
    },
    error: {
      heading: `${title} region unavailable`,
      body: "The dashboard reports whether projected stream data or authoritative receipt records are affected.",
    },
  }[scenario];

  return (
    <section className={`state-block state-${scenario}`} role={scenario === "error" ? "alert" : "status"}>
      <strong>{copy.heading}</strong>
      <p>{copy.body}</p>
    </section>
  );
}
