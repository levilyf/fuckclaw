# §3 — High-Level Architecture

## 3.1 System Architecture Overview

```mermaid
graph TB
    subgraph "User Interfaces"
        CLI["CLI / TUI"]
        WEB["Web Dashboard"]
        DESKTOP["Desktop App<br/>(Tauri)"]
        VOICE["Voice Interface"]
        API_EXT["External API"]
    end

    subgraph "Gateway Layer"
        GW["API Gateway<br/>(Hono)"]
        WS["WebSocket Server"]
        AUTH["Auth Middleware<br/>(API Key / Local)"]
    end

    subgraph "Agent Kernel (§4)"
        SM["State Machine"]
        EXEC["Execution Loop"]
        ORCH["Task Orchestrator"]
        CTX["Context Manager"]
    end

    subgraph "Cognitive Layer"
        REASON["Reasoning Engine (§11)"]
        PLAN["Planner (§5)"]
        SKILLS["Skill Engine (§10)"]
    end

    subgraph "Memory Layer"
        WM["Working Memory (§6)"]
        LTM["Long-Term Memory (§6)"]
        SEM["Semantic Memory (§6)"]
        EPIS["Episodic Memory (§6)"]
        PROC["Procedural Memory (§6)"]
        KG["Knowledge Graph (§8)"]
    end

    subgraph "Execution Layer"
        TOOLS["Tool Runtime (§9)"]
        AGENTS["Multi-Agent Pool (§15)"]
        MCP_C["MCP Client (§17)"]
        SCHED["Scheduler (§13)"]
    end

    subgraph "Infrastructure Layer"
        EB["Event Bus (§14)"]
        LLM["LLM Router (§12)"]
        PERSIST["Persistence Layer (§20)"]
        OBS["Observability (§18)"]
        PLUGINS["Plugin System (§16)"]
        CONFIG["Configuration (§19)"]
    end

    subgraph "External Services"
        PROVIDERS["LLM Providers<br/>(Anthropic, OpenAI, Google, etc.)"]
        MCP_S["MCP Servers"]
        WEBHOOKS["Webhooks"]
        GIT["Git Repositories"]
        DOCKER["Docker"]
        FS["Filesystem"]
    end

    CLI --> GW
    WEB --> GW
    DESKTOP --> GW
    VOICE --> GW
    API_EXT --> GW
    GW --> AUTH --> SM
    WS --> SM

    SM --> EXEC
    EXEC --> ORCH
    ORCH --> CTX

    CTX --> REASON
    CTX --> PLAN
    CTX --> SKILLS

    REASON --> LLM
    PLAN --> LLM
    
    CTX --> WM
    CTX --> LTM
    CTX --> SEM
    CTX --> EPIS
    CTX --> PROC
    CTX --> KG

    ORCH --> TOOLS
    ORCH --> AGENTS
    ORCH --> MCP_C
    ORCH --> SCHED

    LLM --> PROVIDERS
    TOOLS --> FS
    TOOLS --> GIT
    TOOLS --> DOCKER
    MCP_C --> MCP_S
    SCHED --> WEBHOOKS

    EB -.-> SM
    EB -.-> REASON
    EB -.-> PLAN
    EB -.-> TOOLS
    EB -.-> SCHED
    EB -.-> OBS
    EB -.-> PLUGINS

    PERSIST --- WM
    PERSIST --- LTM
    PERSIST --- KG
    PERSIST --- OBS
```

## 3.2 Runtime Architecture

FuckClaw runs as a **single long-lived Node.js process** with the following runtime structure:

```mermaid
graph LR
    subgraph "Process: fuckclaw"
        subgraph "Main Thread"
            BOOT["Bootstrap"]
            KERNEL["Agent Kernel"]
            EB["Event Bus"]
            LOOP["Cognitive Loop"]
            HTTP["HTTP/WS Server"]
        end
        
        subgraph "Worker Threads"
            W1["Embedding Worker"]
            W2["Index Worker"]
            W3["Search Worker"]
        end
        
        subgraph "Child Processes"
            CP1["Shell Executor"]
            CP2["Python Runtime"]
            CP3["Docker CLI"]
            CP4["Browser Controller"]
            CP5["MCP Server Subprocess"]
        end
    end
    
    BOOT --> KERNEL
    KERNEL --> EB
    KERNEL --> LOOP
    KERNEL --> HTTP
    KERNEL -.-> W1
    KERNEL -.-> W2
    KERNEL -.-> W3
    KERNEL -.-> CP1
    KERNEL -.-> CP2
    KERNEL -.-> CP3
    KERNEL -.-> CP4
    KERNEL -.-> CP5
```

