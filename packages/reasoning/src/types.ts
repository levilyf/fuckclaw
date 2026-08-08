import { Task, ContextBundle, StepResult, IReasoningEngineRunner } from '@fuckclaw/kernel';

export interface ParsedAction {
  type: 'tool' | 'finish';
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  finalResponse?: string;
  thought?: string;
}

export interface ReasoningEngineOptions {
  maxSteps?: number;
}

export type { Task, ContextBundle, StepResult, IReasoningEngineRunner };
