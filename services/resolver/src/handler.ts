const AGGREGATORS = {
  testnet: "https://aggregator.walrus-testnet.walrus.space",
  mainnet: "https://aggregator.walrus.space",
} as const;

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

  const p = parsed as Record<string, unknown>;
  if (!p.envelope || !p.intent) {
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
