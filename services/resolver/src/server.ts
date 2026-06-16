import * as http from "http";
import { handleRequest } from "./handler.js";

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 8787;

http
  .createServer(async (req, res) => {
    const url = `http://localhost:${PORT}${req.url ?? "/"}`;
    const response = await handleRequest(new Request(url, { method: req.method ?? "GET" }));
    const body = await response.text();
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => { headers[key] = value; });
    res.writeHead(response.status, headers);
    res.end(body);
  })
  .listen(PORT, () => {
    console.log(`[resolver] listening on http://localhost:${PORT}`);
    console.log(`[resolver] GET /v1/{blobId}?network=testnet|mainnet`);
  });
