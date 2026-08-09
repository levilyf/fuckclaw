# @fuckclaw/multi-agent

The `@fuckclaw/multi-agent` package brings team-based orchestration to FuckClaw. It allows a central supervisor to divide and delegate work to specialized sub-agents.

## What it does
When a task is too complex for a single prompt, the Supervisor spawns specialized agents. Each sub-agent receives a customized system prompt, a strict token budget, and a heavily restricted toolset. 

## Intended Audience
- **Users Executing Complex Workflows**: If you submit a massive task like "Build a full-stack web app from scratch", this package ensures the workload is divided logically. You will see the Supervisor orchestrating handoffs in the CLI logs.

## Key Behaviors
- **Role Specifications**: Includes 8 built-in agent personas: `supervisor`, `researcher`, `coder`, `reviewer`, `writer`, `planner`, `memory_manager`, and `devops`.
- **Delegation Protocol**: The supervisor delegates a parent task to a child agent, passes specific context files, and waits for the child to return structured output.
- **Strict Tool Isolation**: Sub-agents are sandboxed to safe toolsets. For example, a `reviewer` agent is granted `read` access to files but explicitly blocked from using the `write` or `shell` tools.

## Example Workflow
1. User requests: *"Write an auth module and review its security."*
2. Kernel hands task to `supervisor`.
3. `supervisor` delegates to `coder` (allowed to `write`).
4. `coder` finishes.
5. `supervisor` delegates the output to `reviewer` (allowed only to `read`).
6. `reviewer` approves, and `supervisor` completes the task.

## How it fits into FuckClaw
**Depends on:** `@fuckclaw/reasoning` (powers the children), `@fuckclaw/tool-runtime` (enforces tool boundaries).
**Used by:** `@fuckclaw/kernel`.

## Status
🟢 **Core**
Agent pool orchestration, tool whitelisting, and the 8 default personas are fully implemented.
*Limitations:* Sub-agents currently execute sequentially or via controlled parallel fan-out on a single host machine. Multi-machine swarm clustering is not supported.
