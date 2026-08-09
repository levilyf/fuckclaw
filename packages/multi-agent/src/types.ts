import { TaskBudget } from '@fuckclaw/kernel';

export type ModelTier = 'fast' | 'standard' | 'frontier' | 'reasoning';

export interface ArtifactReference {
  id: string;
  name: string;
  path: string;
  type: string;
  size?: number;
}

export interface AgentSpec {
  /** Agent type identifier (e.g., 'supervisor', 'researcher', 'coder', 'reviewer', etc.) */
  type: string;

  /** Role description */
  role: string;

  /** Specialized system prompt */
  systemPrompt: string;

  /** Which tools this agent has access to ('all' or array of tool names) */
  allowedTools: string[] | 'all';

  /** Default model tier */
  defaultModelTier: ModelTier;

  /** Memory retrieval specialization */
  memoryFocus: {
    /** Which memory types to prioritize */
    priorityTypes: ('episodic' | 'semantic' | 'procedural')[];
    /** Custom retrieval query augmentation */
    retrievalPrompt?: string;
  };

  /** Maximum concurrent instances */
  maxInstances: number;

  /** Maximum budget per invocation */
  maxBudget: Partial<TaskBudget>;
}

export interface AgentDelegation {
  /** Unique delegation ID */
  id: string;

  /** Parent task ID */
  parentTaskId: string;

  /** Agent type to delegate to */
  agentType: string;

  /** Task description for the agent */
  task: string;

  /** Input context to provide */
  context: {
    /** Relevant files */
    files?: string[];
    /** Relevant memory records */
    memoryIds?: string[];
    /** Custom context data */
    data?: Record<string, unknown>;
  };

  /** Expected output format */
  expectedOutput?: {
    schema?: Record<string, unknown>;
    description?: string;
  };

  /** Resource budget */
  budget: Partial<TaskBudget>;

  /** Timeout in milliseconds */
  timeoutMs: number;

  /** Result if completed */
  result?: AgentResult;

  /** Current delegation state */
  state: 'pending' | 'executing' | 'completed' | 'failed' | 'cancelled';
}

export interface AgentResult {
  success: boolean;
  output: string;
  structuredData?: Record<string, unknown>;
  artifacts?: ArtifactReference[];
  tokensUsed: number;
  costUsd: number;
  durationMs: number;
}

export interface AgentInstance {
  id: string;
  spec: AgentSpec;
  delegation: AgentDelegation;
  state: 'pending' | 'executing' | 'completed' | 'failed' | 'cancelled';
  startedAt: number;
  completedAt?: number;
}

export interface IAgentOrchestrator {
  /** Delegate a task to a specialized agent */
  delegate(delegation: Omit<AgentDelegation, 'id' | 'state'>): Promise<AgentResult>;

  /** Delegate multiple tasks in parallel */
  delegateParallel(delegations: Omit<AgentDelegation, 'id' | 'state'>[]): Promise<AgentResult[]>;

  /** Get the status of a delegation */
  status(delegationId: string): AgentDelegation | null;

  /** Cancel a delegation */
  cancel(delegationId: string): Promise<void>;

  /** List active agents */
  listActive(): AgentInstance[];

  /** Register a custom agent type */
  registerAgentType(spec: AgentSpec): void;

  /** Get agent specification by type */
  getAgentSpec(type: string): AgentSpec | undefined;
}
