# FuckClaw — Architecture Specification

## Document Metadata

| Field | Value |
|---|---|
| **Project** | FuckClaw |
| **Document Type** | Architecture Specification (RFC-grade) |
| **Status** | Draft v0.1 |
| **Classification** | Internal — Engineering |
| **Audience** | Senior Software Engineers, System Architects |

## Document Index

This specification is split across multiple files for navigability. Each file is self-contained but cross-references related sections.

| # | Section | File | Description |
|---|---------|------|-------------|
| 1 | Vision | [01-vision.md](./01-vision.md) | What FuckClaw actually is |
| 2 | System Philosophy | [02-philosophy.md](./02-philosophy.md) | Design principles, tradeoffs, goals, non-goals |
| 3 | High-Level Architecture | [03-high-level-architecture.md](./03-high-level-architecture.md) | Component diagrams, runtime diagrams, data flow |
| 4 | Agent Kernel | [04-agent-kernel.md](./04-agent-kernel.md) | Central runtime, lifecycle, state machine, execution loop |
| 5 | Planner | [05-planner.md](./05-planner.md) | Hierarchical planning, goal graphs, replanning |
| 6 | Memory System | [06-memory-system.md](./06-memory-system.md) | Working/long-term/semantic/episodic/procedural memory |
| 7 | Workspace | [07-workspace.md](./07-workspace.md) | Filesystem layout, projects, artifacts |
| 8 | Knowledge Graph | [08-knowledge-graph.md](./08-knowledge-graph.md) | Entity model, relationships, graph queries |
| 9 | Tool Runtime | [09-tool-runtime.md](./09-tool-runtime.md) | Tool abstraction, registry, execution |
| 10 | Skills | [10-skills.md](./10-skills.md) | Skill composition, learning, marketplace |
| 11 | Reasoning Engine | [11-reasoning-engine.md](./11-reasoning-engine.md) | ReAct, tree search, reflection, verification |
| 12 | LLM Router | [12-llm-router.md](./12-llm-router.md) | Cloud-first routing, model selection, cost optimization |
| 13 | Scheduler | [13-scheduler.md](./13-scheduler.md) | Time events, webhooks, reactive execution |
| 14 | Event Bus | [14-event-bus.md](./14-event-bus.md) | Pub/sub, internal/external events, persistence |
| 15 | Multi-Agent Architecture | [15-multi-agent.md](./15-multi-agent.md) | Supervisor, delegation, shared context |
| 16 | Plugin System | [16-plugin-system.md](./16-plugin-system.md) | SDK, lifecycle, hooks, marketplace |
| 17 | MCP Integration | [17-mcp-integration.md](./17-mcp-integration.md) | Client, server, discovery, tool exposure |
| 18 | Observability | [18-observability.md](./18-observability.md) | Logging, tracing, metrics, replay |
| 19 | Configuration | [19-configuration.md](./19-configuration.md) | Workspace config, profiles, runtime configs |
| 20 | Persistence Layer | [20-persistence.md](./20-persistence.md) | SQLite, Postgres, vector DB, knowledge graph storage |
| 21 | Networking | [21-networking.md](./21-networking.md) | Gateway, API, WebSocket, streaming |
| 22 | Frontend Architecture | [22-frontend.md](./22-frontend.md) | Desktop, web, mobile, CLI, TUI, voice |
| 23 | AI Self-Improvement | [23-self-improvement.md](./23-self-improvement.md) | Skill extraction, prompt evolution, failure learning |
| 24 | Future Roadmap | [24-roadmap.md](./24-roadmap.md) | Phased delivery plan |

## How to Read This Document

Start with sections 1-3 for the conceptual foundation. Section 4 (Agent Kernel) is the most critical — every other subsystem connects through it. Read section 14 (Event Bus) early, as it is the nervous system connecting all components.

Cross-references use the format `§N` (e.g., `§4` refers to Agent Kernel). Internal subsection references use `§N.M` notation.
