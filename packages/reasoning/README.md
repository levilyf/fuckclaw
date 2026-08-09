# @fuckclaw/reasoning

The `@fuckclaw/reasoning` package is the "brain" of the agent framework. It dictates *how* the AI approaches solving a problem once a step is assigned to it.

## What it does
Instead of forcing a single execution loop for every problem, this package provides multiple reasoning strategies. A dynamic `StrategySelector` evaluates the task's complexity and routes it to the most efficient approach to save tokens.

## Intended Audience
- **Advanced Users & Developers**: If FuckClaw is failing to solve a complex coding problem, you can observe which reasoning strategy was chosen. You can force the engine to "think deeper" by tagging a task to use Tree Search.

## Key Strategies
- **Direct Strategy**: A fast-path for single-turn generation. Ideal for simple questions or one-off file writes where iteration is unnecessary.
- **ReAct Loop (Reason + Act)**: The standard iterative loop. The agent Observes, Thinks, Acts (calls a tool), and Reflects until the task is complete.
- **Tree/Beam Search**: For highly complex problems, the agent explores multiple branching paths in parallel. A `StateEvaluator` scores the progress of each branch (rewarding goal keywords, penalizing errors) and prunes dead-end paths using Beam Search to find the optimal solution.

## Key Behaviors
- **Tool Parsing**: Safely extracts JSON tool calls from the LLM's raw text output, ensuring strict adherence to schemas and recovering gracefully from malformed JSON or markdown blocks.

## How it fits into FuckClaw
**Depends on:** `@fuckclaw/llm-router`, `@fuckclaw/tool-runtime`.
**Used by:** `@fuckclaw/kernel`, `@fuckclaw/multi-agent`. 

## Status
🟢 **Core**
Tree Search, Beam Search, ReAct, and Direct execution are all fully active. 
*Caveat:* Tree Search consumes significantly more tokens than ReAct. The Strategy Selector avoids it unless necessary, but users should monitor budgets when manually forcing it.
