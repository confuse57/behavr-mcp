#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { BehavrClient } from "behavr-sdk";
import { loadConfig } from "./config.js";
import { redact } from "./errors.js";
import { askDescription, askInputShape, handleAsk } from "./tools/ask.js";
import { handleRemember, rememberDescription, rememberInputShape } from "./tools/remember.js";

// stdout carries JSON-RPC only; every log line goes to stderr.

async function main(): Promise<void> {
  const config = loadConfig();
  if ("error" in config) {
    console.error(`[behavr-mcp] ${config.error}`);
    process.exit(1);
  }

  const client = new BehavrClient({ apiKey: config.apiKey });
  const server = new McpServer({ name: "behavr-mcp", version: "0.1.0" });

  server.registerTool(
    "remember",
    { description: rememberDescription, inputSchema: rememberInputShape },
    (args, extra) => handleRemember(args, { client, config }, extra),
  );

  server.registerTool(
    "ask",
    { description: askDescription, inputSchema: askInputShape },
    (args) => handleAsk(args, { client, config }),
  );

  await server.connect(new StdioServerTransport());
  console.error(
    `[behavr-mcp] ready (client_id: ${config.clientId ?? "(default)"}, ` +
      `agent_id: ${config.agentId ?? "(default)"})`,
  );
}

main().catch((err) => {
  const key = process.env.BEHAVR_API_KEY?.trim();
  const text = err instanceof Error ? (err.stack ?? err.message) : String(err);
  console.error(`[behavr-mcp] fatal: ${redact(text, key)}`);
  process.exit(1);
});
