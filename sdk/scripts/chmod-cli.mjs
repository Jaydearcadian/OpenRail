import { chmodSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const cliPath = resolve(here, "../dist/cli.js");

if (existsSync(cliPath) && process.platform !== "win32") {
  chmodSync(cliPath, 0o755);
}
