import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { redact } from "../src/errors.js";

// Live end-to-end check against the real BEHAVR backend. All output goes to stderr.
// The key comes only from BEHAVR_E2E_API_KEY; BEHAVR_API_KEY and .env are never read.

const e2eKey = process.env.BEHAVR_E2E_API_KEY?.trim();
if (!e2eKey) {
  console.error("BEHAVR_E2E_API_KEY is not set. Stopping (BEHAVR_API_KEY and .env are never used).");
  process.exit(1);
}
const apiKey: string = e2eKey;

const imageEnv = process.env.BEHAVR_E2E_IMAGE?.trim();
if (!imageEnv || !path.isAbsolute(imageEnv) || !existsSync(imageEnv)) {
  console.error("BEHAVR_E2E_IMAGE must be an absolute path to an existing image (e.g. a screenshot with some text).");
  process.exit(1);
}
const imagePath: string = imageEnv;
const question = process.env.BEHAVR_E2E_QUESTION?.trim() || "What is shown in the image I saved?";

const serverEntry = fileURLToPath(new URL("../src/index.js", import.meta.url));
const clientId = `mcp-e2e-${Date.now()}`;
const outputs: string[] = [];
let serverStderr = "";
let failures = 0;

function log(message: string): void {
  console.error(redact(message, apiKey));
}

function check(ok: boolean, label: string, detail = ""): void {
  if (ok) {
    log(`PASS ${label}`);
  } else {
    failures++;
    log(`FAIL ${label}${detail ? `: ${detail}` : ""}`);
  }
}

function textOf(result: CallToolResult): string {
  const first = result.content[0];
  const text = first?.type === "text" ? first.text : "";
  outputs.push(text);
  return text;
}

// Splits ask's output ("answer\n\nSources:\n- a\n- b") into its parts.
function parseAsk(text: string): { answer: string; sources: string[] } {
  const marker = "\n\nSources:\n";
  const at = text.indexOf(marker);
  if (at === -1) return { answer: text.trim(), sources: [] };
  const sources = text
    .slice(at + marker.length)
    .split("\n")
    .map((line) => line.replace(/^- /, "").trim())
    .filter(Boolean);
  return { answer: text.slice(0, at).trim(), sources };
}

async function startServer(agentId: string): Promise<Client> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverEntry],
    env: { BEHAVR_API_KEY: apiKey, BEHAVR_CLIENT_ID: clientId, BEHAVR_AGENT_ID: agentId },
    stderr: "pipe",
  });
  transport.stderr?.on("data", (chunk) => {
    serverStderr += String(chunk);
  });
  const client = new Client({ name: "behavr-mcp-e2e", version: "0.1.0" });
  await client.connect(transport);
  return client;
}

async function main(): Promise<void> {
  log(`client_id: ${clientId}`);
  const a = await startServer("e2e-agent-a");
  const b = await startServer("e2e-agent-b");
  try {
    const names = (await a.listTools()).tools.map((t) => t.name).sort().join(",");
    check(names === "ask,remember", "tools/list shows ask and remember", names);

    // The allowlist runs before any filesystem or network access, so the file need not exist.
    const refused = (await a.callTool({
      name: "remember",
      arguments: { file_path: path.join(path.dirname(imagePath), "notes.txt") },
    })) as CallToolResult;
    const refusedText = textOf(refused);
    check(refused.isError === true && refusedText.includes("Refusing to upload 'notes.txt'"), "allowlist rejects .txt", refusedText);

    let progressCount = 0;
    const remembered = (await a.callTool(
      { name: "remember", arguments: { file_path: imagePath } },
      undefined,
      { timeout: 150_000, onprogress: () => void progressCount++ },
    )) as CallToolResult;
    const rememberedText = textOf(remembered);
    log(`remember (agent a):\n${rememberedText}`);
    log(`progress notifications: ${progressCount}`);
    check(!remembered.isError && rememberedText.includes("status: completed"), "remember completes on agent a");

    const memoryId = /^memoryId: (.+)$/m.exec(rememberedText)?.[1]?.trim();
    check(Boolean(memoryId), "remember result includes a memoryId", rememberedText);

    const asked = (await b.callTool(
      { name: "ask", arguments: { question } },
      undefined,
      { timeout: 120_000 },
    )) as CallToolResult;
    const askedText = textOf(asked);
    log(`ask (agent b): ${askedText}`);
    const { answer, sources } = parseAsk(askedText);
    check(!asked.isError, "ask on agent b succeeds", askedText);
    check(answer.length > 0 && !/no completed captures/i.test(answer), "ask on agent b returns a non-empty answer", answer);
    check(
      memoryId !== undefined && sources.includes(memoryId),
      "ask on agent b cites agent a's memoryId in sources (same client_id)",
      `memoryId=${memoryId ?? "(none)"} sources=[${sources.join(", ")}]`,
    );
  } finally {
    await a.close();
    await b.close();
  }

  check(!serverStderr.includes(apiKey), "API key never appears in server stderr");
  check(outputs.every((t) => !t.includes(apiKey)), "API key never appears in tool output");
  log(`server stderr:\n${serverStderr.trim()}`);
}

main().then(
  () => {
    log(failures ? `${failures} check(s) failed` : "All e2e checks passed");
    process.exit(failures ? 1 : 0);
  },
  (err) => {
    log(`e2e crashed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
    process.exit(1);
  },
);
