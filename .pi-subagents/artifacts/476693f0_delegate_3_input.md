# Task for delegate

Write the file /data/data/com.termux/files/home/fuckclaw/docs/architecture/09-tool-runtime.md for the FuckClaw architecture specification.

This is §9 — Tool Runtime. Write in RFC-grade depth with Mermaid diagrams, TypeScript interfaces, tables.

The Tool Runtime is the agent's hands — how it interacts with the external world. Cover:

1. Purpose — tools as the bridge between reasoning and action
2. Tool Abstraction — unified ToolDefinition interface that works across native tools, MCP tools, REST APIs, CLI tools
3. Tool Registry — dynamic registration, discovery, capability description. Registry data structures.
4. Native Tools — built-in tools:
   - Shell (command execution, streaming output, timeout, working directory)
   - Filesystem (read, write, edit, search, watch, glob)
   - Git (clone, commit, push, pull, diff, branch, log)
   - Python (execute scripts, manage venvs, pip install)
   - Browser (Playwright-based: navigate, screenshot, click, fill, extract)
   - Docker (build, run, exec, compose, logs)
   - Database (SQLite, Postgres query execution)
   - HTTP (arbitrary HTTP requests)
   - Search (web search via APIs)
5. MCP Tool Integration — how MCP-discovered tools are registered and invoked (details in §17)
6. Tool Execution Pipeline — validation → preparation → execution → result parsing → error handling
7. Error Handling — error classification (transient, permanent, auth, timeout), retry policies per tool
8. Streaming — real-time output streaming for long-running tools (shell, docker build)
9. Timeouts — per-tool timeout configuration, global timeout, graceful kill
10. Retries — exponential backoff, jitter, max retries, idempotency checks
11. Tool Result Schema — structured tool results with stdout, stderr, exit code, artifacts
12. Tool Security Context — tools run with operator's full permissions (no sandbox)
13. Interfaces, failure modes, extensibility, performance, future improvements

Cross-reference: §4 Agent Kernel, §11 Reasoning Engine, §17 MCP, §14 Event Bus.

Target: ~500 lines.

---
**Output:**
Write your findings to exactly this path: /data/data/com.termux/files/home/fuckclaw/docs/architecture/09-tool-runtime.md
This path is authoritative for this run.
Ignore any other output filename or output path mentioned elsewhere, including output destinations in the base agent prompt, system prompt, or task instructions.

## Acceptance Contract
Acceptance level: reviewed
Completion is not accepted from prose alone. End with a structured acceptance report.

Criteria:
- criterion-1: Implement the requested change without widening scope
- criterion-2: Return evidence sufficient for an independent acceptance review

Required evidence: changed-files, tests-added, commands-run, validation-output, residual-risks, no-staged-files

Review gate: required by reviewer.

Finish with a fenced JSON block tagged `acceptance-report` in this shape:
Use empty arrays when no items apply; array fields contain strings unless object entries are shown.
`criteriaSatisfied[].status` must be exactly one of: satisfied, not-satisfied, not-applicable.
`commandsRun[].result` must be exactly one of: passed, failed, not-run.
`manualNotes` and `notes` are optional strings; an empty string means no note and does not satisfy `manual-notes` evidence.
```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "specific proof"
    },
    {
      "id": "criterion-2",
      "status": "satisfied",
      "evidence": "specific proof"
    }
  ],
  "changedFiles": [
    "src/file.ts"
  ],
  "testsAddedOrUpdated": [
    "test/file.test.ts"
  ],
  "commandsRun": [
    {
      "command": "command",
      "result": "passed",
      "summary": "short result"
    }
  ],
  "validationOutput": [
    "validation output or concise summary"
  ],
  "residualRisks": [
    "none"
  ],
  "noStagedFiles": true,
  "diffSummary": "short description of the diff",
  "reviewFindings": [
    "blocker: file.ts:12 - issue found, or no blockers"
  ],
  "manualNotes": "anything else the parent should know"
}
```