### 3.2.1 Boot Sequence

```mermaid
sequenceDiagram
    participant OS as Operating System
    participant BOOT as Bootstrap
    participant CONFIG as Config Loader
    participant PERSIST as Persistence
    participant EB as Event Bus
    participant KERNEL as Agent Kernel
    participant PLUGINS as Plugin System
    participant SCHED as Scheduler
    participant MCP as MCP Manager
    participant LOOP as Cognitive Loop

    OS->>BOOT: Start process
    BOOT->>CONFIG: Load workspace config
    CONFIG-->>BOOT: Configuration tree
    BOOT->>PERSIST: Initialize databases
    PERSIST-->>BOOT: DB connections ready
    BOOT->>EB: Initialize event bus
    EB-->>BOOT: Bus ready
    BOOT->>KERNEL: Initialize kernel
    KERNEL->>KERNEL: Load state from last checkpoint
    KERNEL->>PLUGINS: Discover and load plugins
    PLUGINS-->>KERNEL: Plugin registry populated
    KERNEL->>MCP: Start MCP connections
    MCP-->>KERNEL: MCP tools registered
    KERNEL->>SCHED: Initialize scheduler
    SCHED->>SCHED: Load pending schedules from DB
    SCHED-->>KERNEL: Scheduler active
    KERNEL->>LOOP: Start cognitive loop
    LOOP->>EB: Emit(system.ready)
    
    Note over LOOP: Continuous operation begins
    
    loop Cognitive Tick
        LOOP->>EB: Check event queue
        LOOP->>KERNEL: Process next task
        KERNEL->>KERNEL: Observe → Remember → Reason → Act → Learn
    end
```

### 3.2.2 Shutdown Sequence

```mermaid
sequenceDiagram
    participant OS as Operating System
    participant KERNEL as Agent Kernel
    participant LOOP as Cognitive Loop
    participant TASKS as Active Tasks
    participant MEM as Memory System
    participant PERSIST as Persistence
    participant EB as Event Bus

    OS->>KERNEL: SIGTERM / SIGINT
    KERNEL->>LOOP: Stop accepting new tasks
    KERNEL->>TASKS: Graceful cancel (30s deadline)
    TASKS->>TASKS: Checkpoint in-progress work
    TASKS-->>KERNEL: All tasks checkpointed or completed
    KERNEL->>MEM: Flush working memory to persistence
    MEM->>PERSIST: Write checkpoint
    PERSIST-->>KERNEL: Checkpoint saved
    KERNEL->>EB: Emit(system.shutdown)
    KERNEL->>PERSIST: Close database connections
    KERNEL->>OS: Exit(0)
    
    Note over OS: On next boot, kernel resumes from checkpoint
```

## 3.3 Data Flow Architecture

### 3.3.1 User-Initiated Request Flow

```mermaid
sequenceDiagram
    participant USER as User
    participant GW as Gateway
    participant KERNEL as Agent Kernel
    participant CTX as Context Manager
    participant MEM as Memory System
    participant KG as Knowledge Graph
    participant REASON as Reasoning Engine
    participant LLM as LLM Router
    participant TOOLS as Tool Runtime
    participant OBS as Observability

    USER->>GW: "Deploy the auth service to staging"
    GW->>KERNEL: CreateTask(message, metadata)
    KERNEL->>OBS: TraceStart(task_id)
    
    KERNEL->>CTX: BuildContext(task)
    CTX->>MEM: Retrieve relevant memories
    MEM-->>CTX: [episodic: last deployment, semantic: staging config, procedural: deploy steps]
    CTX->>KG: Query related entities
    KG-->>CTX: [project: auth-service, env: staging, deps: [postgres, redis]]
    CTX-->>KERNEL: ContextBundle

    KERNEL->>REASON: Reason(task, context)
    REASON->>LLM: Generate(system_prompt + context + task)
    LLM-->>REASON: Plan: [1. check git status, 2. run tests, 3. build image, 4. deploy]
    
    loop Execute Plan Steps
        REASON->>TOOLS: Execute(tool_call)
        TOOLS-->>REASON: ToolResult
        REASON->>MEM: Store step result
        REASON->>OBS: TraceStep(step_id, result)
        REASON->>REASON: Reflect on result, adjust plan if needed
    end
    
    REASON-->>KERNEL: TaskResult
    KERNEL->>MEM: Persist episodic memory (full task trace)
    KERNEL->>KG: Update entities (deployment timestamp, status)
    KERNEL->>OBS: TraceEnd(task_id)
    KERNEL->>GW: Response to user
    GW->>USER: "Auth service deployed to staging. Build #247. All health checks passing."
```

