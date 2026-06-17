export const CANONICAL_SCHEMA_VERSION = "1" as const;
export const ENVELOPE_DOMAIN = "openrails.permission-envelope" as const;
export const GATEWAY_EVENT_DOMAIN = "openrails.gateway-event" as const;

export type CanonicalJson =
  | null
  | boolean
  | number
  | string
  | CanonicalJson[]
  | { [key: string]: CanonicalJson };

function isPlainObject(value: object): value is Record<string, unknown> {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function canonicalize(value: unknown, path: string, seen: WeakSet<object>): string {
  if (value === null) return "null";

  const valueType = typeof value;
  if (valueType === "string") return JSON.stringify(value);
  if (valueType === "boolean") return value ? "true" : "false";
  if (valueType === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`Unsupported canonical JSON number at ${path}.`);
    }
    return JSON.stringify(value);
  }
  if (
    valueType === "undefined" ||
    valueType === "bigint" ||
    valueType === "function" ||
    valueType === "symbol"
  ) {
    throw new Error(`Unsupported canonical JSON value at ${path}.`);
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) {
      throw new Error(`Circular canonical JSON value at ${path}.`);
    }
    seen.add(value);
    const encoded = value.map((item, index) => {
      if (!(index in value)) {
        throw new Error(`Unsupported sparse canonical JSON array at ${path}.`);
      }
      return canonicalize(item, `${path}[${index}]`, seen);
    });
    seen.delete(value);
    return `[${encoded.join(",")}]`;
  }

  if (valueType === "object") {
    if (!isPlainObject(value as object)) {
      throw new Error(`Unsupported canonical JSON object at ${path}.`);
    }
    const record = value as Record<string, unknown>;
    if (seen.has(record)) {
      throw new Error(`Circular canonical JSON value at ${path}.`);
    }
    seen.add(record);
    const keys = Object.keys(record).sort();
    const encoded = keys.map((key) => {
      const propertyPath = `${path}.${key}`;
      return `${JSON.stringify(key)}:${canonicalize(record[key], propertyPath, seen)}`;
    });
    seen.delete(record);
    return `{${encoded.join(",")}}`;
  }

  throw new Error(`Unsupported canonical JSON value at ${path}.`);
}

export function canonicalJson(value: unknown): string {
  return canonicalize(value, "$", new WeakSet<object>());
}

export function canonicalJsonBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(canonicalJson(value));
}

export function domainSeparatedBytes(domain: string, value: unknown): Uint8Array {
  return new TextEncoder().encode(`OpenRails:${domain}:v${CANONICAL_SCHEMA_VERSION}\n${canonicalJson(value)}`);
}

export function canonicalEnvelopeBytes(payload: unknown): Uint8Array {
  return domainSeparatedBytes(ENVELOPE_DOMAIN, payload);
}

export function canonicalGatewayEventBytes(payload: unknown): Uint8Array {
  return domainSeparatedBytes(GATEWAY_EVENT_DOMAIN, payload);
}
