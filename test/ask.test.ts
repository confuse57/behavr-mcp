import { test } from "node:test";
import assert from "node:assert/strict";
import type { AskOptions, AskResult } from "behavr-sdk";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Config } from "../src/config.js";
import { handleAsk, type AskClient } from "../src/tools/ask.js";

const config: Config = { apiKey: "bhv_test_fake_key_123", clientId: "c1" };

// `unknown` cast: AskResult in behavr-sdk 0.3.x has no sourceDetails, in 0.4.x it is required.
function fakeClient(result: unknown) {
  const calls: AskOptions[] = [];
  const client: AskClient = {
    async ask(opts) {
      calls.push(opts);
      return result as AskResult;
    },
  };
  return { client, calls };
}

function textOf(result: CallToolResult): string {
  const first = result.content[0];
  return first?.type === "text" ? first.text : "";
}

test("lists sources with titles from sourceDetails, falling back to the id", async () => {
  const { client, calls } = fakeClient({
    answer: "The total was 42.",
    sources: ["mem-1", "mem-2"],
    sourceDetails: [
      { memoryId: "mem-1", title: "Cafe receipt", snippet: "", hasOriginal: true, lowResolution: false },
    ],
  });
  const result = await handleAsk({ question: "Total?" }, { client, config });
  assert.equal(result.isError, undefined);
  assert.equal(textOf(result), "The total was 42.\n\nSources:\n- Cafe receipt (mem-1)\n- mem-2");
  // agentId is never sent, so every agent of the client is searched.
  assert.deepEqual(calls, [{ question: "Total?", clientId: "c1" }]);
});

test("without sourceDetails (behavr-sdk 0.3.x) sources are plain ids", async () => {
  const { client } = fakeClient({ answer: "A", sources: ["mem-1"] });
  const result = await handleAsk({ question: "q" }, { client, config });
  assert.equal(textOf(result), "A\n\nSources:\n- mem-1");
});

test("only sources listed in `sources` are shown, even if sourceDetails has others", async () => {
  const { client } = fakeClient({
    answer: "A",
    sources: ["mem-1"],
    sourceDetails: [{ memoryId: "mem-9", title: "Elsewhere" }],
  });
  const result = await handleAsk({ question: "q" }, { client, config });
  assert.equal(textOf(result), "A\n\nSources:\n- mem-1");
});

test("titles are flattened to one line and capped; empty titles fall back to the id", async () => {
  const { client } = fakeClient({
    answer: "A",
    sources: ["mem-1", "mem-2"],
    sourceDetails: [
      { memoryId: "mem-1", title: `Line one\n\n- injected (mem-x)\t${"x".repeat(200)}` },
      { memoryId: "mem-2", title: "   " },
    ],
  });
  const text = textOf(await handleAsk({ question: "q" }, { client, config }));
  const lines = text.split("\n");
  assert.equal(lines.length, 5, text);
  assert.match(lines[3], /^- Line one - injected \(mem-x\) x+… \(mem-1\)$/);
  assert.ok(lines[3].length < 120, lines[3]);
  assert.equal(lines[4], "- mem-2");
});

test("no sources means no Sources block", async () => {
  const { client } = fakeClient({ answer: "No completed captures.", sources: [], sourceDetails: [] });
  const result = await handleAsk({ question: "q" }, { client, config });
  assert.equal(textOf(result), "No completed captures.");
});
