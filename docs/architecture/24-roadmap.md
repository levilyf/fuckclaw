# §24 — Future Roadmap

## 24.1 Purpose

This document outlines the phased delivery plan for the FuckClaw Personal AI Operating System. The architecture specified in this document is vast; attempting a "big bang" release is unrealistic. Development is structured in progressive phases, each delivering a functional, self-contained subset of the system that builds toward the final vision.

## 24.2 Phased Delivery Plan

### Phase 1: The Reactive Core (MVP)
*Goal: Establish the Agent Kernel, basic Tool Runtime, and synchronous reasoning.*

- **Agent Kernel**: Core execution loop, single-task processing (no concurrency).
- **Reasoning Engine**: Basic ReAct loop (Observe-Think-Act).
- **Tool Runtime**: Shell, Filesystem, HTTP, and Basic Python execution.
- **LLM Router**: Multi-provider support (Anthropic, OpenAI) with basic tier-based routing.
- **Memory System (V1)**: Working Memory and basic Episodic Memory (raw logging to SQLite).
- **Frontend**: CLI Interface (`fuckclaw ask`).
- **Configuration**: `fuckclaw.toml` and environment variable support.

### Phase 2: Memory & Knowledge (The "Brain" Update)
*Goal: Implement persistent cognitive state and structured world modeling.*

- **Memory System (V2)**: Semantic and Procedural memory implementation.
- **Knowledge Graph**: SQLite adjacency-list implementation with entity extraction.
- **Consolidation Daemon**: Background task to convert Episodic $\to$ Semantic/Procedural.
- **Vector Search**: Integration of `sqlite-vec` for dense embedding retrieval.
- **Workspace**: Project management and indexing.
- **Observability**: Structured logging and basic trace recording.

### Phase 3: Autonomy & Planning (The "Agency" Update)
*Goal: Move from reactive single-step execution to proactive multi-step autonomy.*

- **Planner**: Goal decomposition, dependency graphs, and replanning.
- **Scheduler**: Cron, file watching, and condition-based triggers.
- **Event Bus**: Internal Pub/Sub for module decoupling.
- **Agent Kernel (V2)**: Concurrent task execution and preemption.
- **Skills (V1)**: Explicitly defined YAML skill manifests and execution.
- **Frontend**: Web Dashboard for visualizing plans and traces.

### Phase 4: Extensibility & Multi-Agent (The "Ecosystem" Update)
*Goal: Expand capabilities through plugins, specialized agents, and self-improvement.*

- **Multi-Agent Architecture**: Supervisor routing to specialized agents (Coder, Researcher, Reviewer).
- **Plugin System**: SDK and dynamic loading of third-party plugins.
- **MCP Integration**: Full client and server implementation.
- **Skills (V2)**: Automatic skill extraction and learning from execution traces.
- **AI Self-Improvement**: Anti-pattern generation and prompt evolution.
- **Networking**: Webhooks and external API access.

## 24.3 Long-Term Vision (Phase 5+)

Beyond the core architecture specified in this RFC, the long-term vision includes:

1. **Local-First Capabilities**: Seamless offloading of tasks to fine-tuned local models (Llama 3, Mistral) running on consumer hardware to drastically reduce API costs.
2. **Cross-Device Synchronization**: End-to-end encrypted synchronization of the Knowledge Graph and Skills directory between an operator's desktop, laptop, and mobile devices.
3. **Federated Agent Networks**: Enabling FuckClaw instances belonging to different team members to securely communicate, share knowledge, and collaborate on shared codebases.
4. **Voice & Ambient Presence**: Deeper integration with OS-level audio (always-listening mode with wake words) to allow the agent to monitor meetings and summarize them autonomously.

## 24.4 Architectural Evolution Principles

As FuckClaw evolves through these phases, the following principles dictate architectural changes:

1. **Backwards Compatibility**: The `fuckclaw.db` schema must always migrate forward non-destructively.
2. **Modular Upgrades**: A change to the Reasoning Engine should not require changes to the Persistence Layer. The Event Bus and typed interfaces guarantee this.
3. **Operator Control**: New autonomous features (like self-improvement or proactive scheduling) must always ship with clear configuration flags to disable them if the operator prefers a more deterministic system.