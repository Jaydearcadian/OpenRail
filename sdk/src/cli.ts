#!/usr/bin/env node
import { createOpenRailsApiClient, OpenRailsApiError, type OpenRailsApiClient } from "./api.js";
import type { SettlementType } from "./types.js";

export const DEFAULT_OPENRAILS_API_BASE_URL = "https://openrails-receipt-api.microcosm.workers.dev";

export interface OpenRailsCliIo {
  stdout?: Pick<NodeJS.WritableStream, "write">;
  stderr?: Pick<NodeJS.WritableStream, "write">;
  env?: Record<string, string | undefined>;
}

export type OpenRailsCliClientFactory = (baseUrl: string) => OpenRailsApiClient;

class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

const HELP_TEXT = `Usage:
  openrails [--base-url URL] health
  openrails [--base-url URL] receipts list [--limit N] [--order ascending|descending] [--paycard-id ID] [--payer ID] [--recipient ID] [--settlement-type N] [--cursor-tx-digest DIGEST --cursor-event-seq SEQ]
  openrails [--base-url URL] receipts get <paycardId> [--limit N] [--max-pages N]
  openrails [--base-url URL] streams get <paycardId>
  openrails [--base-url URL] streams events <paycardId> [--limit N] [--cursor EVENT_ID]
  openrails [--base-url URL] proof <paycardId> [--limit N] [--receipt-limit N] [--max-pages N]

Options:
  --base-url URL             OpenRails Receipt API base URL. Overrides OPENRAILS_API_BASE_URL.
  -h, --help                 Show this help message.
`;

interface ParsedGlobalArgs {
  baseUrl?: string;
  help: boolean;
  rest: string[];
}

interface ParsedCommandArgs {
  options: Map<string, string>;
  positionals: string[];
}

function write(stream: Pick<NodeJS.WritableStream, "write">, message: string): void {
  stream.write(message);
}

function readOptionValue(argv: string[], index: number, optionName: string): { value: string; nextIndex: number } {
  const current = argv[index];
  const equalsIndex = current.indexOf("=");
  if (equalsIndex !== -1) {
    const value = current.slice(equalsIndex + 1);
    if (!value) throw new UsageError(`${optionName} requires a value.`);
    return { value, nextIndex: index + 1 };
  }

  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new UsageError(`${optionName} requires a value.`);
  }
  return { value, nextIndex: index + 2 };
}

function parseGlobalArgs(argv: string[]): ParsedGlobalArgs {
  const rest: string[] = [];
  let baseUrl: string | undefined;
  let help = false;

  for (let index = 0; index < argv.length; ) {
    const arg = argv[index];
    if (arg === "-h" || arg === "--help") {
      help = true;
      index += 1;
    } else if (arg === "--base-url" || arg.startsWith("--base-url=")) {
      const parsed = readOptionValue(argv, index, "--base-url");
      baseUrl = parsed.value;
      index = parsed.nextIndex;
    } else {
      rest.push(arg);
      index += 1;
    }
  }

  return { baseUrl, help, rest };
}

function parseCommandArgs(argv: string[], allowedOptions: Set<string>): ParsedCommandArgs {
  const options = new Map<string, string>();
  const positionals: string[] = [];

  for (let index = 0; index < argv.length; ) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      index += 1;
      continue;
    }

    const optionName = arg.includes("=") ? arg.slice(0, arg.indexOf("=")) : arg;
    if (!allowedOptions.has(optionName)) {
      throw new UsageError(`Unknown option: ${optionName}.`);
    }

    const parsed = readOptionValue(argv, index, optionName);
    options.set(optionName, parsed.value);
    index = parsed.nextIndex;
  }

  return { options, positionals };
}

function requireNoPositionals(positionals: string[], command: string): void {
  if (positionals.length > 0) {
    throw new UsageError(`${command} does not accept positional arguments: ${positionals.join(" ")}.`);
  }
}

function requireOnePositional(positionals: string[], command: string, name: string): string {
  if (positionals.length === 0) {
    throw new UsageError(`${command} requires <${name}>.`);
  }
  if (positionals.length > 1) {
    throw new UsageError(`${command} accepts exactly one positional argument.`);
  }
  return positionals[0];
}

