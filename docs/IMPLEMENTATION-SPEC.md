# FuckClaw Implementation Specification

## Document Metadata

| Field | Value |
|---|---|
| **Document Title** | FuckClaw Implementation Specification |
| **Document Type** | Engineering Contract & Implementation Specification |
| **Status** | Approved Canonical Engineering Guide |
| **Classification** | Internal — Engineering |
| **Audience** | Software Engineers, Runtime Implementers, Core Contributors |
| **Scope** | Complete system-wide translation from RFC Architecture to Production Code |

---

## Table of Contents

1. [Architectural Traceability & Foundation](#1-architectural-traceability--foundation)
2. [Dependency Analysis & Subsystem Topography](#2-dependency-analysis--subsystem-topography)
3. [Monorepo & Workspace Design](#3-monorepo--workspace-design)
4. [Subsystem Implementation Blueprints (All 24 Subsystems)](#4-subsystem-implementation-blueprints)
   - [4.1 Configuration Subsystem (§19)](#41-configuration-subsystem-19)
   - [4.2 Observability Subsystem (§18)](#42-observability-subsystem-18)
   - [4.3 Persistence Layer (§20)](#43-persistence-layer-20)
   - [4.4 Event Bus Subsystem (§14)](#44-event-bus-subsystem-14)
   - [4.5 Workspace Subsystem (§7)](#45-workspace-subsystem-7)
   - [4.6 Tool Runtime Subsystem (§9)](#46-tool-runtime-subsystem-9)
   - [4.7 LLM Router Subsystem (§12)](#47-llm-router-subsystem-12)
   - [4.8 Agent Kernel Subsystem (§4)](#48-agent-kernel-subsystem-4)
   - [4.9 Reasoning Engine Subsystem (§11)](#49-reasoning-engine-subsystem-11)
   - [4.10 Memory System Subsystem (§6)](#410-memory-system-subsystem-6)
   - [4.11 Planner Subsystem (§5)](#411-planner-subsystem-5)
   - [4.12 Scheduler Subsystem (§13)](#412-scheduler-subsystem-13)
   - [4.13 Knowledge Graph Subsystem (§8)](#413-knowledge-graph-subsystem-8)
   - [4.14 Skills Engine Subsystem (§10)](#414-skills-engine-subsystem-10)
   - [4.15 MCP Integration Subsystem (§17)](#415-mcp-integration-subsystem-17)
   - [4.16 Plugin System Subsystem (§16)](#416-plugin-system-subsystem-16)
   - [4.17 Networking & Gateway Subsystem (§21)](#417-networking--gateway-subsystem-21)
   - [4.18 Frontend & CLI Architecture (§22)](#418-frontend--cli-architecture-22)
   - [4.19 Multi-Agent Architecture (§15)](#419-multi-agent-architecture-15)
   - [4.20 AI Self-Improvement Subsystem (§23)](#420-ai-self-improvement-subsystem-23)
5. [Engineering Build Order & Milestones](#5-engineering-build-order--milestones)
6. [Project-Wide Coding Standards & Design Patterns](#6-project-wide-coding-standards--design-patterns)
7. [Comprehensive Testing Philosophy](#7-comprehensive-testing-philosophy)
8. [Risk Register & Mitigation Strategies](#8-risk-register--mitigation-strategies)
9. [Engineering Playbook for Future Implementation Tasks](#9-engineering-playbook-for-future-implementation-tasks)

---

## 1. Architectural Traceability & Foundation

This specification is the authoritative engineering contract that bridges the FuckClaw RFC Architecture documents (`§1` through `§24`) with the production implementation. Every module, interface, and design pattern defined herein maps directly to an architectural requirement.

### Source of Truth Hierarchy
1. **FuckClaw Architecture RFCs (`docs/architecture/*.md`)**: The conceptual, strategic, and functional source of truth.
2. **This Implementation Specification (`docs/IMPLEMENTATION-SPEC.md`)**: The structural, type, and implementation source of truth.
3. **Source Code (`packages/*/src`)**: The executable embodiment of this specification.

If an implementation detail was unstated in the RFCs, it has been resolved here using architectural principles (§2) and explicitly noted as an **[Implementation Decision]**.

---

## 2. Dependency Analysis & Subsystem Topography

### 2.1 Subsystem Classification Matrix

| Subsystem | Level | Hard Dependencies | Soft Dependencies | Boot Requirement |
|---|---|---|---|---|
| **Configuration (§19)** | 1 (Infra) | Node.js FS, OS env | None | Yes (Step 1) |
| **Observability (§18)** | 1 (Infra) | Configuration | Persistence (Log flush) | Yes (Step 2) |
| **Persistence Layer (§20)** | 1 (Infra) | Configuration, Observability | None | Yes (Step 3) |
| **Event Bus (§14)** | 1 (Infra) | Configuration, Observability | Persistence (Audit/Replay) | Yes (Step 4) |
| **Workspace (§7)** | 2 (Spine) | Configuration, Observability | None | Yes (Step 5) |
| **Tool Runtime (§9)** | 2 (Spine) | Observability, Event Bus, Workspace | None | Yes (Step 6) |
| **LLM Router (§12)** | 2 (Spine) | Configuration, Observability, Event Bus | Persistence (Cache) | Yes (Step 7) |
| **Agent Kernel (§4)** | 2 (Spine) | Config, Obs, Event Bus, Persistence | All Execution Modules | Yes (Step 8) |
| **Reasoning Engine (§11)** | 3 (Loop) | Kernel, LLM Router, Tool Runtime | Memory, Knowledge Graph | No (Lazy per task) |
| **Memory System (§6)** | 4 (Context) | Persistence, Observability, Event Bus | LLM Router (Embeddings/Consolidation) | No (Initialized on boot) |
| **Planner (§5)** | 5 (Action) | Kernel, Reasoning Engine, LLM Router | Memory System | No (Lazy per task) |
| **Scheduler (§13)** | 5 (Action) | Kernel, Event Bus, Persistence | Observability | No (Started post-boot) |
| **Knowledge Graph (§8)** | 6 (Struct) | Persistence, Observability, Event Bus | LLM Router | No (Lazy/Background) |
| **Skills Engine (§10)** | 6 (Struct) | Tool Runtime, Workspace, Persistence | LLM Router | No (Lazy per task) |
| **MCP Integration (§17)** | 7 (Eco) | Tool Runtime, Event Bus, Configuration | None | No (Post-boot client) |
| **Plugin System (§16)** | 7 (Eco) | Event Bus, Tool Runtime, Skills | All subsystems | No (Post-boot loader) |
| **Networking (§21)** | 7 (Eco) | Kernel, Event Bus, Configuration | Observability | No (Server start) |
| **Frontend/CLI (§22)** | 7 (Eco) | Kernel, Networking, Observability | None | No (Client layer) |
| **Multi-Agent (§15)** | 8 (Adv) | Kernel, Reasoning, Memory, Bus | All subsystems | No (Deferred) |
| **Self-Improvement (§23)**| 8 (Adv) | Skills, Memory, Planner, Kernel | All subsystems | No (Deferred) |

### 2.2 Critical Dependency Cycles & Resolution

1. **Cycle: Kernel (§4) $\leftrightarrow$ Event Bus (§14)**
   - *Problem*: The Kernel orchestrates all modules and emits state changes to the Event Bus. The Event Bus routes events that trigger Kernel tasks.
   - *Resolution*: The Event Bus is instantiated as a pure dependency-injected transport *before* the Kernel. The Kernel receives the `IEventBus` instance in its constructor and registers its internal dispatchers.

2. **Cycle: Memory Consolidation (§6) $\leftrightarrow$ LLM Router (§12) / Reasoning (§11)**
   - *Problem*: Memory retrieval provides context for LLM Reasoning. In turn, Memory Consolidation requires the LLM Router to extract semantic triples and summarize episodes.
   - *Resolution*: Memory retrieval uses deterministic vector/FTS queries (direct persistence access). Consolidation is decoupled into a background daemon that invokes the LLM Router via the Event Bus asynchronously.

3. **Cycle: Tool Runtime (§9) $\leftrightarrow$ Skills Engine (§10)**
   - *Problem*: Skills are composed of atomic tools. Skills themselves can be registered as composite tools in the Tool Registry.
   - *Resolution*: Staged registration. The Tool Runtime boots with native atomic tools. The Skill Engine loads manifests and registers composite wrappers via `IToolRegistry.register()` during Phase 6.

---

## 3. Monorepo & Workspace Design

### 3.1 Workspace Topology

FuckClaw is structured as a TypeScript monorepo using **pnpm workspaces** and **tsup** compilation:

```text
fuckclaw/
├── packages/
│   ├── core/                  # Canonical interfaces, domain models, error hierarchy
│   ├── config/                # Layered configuration manager & Zod validators
│   ├── observability/         # Structured logger, trace spans, metrics registry
│   ├── persistence/           # SQLite (better-sqlite3), sqlite-vec, migration runner
│   ├── event-bus/             # In-process typed pub/sub with WAL persistence
│   ├── workspace/             # Filesystem root (~/.fuckclaw), project & artifact registry
│   ├── tool-runtime/          # Unified tool pipeline, native executors, error classifier
│   ├── llm-router/            # Multi-provider routing, budget enforcement, caching
│   ├── kernel/                # State machine, priority task queue, execution engine
│   ├── reasoning/             # ReAct loop, beam search, reflection engine
│   ├── memory/                # Multi-tier memory (working, episodic, semantic, decay)
│   ├── planner/               # Goal decomposition DAG, dynamic replanning
│   ├── scheduler/             # Cron engine, FS watcher triggers, webhook ingress
│   ├── knowledge-graph/       # SQLite adjacency list, recursive CTE traversals
│   ├── skills/                # YAML skill parser, skill execution, learning pipeline
│   ├── mcp/                   # MCP Client & Server implementations (@modelcontextprotocol/sdk)
│   ├── plugins/               # Plugin SDK, runtime loader, lifecycle manager
│   ├── network/               # Hono REST API, WebSocket server, streaming gateway
│   └── cli/                   # Commander CLI, Ink TUI components
├── docs/                      # Architectural RFCs and specs
├── pnpm-workspace.yaml        # Monorepo package declaration
├── package.json               # Root scripts and dev dependencies
├── tsconfig.base.json         # Base TypeScript compiler options
└── vitest.workspace.ts        # Vitest workspace definition
```

### 3.2 Strict Dependency Direction & Import Rules

To prevent spaghetti architecture and circular compilation locks, imports must strictly follow this directed acyclic graph:

```text
CLI / Web / Network
        │
        ▼
     Kernel
   ┌────┴───────────────────────────────┐
   ▼                                    ▼
Reasoning / Planner / Multi-Agent    Scheduler / Plugins / MCP
   │                                    │
   ├─────────────────┬──────────────────┘
   ▼                 ▼
Memory / KG       Tools / Skills
   │                 │
   ├─────────────────┴──────────────────┐
   ▼                                    ▼
LLM Router                          Workspace
   │                                    │
   ├────────────────────────────────────┘
   ▼
Event Bus
   │
   ▼
Persistence
   │
   ▼
Observability
   │
   ▼
Config
   │
   ▼
  Core (Zero internal dependencies)
```

**Enforced Rules:**
- `packages/core` **must never** import from any other `@fuckclaw/*` package.
- Packages at level $N$ may only import packages from levels $< N$.
- Modules must communicate across functional boundaries using **Interfaces** defined in `@fuckclaw/core` or through events on `@fuckclaw/event-bus`. Direct cross-package concrete class instantiation is forbidden.

---

## 4. Subsystem Implementation Blueprints

---

### 4.1 Configuration Subsystem (§19)

#### Purpose
Provide strongly-typed, layered configuration evaluation with runtime overrides, environment variable mapping, project-level `.toml` overlays, and encrypted secret resolution.

#### Package Layout
```text
packages/config/
├── src/
│   ├── schemas/               # Zod validation schemas
│   │   ├── system.schema.ts
│   │   ├── providers.schema.ts
│   │   ├── budget.schema.ts
│   │   └── index.ts
│   ├── loaders/               # Layer loaders
│   │   ├── env.loader.ts
│   │   ├── file.loader.ts
│   │   └── profile.loader.ts
│   ├── secrets/               # Keystore encryption
│   │   └── keystore.ts
│   ├── config-manager.ts      # Main implementation
│   └── index.ts
```

#### Core Interfaces
```typescript
export interface IConfigManager {
  get(): GlobalConfig;
  get<T>(path: string, defaultValue?: T): T;
  update(path: string, value: unknown): Promise<void>;
  setProfile(profileName: string): Promise<void>;
  on<T>(path: string, handler: (newValue: T) => void): () => void;
  reload(): Promise<void>;
}
```

#### Lifecycle & Concurrency
- **Initialization**: Synchronously reads default config and `~/.fuckclaw/config/fuckclaw.toml` during boot phase 1.
- **Reload**: Triggered via `reload()` or SIGHUP; re-reads files, computes deep diff, and emits change events.
- **Thread Safety**: Single-threaded read cache in memory; writes use atomic file replacement (`write-temp -> rename`).

#### Testing Strategy
- Unit tests validating Zod schemas against valid/invalid TOML strings.
- Precedence tests verifying `Runtime > Env > Project > Profile > Global > Defaults`.

---

### 4.2 Observability Subsystem (§18)

#### Purpose
Provide structured JSON logging, distributed tracing spans with causal parent-child tracking, real-time metric counters/gauges, and immutable audit logs.

#### Package Layout
```text
packages/observability/
├── src/
│   ├── logging/
│   │   ├── logger.ts
│   │   └── formatters.ts
│   ├── tracing/
│   │   ├── tracer.ts
│   │   ├── span.ts
│   │   └── context.ts
│   ├── metrics/
│   │   ├── registry.ts
│   │   └── collectors.ts
│   ├── audit/
│   │   └── audit-logger.ts
│   ├── timeline/
│   │   └── reasoning-timeline.ts
│   └── index.ts
```

#### Core Interfaces
```typescript
export interface IObservability {
  log(entry: LogEntry): void;
  startSpan(name: string, attributes?: Record<string, unknown>, parentSpanId?: string): SpanHandle;
  endSpan(handle: SpanHandle, status?: 'ok' | 'error', error?: Error): void;
  getTrace(traceId: string): Promise<Trace | null>;
  recordMetric(name: string, value: number, tags?: Record<string, string>): void;
  getMetrics(): SystemMetrics;
  audit(entry: Omit<AuditEntry, 'id' | 'timestamp'>): void;
  getTimeline(taskId: string): Promise<ReasoningTimeline | null>;
}
```

#### Implementation Details
- **Tracing**: Uses AsyncLocalStorage (`node:async_hooks`) to implicitly propagate `traceId` and `spanId` through asynchronous execution chains.
- **Audit Logging**: Emits audit records directly to SQLite in WAL mode; buffered writes every 100ms.

---

### 4.3 Persistence Layer (§20)

#### Purpose
Unified relational and vector storage engine using SQLite (`better-sqlite3`), `sqlite-vec` for dense vector indexing, and FTS5 for full-text search.

#### Package Layout
```text
packages/persistence/
├── src/
│   ├── connection/
│   │   ├── connection-pool.ts
│   │   └── pragmas.ts
│   ├── migrations/
│   │   ├── migration-runner.ts
│   │   └── scripts/           # SQL migration files
│   ├── drivers/
│   │   ├── sqlite.driver.ts
│   │   └── postgres.driver.ts # Deferred optional driver
│   ├── repositories/          # Domain data mappers
│   │   ├── task.repo.ts
│   │   ├── event.repo.ts
│   │   ├── memory.repo.ts
│   │   └── graph.repo.ts
│   ├── backup/
│   │   └── snapshot-manager.ts
│   └── index.ts
```

#### Core Interfaces
```typescript
export interface IPersistenceLayer {
  readonly main: IPersistenceDriver;
  readonly vectors: IPersistenceDriver;
  migrate(): Promise<void>;
  backup(destinationPath: string): Promise<void>;
  integrityCheck(): Promise<{ ok: boolean; errors: string[] }>;
  close(): Promise<void>;
}

export interface IPersistenceDriver {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  queryOne<T>(sql: string, params?: unknown[]): Promise<T | null>;
  execute(sql: string, params?: unknown[]): Promise<{ rowsAffected: number; lastInsertRowId?: number | bigint }>;
  transaction<T>(fn: (trx: IPersistenceDriver) => Promise<T>): Promise<T>;
  vectorSearch(table: string, embedding: Float32Array, limit: number): Promise<VectorSearchResult[]>;
}
```

#### Concurrency & Optimization
- Single dedicated writer connection (`better-sqlite3` instance) to serialize writes without table locks.
- Pool of $N$ read-only connections ($N = \text{CPU cores}$).
- PRAGMAs: `journal_mode = WAL`, `synchronous = NORMAL`, `foreign_keys = ON`, `cache_size = -64000` (64MB).

---

### 4.4 Event Bus Subsystem (§14)

#### Purpose
In-process asynchronous and blocking event bus providing complete decoupling between subsystems, persistent event journaling, and dead-letter queues.

#### Package Layout
```text
packages/event-bus/
├── src/
│   ├── dispatcher/
│   │   ├── event-dispatcher.ts
│   │   └── priority-queue.ts
│   ├── persistence/
│   │   └── event-journal.ts
│   ├── dead-letter/
│   │   └── dlq-manager.ts
│   ├── matchers/
│   │   └── pattern-matcher.ts
│   ├── event-bus.ts
│   └── index.ts
```

#### Core Interfaces
```typescript
export interface IEventBus {
  emit(event: Omit<SystemEvent, 'id' | 'timestamp'>): Promise<string>;
  emitSync(event: Omit<SystemEvent, 'id' | 'timestamp'>): Promise<string>;
  subscribe(subscription: EventSubscription): () => void;
  on(pattern: string, handler: (event: SystemEvent) => Promise<void> | void): () => void;
  once(pattern: string, handler: (event: SystemEvent) => Promise<void> | void): () => void;
  query(filter: EventQuery): Promise<SystemEvent[]>;
  replay(fromEventId: string, toEventId?: string): AsyncIterable<SystemEvent>;
}
```

#### Implementation Rules
- Event IDs must be sortable **ULIDs** (`ulidx`).
- Wildcard subscription matching (`tool.*`, `*.completed`) implemented using trie-based prefix tree for $O(K)$ matching where $K$ is the number of path segments.
- Blocking subscriptions execute sequentially by priority; non-blocking subscriptions are pushed to a microtask queue.

---

### 4.5 Workspace Subsystem (§7)

#### Purpose
Manage physical filesystem directory structure at `~/.fuckclaw/`, maintain project metadata registries, isolate task execution workspaces, and manage ZSTD snapshots.

#### Package Layout
```text
packages/workspace/
├── src/
│   ├── layout/
│   │   └── directory-manager.ts
│   ├── projects/
│   │   └── project-registry.ts
│   ├── artifacts/
│   │   └── artifact-store.ts
│   ├── snapshots/
│   │   └── zstd-archiver.ts
│   ├── workspace-manager.ts
│   └── index.ts
```

#### Directory Layout Enforced
```text
~/.fuckclaw/
├── config/        # fuckclaw.toml, profiles/, env.json.enc
├── data/          # fuckclaw.db, vectors.db, events.db
├── workspace/     # projects/, knowledge/, artifacts/
├── logs/          # rotating daily logs
├── cache/         # response cache, embeddings cache
├── plugins/       # installed third-party plugins
├── skills/        # user and learned skill manifests
└── snapshots/     # compressed database and workspace state
```

---

### 4.6 Tool Runtime Subsystem (§9)

#### Purpose
Provide a standardized, sandboxed execution pipeline for tools, including JSON Schema validation, process management, streaming stdout/stderr, retries with exponential backoff, and error categorization.

#### Package Layout
```text
packages/tool-runtime/
├── src/
│   ├── registry/
│   │   └── tool-registry.ts
│   ├── pipeline/
│   │   ├── execution-pipeline.ts
│   │   ├── validator.ts
│   │   └── lock-manager.ts
│   ├── native/
│   │   ├── shell.tool.ts
│   │   ├── filesystem.tool.ts
│   │   ├── git.tool.ts
│   │   ├── python.tool.ts
│   │   ├── http.tool.ts
│   │   └── docker.tool.ts
│   ├── errors/
│   │   └── error-classifier.ts
│   ├── tool-runtime.ts
│   └── index.ts
```

#### Execution Pipeline Order
1. JSON Schema validation (`ajv`).
2. Concurrency lock acquisition (serialized vs exclusive tools).
3. Context setup (working directory, environment variables, AbortSignal).
4. `tool.execution.started` event emission.
5. Invocation with timeout watchdog (`Promise.race` with child process signal termination).
6. Result normalization to standard `ToolResult` interface.
7. Error classification (transient vs fatal).
8. Exponential retry loop if error is marked `retryable`.
9. `tool.execution.completed` event emission.

---

### 4.7 LLM Router Subsystem (§12)

#### Purpose
Cloud-first model gateway managing multi-provider connections (Anthropic, OpenAI, Google, Local), complexity-based tier routing, response caching, token usage tracking, and automatic fallback chains.

#### Package Layout
```text
packages/llm-router/
├── src/
│   ├── router/
│   │   ├── route-selector.ts
│   │   └── tier-classifier.ts
│   ├── providers/
│   │   ├── provider-factory.ts
│   │   ├── anthropic.provider.ts
│   │   ├── openai.provider.ts
│   │   └── google.provider.ts
│   ├── cache/
│   │   └── response-cache.ts
│   ├── budget/
│   │   ├── cost-calculator.ts
│   │   └── budget-tracker.ts
│   ├── fallbacks/
│   │   └── fallback-chain.ts
│   ├── llm-router.ts
│   └── index.ts
```

#### Core Interfaces
```typescript
export interface ILLMRouter {
  generate(request: GenerationRequest): Promise<GenerationResponse>;
  generateStreaming(request: GenerationRequest): AsyncGenerator<StreamChunk>;
  listModels(filter?: { tier?: ModelTier }): ModelConfig[];
  getCosts(from: number, to: number): CostSummary;
  countTokens(messages: Message[]): number;
}
```

#### Routing Logic Matrix
- **Trivial / Simple**: Routes to `fast` tier (`claude-3-5-haiku`, `gpt-4o-mini`).
- **Moderate / Complex**: Routes to `standard` tier (`claude-3-5-sonnet`, `gpt-4o`).
- **Frontier**: Routes to `frontier` tier (`claude-3-opus`, `o1`).
- **Failover Chain**: `Standard -> Frontier -> Fast -> Local`.

---

### 4.8 Agent Kernel Subsystem (§4)

#### Purpose
The microkernel core. Owns the global state machine (`BOOTING`, `IDLE`, `PROCESSING`, `CONSOLIDATING`, `DRAINING`, `SHUTTING_DOWN`), priority task queue with aging, resource conflict locks, and context window assembly.

#### Package Layout
```text
packages/kernel/
├── src/
│   ├── state-machine/
│   │   ├── kernel-state-machine.ts
│   │   └── task-state-machine.ts
│   ├── queue/
│   │   ├── priority-task-queue.ts
│   │   └── aging-calculator.ts
│   ├── orchestrator/
│   │   ├── task-orchestrator.ts
│   │   └── resource-lock.ts
│   ├── context/
│   │   ├── context-manager.ts
│   │   └── token-budget-trimmer.ts
│   ├── recovery/
│   │   └── checkpoint-manager.ts
│   ├── agent-kernel.ts
│   └── index.ts
```

#### Core Interfaces
```typescript
export interface IAgentKernel {
  boot(): Promise<void>;
  shutdown(deadlineMs?: number): Promise<void>;
  getState(): KernelState;
  submitTask(request: TaskRequest): Promise<Task>;
  cancelTask(taskId: string, reason: string): Promise<void>;
  pauseTask(taskId: string): Promise<void>;
  resumeTask(taskId: string): Promise<void>;
  getTask(taskId: string): Task | null;
  listTasks(filter: TaskFilter): Task[];
  buildContext(task: Task): Promise<ContextBundle>;
}
```

#### Checkpointing & State Recovery
- Checkpoint written every 60s during execution and on every task state change.
- Checkpoint payload contains: `kernelState`, `tasks[]`, `workingMemorySnapshot`, `eventCursor`.
- On boot, `CheckpointManager` validates SHA-256 integrity and resumes `EXECUTING` tasks from their last completed step.

---

### 4.9 Reasoning Engine Subsystem (§11)

#### Purpose
Execute the cognitive loop. Implements ReAct (Observe-Think-Act), beam-search decision tree exploration, post-step self-reflection, and tool-call parameter formatting.

#### Package Layout
```text
packages/reasoning/
├── src/
│   ├── react/
│   │   └── react-loop.ts
│   ├── tree-search/
│   │   ├── beam-search.ts
│   │   └── state-evaluator.ts
│   ├── reflection/
│   │   └── self-reflector.ts
│   ├── parsers/
│   │   └── tool-call-parser.ts
│   ├── reasoning-engine.ts
│   └── index.ts
```

#### Execution Semantics
- **ReAct Loop**: Runs iteratively up to `maxSteps` (default: 30).
- **Step Cycle**: `Build Prompt -> LLM Call -> Parse Tool Calls -> Invoke Tools -> Collect Observations -> Reflect -> Check Termination`.
- **Preemption**: Between every ReAct step, the loop checks the task's `AbortSignal` for priority interruption.

---

### 4.10 Memory System Subsystem (§6)

#### Purpose
Provide five-tier cognitive memory: Working Memory (in-RAM session state), Episodic Memory (chronological task logs with embeddings), Semantic Memory (triples/assertions), Procedural Memory (anti-patterns & tool patterns), and Archival Storage, governed by Ebbinghaus mathematical decay.

#### Package Layout
```text
packages/memory/
├── src/
│   ├── working/
│   │   └── working-memory.ts
│   ├── episodic/
│   │   ├── episodic-store.ts
│   │   └── trace-compressor.ts
│   ├── semantic/
│   │   └── semantic-store.ts
│   ├── procedural/
│   │   └── procedural-store.ts
│   ├── decay/
│   │   └── ebbinghaus-decay.ts
│   ├── consolidation/
│   │   ├── consolidation-daemon.ts
│   │   └── dreaming-engine.ts
│   ├── retrieval/
│   │   └── hybrid-retriever.ts
│   ├── memory-system.ts
│   └── index.ts
```

#### Mathematical Decay Formula
The retrievability $R$ of an episodic memory decays as:
$$R(t) = e^{-\frac{t}{S \cdot (1 + \text{accessCount})}}$$
where $t$ is the elapsed time in days and $S$ is the initial stability factor ($S=7.0$).

---

### 4.11 Planner Subsystem (§5)

#### Purpose
Hierarchical goal decomposition into Directed Acyclic Graphs (DAGs) of executable subtasks, dynamic replanning upon execution failures, and post-execution reflection.

#### Package Layout
```text
packages/planner/
├── src/
│   ├── decomposition/
│   │   ├── goal-decomposer.ts
│   │   └── dag-builder.ts
│   ├── execution/
│   │   └── plan-executor.ts
│   ├── replanning/
│   │   └── dynamic-replanner.ts
│   ├── planner.ts
│   └── index.ts
```

---

### 4.12 Scheduler Subsystem (§13)

#### Purpose
Autonomous execution triggers: Cron schedules, filesystem debounced file watching, and incoming webhook triggers.

#### Package Layout
```text
packages/scheduler/
├── src/
│   ├── cron/
│   │   └── cron-runner.ts
│   ├── watchers/
│   │   └── fs-watcher.ts
│   ├── webhooks/
│   │   └── webhook-handler.ts
│   ├── scheduler.ts
│   └── index.ts
```

---

### 4.13 Knowledge Graph Subsystem (§8)

#### Purpose
Entity-relationship modeling stored in SQLite using an adjacency-list schema with recursive Common Table Expressions (CTEs) for depth-first and breadth-first relationship queries.

#### Package Layout
```text
packages/knowledge-graph/
├── src/
│   ├── entities/
│   │   └── entity-manager.ts
│   ├── relationships/
│   │   └── relationship-manager.ts
│   ├── queries/
│   │   └── graph-traversal.ts
│   ├── knowledge-graph.ts
│   └── index.ts
```

---

### 4.14 Skills Engine Subsystem (§10)

#### Purpose
Parse YAML skill manifests, compose multi-step tool routines, and execute learned procedural workflows.

#### Package Layout
```text
packages/skills/
├── src/
│   ├── parser/
│   │   └── manifest-parser.ts
│   ├── registry/
│   │   └── skill-registry.ts
│   ├── executor/
│   │   └── skill-executor.ts
│   ├── skills-engine.ts
│   └── index.ts
```

---

### 4.15 MCP Integration Subsystem (§17)

#### Purpose
Model Context Protocol client (consuming external MCP tools) and server (exposing FuckClaw capabilities to other agents via stdio/SSE).

#### Package Layout
```text
packages/mcp/
├── src/
│   ├── client/
│   │   ├── mcp-client-manager.ts
│   │   └── tool-adapter.ts
│   ├── server/
│   │   ├── mcp-server.ts
│   │   └── resource-exposer.ts
│   ├── mcp-manager.ts
│   └── index.ts
```

---

### 4.16 Plugin System Subsystem (§16)

#### Purpose
Plugin discovery, dynamic manifest loading, sandbox isolation, and capability registration via `@fuckclaw/plugin-sdk`.

#### Package Layout
```text
packages/plugins/
├── src/
│   ├── loader/
│   │   └── plugin-loader.ts
│   ├── context/
│   │   └── plugin-context-factory.ts
│   ├── registry/
│   │   └── plugin-registry.ts
│   ├── plugin-manager.ts
│   └── index.ts
```

---

### 4.17 Networking & Gateway Subsystem (§21)

#### Purpose
Expose Hono-based HTTP REST API, WebSocket server for bi-directional live streaming of reasoning/tool output, and auth middleware.

#### Package Layout
```text
packages/network/
├── src/
│   ├── http/
│   │   ├── server.ts
│   │   ├── routes/
│   │   └── middleware/
│   ├── ws/
│   │   ├── ws-server.ts
│   │   └── stream-handler.ts
│   ├── network-manager.ts
│   └── index.ts
```

---

### 4.18 Frontend & CLI Architecture (§22)

#### Purpose
Operator interfaces: Command-line interface (`commander`), interactive terminal UI (`ink`), and client SDK.

#### Package Layout
```text
packages/cli/
├── src/
│   ├── commands/
│   │   ├── ask.command.ts
│   │   ├── run.command.ts
│   │   ├── status.command.ts
│   │   └── config.command.ts
│   ├── tui/
│   │   ├── App.tsx
│   │   ├── components/
│   │   └── hooks/
│   ├── client/
│   │   └── fuckclaw-client.ts
│   ├── bin.ts
│   └── index.ts
```

---

### 4.19 Multi-Agent Architecture (§15) - [Deferred]

#### Purpose
Supervisor-Worker orchestration, task delegation protocols, and agent role pooling.

---

### 4.20 AI Self-Improvement Subsystem (§23) - [Deferred]

#### Purpose
Automated anti-pattern extraction, prompt mutation benchmarking, and autonomous skill synthesis.

---

## 5. Engineering Build Order & Milestones

The implementation is executed across 7 strictly sequential milestones to eliminate dependency traps:

```text
Milestone 1: Monorepo & Base Infrastructure (Config, Observability, Persistence, Event Bus)
      │
      ▼
Milestone 2: Execution Spine (Workspace, Tool Runtime, LLM Router)
      │
      ▼
Milestone 3: The Ethereal Agent (Kernel State Machine + ReAct Loop + Shell Tool) [First Slice]
      │
      ▼
Milestone 4: Persistent Memory (Working, Episodic, Semantic, Vector Search)
      │
      ▼
Milestone 5: Deliberate Action (Planner DAGs, Dynamic Replanning, Scheduler)
      │
      ▼
Milestone 6: Structural Knowledge & Skills (Knowledge Graph, Skill Manifests)
      │
      ▼
Milestone 7: Ecosystem & Interfaces (MCP, Plugins, Network Gateway, Ink CLI)
```

### Detailed Milestone Specifications

#### Milestone 1: Monorepo & Base Infrastructure
- **Objective**: Establish the compile pipeline, type foundation, database engine, config loader, logger, and event bus.
- **Deliverables**:
  - `packages/core`: Type definitions, error classes.
  - `packages/config`: TOML loader and Zod schema validator.
  - `packages/observability`: Structured logger and tracing handles.
  - `packages/persistence`: SQLite connection pool, migration manager, base schemas.
  - `packages/event-bus`: Typed EventBus with in-memory dispatch and SQLite journaling.
- **Definition of Done**: A script can load config, initialize SQLite, emit a typed event on the bus, persist the event to SQLite, log the action, and shut down cleanly.

#### Milestone 2: Execution Spine
- **Objective**: Implement physical file management, tool pipeline, and cloud LLM routing.
- **Deliverables**:
  - `packages/workspace`: `~/.fuckclaw` scaffolding and directory validation.
  - `packages/tool-runtime`: Execution pipeline, `shell` and `filesystem` native tools.
  - `packages/llm-router`: Multi-provider router with Anthropic Claude and OpenAI drivers.
- **Definition of Done**: Unit tests verify that calling `llmRouter.generate()` returns text from Anthropic, and `toolRuntime.execute('shell')` executes bash commands with streaming stdout.

#### Milestone 3: The Ethereal Agent (First Vertical Slice)
- **Objective**: Connect Kernel, Reasoning Engine, and Tool Runtime into a running ReAct loop.
- **Deliverables**:
  - `packages/kernel`: State machine, priority task queue.
  - `packages/reasoning`: ReAct loop parsing LLM tool calls and feeding tool outputs.
  - `packages/cli`: Minimal `fuckclaw run <prompt>` CLI.
- **Definition of Done**: The operator runs `fuckclaw run "Create a file named test.txt with content Hello"`, and the agent reasons, invokes the filesystem tool, verifies the output, and terminates successfully.

#### Milestone 4: Persistent Memory
- **Objective**: Equip the agent with episodic recall across sessions using embeddings.
- **Deliverables**:
  - `packages/persistence`: `sqlite-vec` integration.
  - `packages/memory`: Working Memory, Episodic Memory storage with embeddings, Ebbinghaus decay, and Context Manager retrieval ranking.
- **Definition of Done**: The agent can answer questions about actions taken in previous CLI runs.

#### Milestone 5: Deliberate Action
- **Objective**: Transition from single-loop ReAct to multi-step hierarchical goal DAGs and cron automation.
- **Deliverables**:
  - `packages/planner`: Goal decomposition and replanning logic.
  - `packages/scheduler`: Cron triggers and FS watchers.
- **Definition of Done**: A complex goal ("Refactor module X and run test suite") is decomposed into 4 dependent sub-tasks and executed systematically.

#### Milestone 6: Structural Knowledge & Skills
- **Objective**: Structured world modeling and reusable composite routines.
- **Deliverables**:
  - `packages/knowledge-graph`: Entity/relationship tables with recursive CTE traversal.
  - `packages/skills`: YAML skill manifest runner.
- **Definition of Done**: The agent executes a multi-step deployment skill defined in YAML and records extracted architectural entities in the knowledge graph.

#### Milestone 7: Ecosystem & Interfaces
- **Objective**: Full protocol compliance and rich operator experience.
- **Deliverables**:
  - `packages/mcp`: MCP Client/Server.
  - `packages/plugins`: Dynamic plugin loader.
  - `packages/network`: Hono API and WebSocket streaming.
  - `packages/cli`: Full Ink TUI dashboard.
- **Definition of Done**: External MCP clients can call FuckClaw tools; operator uses the interactive Ink TUI with real-time reasoning visualization.

---

## 6. Project-Wide Coding Standards & Design Patterns

### 6.1 TypeScript Rules
- **Strict Mode**: `strict: true`, `noImplicitAny: true`, `exactOptionalPropertyTypes: true` enforced in `tsconfig.base.json`.
- **No `any`**: Use `unknown` with type guards or Zod parsers.
- **Explicit Return Types**: All exported public functions and class methods must have explicit return types.
- **Immutability**: Prefer `readonly` modifiers on interface properties and arrays where state is not meant to mutate.

### 6.2 Error Handling Standard
- Every subsystem must extend `FuckClawError` from `@fuckclaw/core`.
- Error codes must follow the taxonomy: `FC_{SUBSYSTEM}_{ERROR_TYPE}` (e.g., `FC_TOOL_TIMEOUT`, `FC_LLM_RATE_LIMIT`, `FC_DB_LOCK_TIMEOUT`).
- Exceptions must **never** be silently swallowed. All catch blocks must either handle, rethrow, or log to the observability pipeline.

### 6.3 Asynchronous Patterns
- Exclusively use `async/await`. Raw Promise chains (`.then()/.catch()`) are forbidden.
- Long-running async operations must accept an `AbortSignal` for cooperative cancellation.
- Use `node:timers/promises` for timeouts rather than `setTimeout` callbacks.

### 6.4 Dependency Injection
- Subsystems must receive their dependencies via constructor parameters typed to interfaces (e.g., `constructor(private db: IPersistenceLayer, private bus: IEventBus)`).
- Global singletons and global mutable variables are strictly prohibited.

---

## 7. Comprehensive Testing Philosophy

### 7.1 Testing Pyramid
- **Unit Tests (Vitest)**: Fast, in-memory, testing isolated classes with mock interfaces. Must achieve $>85\%$ code coverage on core logic.
- **Integration Tests**: Test interactions between paired subsystems (e.g., Persistence + EventBus, ToolRuntime + ChildProcess).
- **End-to-End Tests**: Run full vertical slices through the Kernel using mock or recorded LLM responses.
- **Contract Tests**: Validate JSON Schemas for tools, MCP protocol compatibility, and configuration files.

### 7.2 Deterministic Mocking Standard
To avoid runaway API costs and flaky network tests, all LLM Router calls in CI test suites must use recorded fixture cassettes or deterministic mock providers.

---

## 8. Risk Register & Mitigation Strategies

| Risk | Severity | Probability | Mitigation |
|---|---|---|---|
| **`sqlite-vec` binary compilation failure across OS/architectures** | HIGH | HIGH | Fallback to brute-force in-memory cosine similarity if native C extension fails to load on host OS. |
| **Context window explosion during long ReAct loops** | HIGH | MEDIUM | Strict token budget trimming in Context Manager (§4.8); truncate tool outputs $>10\text{KB}$. |
| **Infinite replanning loops burning token budgets** | HIGH | LOW | Hard budget cap per task (`maxCost`, `maxLLMCalls`); abort task immediately upon threshold breach. |
| **SQLite single-writer database contention (`SQLITE_BUSY`)** | MEDIUM | MEDIUM | Serialized write connection pool + `PRAGMA busy_timeout = 5000;`. |
| **Orphaned child processes from killed tool runs** | MEDIUM | HIGH | Process group spawning (`setsid`) and aggressive process tree reaping on timeout or SIGTERM. |

---

## 9. Engineering Playbook for Future Implementation Tasks

When assigned a specific implementation task, engineers must adhere to the following protocol:

### Step 1: Context Ingestion
- Read the relevant RFC section in `docs/architecture/`.
- Review the specific subsystem blueprint in Section 4 of this document.
- Verify which milestone the task belongs to (Section 5).

### Step 2: Boundary Verification
- Check the dependency direction graph (Section 3.2). Ensure your package does not import forbidden higher-level modules.
- Ensure all public types are declared in `@fuckclaw/core` before writing concrete implementations.

### Step 3: Test-First Development
- Write unit test fixtures in `*.test.ts` asserting interface contracts before implementing logic.
- Execute tests via `pnpm test`.

### Step 4: Verification & Acceptance
- Verify that your code compiles cleanly (`pnpm build`).
- Verify that linting passes without warnings (`pnpm lint`).
- Ensure no agent logic is leaked into infrastructure packages.
