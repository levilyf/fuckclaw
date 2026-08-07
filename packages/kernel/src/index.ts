import { IConfigManager } from '@fuckclaw/config';
import { IObservability } from '@fuckclaw/observability';
import { IPersistenceLayer } from '@fuckclaw/persistence';
import { IEventBus } from '@fuckclaw/event-bus';
import { IWorkspaceManager } from '@fuckclaw/workspace';
import { ToolRuntime } from '@fuckclaw/tool-runtime';
import { LLMRouter } from '@fuckclaw/llm-router';
import { IMemorySystem } from '@fuckclaw/memory';
import { ulid } from 'ulidx';
import crypto from 'node:crypto';

// ─── Kernel & Task State Enums (§4.4, §4.5.2) ────────────────────────────────

export enum KernelState {
  BOOTING = 'booting',
  INITIALIZING = 'initializing',
  RECOVERING = 'recovering',
  IDLE = 'idle',
  PROCESSING = 'processing',
  CONSOLIDATING = 'consolidating',
  DRAINING = 'draining',
  SHUTTING_DOWN = 'shutting_down',
  ERROR = 'error',
}

export enum TaskState {
  PENDING = 'pending',
  PLANNING = 'planning',
  READY = 'ready',
  EXECUTING = 'executing',
  WAITING_TOOL = 'waiting_tool',
  WAITING_LLM = 'waiting_llm',
  WAITING_USER = 'waiting_user',
  PAUSED = 'paused',
  REPLANNING = 'replanning',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

export interface TaskSource {
  type: 'user' | 'event' | 'schedule' | 'agent' | 'self' | 'plan';
  conversationId?: string;
  messageId?: string;
  [key: string]: unknown;
}

export interface TaskBudget {
  maxTokens: number;
  maxDuration: number;
  maxToolCalls: number;
  maxLLMCalls: number;
  maxCost: number;
  consumed: {
    tokens: number;
    duration: number;
    toolCalls: number;
    llmCalls: number;
    cost: number;
  };
}

export interface StepResult {
  step: number;
  thought?: string;
  action?: string;
  observation?: unknown;
  success: boolean;
}

export interface TaskError {
  code: string;
  message: string;
  stack?: string;
}

export interface Task {
  id: string;
  description: string;
  source: TaskSource;
  priority: number;
  state: TaskState;
  parentId?: string;
  childIds: string[];
  budget: TaskBudget;
  results: StepResult[];
  output?: string;
  error?: TaskError;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  tags: string[];
  cancellation: AbortController;
}

export interface TaskRequest {
  description: string;
  source?: TaskSource;
  priority?: number;
  tags?: string[];
  budget?: Partial<TaskBudget>;
}

export interface ContextBundle {
  taskId: string;
  description: string;
  systemPrompt: string;
  history: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  availableTools: string[];
}

export interface TaskFilter {
  state?: TaskState;
  tag?: string;
}

export interface IReasoningEngineRunner {
  runTask(task: Task, context: ContextBundle): Promise<{ output: string; steps: StepResult[] }>;
}

export interface IAgentKernel {
  boot(): Promise<void>;
  shutdown(deadlineMs?: number): Promise<void>;
  submitTask(request: TaskRequest): Promise<Task>;
  getTask(id: string): Promise<Task | null>;
  listTasks(filter?: TaskFilter): Task[];
  cancelTask(id: string): Promise<boolean>;
  getState(): KernelState;
  createCheckpoint(taskId: string): Promise<string>;
}

// ─── Agent Kernel Implementation (§4) ────────────────────────────────────────

export class AgentKernel implements IAgentKernel {
  private state: KernelState = KernelState.BOOTING;
  private taskQueue: Task[] = [];
  private activeTasks: Map<string, Task> = new Map();
  private completedTasks: Map<string, Task> = new Map();
  private reasoningEngine?: IReasoningEngineRunner;

  constructor(
    public readonly config: IConfigManager,
    private logger: IObservability,
    private persistence: IPersistenceLayer,
    private eventBus: IEventBus,
    private workspace: IWorkspaceManager,
    private toolRuntime: ToolRuntime,
    public readonly llmRouter: LLMRouter,
    private memorySystem?: IMemorySystem
  ) {}

