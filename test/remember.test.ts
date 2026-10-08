import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ListOptions, RememberOptions } from "behavr-sdk";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Config } from "../src/config.js";
import { handleRemember, type RememberClient } from "../src/tools/remember.js";

const config: Config = { apiKey: "bhv_test_fake_key_123", clientId: "c1" };
const waitOverrides = { sleep: async () => {}, log: () => {} };

// Fake client: records calls; the upload is "completed" on the first poll.
function fakeClient() {
  const rememberCalls: RememberOptions[] = [];
  const listCalls: ListOptions[] = [];
  const client: RememberClient = {
    async remember(opts) {
      rememberCalls.push(opts);
      return { memoryId: "mem-1", status: "queued", summary: "" };
    },
    async list(opts) {
      listCalls.push(opts);
      return { memories: [{ memoryId: "mem-1", title: "Receipt" }], total: 1 };
    },
  };
  return { client, rememberCalls, listCalls };
}

function textOf(result: CallToolResult): string {
  const first = result.content[0];
  return first?.type === "text" ? first.text : "";
}

test("rejects a relative path without uploading", async () => {
  const { client, rememberCalls } = fakeClient();
  const result = await handleRemember({ file_path: "screenshot.png" }, { client, config, waitOverrides });
  assert.equal(result.isError, true);
  assert.equal(textOf(result), "file_path must be an absolute path, for example C:\\Users\\me\\screenshot.png");
  assert.equal(rememberCalls.length, 0);
});

// These files do not exist: if stat() ran before the allowlist, the message
// would be "File not found" instead.
const missingDir = path.join(os.tmpdir(), "behavr-mcp-does-not-exist");
for (const name of [".env", "notes.txt", "id_rsa", "contract.pdf"]) {
  test(`refuses to upload '${name}' before touching the filesystem`, async () => {
    const { client, rememberCalls } = fakeClient();
    const filePath = path.join(missingDir, name);
    const result = await handleRemember({ file_path: filePath }, { client, config, waitOverrides });
    assert.equal(result.isError, true);
    assert.equal(
      textOf(result),
      "Only image/video files can be remembered (jpg, jpeg, png, heic, webp, mp4, mov, avi, mkv, webm). " +
        `Refusing to upload '${name}'.`,
    );
    // Only the basename is echoed back, never the directory.
    assert.ok(!textOf(result).includes(missingDir), textOf(result));
    assert.equal(rememberCalls.length, 0);
  });
}

test("reports a missing file with an allowed extension without uploading", async () => {
  const { client, rememberCalls } = fakeClient();
  const filePath = path.join(missingDir, "photo.png");
  const result = await handleRemember({ file_path: filePath }, { client, config, waitOverrides });
  assert.equal(result.isError, true);
  assert.equal(textOf(result), `File not found: ${filePath}`);
  assert.equal(rememberCalls.length, 0);
});

let tmpDir: string | undefined;
after(async () => {
  if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
});

for (const name of ["photo.PNG", "scan.heic"]) {
  test(`uploads '${name}' with only the ids that are set`, async () => {
    tmpDir ??= await mkdtemp(path.join(os.tmpdir(), "behavr-mcp-test-"));
    const filePath = path.join(tmpDir, name);
    await writeFile(filePath, "not really an image");
    const { client, rememberCalls, listCalls } = fakeClient();
    const result = await handleRemember({ file_path: filePath }, { client, config, waitOverrides });
    assert.equal(result.isError, undefined);
    assert.equal(
      textOf(result),
      [`Remembered '${name}'.`, "memoryId: mem-1", "title: Receipt", "status: completed"].join("\n"),
    );
    assert.deepEqual(rememberCalls, [{ file: filePath, clientId: "c1" }]);
    assert.deepEqual(listCalls[0], { clientId: "c1", agentId: undefined, status: "completed", limit: 100 });
  });
}
