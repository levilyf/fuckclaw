# @fuckclaw/self-improvement

The `@fuckclaw/self-improvement` package is the mechanism by which FuckClaw learns from its mistakes, ensuring it doesn't repeatedly fail in the exact same way.

## What it does
When an agent fails to complete a task, this engine intercepts the execution trace. It analyzes *why* the failure occurred, extracts a generalized rule (an "anti-pattern"), and automatically injects that rule into future agent prompts to guide behavior.

## Intended Audience
- **All Users**: You benefit from this package automatically. If FuckClaw gets stuck in a loop trying to run a broken command, this engine catches the failure and prevents the agent from trying that specific broken approach again in subsequent runs.

## Key Behaviors
- **Failure Analyzer**: Uses an LLM to review failed traces. It extracts the Context, the specific Mistake, the Consequence, and the Mandatory Corrective Action.
- **Anti-Pattern Store**: Saves these learned constraints in an FTS5-indexed SQLite database for fast semantic retrieval.
- **Context Injection (Negative Constraints)**: Automatically prepends relevant anti-patterns to the agent's context (e.g., *"Do not use Math.random() for JWT secrets; use crypto.randomBytes instead"*).
- **Prompt Evolution**: Proposes permanent changes to agent system prompts based on chronic, repeating failures.

## How it fits into FuckClaw
**Depends on:** `@fuckclaw/llm-router` (to analyze traces), `@fuckclaw/persistence` (SQLite storage).
**Used by:** `@fuckclaw/kernel`. The Kernel calls this package during prompt assembly to gather negative constraints.

## Status
🟢 **Core**
Failure analysis and negative constraint injection are fully active.
*Caveat:* The failure analyzer consumes a small amount of your token budget to review traces in the background. If the token budget is exhausted, self-improvement cycles are skipped.
