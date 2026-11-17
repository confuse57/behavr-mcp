# Changelog

## 0.2.0

- `ask` now lists each source with its title: `- <title> (<memoryId>)`, or `- <memoryId>` when BEHAVR gives no title for that source. Titles are flattened to one line and capped at 100 characters.
- Requires `behavr-sdk` 0.4.0 (pinned exactly), which provides the source titles (`sourceDetails`) and `deleteMemory()`.
- The end-to-end script deletes its uploaded memory at the end of each run.
- Security: `zod` 4.6.5 → 4.6.6 (GHSA-mrhx-c7xc-m3w5), plus patch/minor updates of transitive dependencies of `@modelcontextprotocol/sdk` that fix advisories in `hono`, `@hono/node-server`, `body-parser`, `fast-uri`, `ip-address` and `qs`.

## 0.1.2

- Docs fixes.
