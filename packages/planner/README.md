# @fuckclaw/planner

The `@fuckclaw/planner` package is responsible for breaking down massive, ambiguous user requests into executable, bite-sized steps.

## What it does
Instead of letting an agent flail blindly at a huge goal (e.g., "Build a full-stack web app"), the Planner acts as a project manager. It analyzes the goal and creates a Directed Acyclic Graph (DAG) of dependencies, ensuring tasks are tackled in the correct logical order.

## Intended Audience
- **All Users**: When you submit a multi-step task, you will see the output of the Planner in the CLI or Web Dashboard as a checklist of steps.

## Key Behaviors
- **Goal Decomposition**: Uses the LLM to intelligently split a top-level goal into parallel and sequential execution steps.
- **DAG Execution Engine**: Manages the dependency graph. It ensures that "Step B" (Testing) does not start until "Step A" (Implementation) has successfully finished.
- **Dynamic Replanner**: If a step fails mid-execution (e.g., a dependency fails to install), the Replanner can pause, analyze the failure, and rewrite the remainder of the plan to recover without having to start from scratch.

## Typical Output

When you run a complex task, the Planner outputs:
```text
✓ Generated plan with 3 steps (Strategy: tree_search):
   1. [read] Analyze existing auth.ts file
   2. [code] Rewrite auth.ts using bcrypt
   3. [test] Run unit tests and verify
```

## How it fits into FuckClaw
**Depends on:** `@fuckclaw/llm-router`, `@fuckclaw/knowledge-graph`.
**Used by:** `@fuckclaw/kernel`. The Kernel invokes the Planner when a task is deemed too large for single-shot execution.

## Status
🟢 **Core**
DAG generation, execution, and replanning are fully implemented.
