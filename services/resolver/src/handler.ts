const AGGREGATORS = {
  testnet: "https://aggregator.walrus-testnet.walrus.space",
  mainnet: "https://aggregator.walrus.space",
} as const;

function isPlainOpenRailsEnvelope(value: Record<string, unknown>): boolean {
  return (
    Boolean(value.envelope && value.intent) &&
    typeof value.envelope === "object" &&
    typeof value.intent === "object" &&
    !Array.isArray(value.envelope) &&
    !Array.isArray(value.intent)
  );
}

function decodeBase64Url(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;

  let normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  while (normalized.length % 4) normalized += "=";

  try {
    return Uint8Array.from(atob(normalized), (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

function isEncryptedOpenRailsEnvelope(value: Record<string, unknown>): boolean {
  const keys = Object.keys(value).sort();
  const expectedKeys = ["alg", "ciphertext", "iv", "keyMode", "kind", "plaintextType", "schemaVersion"];
  if (keys.length !== expectedKeys.length || !keys.every((key, index) => key === expectedKeys[index])) {
    return false;
  }
  if (
    value.schemaVersion !== "1" ||
    value.kind !== "openrails.encrypted-link" ||
    value.plaintextType !== "openrails.link.v1" ||
    value.alg !== "AES-256-GCM" ||
    value.keyMode !== "fragment-key" ||
    typeof value.iv !== "string" ||
    typeof value.ciphertext !== "string"
  ) {
    return false;
  }

  const iv = decodeBase64Url(value.iv);
  const ciphertext = decodeBase64Url(value.ciphertext);
  return iv?.length === 12 && Boolean(ciphertext && ciphertext.length > 0);
}

export async function handleRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);

  const match = url.pathname.match(/^\/v1\/([^/]+)$/);
  if (!match) return new Response("Not Found", { status: 404 });

  const blobId = match[1];
  const network = url.searchParams.get("network") === "mainnet" ? "mainnet" : "testnet";

  let upstream: Response;
  try {
    upstream = await fetch(`${AGGREGATORS[network]}/v1/blobs/${blobId}`);
  } catch {
    return new Response("Aggregator unreachable", { status: 502 });
  }

  if (!upstream.ok) {
    return new Response("Envelope not found or expired", { status: 404 });
  }

  const text = await upstream.text();

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return new Response("Invalid blob content", { status: 422 });
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return new Response("Not an OpenRails envelope", { status: 400 });
  }

  const p = parsed as Record<string, unknown>;
  const hasEncryptedFields = ["alg", "ciphertext", "iv", "keyMode", "kind", "plaintextType"].some(
    (key) => key in p
  );
  const isOpenRailsEnvelope = hasEncryptedFields
    ? isEncryptedOpenRailsEnvelope(p)
    : isPlainOpenRailsEnvelope(p);

  if (!isOpenRailsEnvelope) {
    return new Response("Not an OpenRails envelope", { status: 400 });
  }

  return new Response(text, {
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

// Cloudflare Worker entry point
export default { fetch: handleRequest };
