# §18 — Observability

## 18.1 Purpose

Observability is the mechanism by which FuckClaw achieves transparency and debuggability. Every decision, every reasoning step, every tool call, every memory retrieval, every cost expenditure is recorded in a structured, queryable format. This is not a security feature — it is a **trust calibration** and **debugging** feature.

## 18.2 Three Pillars

### 18.2.1 Logging

Structured JSON logs with hierarchical context:

```typescript
interface LogEntry {
  timestamp: number;
  level: 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  module: string;         // e.g., "kernel", "memory", "tool.shell"
  message: string;
  taskId?: string;        // Task context
  correlationId?: string; // Cross-module correlation
  data?: Record<string, unknown>;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}
```

**Log levels by module**:

| Module | Default Level | Rationale |
|---|---|---|
| Agent Kernel | `info` | Task lifecycle events |
| Reasoning Engine | `info` | Reasoning steps (debug for full chain-of-thought) |
| Tool Runtime | `info` | Tool invocations and results |
| Memory System | `warn` | Only log consolidation events and errors |
| LLM Router | `info` | Model selection, cost tracking |
| Event Bus | `warn` | Only log errors and DLQ entries |
| Scheduler | `info` | Trigger fires |
| Plugin System | `info` | Plugin lifecycle |

### 18.2.2 Tracing

Distributed tracing across the full execution path of a task:

```typescript
interface Trace {
  traceId: string;        // Unique per task
  spans: Span[];
}

interface Span {
  spanId: string;
  parentSpanId?: string;
  name: string;           // e.g., "reasoning.react_loop", "tool.shell.execute"
  module: string;
  startTime: number;
  endTime: number;
  duration: number;
  status: 'ok' | 'error';
  attributes: Record<string, string | number | boolean>;
  events: SpanEvent[];    // Timestamped events within the span
}

interface SpanEvent {
  name: string;
  timestamp: number;
  attributes?: Record<string, unknown>;
}
```

**Example trace for "Deploy auth service"**:

```
Trace: task_deploy_auth
├── Span: kernel.task.execute (45.2s)
│   ├── Span: context.build (0.12s)
│   │   ├── Span: memory.retrieve.episodic (0.03s)
│   │   ├── Span: memory.retrieve.semantic (0.02s)
│   │   └── Span: knowledge_graph.query (0.01s)
│   ├── Span: reasoning.react_loop (44.8s)
│   │   ├── Span: llm.generate (2.1s) [model=claude-sonnet, tokens=4521]
│   │   ├── Span: tool.git.execute (1.2s) [command=git status]
│   │   ├── Span: llm.generate (1.8s)
│   │   ├── Span: tool.shell.execute (12.4s) [command=npm test]
│   │   ├── Span: llm.generate (2.3s)
│   │   ├── Span: tool.docker.execute (18.1s) [command=docker build]
│   │   ├── Span: tool.shell.execute (3.2s) [command=kubectl apply]
│   │   └── Span: tool.http.execute (0.8s) [health check]
│   └── Span: memory.persist.episodic (0.05s)
```

### 18.2.3 Metrics

Real-time and historical metrics:

```typescript
interface SystemMetrics {
  /** Task metrics */
  tasks: {
    active: number;
    completed: number;
    failed: number;
    avgDurationMs: number;
    p99DurationMs: number;
  };
  
  /** LLM metrics */
  llm: {
    requestsPerMinute: number;
    tokensPerMinute: { input: number; output: number };
    costToday: number;
    costThisMonth: number;
    cacheHitRate: number;
    errorRate: number;
    avgLatencyMs: number;
  };
  
  /** Memory metrics */
  memory: {
    episodicCount: number;
    semanticCount: number;
    proceduralCount: number;
    knowledgeGraphEntities: number;
    knowledgeGraphRelationships: number;
    dbSizeBytes: number;
    lastConsolidation: number;
  };
  
  /** Tool metrics */
  tools: {
    activeExecutions: number;
    totalExecutions: number;
    errorRate: number;
    avgDurationMs: number;
    byTool: Record<string, { calls: number; errors: number; avgMs: number }>;
  };
  
  /** System metrics */
  system: {
    uptimeMs: number;
    heapUsedMb: number;
    heapTotalMb: number;
    cpuPercent: number;
    eventBusQueueDepth: number;
    activePlugins: number;
  };
}
```

## 18.3 Reasoning Timeline

A specialized observability feature: the **Reasoning Timeline** provides a human-readable, step-by-step record of the agent's reasoning for any task:

```typescript
interface ReasoningTimeline {
  taskId: string;
  taskDescription: string;
  startedAt: number;
  completedAt: number;
  
  entries: ReasoningTimelineEntry[];
}

interface ReasoningTimelineEntry {
  timestamp: number;
  type: 'thought' | 'action' | 'observation' | 'reflection' | 'decision' | 'memory_retrieval' | 'error';
  content: string;
  metadata?: Record<string, unknown>;
}
```

**Example output** (rendered in CLI or web UI):

