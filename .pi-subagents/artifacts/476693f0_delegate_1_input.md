# Task for delegate

Write the file /data/data/com.termux/files/home/fuckclaw/docs/architecture/07-workspace.md for the FuckClaw architecture specification.

This is §7 — Workspace. Write in RFC-grade depth with Mermaid diagrams, TypeScript interfaces, tables.

The Workspace is the agent's persistent filesystem home — analogous to a user's home directory in an OS. Cover:

1. Purpose — why the agent needs an owned filesystem workspace
2. Filesystem Layout — detailed directory tree (~/.fuckclaw/) with every directory explained:
   - data/ (databases)
   - workspace/projects/ (managed projects)
   - workspace/knowledge/ (knowledge base files)
   - workspace/artifacts/ (generated outputs)
   - workspace/scratch/ (temporary working space)
   - config/ (configuration files)
   - logs/ (structured logs)
   - cache/ (LLM response cache, embedding cache)
   - plugins/ (installed plugins)
   - skills/ (learned skills)
   - snapshots/ (workspace snapshots for rollback)
3. Project Management — how projects are registered, tracked, indexed. Project metadata schema.
4. Artifact Management — generated code, documents, images. Artifact metadata, versioning.
5. Knowledge Base — markdown files, research notes, extracted knowledge. How knowledge files are indexed and searchable.
6. Log Structure — structured JSON logs, rotation, retention policies
7. Cache Strategy — what is cached, TTL, eviction, cache invalidation
8. Temporary State — scratch space lifecycle, cleanup policies
9. Snapshots — point-in-time workspace snapshots for rollback. Implementation via filesystem or git.
10. Workspace Operations — create, backup, restore, migrate, export
11. File Watching — inotify/fsevents integration for detecting external changes
12. Interfaces, failure modes, extensibility, future improvements

Cross-reference: §4 Agent Kernel, §6 Memory System, §8 Knowledge Graph, §19 Configuration.

Target: ~400 lines.

---
**Output:**
Write your findings to exactly this path: /data/data/com.termux/files/home/fuckclaw/docs/architecture/07-workspace.md
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