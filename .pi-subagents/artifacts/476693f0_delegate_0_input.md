# Task for delegate

Write the file /data/data/com.termux/files/home/fuckclaw/docs/architecture/06-memory-system.md for the FuckClaw architecture specification.

This is §6 — Memory System. Write it in the same style as the existing sections (RFC-grade depth, Mermaid diagrams, TypeScript interfaces, tables, SQL schemas, sequence diagrams).

Cover ALL of the following with extreme technical depth:

1. Purpose — why a multi-type memory architecture instead of a single vector store
2. Working Memory — current session state, scratchpad, active context. Implemented as in-process data structures flushed to DB on checkpoint.
3. Long-Term Memory — persistent storage of all memories, the archival layer
4. Semantic Memory — facts, knowledge, beliefs about the world. Schema, storage, retrieval, updates, conflict resolution.
5. Procedural Memory — learned skills, tool sequences, workflow patterns. How the agent remembers HOW to do things.
6. Episodic Memory — specific events, conversations, task executions. Temporal indexing, narrative structure.
7. Knowledge Graph integration — how memory entities connect to the Knowledge Graph (§8)
8. Embeddings — embedding model selection, dimensionality, batch processing, caching. Use sqlite-vec for vector storage.
9. Memory Retrieval — multi-signal retrieval combining embedding similarity, recency, importance, access frequency.
10. Memory Ranking — scoring algorithm, weights, context-dependent ranking
11. Memory Decay — time-based decay curves, importance-weighted decay, access-based refresh
12. Memory Consolidation — periodic process that summarizes episodic clusters, extracts semantic facts, identifies procedural patterns. Runs during idle periods.
13. Dreaming — background process that discovers connections between memories, generates insights, cross-pollinates knowledge. Creative consolidation.
14. Memory Compression — reducing token footprint of old memories while preserving essential information
15. Conflict Resolution — when new facts contradict existing beliefs, how to resolve
16. Memory Indexing — full-text search, embedding indexes, temporal indexes, tag indexes
17. Version History — tracking how beliefs/knowledge change over time
18. Interfaces — IMemorySystem TypeScript interface
19. Persistence schema — SQL tables for each memory type
20. Failure modes and mitigations
21. Performance considerations
22. Future improvements

Cross-reference other sections as §N (e.g., §4 for Agent Kernel, §8 for Knowledge Graph, §14 for Event Bus, §11 for Reasoning Engine, §20 for Persistence Layer).

This should be the LONGEST section in the entire document — at least 800 lines. Memory is the core differentiator.

---
**Output:**
Write your findings to exactly this path: /data/data/com.termux/files/home/fuckclaw/docs/architecture/06-memory-system.md
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