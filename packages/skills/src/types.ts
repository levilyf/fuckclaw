import { FuckClawError } from '@fuckclaw/core';
import { ToolContext } from '@fuckclaw/tool-runtime';

export type SkillInputType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'file_path'
  | 'code'
  | 'any';

export interface SkillInput {
  name: string;
  type: SkillInputType;
  description: string;
  required: boolean;
  default?: unknown;
}

export interface SkillOutput {
  name: string;
  type: string;
  description: string;
}

export type SkillAction =
  | { type: 'tool_call'; tool: string; argsTemplate: Record<string, unknown> }
  | { type: 'llm_reason'; prompt: string; outputVar: string }
  | { type: 'sub_skill'; skillId: string; inputMapping: Record<string, string> }
  | { type: 'conditional'; condition: string; thenSteps: string[]; elseSteps?: string[] }
  | { type: 'loop'; overVar: string; bodySteps: string[] };

export type SkillFailurePolicy = 'abort' | 'skip' | 'retry' | 'fallback';

export interface SkillStep {
  id: string;
  action: SkillAction;
  condition?: string;
  onFailure: SkillFailurePolicy;
  fallbackStepId?: string;
}

export interface SkillStats {
  totalExecutions: number;
  successCount: number;
  failureCount: number;
  averageDurationMs: number;
  averageTokenCost: number;
  lastExecutedAt: number;
  successRate: number;
}

export type SkillOrigin = 'builtin' | 'extracted' | 'marketplace' | 'user_defined';

export interface SkillManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  triggerPatterns: string[];
  inputs: SkillInput[];
  outputs: SkillOutput[];
  requiredTools: string[];
  steps: SkillStep[];
  systemPromptAugment?: string;
  stats?: SkillStats;
  origin: SkillOrigin;
  tags: string[];
}

export interface PatternCandidate {
  stepSequence: string[];
  occurrences: number;
  successRate: number;
  averageDuration: number;
  contextSimilarity: number;
}

export interface ScoredSkill {
  skill: SkillManifest;
  relevanceScore: number;
  successRate: number;
}

export interface SkillExecutionResult {
  success: boolean;
  outputs: Record<string, unknown>;
  stepsExecuted: number;
  stepsSkipped: number;
  stepsFailed: number;
  durationMs: number;
  tokenCost: number;
  error?: string;
}

export interface ISkillEngine {
  register(manifest: SkillManifest): Promise<void>;
  execute(
    skillId: string,
    inputs: Record<string, unknown>,
    context?: ToolContext
  ): Promise<SkillExecutionResult>;
  matchSkills(intent: string, limit?: number): Promise<ScoredSkill[]>;
  list(filter?: { origin?: SkillOrigin; tags?: string[] }): SkillManifest[];
  get(skillId: string): SkillManifest | null;
  getStats(skillId: string): SkillStats;
  refine(skillId: string): Promise<SkillManifest | null>;
  detectPatterns(recentPlanTraces?: Array<{ steps: string[]; success: boolean; duration: number }>): Promise<PatternCandidate[]>;
  generateSkill(pattern: PatternCandidate): Promise<SkillManifest>;
  loadFromDirectory(dirPath: string): Promise<number>;
}

export class SkillError extends FuckClawError {
  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(code, message, details);
    this.name = 'SkillError';
  }
}
