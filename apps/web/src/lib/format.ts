/**
 * Human-readable formatting helpers shared across console surfaces.
 * Money is SUI/MIST (1 SUI = 1e9 MIST); rates are MIST/second on-chain but
 * surfaced to operators in whichever time unit reads cleanly.
 */

const MIST_PER_SUI = 1_000_000_000n;

/** MIST (string|bigint) → trimmed SUI string, e.g. "0.0005". */
export function mistToSui(mist: string | bigint | undefined): string {
  if (mist === undefined || mist === "") return "0";
  try {
    const v = typeof mist === "bigint" ? mist : BigInt(mist);
    const sign = v < 0n ? "-" : "";
    const abs = v < 0n ? -v : v;
    const whole = abs / MIST_PER_SUI;
    const frac = (abs % MIST_PER_SUI).toString().padStart(9, "0").replace(/0+$/, "");
    return `${sign}${whole}${frac ? `.${frac}` : ""}`;
  } catch {
    return String(mist);
  }
}

/** "◎0.0005" with the SUI glyph. */
export function suiGlyph(mist: string | bigint | undefined): string {
  return `◎${mistToSui(mist)}`;
}

/** Parse a decimal SUI string into MIST, or null when malformed. */
export function suiToMist(input: string): bigint | null {
  const v = input.trim();
  if (!/^\d+(\.\d{1,9})?$/.test(v)) return null;
  const [whole, frac = ""] = v.split(".");
  return BigInt(whole) * MIST_PER_SUI + BigInt((frac + "000000000").slice(0, 9));
}

/**
 * Pick a readable time unit for a per-second rate and express it in SUI.
 * Small rates read better per hour/day; larger rates per second.
 */
export function humanRate(mistPerSec: string | bigint | undefined): string {
  if (mistPerSec === undefined) return "—";
  let perSec: number;
  try {
    perSec = Number(typeof mistPerSec === "bigint" ? mistPerSec : BigInt(mistPerSec)) / 1e9;
  } catch {
    return "—";
  }
  if (perSec <= 0) return "0 SUI/sec";
  const perHour = perSec * 3600;
  const perDay = perSec * 86400;
  if (perSec >= 0.01) return `≈ ${trim(perSec)} SUI/sec`;
  if (perHour >= 0.01) return `≈ ${trim(perHour)} SUI/hour`;
  return `≈ ${trim(perDay)} SUI/day`;
}

/** Seconds → "2 minutes", "1.5 hours", "3 days". */
export function humanDuration(seconds: number | undefined): string {
  if (!seconds || seconds <= 0) return "—";
  if (seconds < 60) return `${seconds} sec`;
  if (seconds < 3600) return `${trim(seconds / 60)} min`;
  if (seconds < 86400) return `${trim(seconds / 3600)} hr`;
  return `${trim(seconds / 86400)} days`;
}

/** Absolute clock from a unix-seconds timestamp. */
export function clockOf(sec: number | undefined): string {
  if (!sec) return "—";
  return new Date(sec * 1000).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Shorten a hex id / digest for dense display. */
export function shortId(value: string | undefined, head = 6, tail = 4): string {
  if (!value) return "—";
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

function trim(n: number): string {
  // up to 4 significant fractional digits, no trailing zeros
  return Number(n.toFixed(6)).toString();
}
