export interface Config {
  apiKey: string;
  clientId?: string;
  agentId?: string;
}

function optional(value: string | undefined): string | undefined {
  const trimmed = (value ?? "").trim();
  return trimmed || undefined;
}

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
): Config | { error: string } {
  const apiKey = optional(env.BEHAVR_API_KEY);
  if (!apiKey) {
    return {
      error: "BEHAVR_API_KEY is not set. Add it to this MCP server's env config.",
    };
  }
  return {
    apiKey,
    clientId: optional(env.BEHAVR_CLIENT_ID),
    agentId: optional(env.BEHAVR_AGENT_ID),
  };
}