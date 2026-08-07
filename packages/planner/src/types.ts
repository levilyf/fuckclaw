import { TaskBudget, StepResult } from '@fuckclaw/kernel';

export type PlanningStrategy =
  | 'direct'
  | 'sequential'
  | 'parallel'
  | 'hierarchical'
  | 'iterative'
  | 'conditional';

export type GoalType =
  | 'achievement'
  | 'query'
  | 'maintenance'
  | 'exploration'
  | 'creation'
  | 'transformation';

export type GoalState =
  | 'pending'
  | 'active'
  | 'satisfied'
  | 'failed'
  | 'abandoned';

export type StepState =
  | 'pending'
  | 'ready'
  | 'executing'
  | 'completed'
  | 'failed'
  | 'skipped';

export interface CompletionCriteria {
  description: string;
  verification?: {
    type: 'command' | 'file_exists' | 'file_contains' | 'llm_judge';
    command?: string;
    expectedExit?: number;
    path?: string;
    pattern?: string;
    prompt?: string;
    threshold?: number;
  };
}

export interface GoalNode {
  id: string;
  description: string;
  type: GoalType;
  criteria: CompletionCriteria[];
  children: GoalNode[];
  decomposition: 'all' | 'any' | 'best_effort';
  state: GoalState;
}

export interface StepInput {
  name: string;
  source: 'context' | 'previous_step' | 'literal';
  stepId?: string;
  outputName?: string;
  value?: unknown;
}

export interface StepOutput {
  name: string;
  type: string;
  description?: string;
}

export interface StepEstimate {
  tokens: number;
  durationMs: number;
  cost: number;
}

export interface RetryPolicy {
  maxRetries: number;
  backoffMs: number;
  exponential: boolean;
}

export interface Dependency {
  from: string; // Step ID that must complete first
  to: string;   // Step ID that depends on the 'from' step
  dataFlow?: {
    outputName: string;
    inputName: string;
  };
}

export interface PlanStep {
  id: string;
  index: number;
  goalId: string;
  description: string;
  type: {
    kind: 'subtask' | 'tool_call' | 'llm_generation' | 'agent_delegation' | 'conditional';
    details?: Record<string, unknown>;
  };
  inputs: StepInput[];
  outputs: StepOutput[];
  estimate: StepEstimate;
  state: StepState;
  result?: StepResult;
  error?: string;
  retryPolicy: RetryPolicy;
  optional: boolean;
  checkpoint: boolean;
}

export interface ReplanPolicy {
  maxReplans: number;
  maxReplanTokens: number;
  replanCooldownMs: number;
  escalateAfterFailures: number;
}

export interface TaskPlan {
  id: string;
  goal: string;
  version: number;
  strategy: PlanningStrategy;
  rootGoal: GoalNode;
  steps: PlanStep[];
  dependencies: Dependency[];
  estimatedBudget: TaskBudget;
  confidence: number;
  rationale: string;
  createdAt: number;
  replannedAt?: number;
}

export interface PlanReflection {
  planId: string;
  outcome: 'success' | 'partial_success' | 'failure';
  estimateAccuracy: {
    tokenEstimate: number;
    tokenActual: number;
    timeEstimate: number;
    timeActual: number;
    stepCountEstimate: number;
    stepCountActual: number;
  };
  failures: Array<{
    stepId: string;
    reason: string;
    wasRecoverable: boolean;
    resolution: string;
  }>;
  unnecessarySteps: string[];
  lessonsLearned: string[];
  completedAt: number;
}

export interface PlanExecutionResult {
  planId: string;
  success: boolean;
  version: number;
  completedSteps: number;
  totalSteps: number;
  output: string;
  stepOutputs: Record<string, unknown>;
  reflection: PlanReflection;
}
