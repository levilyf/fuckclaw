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
