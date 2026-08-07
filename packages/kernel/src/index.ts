import { IConfigManager } from '@fuckclaw/config';
import { IObservability } from '@fuckclaw/observability';
import { IPersistenceLayer } from '@fuckclaw/persistence';
import { IEventBus } from '@fuckclaw/event-bus';
import { IWorkspaceManager } from '@fuckclaw/workspace';
import { ToolRuntime } from '@fuckclaw/tool-runtime';
import { LLMRouter } from '@fuckclaw/llm-router';
import { IMemorySystem } from '@fuckclaw/memory';
import { ulid } from 'ulidx';

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

export interface TaskFilter {
  state?: TaskState;
  tag?: string;
}

export interface ContextBundle {
  taskId: string;
  description: string;
  systemPrompt: string;
  history: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  availableTools: string[];
}

export interface IReasoningEngineRunner {
  runTask(task: Task, context: ContextBundle): Promise<{ output: string; steps: StepResult[] }>;
}

export interface IAgentKernel {
  boot(): Promise<void>;
  shutdown(deadlineMs?: number): Promise<void>;
  getState(): KernelState;
  submitTask(request: TaskRequest): Promise<Task>;
  cancelTask(taskId: string, reason: string): Promise<void>;
  getTask(taskId: string): Task | null;
  listTasks(filter?: TaskFilter): Task[];
  buildContext(task: Task): Promise<ContextBundle>;
  setReasoningEngine(engine: IReasoningEngineRunner): void;
}

export class AgentKernel implements IAgentKernel {
  private state: KernelState = KernelState.BOOTING;
  private tasks: Map<string, Task> = new Map();
  private taskQueue: string[] = []; // Task IDs in priority/FIFO order
  private activeTaskIds: Set<string> = new Set();
  private reasoningEngine?: IReasoningEngineRunner;

  constructor(
    public readonly config: IConfigManager,
    public readonly logger: IObservability,
    public readonly persistence: IPersistenceLayer,
    public readonly eventBus: IEventBus,
    public readonly workspace: IWorkspaceManager,
    public readonly toolRuntime: ToolRuntime,
    public readonly llmRouter: LLMRouter,
    public readonly memorySystem?: IMemorySystem
  ) {}

  setReasoningEngine(engine: IReasoningEngineRunner): void {
    this.reasoningEngine = engine;
  }

  async boot(): Promise<void> {
    this.state = KernelState.BOOTING;
    this.logger.log({ level: 'info', message: 'Agent Kernel booting...' });

    this.state = KernelState.INITIALIZING;
    await this.workspace.init();

    await this.eventBus.emit('kernel.booted', { timestamp: Date.now() });

    this.state = KernelState.IDLE;
    this.logger.log({ level: 'info', message: 'Agent Kernel state transitioned to IDLE' });
  }

  async shutdown(_deadlineMs: number = 5000): Promise<void> {
    this.logger.log({ level: 'info', message: 'Agent Kernel initiating shutdown sequence...' });
    this.state = KernelState.DRAINING;

    // Abort all active tasks
    for (const taskId of this.activeTaskIds) {
      const task = this.tasks.get(taskId);
      if (task) {
        task.cancellation.abort();
        task.state = TaskState.CANCELLED;
      }
    }

    this.state = KernelState.SHUTTING_DOWN;
    await this.eventBus.emit('kernel.shutdown', { timestamp: Date.now() });
    this.logger.log({ level: 'info', message: 'Agent Kernel shutdown complete' });
  }

  getState(): KernelState {
    return this.state;
  }

  async submitTask(request: TaskRequest): Promise<Task> {
    if (this.state === KernelState.DRAINING || this.state === KernelState.SHUTTING_DOWN) {
      throw new Error('Kernel is shutting down, no new tasks accepted');
    }

    const taskId = ulid();
    const task: Task = {
      id: taskId,
      description: request.description,
      source: request.source || { type: 'user' },
      priority: request.priority ?? 50,
      state: TaskState.PENDING,
      childIds: [],
      budget: {
        maxTokens: request.budget?.maxTokens ?? 100000,
        maxDuration: request.budget?.maxDuration ?? 60000,
        maxToolCalls: request.budget?.maxToolCalls ?? 25,
        maxLLMCalls: request.budget?.maxLLMCalls ?? 25,
        maxCost: request.budget?.maxCost ?? 1.0,
        consumed: { tokens: 0, duration: 0, toolCalls: 0, llmCalls: 0, cost: 0 },
      },
      results: [],
      createdAt: Date.now(),
      tags: request.tags ?? [],
      cancellation: new AbortController(),
    };

    this.tasks.set(taskId, task);
    this.taskQueue.push(taskId);

    // Sort priority queue (lower number = higher priority)
    this.taskQueue.sort((a, b) => {
      const taskA = this.tasks.get(a)!;
      const taskB = this.tasks.get(b)!;
      return taskA.priority - taskB.priority;
    });

    await this.eventBus.emit('task.enqueued', { taskId, description: task.description });
    this.logger.log({ level: 'info', message: `Task ${taskId} submitted: "${task.description}"` });

    // Process immediately in this minimal executor slice
    await this.processQueue();

    return this.tasks.get(taskId)!;
  }

