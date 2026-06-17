import { dirname } from "path";
import { mkdir, readFile, rename, writeFile } from "fs/promises";
import type { EventId } from "@mysten/sui/client";
import type { SignedGatewayEvent } from "./heartbeat.js";

export interface PendingGatewayDelivery {
  eventId: string;
  webhookUrl: string;
  payload: SignedGatewayEvent;
  attempts: number;
  nextAttemptAtMs: number;
}

export interface GatewayPersistedState {
  watchlist: string[];
  cursor: EventId | null;
  pendingDeliveries: PendingGatewayDelivery[];
  sentEventIds: string[];
  sequence: number;
}

export interface GatewayStore {
  load(): Promise<GatewayPersistedState>;
  save(state: GatewayPersistedState): Promise<void>;
}

export function defaultGatewayState(): GatewayPersistedState {
  return {
    watchlist: [],
    cursor: null,
    pendingDeliveries: [],
    sentEventIds: [],
    sequence: 0,
  };
}

function cloneState(state: GatewayPersistedState): GatewayPersistedState {
  return JSON.parse(JSON.stringify(state)) as GatewayPersistedState;
}

function normalizeState(value: Partial<GatewayPersistedState> | null | undefined): GatewayPersistedState {
  const defaults = defaultGatewayState();
  return {
    watchlist: Array.isArray(value?.watchlist) ? [...value.watchlist] : defaults.watchlist,
    cursor: value?.cursor ?? defaults.cursor,
    pendingDeliveries: Array.isArray(value?.pendingDeliveries)
      ? [...value.pendingDeliveries]
      : defaults.pendingDeliveries,
    sentEventIds: Array.isArray(value?.sentEventIds) ? [...value.sentEventIds] : defaults.sentEventIds,
    sequence: Number.isSafeInteger(value?.sequence) && value!.sequence! >= 0
      ? value!.sequence!
      : defaults.sequence,
  };
}

export class InMemoryGatewayStore implements GatewayStore {
  private state: GatewayPersistedState;

  constructor(initial?: Partial<GatewayPersistedState>) {
    this.state = normalizeState(initial);
  }

  async load(): Promise<GatewayPersistedState> {
    return cloneState(this.state);
  }

  async save(state: GatewayPersistedState): Promise<void> {
    this.state = cloneState(normalizeState(state));
  }
}

export class FileGatewayStore implements GatewayStore {
  constructor(private readonly filePath: string) {}

  async load(): Promise<GatewayPersistedState> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      return normalizeState(JSON.parse(raw) as Partial<GatewayPersistedState>);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return defaultGatewayState();
      }
      throw error;
    }
  }

  async save(state: GatewayPersistedState): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const tmpPath = `${this.filePath}.${process.pid}.tmp`;
    await writeFile(tmpPath, `${JSON.stringify(normalizeState(state), null, 2)}\n`, "utf8");
    await rename(tmpPath, this.filePath);
  }
}