```
🧠 Reasoning Timeline for: "Deploy auth service to staging"
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[14:23:01] 💭 THOUGHT: I need to deploy the auth service. Let me check the current
           state of the repository and ensure tests pass first.

[14:23:03] 🔍 MEMORY: Retrieved: Last deployment was 3 days ago (commit abc123).
           Staging environment uses Kubernetes namespace 'staging'.

[14:23:04] 🔧 ACTION: git status (in /home/user/projects/auth-service)
[14:23:04] 👁 OBSERVATION: On branch main, 2 commits ahead of origin.

[14:23:06] 💭 THOUGHT: Repository has unpushed commits. I should run tests before deploying.

[14:23:07] 🔧 ACTION: npm test
[14:23:19] 👁 OBSERVATION: 47 tests passed, 0 failed. Coverage: 87%.

[14:23:21] 🔧 ACTION: docker build -t auth-service:staging .
[14:23:39] 👁 OBSERVATION: Successfully built image sha256:def456...

[14:23:40] 📋 DECISION: Tests pass, image built. Proceeding with deployment.

[14:23:41] 🔧 ACTION: kubectl apply -f k8s/staging.yaml
[14:23:44] 👁 OBSERVATION: deployment.apps/auth-service configured

[14:23:45] 🔁 REFLECTION: Deployment command succeeded. Let me verify with a health check.

[14:23:46] 🔧 ACTION: curl https://staging.auth.example.com/health
[14:23:47] 👁 OBSERVATION: {"status": "healthy", "version": "2.1.4"}

[14:23:47] ✅ COMPLETE: Auth service deployed to staging. Version 2.1.4, all health checks passing.
```

## 18.4 Audit History

An immutable audit log of all state-changing actions:

```sql
CREATE TABLE audit_log (
    id TEXT PRIMARY KEY,
    timestamp INTEGER NOT NULL,
    action TEXT NOT NULL,      -- 'tool_execute', 'file_write', 'git_push', 'memory_update'
    actor TEXT NOT NULL,       -- 'agent', 'user', 'scheduler', 'plugin:{id}'
    task_id TEXT,
    details_json TEXT NOT NULL,
    result TEXT NOT NULL,      -- 'success', 'failure', 'error'
    metadata_json TEXT
);

CREATE INDEX idx_audit_time ON audit_log(timestamp DESC);
CREATE INDEX idx_audit_action ON audit_log(action, timestamp DESC);
CREATE INDEX idx_audit_task ON audit_log(task_id);
```

## 18.5 Replay

Any task execution can be replayed from its event log for debugging:

```typescript
interface ReplaySession {
  /** Replay events from a specific task */
  replayTask(taskId: string): AsyncIterable<ReplayEvent>;
  
  /** Replay all events in a time range */
  replayTimeRange(from: number, to: number): AsyncIterable<ReplayEvent>;
  
  /** Step through events one at a time */
  step(): ReplayEvent | null;
  
  /** Jump to a specific event */
  seekTo(eventId: string): void;
}

interface ReplayEvent {
  event: SystemEvent;
  index: number;
  totalEvents: number;
  relativeTimeMs: number;  // Time since replay start
}
```

## 18.6 Interfaces

```typescript
export interface IObservability {
  /** Logging */
  log(entry: LogEntry): void;
  
  /** Tracing */
  startSpan(name: string, attributes?: Record<string, unknown>): SpanHandle;
  endSpan(handle: SpanHandle, status?: 'ok' | 'error'): void;
  getTrace(traceId: string): Promise<Trace | null>;
  
  /** Metrics */
  getMetrics(): SystemMetrics;
  recordMetric(name: string, value: number, tags?: Record<string, string>): void;
  
  /** Reasoning Timeline */
  getTimeline(taskId: string): Promise<ReasoningTimeline | null>;
  
  /** Audit */
  audit(entry: Omit<AuditEntry, 'id' | 'timestamp'>): void;
  queryAudit(filter: AuditFilter): Promise<AuditEntry[]>;
  
  /** Replay */
  createReplaySession(filter: ReplayFilter): ReplaySession;
}
```

## 18.7 Failure Modes

| Failure | Impact | Mitigation |
|---|---|---|
| Log volume overwhelms disk | Disk full | Log rotation (daily); level-based retention; compression |
| Trace storage grows unbounded | DB bloat | Trace sampling for low-priority tasks; 30-day retention |
| Metrics collection causes overhead | CPU usage | Sampling (metrics collected every 10s, not per-event) |
| Audit log corruption | Lost accountability | Append-only writes; WAL mode; periodic integrity checks |

## 18.8 Future Improvements

1. **OpenTelemetry export**: Export traces and metrics to Jaeger, Prometheus, Grafana
2. **Web-based trace viewer**: Interactive trace visualization with span details and timing
3. **Anomaly detection**: Automatically flag unusual patterns (cost spikes, error rate increases)
4. **Performance regression alerts**: Detect when task completion times increase significantly
5. **LLM response quality tracking**: Rate and track LLM output quality over time for model selection optimization
