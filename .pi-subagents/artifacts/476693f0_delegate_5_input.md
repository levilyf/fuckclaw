# Task for delegate

Write the file /data/data/com.termux/files/home/fuckclaw/docs/architecture/11-reasoning-engine.md for the FuckClaw architecture specification.

This is §11 — Reasoning Engine. Write in RFC-grade depth with Mermaid diagrams, TypeScript interfaces, tables.

The Reasoning Engine is the core cognitive processor — it takes context and produces decisions and actions. Cover:

1. Purpose — why a dedicated reasoning engine instead of raw LLM calls
2. ReAct Pattern — Reason + Act loop. Implementation of the observe-think-act cycle.
3. Tree Search — exploring multiple reasoning paths when a problem is complex. Beam search over action sequences. When to branch vs commit.
4. Reflection — self-evaluation after each step. Comparing expected vs actual outcomes.
5. Planning Loops — tight integration with Planner (§5) for multi-step reasoning
6. Verification — checking tool outputs against expectations, validating results
7. Self-Correction — detecting reasoning errors, backtracking, trying alternative approaches
8. Execution Budget — token budget tracking, cost-aware reasoning (use cheaper models for simpler steps)
9. Context Construction — how the reasoning engine requests context from the Context Manager (§4.8)
10. Prompt Construction — system prompt architecture, few-shot examples, chain-of-thought formatting
11. Structured Output — using schemas to get structured responses from LLMs
12. Reasoning Traces — full trace of reasoning steps for observability (§18)
13. Multi-Strategy Reasoning — selecting between strategies (direct answer, research, decompose, delegate to agent) based on task complexity
14. Interfaces, failure modes, performance considerations, future improvements

Cross-reference: §4 Agent Kernel, §5 Planner, §6 Memory, §9 Tool Runtime, §12 LLM Router.

Target: ~500 lines.

---
**Output:**
Write your findings to exactly this path: /data/data/com.termux/files/home/fuckclaw/docs/architecture/11-reasoning-engine.md
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