function parsePositiveInteger(value: string | undefined, optionName: string): number | undefined {
  if (value === undefined) return undefined;
  if (!/^[0-9]+$/.test(value)) {
    throw new UsageError(`${optionName} must be a positive integer.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new UsageError(`${optionName} must be a positive integer.`);
  }
  return parsed;
}

function parseSettlementType(value: string | undefined): SettlementType | undefined {
  if (value === undefined) return undefined;
  if (!/^[0-9]+$/.test(value)) {
    throw new UsageError("--settlement-type must be 0, 1, or 2.");
  }
  const parsed = Number(value);
  if (parsed !== 0 && parsed !== 1 && parsed !== 2) {
    throw new UsageError("--settlement-type must be 0, 1, or 2.");
  }
  return parsed;
}

function parseOrder(value: string | undefined): "ascending" | "descending" | undefined {
  if (value === undefined) return undefined;
  if (value !== "ascending" && value !== "descending") {
    throw new UsageError("--order must be ascending or descending.");
  }
  return value;
}

function baseUrlFor(globalArgs: ParsedGlobalArgs, env: Record<string, string | undefined>): string {
  return globalArgs.baseUrl ?? env.OPENRAILS_API_BASE_URL ?? DEFAULT_OPENRAILS_API_BASE_URL;
}

function stringifyJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function errorMessage(error: unknown): string {
  if (error instanceof UsageError) return `Usage error: ${error.message}\n`;
  if (error instanceof NotFoundError) return `Not found: ${error.message}\n`;
  if (error instanceof OpenRailsApiError) {
    return `OpenRails API error (${error.status} ${error.code}): ${error.message}\n`;
  }
  if (error instanceof Error) return `Error: ${error.message}\n`;
  return `Error: ${String(error)}\n`;
}

async function runCommand(client: OpenRailsApiClient, commandArgs: string[]): Promise<unknown> {
  const [scope, action, ...rest] = commandArgs;
  if (!scope) throw new UsageError("A command is required.");

  if (scope === "health") {
    if (action) throw new UsageError("health does not accept subcommands.");
    return client.health();
  }

  if (scope === "receipts" && action === "list") {
    const parsed = parseCommandArgs(
      rest,
      new Set([
        "--limit",
        "--order",
        "--paycard-id",
        "--payer",
        "--recipient",
        "--settlement-type",
        "--cursor-tx-digest",
        "--cursor-event-seq",
      ])
    );
    requireNoPositionals(parsed.positionals, "receipts list");

    const cursorTxDigest = parsed.options.get("--cursor-tx-digest");
    const cursorEventSeq = parsed.options.get("--cursor-event-seq");
    if ((cursorTxDigest && !cursorEventSeq) || (!cursorTxDigest && cursorEventSeq)) {
      throw new UsageError("--cursor-tx-digest and --cursor-event-seq must be provided together.");
    }

    return client.listReceipts({
      limit: parsePositiveInteger(parsed.options.get("--limit"), "--limit"),
      order: parseOrder(parsed.options.get("--order")),
      paycardId: parsed.options.get("--paycard-id"),
      payer: parsed.options.get("--payer"),
      recipient: parsed.options.get("--recipient"),
      settlementType: parseSettlementType(parsed.options.get("--settlement-type")),
      cursorTxDigest,
      cursorEventSeq,
    });
  }

  if (scope === "receipts" && action === "get") {
    const parsed = parseCommandArgs(rest, new Set(["--limit", "--max-pages"]));
    const paycardId = requireOnePositional(parsed.positionals, "receipts get", "paycardId");
    const receipt = await client.getReceipt(paycardId, {
      limit: parsePositiveInteger(parsed.options.get("--limit"), "--limit"),
      maxPages: parsePositiveInteger(parsed.options.get("--max-pages"), "--max-pages"),
    });
    if (!receipt) throw new NotFoundError(`receipt for paycardId ${paycardId}`);
    return receipt;
  }

  if (scope === "streams" && action === "get") {
    const parsed = parseCommandArgs(rest, new Set());
    const paycardId = requireOnePositional(parsed.positionals, "streams get", "paycardId");
    const stream = await client.getStream(paycardId);
    if (!stream) throw new NotFoundError(`stream for paycardId ${paycardId}`);
    return stream;
  }

  if (scope === "streams" && action === "events") {
    const parsed = parseCommandArgs(rest, new Set(["--limit", "--cursor"]));
    const paycardId = requireOnePositional(parsed.positionals, "streams events", "paycardId");
    return client.listStreamEvents(paycardId, {
      limit: parsePositiveInteger(parsed.options.get("--limit"), "--limit"),
      cursor: parsed.options.get("--cursor"),
    });
  }

  if (scope === "proof") {
    const parsed = parseCommandArgs(
      action === undefined ? rest : [action, ...rest],
      new Set(["--limit", "--receipt-limit", "--max-pages"])
    );
    const paycardId = requireOnePositional(parsed.positionals, "proof", "paycardId");
    const proof = await client.getProof(paycardId, {
      limit: parsePositiveInteger(parsed.options.get("--limit"), "--limit"),
      receiptLimit: parsePositiveInteger(parsed.options.get("--receipt-limit"), "--receipt-limit"),
      maxPages: parsePositiveInteger(parsed.options.get("--max-pages"), "--max-pages"),
    });
    if (!proof) throw new NotFoundError(`proof for paycardId ${paycardId}`);
    return proof;
  }

  throw new UsageError(`Unknown command: ${commandArgs.join(" ")}.`);
}

export async function runOpenRailsCli(
  argv: string[] = process.argv.slice(2),
  io: OpenRailsCliIo = {},
  clientFactory: OpenRailsCliClientFactory = createOpenRailsApiClient
): Promise<number> {
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  const env = io.env ?? process.env;

  try {
    const globalArgs = parseGlobalArgs(argv);
    if (globalArgs.help) {
      write(stdout, HELP_TEXT);
      return 0;
    }

    const client = clientFactory(baseUrlFor(globalArgs, env));
    const result = await runCommand(client, globalArgs.rest);
    write(stdout, stringifyJson(result));
    return 0;
  } catch (error) {
    write(stderr, errorMessage(error));
    if (error instanceof UsageError) {
      write(stderr, `Run "openrails --help" for usage.\n`);
      return 2;
    }
    return 1;
  }
}

if (require.main === module) {
  void runOpenRailsCli().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
