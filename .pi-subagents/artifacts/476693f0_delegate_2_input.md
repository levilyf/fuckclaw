# Task for delegate

Write the file /data/data/com.termux/files/home/fuckclaw/docs/architecture/08-knowledge-graph.md for the FuckClaw architecture specification.

This is §8 — Knowledge Graph. Write in RFC-grade depth with Mermaid diagrams, TypeScript interfaces, tables, SQL schemas.

The Knowledge Graph is the agent's structured model of the world — entities and their relationships. Cover:

1. Purpose — why a knowledge graph on top of memory. Structured relationships vs unstructured text.
2. Entity Model — entity types and their schemas:
   - Projects (repos, codebases, deployments)
   - People (contacts, collaborators, team members)
   - Organizations (companies, teams, communities)
   - Files (tracked files, their roles, dependencies)
   - Conversations (chat sessions, their topics, outcomes)
   - Goals (active/completed/abandoned goals)
   - Tasks (work items, their status, outcomes)
   - Events (calendar events, incidents, milestones)
   - Decisions (architectural decisions, their context, rationale)
   - Concepts (technical concepts, learned definitions)
   - Tools (known tools, their capabilities, reliability)
   - Skills (learned skills, their success rates)
3. Relationship Types — typed edges between entities (e.g., person WORKS_ON project, file DEPENDS_ON file, decision AFFECTS project)
4. Graph Storage — SQLite adjacency-list model with recursive CTEs for traversal. Schema design.
5. Graph Queries — common query patterns (find all entities related to X within N hops, find the context around a decision, find all files for a project)
6. Graph Updates — how entities are created, merged, updated. Idempotent upsert patterns.
7. Entity Resolution — detecting duplicate entities, merging, canonical names
8. Temporal Versioning — tracking entity state changes over time (not just current state)
9. Graph Visualization — data format for rendering (D3, Cytoscape compatible)
10. Integration with Memory (§6) — how graph entities reference memory records and vice versa
11. Interfaces, SQL schema, failure modes, performance, future improvements

Target: ~500 lines.

---
**Output:**
Write your findings to exactly this path: /data/data/com.termux/files/home/fuckclaw/docs/architecture/08-knowledge-graph.md
This path is authoritative for this run.
Ignore any other output filename or output path mentioned elsewhere, including output destinations in the base agent prompt, system prompt, or task instructions.

## Acceptance Contract
Acceptance level: checked
Completion is not accepted from prose alone. End with a structured acceptance report.

Criteria:
- criterion-1: Implement the requested change without widening scope

Required evidence: changed-files, tests-added, commands-run, residual-risks, no-staged-files

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