  setReasoningEngine(runner: IReasoningEngineRunner) {
    this.reasoningEngine = runner;
  }

  async boot(): Promise<void> {
    this.transitionState(KernelState.INITIALIZING);
    this.logger.log({
      level: 'info',
      module: 'kernel',
      message: 'Agent Kernel booting and initializing subsystems...',
    });

    await this.workspace.init();

    // Checkpoint recovery check (§4.4)
    const interrupted = this.persistence.query<{ id: string; description: string; state: string }>(
      "SELECT id, description, state FROM tasks WHERE state IN ('executing', 'ready', 'pending')"
    );

    if (interrupted.length > 0) {
      this.transitionState(KernelState.RECOVERING);
      this.logger.log({
        level: 'warn',
        module: 'kernel',
        message: `Found ${interrupted.length} interrupted task(s) in SQLite. Recovering state...`,
      });
      // Mark recoverable tasks as pending to resume
      for (const t of interrupted) {
        this.persistence.execute("UPDATE tasks SET state = 'pending' WHERE id = ?", [t.id]);
      }
    }

    this.transitionState(KernelState.IDLE);
    await this.eventBus.emit('system.ready', { state: this.state });
  }

  async shutdown(deadlineMs: number = 5000): Promise<void> {
    this.transitionState(KernelState.DRAINING);
    this.logger.log({
      level: 'info',
      module: 'kernel',
      message: 'Agent Kernel initiating shutdown sequence...',
    });

    // Abort all active tasks
    for (const task of this.activeTasks.values()) {
      task.cancellation.abort();
      this.updateTaskState(task, TaskState.CANCELLED);
    }

    const start = Date.now();
    while (this.activeTasks.size > 0 && Date.now() - start < deadlineMs) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    this.transitionState(KernelState.SHUTTING_DOWN);
    await this.eventBus.emit('system.shutdown', { state: this.state });
    this.logger.log({
      level: 'info',
      module: 'kernel',
      message: 'Agent Kernel shutdown complete',
    });
  }

  getState(): KernelState {
    return this.state;
  }

  async submitTask(request: TaskRequest): Promise<Task> {
    if (this.state === KernelState.DRAINING || this.state === KernelState.SHUTTING_DOWN) {
      throw new Error('Kernel is shutting down and cannot accept new tasks');
    }

    const id = ulid();
    const task: Task = {
      id,
      description: request.description,
      source: request.source ?? { type: 'user' },
      priority: request.priority ?? 10,
      state: TaskState.PENDING,
      childIds: [],
      budget: {
        maxTokens: request.budget?.maxTokens ?? 50000,
        maxDuration: request.budget?.maxDuration ?? 300000,
        maxToolCalls: request.budget?.maxToolCalls ?? 30,
        maxLLMCalls: request.budget?.maxLLMCalls ?? 30,
        maxCost: request.budget?.maxCost ?? 1.0,
        consumed: { tokens: 0, duration: 0, toolCalls: 0, llmCalls: 0, cost: 0 },
      },
      results: [],
      createdAt: Date.now(),
      tags: request.tags ?? [],
      cancellation: new AbortController(),
    };

    // 1. Persist task record in SQLite (§4.5, §20.3)
    this.persistTask(task);

    this.taskQueue.push(task);
    this.taskQueue.sort((a, b) => b.priority - a.priority);

    await this.eventBus.emit('kernel.task.created', {
      taskId: task.id,
      description: task.description,
      priority: task.priority,
    });
    this.logger.getMetrics?.().incrementCounter('tasks.total');

    this.logger.log({
      level: 'info',
      module: 'kernel',
      message: `Task ${task.id} submitted: "${task.description}"`,
      taskId: task.id,
    });

    return this.processTask(task);
  }

