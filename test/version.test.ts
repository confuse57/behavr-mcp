import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Runs from dist/test/; the built server is dist/src/index.js, package.json is two levels up.
const serverPath = fileURLToPath(new URL("../src/index.js", import.meta.url));
const pkgPath = fileURLToPath(new URL("../../package.json", import.meta.url));

test("server reports the same version as package.json in initialize", async () => {
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version: string };

  // Dummy key: initialize never calls the BEHAVR API.
  const child = spawn(process.execPath, [serverPath], {
    env: { ...process.env, BEHAVR_API_KEY: "bhv_test_fake_key_123" },
    stdio: ["pipe", "pipe", "pipe"],
  });

  try {
    const response = await new Promise<{ result?: { serverInfo?: { version?: string } } }>(
      (resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("no initialize response within 10s")), 10_000);
        let buf = "";
        child.stdout.setEncoding("utf8");
        child.stdout.on("data", (chunk: string) => {
          buf += chunk;
          const nl = buf.indexOf("\n");
          if (nl === -1) return;
          clearTimeout(timer);
          try {
            resolve(JSON.parse(buf.slice(0, nl)));
          } catch (err) {
            reject(err);
          }
        });
        child.on("error", reject);
        child.on("exit", (code) => reject(new Error(`server exited early with code ${code}`)));
        child.stdin.write(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: {
              protocolVersion: "2025-06-18",
              capabilities: {},
              clientInfo: { name: "version-test", version: "0" },
            },
          }) + "\n",
        );
      },
    );

    assert.equal(response.result?.serverInfo?.version, pkg.version);
  } finally {
    child.kill();
  }
});
