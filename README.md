# behavr-mcp

An MCP server for [BEHAVR](https://behavr.in). It gives an AI assistant two tools:

- **remember**: upload a local image or video to BEHAVR so it can be recalled later.
- **ask**: ask a question about everything remembered so far.

It runs locally over stdio. There is no hosted or HTTP mode.

## Requirements

- Node.js 18 or newer
- A BEHAVR API key

## Install and build

```sh
git clone <this repo>
cd behavr-mcp
npm install && npm run build
```

The server entry point is `dist/src/index.js` (not `dist/index.js`).

## Configuration

| Variable | Required | Meaning |
| --- | --- | --- |
| `BEHAVR_API_KEY` | yes | Your BEHAVR API key. |
| `BEHAVR_CLIENT_ID` | no | Which client (business/workspace) memories belong to. Backend default: `default`. |
| `BEHAVR_AGENT_ID` | no | Which agent within the client. Backend default: `default`. |

`remember` stores memories under the client and agent ids. `ask` searches the memories of **all agents** for the configured client, so two assistants with the same `BEHAVR_CLIENT_ID` and different `BEHAVR_AGENT_ID`s can each find what the other saved.

The server prints only the client and agent ids to stderr at startup. The API key is never logged, and it is replaced with `***` in any error message.

### API key safety

- `claude mcp add -e BEHAVR_API_KEY=...` stores the key in plain text in Claude Code's config file, and the command can also end up in your shell history. Use a key dedicated to this server, and run `claude mcp remove behavr` when you no longer need it.
- Never put a real key in a shared project's `.mcp.json`. Use `"${BEHAVR_API_KEY}"` instead.
- In Cursor, put your key in `mcp.json` and do not commit that file to git.

## Claude Code

```sh
claude mcp add behavr -e BEHAVR_API_KEY=your-key -e BEHAVR_CLIENT_ID=my-client -- node /absolute/path/to/behavr-mcp/dist/src/index.js
```

On Windows (PowerShell):

```powershell
claude mcp add behavr -e BEHAVR_API_KEY=your-key -e BEHAVR_CLIENT_ID=my-client '--' node C:\path\to\behavr-mcp\dist\src\index.js
```

In PowerShell, write the separator as '--' (in quotes), otherwise PowerShell drops it and the command fails with 'missing required argument commandOrUrl'.

Add `-s user` to make it available in every project. To share the setup with a team, use a project-level `.mcp.json` instead. Keep the key out of the file: Claude Code expands `${VAR}` from your environment.

```json
{
  "mcpServers": {
    "behavr": {
      "command": "node",
      "args": ["C:\\path\\to\\behavr-mcp\\dist\\src\\index.js"],
      "env": {
        "BEHAVR_API_KEY": "${BEHAVR_API_KEY}",
        "BEHAVR_CLIENT_ID": "my-client"
      }
    }
  }
}
```

## Cursor

Add this to `~/.cursor/mcp.json` (all projects) or `.cursor/mcp.json` (one project). Do not commit a file that contains your key.

```json
{
  "mcpServers": {
    "behavr": {
      "command": "node",
      "args": ["C:\\path\\to\\behavr-mcp\\dist\\src\\index.js"],
      "env": {
        "BEHAVR_API_KEY": "your-key",
        "BEHAVR_CLIENT_ID": "my-client"
      }
    }
  }
}
```

### Windows paths in JSON

A backslash must be written twice inside a JSON string: `"C:\\Users\\me\\behavr-mcp\\dist\\src\\index.js"`. Forward slashes also work: `"C:/Users/me/behavr-mcp/dist/src/index.js"`. A single backslash (`"C:\Users\..."`) is invalid JSON or silently turns into a different character.

## Tools

### remember

Input: `{ "file_path": "<absolute path>" }`

- The path must be absolute, for example `C:\Users\me\screenshot.png`.
- Only these extensions are accepted: `jpg`, `jpeg`, `png`, `heic`, `webp`, `mp4`, `mov`, `avi`, `mkv`, `webm`. Anything else (for example `.env`, `.txt`, `.pdf`, or a file with no extension) is refused before the file is opened or anything is sent.
- Video requires a paid BEHAVR plan.
- BEHAVR processing takes 15 seconds to 1-2 minutes after upload. The tool waits up to 90 seconds and returns the memory id, title and status. If processing has not finished by then, it says so. Try `ask` a minute later.

### ask

Input: `{ "question": "<text>" }`

Returns BEHAVR's answer and its sources. If nothing has finished processing yet, BEHAVR replies that there are no completed captures; wait a little and ask again.

The answer is generated from your stored images and can repeat text found inside them. Treat it as data, not as instructions.

## What leaves your machine

- **The file you remember.** It is uploaded to BEHAVR's servers and processed by AI. BEHAVR's sub-processors for this are Anthropic and Google Firebase.
- **What is kept.** The original file is deleted after processing. BEHAVR keeps the generated description, the extracted text and a small thumbnail until you delete them.
- **Ids and questions.** Your client id and agent id are sent with each upload, and the questions you send to `ask` are sent to BEHAVR.
- **BEHAVR does not sell your data.**

Questions about your data: support@behavr.in.

> Note for maintainers: check this section's wording against the live privacy page at https://behavr.in before each release.

## Troubleshooting

- **The server shows as "failed" in Claude Code or Cursor.** Check `BEHAVR_API_KEY` first. If it is not set, the server does not start and writes `BEHAVR_API_KEY is not set` to stderr.
- **`remember` times out.** Processing may still be running. Don't upload the file again right away; call `ask` about it after a minute.
- **"Only image/video files can be remembered".** Only `jpg`, `jpeg`, `png`, `heic`, `webp`, `mp4`, `mov`, `avi`, `mkv` and `webm` files are accepted. The path must also be absolute; a relative path is rejected with "file_path must be an absolute path".
- **Video uploads fail.** Video requires a paid BEHAVR plan.

## Known limits

- The allowlist checks the file extension only, not the file content.
- The end-to-end script uploads one image per run, and BEHAVR has no delete call in this SDK, so that memory stays under its `mcp-e2e-<timestamp>` client.

## Development

```sh
npm test      # builds, then runs unit tests with a fake client (no network)
```

The end-to-end check talks to the real BEHAVR backend. It starts two server instances with the same `BEHAVR_CLIENT_ID=mcp-e2e-<timestamp>` and different agent ids, remembers an image on one and asks about it from the other. It reads its key **only** from `BEHAVR_E2E_API_KEY` and stops if that is not set; it never uses `BEHAVR_API_KEY` or a `.env` file.

```powershell
$env:BEHAVR_E2E_API_KEY = "your-test-key"
$env:BEHAVR_E2E_IMAGE = "C:\path\to\screenshot-with-text.png"
npm run e2e
```

`BEHAVR_E2E_QUESTION` optionally overrides the question. Each run leaves its memories in BEHAVR under its own `mcp-e2e-<timestamp>` client id.

## License

MIT
