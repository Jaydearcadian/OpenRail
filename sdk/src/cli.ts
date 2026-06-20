#!/usr/bin/env node
import { createOpenRailsApiClient, OpenRailsApiError, type OpenRailsApiClient } from "./api.js";
import type { SettlementType } from "./types.js";
import type { Transaction } from "@mysten/sui/transactions";
import { SuiClient, Ed25519Keypair, decodeSuiPrivateKey } from "./sui.js";
import { NETWORKS } from "./network.js";
import { createNonceEngine } from "./nonce.js";
import {
  buildCreateNonceAccountPTB,
  buildMintPTB,
  buildClaimPTB,
  buildCancelPTB,
  buildResolvePTB,
} from "./ptb.js";

export const DEFAULT_OPENRAILS_API_BASE_URL = "https://openrails-receipt-api.microcosm.workers.dev";

const WRITE_COMMANDS = new Set(["nonce-create", "open", "claim", "cancel", "resolve"]);
const DEFAULT_COIN_TYPE = "0x2::sui::SUI";

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

Write commands (V1.2; signs and submits transactions):
  openrails nonce-create [--network testnet|mainnet] [--rpc URL] [--package ID]
  openrails open --coin ID --amount N --rate N --recipient ADDR --duration SECS --recovery ADDR --nonce-account ID [--channel N] [--nonce-value N] [--metadata-hash HEX] [--start UNIX] [--type COIN] [--network ...] [--package ID]
  openrails claim <paycardId> [--type COIN] [--network ...] [--package ID]
  openrails cancel <paycardId> [--type COIN] [--network ...] [--package ID]
  openrails resolve <paycardId> [--type COIN] [--network ...] [--package ID]

Options:
  --base-url URL             OpenRails Receipt API base URL. Overrides OPENRAILS_API_BASE_URL.
  --network NET              testnet (default) or mainnet — selects the RPC.
  --rpc URL                  Override the RPC URL.
  --package ID               OpenRails V1.2 package id. Overrides OPENRAILS_PACKAGE_ID.
  --type COIN                Coin type for the channel. Default 0x2::sui::SUI.
  -h, --help                 Show this help message.

Write env:
  OPENRAILS_PRIVATE_KEY      Required for write commands. Sui Ed25519 key ("suiprivkey..."). Never logged.
  OPENRAILS_PACKAGE_ID       Default package id for write commands.
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

// ─── Write commands (sign + submit) ──────────────────────────────────────────

const COMMON_WRITE_OPTIONS = ["--network", "--rpc", "--package", "--type"];

interface WriteContext {
  client: SuiClient;
  keypair: Ed25519Keypair;
  sender: string;
  packageId: string;
  coinType: string;
}

function requireValue(value: string | undefined, name: string): string {
  if (!value) throw new UsageError(`${name} is required.`);
  return value;
}

function parseBigintArg(value: string | undefined, name: string): bigint {
  if (value === undefined) throw new UsageError(`${name} is required.`);
  if (!/^[0-9]+$/.test(value)) throw new UsageError(`${name} must be a non-negative integer.`);
  return BigInt(value);
}

function requireAddress(value: string | undefined, name: string): string {
  if (!value || !/^0x[0-9a-fA-F]+$/.test(value)) {
    throw new UsageError(`${name} must be a 0x hex address.`);
  }
  return value;
}