### 3.3.2 Autonomous Event-Driven Flow

```mermaid
sequenceDiagram
    participant EXT as External Event Source
    participant SCHED as Scheduler
    participant EB as Event Bus
    participant KERNEL as Agent Kernel
    participant REASON as Reasoning Engine
    participant TOOLS as Tool Runtime
    participant MEM as Memory System

    EXT->>SCHED: GitHub webhook: PR opened
    SCHED->>EB: Emit(github.pr.opened, payload)
    EB->>KERNEL: Event received
    KERNEL->>KERNEL: Match event to registered handlers
    
    Note over KERNEL: Handler: "auto-review PRs on watched repos"
    
    KERNEL->>REASON: PlanTask("Review PR #142 on auth-service")
    REASON->>TOOLS: git.diff(pr: 142)
    TOOLS-->>REASON: diff content
    REASON->>MEM: Retrieve(project: auth-service, type: review_patterns)
    MEM-->>REASON: [known anti-patterns, past review feedback]
    REASON->>TOOLS: analyze_code(diff, patterns)
    TOOLS-->>REASON: analysis results
    REASON->>TOOLS: github.post_review(pr: 142, comments: [...])
    TOOLS-->>REASON: Review posted
    
    REASON-->>KERNEL: Task complete
    KERNEL->>MEM: Store(episodic: "Reviewed PR #142, found 3 issues")
    KERNEL->>EB: Emit(task.completed, {task_id, summary})
```

### 3.3.3 Memory Consolidation Flow (Background)

```mermaid
sequenceDiagram
    participant SCHED as Scheduler
    participant EB as Event Bus
    participant MEM as Memory System
    participant KG as Knowledge Graph
    participant LLM as LLM Router
    participant PERSIST as Persistence

    Note over SCHED: Consolidation cycle triggers (every 4 hours or on idle)
    
    SCHED->>EB: Emit(memory.consolidation.start)
    EB->>MEM: Consolidation triggered
    
    MEM->>MEM: Identify unconsolidated episodic memories
    MEM->>LLM: Summarize episode cluster
    LLM-->>MEM: Summary + extracted entities + learned patterns
    
    MEM->>KG: Upsert entities and relationships
    KG-->>MEM: Graph updated
    
    MEM->>MEM: Extract procedural knowledge (repeated tool sequences)
    MEM->>MEM: Update semantic memory (new facts, updated beliefs)
    MEM->>MEM: Apply decay to old episodic details
    MEM->>MEM: Compress consolidated episodes
    
    MEM->>PERSIST: Write consolidated state
    MEM->>EB: Emit(memory.consolidation.complete, stats)
```

## 3.4 Component Responsibility Matrix