  private async processTask(task: Task): Promise<Task> {
    const queueIdx = this.taskQueue.indexOf(task);
    if (queueIdx !== -1) {
      this.taskQueue.splice(queueIdx, 1);
    }

    this.activeTasks.set(task.id, task);
    this.transitionState(KernelState.PROCESSING);
    this.updateTaskState(task, TaskState.EXECUTING);
    task.startedAt = Date.now();
    this.logger.getMetrics?.().recordGauge('tasks.active', this.activeTasks.size);

    try {
      if (!this.reasoningEngine) {
        throw new Error('No reasoning engine attached to Agent Kernel');
      }

      const context = await this.buildContext(task);
      const executionResult = await this.reasoningEngine.runTask(task, context);

      task.output = executionResult.output;
      task.results = executionResult.steps;
      task.completedAt = Date.now();
      task.budget.consumed.duration = task.completedAt - task.startedAt;

      // Persist executed step records in SQLite (§4.5)
      this.persistTaskSteps(task);

      this.updateTaskState(task, TaskState.COMPLETED);
      this.logger.getMetrics?.().incrementCounter('tasks.completed');

      await this.eventBus.emit('kernel.task.completed', {
        taskId: task.id,
        success: true,
        output: task.output,
      });

      // Record to episodic memory if available (§6)
      if (this.memorySystem) {
        await this.memorySystem.recordEpisode({
          sessionId: 'kernel-main',
          taskId: task.id,
          timestamp: Date.now(),
          source: 'user_interaction',
          actor: 'agent',
          summary: `Task "${task.description}" completed`,
          content: `Task: ${task.description}\nResult: ${task.output}`,
          importanceScore: 0.7,
          embedding: [],
        });
      }

      return task;
    } catch (err: any) {
      task.error = {
        code: 'EXECUTION_FAILED',
        message: err.message || String(err),
        stack: err.stack,
      };
      task.completedAt = Date.now();
      task.budget.consumed.duration = task.completedAt - (task.startedAt ?? task.createdAt);

      this.updateTaskState(task, TaskState.FAILED);
      this.logger.getMetrics?.().incrementCounter('tasks.failed');

      await this.eventBus.emit('kernel.task.completed', {
        taskId: task.id,
        success: false,
        error: task.error.message,
      });

      this.logger.log({
        level: 'error',
        module: 'kernel',
        message: `Task ${task.id} failed: ${task.error.message}`,
        taskId: task.id,
        error: { name: 'TaskExecutionError', message: task.error.message, stack: task.error.stack },
      });

      return task;
    } finally {
      this.activeTasks.delete(task.id);
      this.completedTasks.set(task.id, task);
      this.persistTask(task);
      this.logger.getMetrics?.().recordGauge('tasks.active', this.activeTasks.size);

      if (this.activeTasks.size === 0 && this.state === KernelState.PROCESSING) {
        this.transitionState(KernelState.IDLE);
      }
    }
  }

  async getTask(id: string): Promise<Task | null> {
    if (this.activeTasks.has(id)) {
      return this.activeTasks.get(id)!;
    }
    if (this.completedTasks.has(id)) {
      return this.completedTasks.get(id)!;
    }

    const row = this.persistence.query<{
      id: string;
      description: string;
      source_json: string;
      priority: number;
      state: string;
      budget_json: string;
      output: string | null;
      error_json: string | null;
      tags_json: string;
      created_at: number;
      started_at: number | null;
      completed_at: number | null;
    }>('SELECT * FROM tasks WHERE id = ?', [id])[0];

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      description: row.description,
      source: JSON.parse(row.source_json),
      priority: row.priority,
      state: row.state as TaskState,
      childIds: [],
      budget: JSON.parse(row.budget_json),
      results: [],
      output: row.output ?? undefined,
      error: row.error_json ? JSON.parse(row.error_json) : undefined,
      createdAt: row.created_at,
      startedAt: row.started_at ?? undefined,
      completedAt: row.completed_at ?? undefined,
      tags: JSON.parse(row.tags_json),
      cancellation: new AbortController(),
    };
  }

  listTasks(filter?: TaskFilter): Task[] {
    const all = [
      ...this.taskQueue,
      ...Array.from(this.activeTasks.values()),
      ...Array.from(this.completedTasks.values()),
    ];

    if (!filter) return all;

    return all.filter((t) => {
      if (filter.state && t.state !== filter.state) return false;
      if (filter.tag && !t.tags.includes(filter.tag)) return false;
      return true;
    });
  }

