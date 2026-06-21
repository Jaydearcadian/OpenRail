import { Fragment } from "react";

export type JsonValue = string | number | boolean;

function renderValue(value: JsonValue) {
  if (typeof value === "number") return <span className="jn">{value}</span>;
  if (typeof value === "boolean") return <span className="jb">{String(value)}</span>;
  return <span className="js">"{value}"</span>;
}

export function JsonBox({ data, note }: { data: Array<{ key: string; value: JsonValue }>; note?: string }) {
  return (
    <pre className="jsonbox" aria-label="JSON payload">
{"{"}
      {data.map((entry, index) => (
        <Fragment key={entry.key}>
          {"\n  "}
          <span className="jk">"{entry.key}"</span>: {renderValue(entry.value)}{index < data.length - 1 ? "," : ""}
        </Fragment>
      ))}
      {note ? <>{"\n  "}<span className="jc">// {note}</span></> : null}
      {"\n}"}
    </pre>
  );
}
