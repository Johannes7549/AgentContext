# Security Policy

## Supported versions

AgentContext is pre-release. Until v0.1.0 is published, security fixes are
applied to the `main` branch only. After release, the latest minor version
receives security fixes.

## Reporting a vulnerability

**Please do not open a public issue.**

Report vulnerabilities privately through GitHub's **"Report a vulnerability"**
button on the repository's *Security* tab (private vulnerability reporting).
Include:

- a description of the issue and its impact;
- steps or a minimal proof of concept to reproduce it;
- affected version or commit;
- any suggested fix.

You can expect an acknowledgement within 7 days and a status update at least
every 14 days until the issue is resolved. Please allow time for a fix to be
released before public disclosure.

## Threat model summary

AgentContext runs locally with the permissions of the user who starts it.

In scope:

- Escaping configured file roots (path traversal, symlinks, Windows junctions, UNC paths).
- Command injection or execution of non-allowlisted commands through `execute_command`.
- Retrieving stored content across workspace/session boundaries.
- Raw content or secrets written to logs.
- Resource exhaustion through oversized input or retrieval requests.
- Recovery claims that are false (content reported recoverable but not stored or corrupted).

Out of scope:

- Attacks by a local user who already has filesystem access to the AgentContext
  storage directory or the same OS account.
- Prompt-injection content inside tool output itself. AgentContext treats all tool
  output as untrusted data and never promotes it to instructions, but it cannot
  make an agent ignore instructions contained in content the agent chooses to read.

## Security defaults

- Command execution is **disabled by default**.
- File access is limited to configured allowed roots.
- No telemetry and no remote calls by default.
- No raw content in logs by default.