  async cancelTask(id: string): Promise<boolean> {
    const active = this.activeTasks.get(id);
    if (active) {
      active.cancellation.abort();
      this.updateTaskState(active, TaskState.CANCELLED);
      return true;
    }
    return false;
  }

  async createCheckpoint(taskId: string): Promise<string> {
    const task = await this.getTask(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found for checkpointing`);
    }

    const snapshot = JSON.stringify({
      id: task.id,
      description: task.description,
      state: task.state,
      budget: task.budget,
      results: task.results,
    });

    const hash = crypto.createHash('sha256').update(snapshot).digest('hex');
    const checkpointId = ulid();

    this.persistence.execute(
      'INSERT INTO checkpoints (id, task_id, state, snapshot_json, hash, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [checkpointId, task.id, task.state, snapshot, hash, Date.now()]
    );

    this.logger.log({
      level: 'debug',
      module: 'kernel',
      message: `Checkpoint ${checkpointId} created for task ${taskId}`,
      taskId,
    });

    return checkpointId;
  }

  private transitionState(newState: KernelState) {
    const oldState = this.state;
    this.state = newState;
    this.logger.log({
      level: 'info',
      module: 'kernel',
      message: `Agent Kernel state transitioned: ${oldState} -> ${newState}`,
      metadata: { from: oldState, to: newState },
    });
    this.eventBus.emit('kernel.state.changed', { from: oldState, to: newState });
  }

  private updateTaskState(task: Task, newState: TaskState) {
    const oldState = task.state;
    task.state = newState;
    this.persistTask(task);
    this.eventBus.emit('kernel.task.state_changed', {
      taskId: task.id,
      from: oldState,
      to: newState,
    });
  }

  private persistTask(task: Task) {
    try {
      this.persistence.execute(
        `INSERT INTO tasks (id, description, source_json, priority, state, budget_json, output, error_json, tags_json, created_at, started_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           state = excluded.state,
           budget_json = excluded.budget_json,
           output = excluded.output,
           error_json = excluded.error_json,
           started_at = excluded.started_at,
           completed_at = excluded.completed_at`,
        [
          task.id,
          task.description,
          JSON.stringify(task.source),
          task.priority,
          task.state,
          JSON.stringify(task.budget),
          task.output ?? null,
          task.error ? JSON.stringify(task.error) : null,
          JSON.stringify(task.tags),
          task.createdAt,
          task.startedAt ?? null,
          task.completedAt ?? null,
        ]
      );
    } catch (err) {
      this.logger.log({
        level: 'error',
        module: 'kernel',
        message: `Failed to persist task ${task.id}`,
        metadata: { error: String(err) },
      });
    }
  }

  private persistTaskSteps(task: Task) {
    for (const res of task.results) {
      try {
        const stepId = ulid();
        this.persistence.execute(
          `INSERT INTO task_steps (id, task_id, step_number, thought, action, observation_json, success, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            stepId,
            task.id,
            res.step,
            res.thought ?? null,
            res.action ?? null,
            res.observation !== undefined ? JSON.stringify(res.observation) : null,
            res.success ? 1 : 0,
            Date.now(),
          ]
        );
      } catch {}
    }
  }

  private async buildContext(task: Task): Promise<ContextBundle> {
    const availableTools = this.toolRuntime.listTools().map((t) => t.name);
    let systemPrompt = `You are FuckClaw, an autonomous personal AI runtime.\nWorkspace Root: ${this.workspace.getRoot()}\nAvailable Tools: ${availableTools.join(', ')}`;

    // Memory recall injection (§4.8, §6.7)
    if (this.memorySystem) {
      const recalledContext = await this.memorySystem.retrieveForContext(task.description, 2000);
      if (recalledContext && recalledContext.trim().length > 0) {
        systemPrompt += `\n\n--- RECALLED MEMORY CONTEXT ---\n${recalledContext}\n--- END MEMORY CONTEXT ---`;
      }
    }

    return {
      taskId: task.id,
      description: task.description,
      systemPrompt,
      history: [{ role: 'user', content: task.description }],
      availableTools,
    };
  }
}
