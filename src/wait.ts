import type { ListOptions, ListResponse, Memory } from "behavr-sdk";
import { errorStatus, formatError } from "./errors.js";

export interface MemoryLister {
  list(options: ListOptions): Promise<ListResponse>;
}

export interface WaitOptions {
  client: MemoryLister;
  memoryId: string;
  clientId?: string;
  agentId?: string;
  /** Only used to redact the key from log lines. */
  apiKey?: string;
  /** Called once per tick with a monotonically increasing progress value. */
  onProgress?: (progress: number, total: number, message: string) => Promise<void> | void;
  signal?: AbortSignal;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  log?: (message: string) => void;
  intervalMs?: number;
  timeoutMs?: number;
  failedCheckEvery?: number;
}

export type WaitResult =
  | { state: "completed"; memory: Memory }
  | { state: "failed"; message: string }
  | { state: "timeout"; message: string }
  | { state: "error"; message: string };

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Poll /v1/memories until the uploaded memory is completed, failed, or the
 * timeout passes. Uses the same clientId/agentId as the upload, since the
 * listing is scoped by them.
 */
export async function waitForMemory(options: WaitOptions): Promise<WaitResult> {
  const {
    client,
    memoryId,
    clientId,
    agentId,
    apiKey,
    onProgress,
    signal,
    sleep = defaultSleep,
    now = Date.now,
    log = (message: string) => console.error(message),
    intervalMs = 3000,
    timeoutMs = 90_000,
    failedCheckEvery = 5,
  } = options;

  const totalTicks = Math.ceil(timeoutMs / intervalMs);
  const start = now();
  let tick = 0;

  // Returns a terminal result for 401/403, otherwise logs and keeps polling.
  const handleError = (err: unknown): WaitResult | undefined => {
    const status = errorStatus(err);
    const text = formatError(err, apiKey);
    if (status === 401 || status === 403) return { state: "error", message: text };
    log(`[behavr-mcp] polling memory ${memoryId} failed, retrying: ${text}`);
    return undefined;
  };

  const findIn = async (status: string): Promise<Memory | undefined> => {
    const res = await client.list({ clientId, agentId, status, limit: 100 });
    return res.memories.find((m) => m.memoryId === memoryId);
  };

  while (true) {
    await sleep(intervalMs);
    tick++;
    if (signal?.aborted) return { state: "error", message: "Cancelled while waiting for processing." };

    try {
      const memory = await findIn("completed");
      if (memory) return { state: "completed", memory };
    } catch (err) {
      const stop = handleError(err);
      if (stop) return stop;
    }

    if (tick % failedCheckEvery === 0) {
      try {
        if (await findIn("failed")) {
          return { state: "failed", message: `Processing failed for memory ${memoryId}.` };
        }
      } catch (err) {
        const stop = handleError(err);
        if (stop) return stop;
      }
    }

    const elapsed = now() - start;
    if (onProgress) {
      const seconds = Math.round(elapsed / 1000);
      try {
        await onProgress(tick, Math.max(tick, totalTicks), `Waiting for BEHAVR to process memory (${seconds}s)`);
      } catch (err) {
        log(`[behavr-mcp] progress notification failed: ${formatError(err, apiKey)}`);
      }
    }

    if (elapsed >= timeoutMs) {
      return {
        state: "timeout",
        message:
          `Uploaded as memory ${memoryId}, but it hasn't finished processing within ${Math.round(timeoutMs / 1000)} seconds. ` +
          "Processing either failed or is still running. Try ask in a minute; " +
          "if it still isn't found, upload again.",
      };
    }
  }
}