| Component | Owns | Produces | Consumes |
|-----------|------|----------|----------|
| **Agent Kernel** | Task lifecycle, state machine | `task.*` events, context requests | All events (routing) |
| **Planner** | Goal decomposition, dependency graphs | Task plans, sub-goal trees | Task requests, memory context |
| **Memory System** | All memory stores, consolidation | Memory query results, consolidation events | Episodic inputs, tool results, conversation turns |
| **Knowledge Graph** | Entity/relationship model | Graph query results, entity change events | Entity upsert requests, consolidation outputs |
| **Tool Runtime** | Tool registry, execution sandbox | Tool results, error reports | Tool invocation requests |
| **Skill Engine** | Skill registry, composition logic | Composed tool sequences, skill learning events | Skill invocation requests, procedural memory |
| **Reasoning Engine** | Reasoning loop, reflection | Reasoning traces, action decisions | Context bundles, tool results |
| **LLM Router** | Provider connections, routing logic | LLM responses, cost metrics | Generation requests |
| **Scheduler** | Time-based and event-based triggers | Trigger events, scheduled task requests | Cron specs, webhook registrations |
| **Event Bus** | Event routing, persistence | Routed events | All events from all components |
| **Plugin System** | Plugin lifecycle, SDK | Plugin capability registrations | Plugin manifests |
| **MCP Integration** | MCP client connections, server exposure | Tool registrations from MCP | MCP transport messages |
| **Observability** | Traces, logs, metrics | Dashboards, audit logs | All events (passive consumer) |
| **Persistence Layer** | Database connections, migrations | Query results | CRUD operations from all components |
| **Configuration** | Config tree, profiles | Resolved config values | Config files, environment variables |

## 3.5 Module Dependency Graph

This graph shows **compile-time dependencies** (imports), not runtime communication (which goes through the event bus):

```mermaid
graph TD
    KERNEL["Agent Kernel"]
    PLAN["Planner"]
    MEM["Memory System"]
    KG["Knowledge Graph"]
    TOOLS["Tool Runtime"]
    SKILLS["Skill Engine"]
    REASON["Reasoning Engine"]
    LLM["LLM Router"]
    SCHED["Scheduler"]
    EB["Event Bus"]
    PLUGINS["Plugin System"]
    MCP["MCP Integration"]
    OBS["Observability"]
    PERSIST["Persistence Layer"]
    CONFIG["Configuration"]
    TYPES["Shared Types"]
    
    KERNEL --> EB
    KERNEL --> CONFIG
    KERNEL --> TYPES
    
    PLAN --> TYPES
    MEM --> PERSIST
    MEM --> TYPES
    KG --> PERSIST
    KG --> TYPES
    TOOLS --> TYPES
    SKILLS --> TYPES
    REASON --> LLM
    REASON --> TYPES
    LLM --> CONFIG
    LLM --> TYPES
    SCHED --> EB
    SCHED --> PERSIST
    SCHED --> TYPES
    EB --> PERSIST
    EB --> TYPES
    PLUGINS --> TYPES
    MCP --> TOOLS
    MCP --> TYPES
    OBS --> EB
    OBS --> PERSIST
    OBS --> TYPES
    PERSIST --> CONFIG
    
    style TYPES fill:#2d3436,stroke:#636e72,color:#fff
    style EB fill:#2d3436,stroke:#e17055,color:#fff
    style KERNEL fill:#2d3436,stroke:#0984e3,color:#fff
```

**Key observation**: All modules depend on `Shared Types` and most depend on `Event Bus`. No module directly depends on another module's *implementation* — only on shared interfaces. This is the modularity enforcement mechanism.

## 3.6 Deployment Architecture

### Single-Node (Default)

```
┌─────────────────────────────────────────────────────────┐
│  Host Machine (Linux/macOS/Windows)                      │
│                                                          │
│  ┌───────────────────────────────────────────────────┐  │
│  │  fuckclaw (Node.js process)                        │  │
│  │  ├── Agent Kernel                                  │  │
│  │  ├── HTTP Server (:3141)                           │  │
│  │  ├── WebSocket Server (:3141/ws)                   │  │
│  │  ├── Worker Threads (embedding, indexing)          │  │
│  │  └── Child Processes (shell, python, docker)       │  │
│  └───────────────────────────────────────────────────┘  │
│                                                          │
│  ┌───────────────────────────────────────────────────┐  │
│  │  Data Directory (~/.fuckclaw/)                      │  │
│  │  ├── data/                                         │  │
│  │  │   ├── fuckclaw.db (SQLite - main)               │  │
│  │  │   ├── vectors.db (SQLite - embeddings)          │  │
│  │  │   └── events.db (SQLite - event log)            │  │
│  │  ├── workspace/                                    │  │
│  │  │   ├── projects/                                 │  │
│  │  │   ├── knowledge/                                │  │
│  │  │   └── artifacts/                                │  │
│  │  ├── config/                                       │  │
│  │  ├── logs/                                         │  │
│  │  ├── cache/                                        │  │
│  │  └── plugins/                                      │  │
│  └───────────────────────────────────────────────────┘  │
│                                                          │
│  ┌─────────────────────┐  ┌─────────────────────┐      │
│  │  Optional: Redis    │  │  Optional: Postgres  │      │
│  │  (task queue)       │  │  (scale persistence) │      │
│  └─────────────────────┘  └─────────────────────┘      │
└─────────────────────────────────────────────────────────┘
```

