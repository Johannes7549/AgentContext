# ADR-0010: Command adapter never uses a shell; Windows script shims are refused

- **Status:** Accepted
- **Date:** 2026-11-23
- **Task:** AC-034

## Context

`execute_command` lets an agent run local programs and receive optimized
output. Arguments come from model output, which may contain injected
instructions. Running them through a shell would allow command injection
(`;`, `&&`, `|`, `$(...)`, `%VAR%`).

On Windows, many developer tools are installed as script shims (`npm.cmd`,
`pnpm.cmd`, `.ps1`). Since the fix for CVE-2024-27980, Node refuses to spawn
`.cmd`/`.bat` files without `shell: true`, and running them through `cmd.exe`
re-introduces shell parsing of the arguments.

## Options

1. **Use a shell when needed** (e.g. for `.cmd` files) with argument escaping —
   escaping for `cmd.exe` is notoriously error-prone.
2. **Never use a shell; refuse script shims** — users allowlist real
   executables (e.g. `node.exe` with a script path, `git.exe`).

## Decision

Option 2:

- Commands are disabled by default; the tool is not registered unless
  `commands.enabled` is true.
- Only exact allowlist entries (executable names looked up on PATH, or
  absolute paths) run, always with `shell: false` and an argument array.
- On Windows, targets with `.cmd`, `.bat`, `.ps1`, `.vbs`, `.js` or `.wsf`
  extensions are refused with `COMMAND_NOT_ALLOWED`; `.cmd`/`.bat` are refused
  on every platform.
- The working directory must be inside an allowed root; the environment is
  reduced to an allowlist with secret-looking names removed; timeouts, an
  output cap and cancellation kill the whole process tree (`taskkill /T` on
  Windows, process group on POSIX); a request can shorten but never extend
  the configured timeout.
- Commands run with the user's operating-system permissions (documented).

## Consequences

- + No shell interpretation of agent-supplied arguments on any platform.
- − `npm`, `pnpm` and similar shims cannot be allowlisted directly on Windows;
  users can allowlist `node` and pass the package manager's JS entry point, or
  run such commands themselves and pass the output to `optimize_context`.