  private async processQueue(): Promise<void> {
    if (this.taskQueue.length === 0) return;

    const previousState = this.state;
    this.state = KernelState.PROCESSING;

    while (this.taskQueue.length > 0) {
      const nextTaskId = this.taskQueue.shift()!;
      const task = this.tasks.get(nextTaskId);
      if (!task || task.state === TaskState.CANCELLED) continue;

      this.activeTaskIds.add(nextTaskId);
      task.state = TaskState.EXECUTING;
      task.startedAt = Date.now();

      await this.eventBus.emit('task.started', { taskId: task.id });

      try {
        if (this.memorySystem) {
          this.memorySystem.working.appendTurn({
            role: 'user',
            content: task.description,
            timestamp: Date.now(),
          });
          // Capture user facts into semantic store if the input expresses facts/preferences
          await this.memorySystem.extractAndAssertUserFacts(task.description, task.id).catch(e => {
            this.logger.log({ level: 'warn', message: 'Failed to extract user facts', metadata: { error: e } });
          });
        }

        const context = await this.buildContext(task);
        if (!this.reasoningEngine) {
          throw new Error('ReasoningEngine runner not attached to Kernel');
        }

        const runResult = await this.reasoningEngine.runTask(task, context);
        task.results = runResult.steps;
        task.output = runResult.output;
        task.state = TaskState.COMPLETED;
        task.completedAt = Date.now();

        if (this.memorySystem) {
          this.memorySystem.working.appendTurn({
            role: 'assistant',
            content: task.output,
            timestamp: Date.now(),
          });
        }

        await this.eventBus.emit('task.completed', { taskId: task.id, output: task.output });
      } catch (err: any) {
        task.state = TaskState.FAILED;
        task.error = {
          code: err.code || 'TASK_EXECUTION_ERROR',
          message: err.message || String(err),
          stack: err.stack,
        };
        task.completedAt = Date.now();
        await this.eventBus.emit('task.failed', { taskId: task.id, error: task.error });
      } finally {
        if (this.memorySystem) {
          await this.memorySystem.flushWorkingToEpisodic(task.id).catch(e => {
            this.logger.log({ level: 'error', message: 'Failed to flush memory', metadata: { error: e } });
          });
        }
        this.activeTaskIds.delete(nextTaskId);
      }
    }

    this.state = previousState === KernelState.PROCESSING ? KernelState.IDLE : previousState;
  }

  async cancelTask(taskId: string, reason: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) return;

    task.cancellation.abort();
    task.state = TaskState.CANCELLED;
    task.error = { code: 'TASK_CANCELLED', message: reason };
    this.activeTaskIds.delete(taskId);
    await this.eventBus.emit('task.cancelled', { taskId, reason });
  }

  getTask(taskId: string): Task | null {
    return this.tasks.get(taskId) ?? null;
  }

  listTasks(filter?: TaskFilter): Task[] {
    const all = Array.from(this.tasks.values());
    if (!filter) return all;
    return all.filter((t) => {
      if (filter.state && t.state !== filter.state) return false;
      if (filter.tag && !t.tags.includes(filter.tag)) return false;
      return true;
    });
  }

  async buildContext(task: Task): Promise<ContextBundle> {
    let systemPrompt =
      'You are FuckClaw, an autonomous AI operating system runtime. Solve the user request with the minimal bounded ReAct loop and invoke the available tools when the request requires an external action.';

    if (this.memorySystem) {
      const memoryContext = await this.memorySystem.retrieveForContext(task.description, 1000);
      if (memoryContext.trim().length > 0) {
        systemPrompt += `\n\n# Recalled Knowledge & Context\n${memoryContext}`;
      }
    }

    return {
      taskId: task.id,
      description: task.description,
      systemPrompt,
      history: [{ role: 'user', content: task.description }],
      availableTools: ['shell', 'filesystem'],
    };
  }
}
