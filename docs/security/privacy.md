# Privacy and data handling

## What leaves your machine

Nothing. AgentContext makes no network requests and sends no telemetry. The
only output is the MCP response to the client that started it.

## What is stored, and where

| Data | Location | Contains content? |
|---|---|---|
| Originals of optimized content | `<storageDir>/agentcontext.db` (≤ 64 KiB, inline) or `<storageDir>/blobs/` (larger, files named by SHA-256) | **Yes** |
| Optimized variants and omission records | `agentcontext.db` | Yes (the returned content) |
| Optimization events (for stats) | `agentcontext.db` | No — only counts, token numbers, strategy names, timings |
| Logs | stderr of the server process (your MCP client decides where they go) | No — content fields are replaced by their size and secret-looking values are masked |

`storageDir` defaults to your user data directory (see
[Configuration](../configuration.md)). Stored content is not encrypted; it is
protected by your operating-system account permissions, like other files in
your profile.

`source` labels are stored with each original. `execute_command` stores only
the executable name, never its arguments.

## Retention and deletion

- Originals expire after `ttlHours` (default 7 days).
- Beyond `quotaMb` (default 500 MB) the oldest are evicted.
- Cleanup runs at startup and every hour.
- To delete everything immediately, stop the server and delete the storage
  directory.

## Access between projects and sessions

Every stored context carries a workspace id (derived from the project
directory) and a session id. By default only the session that stored a
context can retrieve it; with `retrievalScope: "workspace"` other sessions of
the same project can. Other projects cannot, even when they share a storage
directory. Inaccessible contexts are reported as `NOT_FOUND`.

## Commands and files

`read_file` only reads inside the allowed roots. `execute_command` is disabled
by default; when enabled, it runs allowlisted executables with your
operating-system permissions and a filtered environment.

See also: [Security policy](../../SECURITY.md) ·
[Security checklist](SECURITY_CHECKLIST.md).
