import { Task, ContextBundle, StepResult, IReasoningEngineRunner } from '@fuckclaw/kernel';

export type ReasoningStrategyType = 'direct' | 'react' | 'tree_search' | 'iterative_refinement';

export interface ParsedAction {
  type: 'tool' | 'finish';
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  finalResponse?: string;
  thought?: string;
}

export interface ReasoningEngineOptions {
  maxSteps?: number;
  defaultStrategy?: ReasoningStrategyType;
}

export interface IReasoningStrategy {
  readonly name: ReasoningStrategyType;
  execute(task: Task, context: ContextBundle): Promise<{ output: string; steps: StepResult[] }>;
}

export type { Task, ContextBundle, StepResult, IReasoningEngineRunner };
