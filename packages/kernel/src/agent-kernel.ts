import { IConfigManager } from '@fuckclaw/config';
import { IObservability } from '@fuckclaw/observability';
import { IPersistenceLayer } from '@fuckclaw/persistence';
import { IEventBus } from '@fuckclaw/event-bus';
import { IWorkspaceManager } from '@fuckclaw/workspace';
import { IToolRuntime } from '@fuckclaw/tool-runtime';
import { LLMRouter } from '@fuckclaw/llm-router';
import { IMemorySystem } from '@fuckclaw/memory';
import { ulid } from 'ulidx';
import {
  IAgentKernel,
  KernelState,
  TaskState,
  Task,
  TaskRequest,
  TaskFilter,
  IReasoningEngineRunner,
} from './types.js';
import { KernelStateMachine } from './state-machine/kernel-state-machine.js';
import { TaskStateMachine } from './state-machine/task-state-machine.js';
import { PriorityTaskQueue } from './queue/priority-task-queue.js';
import { ContextManager } from './context/context-manager.js';
import { CheckpointManager } from './recovery/checkpoint-manager.js';

export class AgentKernel implements IAgentKernel {
  private stateMachine: KernelStateMachine;
  private taskStateMachine: TaskStateMachine;
  private taskQueue = new PriorityTaskQueue();
  private contextManager: ContextManager;
  private checkpointManager: CheckpointManager;
  private activeTasks: Map<string, Task> = new Map();
  private completedTasks: Map<string, Task> = new Map();
  private reasoningEngine?: IReasoningEngineRunner;

  constructor(
    public readonly config: IConfigManager,
    private logger: IObservability,
    private persistence: IPersistenceLayer,
    private eventBus: IEventBus,
    private workspace: IWorkspaceManager,
    toolRuntime: IToolRuntime,
    public readonly llmRouter: LLMRouter,
    private memorySystem?: IMemorySystem,
    reasoningEngine?: IReasoningEngineRunner
  ) {
    this.stateMachine = new KernelStateMachine(logger, eventBus);
    this.taskStateMachine = new TaskStateMachine(persistence, eventBus);
    this.contextManager = new ContextManager(workspace, toolRuntime, memorySystem);
    this.checkpointManager = new CheckpointManager(persistence, logger);
    if (reasoningEngine) {
      this.reasoningEngine = reasoningEngine;
    }
  }

  setReasoningEngine(runner: IReasoningEngineRunner) {
    this.reasoningEngine = runner;
  }

  async boot(): Promise<void> {
    this.stateMachine.transition(KernelState.INITIALIZING);
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
      this.stateMachine.transition(KernelState.RECOVERING);
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

    this.stateMachine.transition(KernelState.IDLE);
    await this.eventBus.emit('system.ready', { state: this.getState() });
  }

  async shutdown(deadlineMs: number = 5000): Promise<void> {
    this.stateMachine.transition(KernelState.DRAINING);
    this.logger.log({
      level: 'info',
      module: 'kernel',
      message: 'Agent Kernel initiating shutdown sequence...',
    });

    // Abort all active tasks
    for (const task of this.activeTasks.values()) {
      task.cancellation.abort();
      this.taskStateMachine.updateState(task, TaskState.CANCELLED);
    }

    const start = Date.now();
    while (this.activeTasks.size > 0 && Date.now() - start < deadlineMs) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    this.stateMachine.transition(KernelState.SHUTTING_DOWN);
    await this.eventBus.emit('system.shutdown', { state: this.getState() });
    this.logger.log({
      level: 'info',
      module: 'kernel',
      message: 'Agent Kernel shutdown complete',
    });
  }

  getState(): KernelState {
    return this.stateMachine.getState();
  }

  async submitTask(request: TaskRequest): Promise<Task> {
    const currentState = this.getState();
    if (currentState === KernelState.DRAINING || currentState === KernelState.SHUTTING_DOWN) {
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
    this.taskStateMachine.persistTask(task);
    this.taskQueue.enqueue(task);

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
    this.taskQueue.remove(task);
    this.activeTasks.set(task.id, task);
    this.stateMachine.transition(KernelState.PROCESSING);
    this.taskStateMachine.updateState(task, TaskState.EXECUTING);
    task.startedAt = Date.now();
    this.logger.getMetrics?.().recordGauge('tasks.active', this.activeTasks.size);

    try {
      if (!this.reasoningEngine) {
        throw new Error('No reasoning engine attached to Agent Kernel');
      }

      const context = await this.contextManager.buildContext(task);
      const executionResult = await this.reasoningEngine.runTask(task, context);

      task.output = executionResult.output;
      task.results = executionResult.steps;
      task.completedAt = Date.now();
      task.budget.consumed.duration = task.completedAt - task.startedAt;

      // Persist executed step records in SQLite (§4.5)
      this.persistTaskSteps(task);

      this.taskStateMachine.updateState(task, TaskState.COMPLETED);
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

      this.taskStateMachine.updateState(task, TaskState.FAILED);
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
      this.taskStateMachine.persistTask(task);
      this.logger.getMetrics?.().recordGauge('tasks.active', this.activeTasks.size);

      if (this.activeTasks.size === 0 && this.getState() === KernelState.PROCESSING) {
        this.stateMachine.transition(KernelState.IDLE);
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
      ...this.taskQueue.list(),
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
      this.taskStateMachine.updateState(active, TaskState.CANCELLED);
      return true;
    }
    return false;
  }

  async createCheckpoint(taskId: string): Promise<string> {
    const task = await this.getTask(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found for checkpointing`);
    }
    return this.checkpointManager.createCheckpoint(task);
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
}
