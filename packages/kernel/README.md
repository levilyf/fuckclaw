# @fuckclaw/kernel

The `@fuckclaw/kernel` package is the central orchestration engine of FuckClaw. It manages the lifecycle of autonomous tasks, handles concurrency, and securely formats context for the LLM.

## What it does
When the CLI hands over a task, the Kernel takes full ownership. It moves the task state from `idle` to `executing` to `completed`. It locks resources so multiple agents don't corrupt the same file, and it acts as the gatekeeper for token budgets, ensuring the AI never exceeds context limits.

## Intended Audience
- **Advanced Operators & Contributors**: You care about this package when debugging task starvation, token budget drop-offs, or concurrent execution locks.

## Key Behaviors
- **Context Assembly**: The `ContextManager` dynamically builds the "System Prompt." It pulls in negative constraints (anti-patterns from Self-Improvement), episodic memories, and relevant files, trimming them automatically to fit the token budget before passing them to the LLM.
- **Priority Queue**: The `TaskOrchestrator` runs an event loop, pulling tasks based on priority and calculating "aging" to prevent low-priority background tasks from starving.
- **Resource Locks**: Prevents concurrency collisions (e.g., stopping two agents from executing shell commands in the same directory simultaneously).

## How it fits into FuckClaw
**Depends on:** `@fuckclaw/memory`, `@fuckclaw/event-bus`, `@fuckclaw/config`.
**Used by:** `@fuckclaw/cli` (to submit tasks), `@fuckclaw/network` (HTTP triggers).
The Kernel bridges the user interface to the Execution Engines (`reasoning`, `multi-agent`).

## Status
🟢 **Core**
Task state machines, context assembly, and single-node resource locking are fully functional.
*Deferred:* Multi-node distributed task queuing is not supported.
