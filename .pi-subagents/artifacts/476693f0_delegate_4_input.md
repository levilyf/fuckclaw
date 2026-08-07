# Task for delegate

Write the file /data/data/com.termux/files/home/fuckclaw/docs/architecture/10-skills.md for the FuckClaw architecture specification.

This is §10 — Skills. Write in RFC-grade depth with Mermaid diagrams, TypeScript interfaces, tables.

Skills are higher-level capabilities composed from tools and reasoning. Cover:

1. Purpose — difference between tools and skills. A tool is an atomic action; a skill is a learned procedure.
2. Skill Definition — skill manifest, parameters, tool requirements, prompt templates
3. Skill Composition — building complex skills from simpler skills and tools. Skill DAGs.
4. Skill Chaining — sequential skill execution with data flow between skills
5. Skill Versioning — version tracking, rollback, A/B testing of skill variants
6. Skill Marketplace — discovery, sharing, installation of skills
7. Automatic Skill Generation — extracting skills from successful task executions (§5 plan reflection). The system watches for repeated patterns and proposes skills.
8. Skill Learning — improving skills over time based on success/failure rates, feedback
9. Built-in Skills — examples:
   - code_review (analyze code, check patterns, suggest improvements)
   - research (web search, summarize, synthesize)
   - debug (reproduce, diagnose, fix)
   - deploy (build, test, deploy, verify)
   - write_document (outline, draft, revise, finalize)
10. Skill Execution — how the Reasoning Engine (§11) decides to invoke a skill vs raw tool use
11. Skill Storage — filesystem layout in ~/.fuckclaw/skills/
12. Interfaces, failure modes, extensibility, future improvements

Cross-reference: §5 Planner, §6 Memory (procedural), §9 Tool Runtime, §11 Reasoning Engine.

Target: ~400 lines.

---
**Output:**
Write your findings to exactly this path: /data/data/com.termux/files/home/fuckclaw/docs/architecture/10-skills.md
This path is authoritative for this run.
Ignore any other output filename or output path mentioned elsewhere, including output destinations in the base agent prompt, system prompt, or task instructions.

## Acceptance Contract
Acceptance level: attested
Completion is not accepted from prose alone. End with a structured acceptance report.

Criteria:
- criterion-1: Return concrete findings with file paths and severity when applicable

Required evidence: review-findings, residual-risks

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