function hexToByteArray(hex: string, name: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(clean)) {
    throw new UsageError(`${name} must be hex bytes.`);
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function loadWriteContext(options: Map<string, string>, env: Record<string, string | undefined>): WriteContext {
  const network = options.get("--network") ?? "testnet";
  if (network !== "testnet" && network !== "mainnet") {
    throw new UsageError("--network must be testnet or mainnet.");
  }
  const rpc = options.get("--rpc") ?? NETWORKS[network].rpc;
  const packageId = options.get("--package") ?? env.OPENRAILS_PACKAGE_ID;
  if (!packageId) throw new UsageError("--package <id> or OPENRAILS_PACKAGE_ID is required.");

  const privateKey = env.OPENRAILS_PRIVATE_KEY;
  if (!privateKey) throw new UsageError("OPENRAILS_PRIVATE_KEY env var is required for write commands.");
  const decoded = decodeSuiPrivateKey(privateKey);
  if (decoded.schema !== "ED25519") {
    throw new UsageError("OPENRAILS_PRIVATE_KEY must be an Ed25519 key (suiprivkey...).");
  }
  const keypair = Ed25519Keypair.fromSecretKey(decoded.secretKey);

  return {
    client: new SuiClient({ url: rpc }),
    keypair,
    sender: keypair.toSuiAddress(),
    packageId,
    coinType: options.get("--type") ?? DEFAULT_COIN_TYPE,
  };
}

async function execute(ctx: WriteContext, tx: Transaction) {
  return ctx.client.signAndExecuteTransaction({
    signer: ctx.keypair,
    transaction: tx,
    options: { showEffects: true, showObjectChanges: true, showEvents: true },
  });
}

function createdObjectIds(res: { objectChanges?: unknown[] | null }, typeSuffix: string): string[] {
  const changes = (res.objectChanges ?? []) as Array<{ type?: string; objectType?: string; objectId?: string }>;
  return changes
    .filter((c) => c.type === "created" && typeof c.objectType === "string" && c.objectType.includes(typeSuffix))
    .map((c) => c.objectId as string);
}

function settlementReceiptEmitted(res: { events?: Array<{ type?: string }> | null }): boolean {
  return (res.events ?? []).some((e) => typeof e.type === "string" && e.type.endsWith("::events::SettlementReceipt"));
}

async function runWriteCommand(commandArgs: string[], env: Record<string, string | undefined>): Promise<unknown> {
  const [scope, ...rest] = commandArgs;

  if (scope === "nonce-create") {
    const parsed = parseCommandArgs(rest, new Set(COMMON_WRITE_OPTIONS));
    requireNoPositionals(parsed.positionals, "nonce-create");
    const ctx = loadWriteContext(parsed.options, env);
    const res = await execute(ctx, buildCreateNonceAccountPTB(ctx.packageId));
    return {
      command: "nonce-create",
      sender: ctx.sender,
      digest: res.digest,
      nonceAccountId: createdObjectIds(res, "::nonce_account::NonceAccount")[0] ?? null,
    };
  }

  if (scope === "open") {
    const parsed = parseCommandArgs(
      rest,
      new Set([
        ...COMMON_WRITE_OPTIONS,
        "--coin",
        "--amount",
        "--rate",
        "--recipient",
        "--duration",
        "--recovery",
        "--nonce-account",
        "--channel",
        "--nonce-value",
        "--metadata-hash",
        "--start",
      ])
    );
    requireNoPositionals(parsed.positionals, "open");
    const ctx = loadWriteContext(parsed.options, env);

    const coin = requireValue(parsed.options.get("--coin"), "--coin");
    const amount = parseBigintArg(parsed.options.get("--amount"), "--amount");
    const rate = parseBigintArg(parsed.options.get("--rate"), "--rate");
    const recipient = requireAddress(parsed.options.get("--recipient"), "--recipient");
    const duration = parseBigintArg(parsed.options.get("--duration"), "--duration");
    const recovery = requireAddress(parsed.options.get("--recovery"), "--recovery");
    const nonceAccount = requireValue(parsed.options.get("--nonce-account"), "--nonce-account");
    const channel = parsed.options.has("--channel") ? parseBigintArg(parsed.options.get("--channel"), "--channel") : 0n;
    const start = parsed.options.has("--start") ? Number(parseBigintArg(parsed.options.get("--start"), "--start")) : 0;
    const metaHex = parsed.options.get("--metadata-hash");
    const metadataHash = metaHex ? hexToByteArray(metaHex, "--metadata-hash") : undefined;

    let nonceValue: bigint;
    if (parsed.options.has("--nonce-value")) {
      nonceValue = parseBigintArg(parsed.options.get("--nonce-value"), "--nonce-value");
    } else {
      const engine = createNonceEngine({
        client: ctx.client,
        packageId: ctx.packageId,
        payer: ctx.sender,
        nonceAccountId: nonceAccount,
      });
      nonceValue = (await engine.next({ nonceChannel: channel })).value;
    }

    const tx = buildMintPTB({
      packageId: ctx.packageId,
      coinObjectId: coin,
      totalProvisionAmount: amount,
      maxFlowRatePerSecond: rate,
      recipient,
      startTimestamp: start,
      durationSeconds: Number(duration),
      recoveryTarget: recovery,
      typeArgument: ctx.coinType,
      nonceAccountObjectId: nonceAccount,
      nonceChannel: channel,
      nonceValue,
      metadataHash,
    });
    const res = await execute(ctx, tx);
    return {
      command: "open",
      sender: ctx.sender,
      digest: res.digest,
      paycardId: createdObjectIds(res, "::paycard_v1::Paycard")[0] ?? null,
      nonceChannel: channel.toString(),
      nonceValue: nonceValue.toString(),
    };
  }

  if (scope === "claim" || scope === "cancel" || scope === "resolve") {
    const parsed = parseCommandArgs(rest, new Set(COMMON_WRITE_OPTIONS));
    const paycardId = requireOnePositional(parsed.positionals, scope, "paycardId");
    const ctx = loadWriteContext(parsed.options, env);
    const common = { packageId: ctx.packageId, paycardObjectId: paycardId, typeArgument: ctx.coinType };
    const tx =
      scope === "claim" ? buildClaimPTB(common) : scope === "cancel" ? buildCancelPTB(common) : buildResolvePTB(common);
    const res = await execute(ctx, tx);
    return {
      command: scope,
      sender: ctx.sender,
      digest: res.digest,
      settlementReceiptEmitted: settlementReceiptEmitted(res),
    };
  }

  throw new UsageError(`Unknown write command: ${scope}.`);
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

    const scope = globalArgs.rest[0];
    let result: unknown;
    if (scope && WRITE_COMMANDS.has(scope)) {
      result = await runWriteCommand(globalArgs.rest, env);
    } else {
      const client = clientFactory(baseUrlFor(globalArgs, env));
      result = await runCommand(client, globalArgs.rest);
    }
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