### Docker Deployment (Alternative)

```yaml
# docker-compose.yml (conceptual)
services:
  fuckclaw:
    image: fuckclaw:latest
    ports:
      - "3141:3141"
    volumes:
      - ~/.fuckclaw:/data
      - /var/run/docker.sock:/var/run/docker.sock  # Docker-in-Docker
      - ~/.ssh:/root/.ssh:ro                         # Git SSH keys
    environment:
      - ANTHROPIC_API_KEY
      - OPENAI_API_KEY
      - GOOGLE_AI_API_KEY
```

## 3.7 Package Structure

```
fuckclaw/
├── packages/
│   ├── core/                    # Shared types, interfaces, utilities
│   │   ├── src/
│   │   │   ├── types/           # All shared TypeScript types
│   │   │   ├── interfaces/      # Module interface definitions
│   │   │   ├── errors/          # Error hierarchy
│   │   │   └── utils/           # Shared utilities
│   │   └── package.json
│   │
│   ├── kernel/                  # Agent Kernel (§4)
│   │   ├── src/
│   │   │   ├── state-machine.ts
│   │   │   ├── execution-loop.ts
│   │   │   ├── task-orchestrator.ts
│   │   │   ├── context-manager.ts
│   │   │   └── index.ts
│   │   └── package.json
│   │
│   ├── planner/                 # Planner (§5)
│   ├── memory/                  # Memory System (§6)
│   ├── knowledge-graph/         # Knowledge Graph (§8)
│   ├── tools/                   # Tool Runtime (§9)
│   ├── skills/                  # Skill Engine (§10)
│   ├── reasoning/               # Reasoning Engine (§11)
│   ├── llm-router/              # LLM Router (§12)
│   ├── scheduler/               # Scheduler (§13)
│   ├── event-bus/               # Event Bus (§14)
│   ├── agents/                  # Multi-Agent Architecture (§15)
│   ├── plugins/                 # Plugin System (§16)
│   ├── mcp/                     # MCP Integration (§17)
│   ├── observability/           # Observability (§18)
│   ├── config/                  # Configuration (§19)
│   ├── persistence/             # Persistence Layer (§20)
│   ├── network/                 # Networking (§21)
│   │
│   ├── cli/                     # CLI Interface
│   ├── web/                     # Web Dashboard (Next.js or SvelteKit)
│   ├── desktop/                 # Desktop App (Tauri)
│   └── sdk/                     # Plugin SDK
│
├── turbo.json                   # Turborepo config
├── package.json                 # Root workspace
└── tsconfig.base.json           # Shared TypeScript config
```

## 3.8 Critical Path Analysis

The **critical path** for a user request flows through:

```
Gateway → Kernel → Context Manager → Memory Retrieval → LLM Generation → Tool Execution → Response
```

**Latency budget** (target: < 10s for first response token):

| Stage | Target Latency | Bottleneck |
|-------|---------------|------------|
| Gateway routing | < 1ms | Negligible |
| Context building | < 200ms | Memory retrieval (embedding search) |
| Memory retrieval | < 100ms | SQLite vector search (sqlite-vec) |
| Knowledge graph query | < 50ms | Recursive CTEs on indexed graph |
| Context assembly | < 50ms | String concatenation + token counting |
| LLM generation (first token) | 1-5s | Network latency to provider |
| LLM generation (full) | 5-30s | Token generation speed |
| Tool execution | Variable | Depends on tool (shell: 0.1-60s, API: 0.5-5s) |

The dominant factor is always LLM generation time. Everything else must be fast enough to be imperceptible relative to LLM latency.
