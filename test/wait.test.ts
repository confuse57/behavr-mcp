import { test } from "node:test";
import assert from "node:assert/strict";
import { BehavrApiError, type ListOptions, type ListResponse } from "behavr-sdk";
import { formatError, redact } from "../src/errors.js";
import { waitForMemory, type MemoryLister, type WaitOptions } from "../src/wait.js";

const FAKE_KEY = "bhv_test_fake_key_123";
const TIMEOUT_MESSAGE =
  "Uploaded as memory mem-1, but it hasn't finished processing within 90 seconds. " +
  "Processing either failed or is still running. Try ask in a minute; " +
  "if it still isn't found, upload again.";

const empty: ListResponse = { memories: [], total: 0 };
const found: ListResponse = { memories: [{ memoryId: "mem-1", title: "Receipt" }], total: 1 };

// Fake client: records every list() call and answers via the handler.
function fakeClient(handler: (opts: ListOptions) => ListResponse) {
  const calls: ListOptions[] = [];
  const client: MemoryLister = {
    async list(opts) {
      calls.push(opts);
      return handler(opts);
    },
  };
  return { client, calls };
}

// Fake clock: sleep() advances now() instantly, so 90s runs in milliseconds.
function setup(client: MemoryLister, overrides: Partial<WaitOptions> = {}) {
  let t = 0;
  const logs: string[] = [];
  const options: WaitOptions = {
    client,
    memoryId: "mem-1",
    clientId: "c1",
    agentId: "a1",
    apiKey: FAKE_KEY,
    now: () => t,
    sleep: async (ms) => {
      t += ms;
    },
    log: (message) => logs.push(message),
    ...overrides,
  };
  return { options, logs };
}

test("finds the memory on the 2nd tick, with the upload's ids", async () => {
  let completedCalls = 0;
  const { client, calls } = fakeClient((opts) => {
    if (opts.status !== "completed") return empty;
    completedCalls++;
    return completedCalls === 2 ? found : empty;
  });
  const result = await waitForMemory(setup(client).options);
  assert.equal(result.state, "completed");
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], { clientId: "c1", agentId: "a1", status: "completed", limit: 100 });
});

test("reports failure when the memory shows up in the failed list on the 5th tick", async () => {
  const { client, calls } = fakeClient((opts) => (opts.status === "failed" ? found : empty));
  const result = await waitForMemory(setup(client).options);
  assert.deepEqual(result, { state: "failed", message: "Processing failed for memory mem-1." });
  assert.equal(calls.length, 6);
  assert.equal(calls[5].status, "failed");
});

test("times out after 90s on the fake clock with the generic message", async () => {
  const { client, calls } = fakeClient(() => empty);
  const result = await waitForMemory(setup(client).options);
  assert.deepEqual(result, { state: "timeout", message: TIMEOUT_MESSAGE });
  assert.equal(calls.filter((c) => c.status === "completed").length, 30);
});

test("keeps polling through 429 and network errors", async () => {
  let call = 0;
  const { client } = fakeClient((opts) => {
    if (opts.status !== "completed") return empty;
    call++;
    if (call === 1) throw new BehavrApiError(429, { detail: "Too many requests" }, "x");
    if (call === 2) throw new TypeError("fetch failed");
    return found;
  });
  const { options, logs } = setup(client);
  const result = await waitForMemory(options);
  assert.equal(result.state, "completed");
  assert.equal(logs.length, 2);
  assert.match(logs[0], /429/);
  assert.match(logs[1], /fetch failed/);
});

test("stops immediately on 401", async () => {
  const { client, calls } = fakeClient(() => {
    throw new BehavrApiError(401, { detail: "Invalid API key" }, "x");
  });
  const result = await waitForMemory(setup(client).options);
  assert.deepEqual(result, { state: "error", message: "BEHAVR API error (401): Invalid API key" });
  assert.equal(calls.length, 1);
});

test("never puts the API key in error results or log lines", async () => {
  let call = 0;
  const { client } = fakeClient(() => {
    call++;
    if (call === 1) throw new BehavrApiError(500, { detail: `boom ${FAKE_KEY}` }, "x");
    throw new BehavrApiError(403, { detail: { error: "forbidden", message: `bad key ${FAKE_KEY}` } }, "x");
  });
  const { options, logs } = setup(client);
  const result = await waitForMemory(options);
  assert.equal(result.state, "error");
  if (result.state !== "error") return;
  assert.equal(result.message, "BEHAVR API error (403): bad key ***");
  for (const line of [result.message, ...logs]) assert.ok(!line.includes(FAKE_KEY), line);
  assert.equal(formatError(new Error(`x ${FAKE_KEY} y ${FAKE_KEY}`), FAKE_KEY), "x *** y ***");
});

test("stops when the request is cancelled", async () => {
  const controller = new AbortController();
  const { client, calls } = fakeClient(() => {
    controller.abort();
    return empty;
  });
  const result = await waitForMemory(setup(client, { signal: controller.signal }).options);
  assert.deepEqual(result, { state: "error", message: "Cancelled while waiting for processing." });
  assert.equal(calls.length, 1);
});

test("keeps polling when onProgress throws", async () => {
  let completedCalls = 0;
  const { client } = fakeClient((opts) => {
    if (opts.status !== "completed") return empty;
    completedCalls++;
    return completedCalls === 3 ? found : empty;
  });
  const progress: Array<[number, number]> = [];
  const { options, logs } = setup(client, {
    onProgress: (p, total) => {
      progress.push([p, total]);
      throw new Error("transport closed");
    },
  });
  const result = await waitForMemory(options);
  assert.equal(result.state, "completed");
  assert.deepEqual(progress, [[1, 30], [2, 30]]);
  assert.equal(logs.length, 2);
  assert.match(logs[0], /progress notification failed: transport closed/);
});

test("redact() leaves text alone for an empty or missing secret", () => {
  assert.equal(redact("hello world", ""), "hello world");
  assert.equal(redact("hello world", undefined), "hello world");
  assert.equal(redact("k and k", "k"), "*** and ***");
});
