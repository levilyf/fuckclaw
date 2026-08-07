import { IToolRuntime, ToolContext } from '@fuckclaw/tool-runtime';
import { ILLMRouter } from '@fuckclaw/llm-router';
import { IObservability } from '@fuckclaw/observability';
import { IEventBus } from '@fuckclaw/event-bus';
import { ulid } from 'ulidx';
import {
  SkillManifest,
  SkillOrigin,
  SkillStats,
  ScoredSkill,
  SkillExecutionResult,
  PatternCandidate,
  ISkillEngine,
} from './types.js';
import { SkillRegistry } from './registry/skill-registry.js';
import { SkillExecutor } from './executor/skill-executor.js';

export class SkillsEngine implements ISkillEngine {
  private registry: SkillRegistry;
  private executor: SkillExecutor;

  constructor(
    toolRuntime: IToolRuntime,
    llmRouter?: ILLMRouter,
    observability?: IObservability,
    eventBus?: IEventBus
  ) {
    this.registry = new SkillRegistry(observability);
    this.executor = new SkillExecutor(
      this.registry,
      toolRuntime,
      llmRouter,
      observability,
      eventBus
    );
  }

  public async register(manifest: SkillManifest): Promise<void> {
    return this.registry.register(manifest);
  }

  public async execute(
    skillId: string,
    inputs: Record<string, unknown>,
    context?: ToolContext
  ): Promise<SkillExecutionResult> {
    return this.executor.execute(skillId, inputs, context);
  }

  public async matchSkills(intent: string, limit?: number): Promise<ScoredSkill[]> {
    return this.registry.matchSkills(intent, limit);
  }

  public list(filter?: { origin?: SkillOrigin; tags?: string[] }): SkillManifest[] {
    return this.registry.list(filter);
  }

  public get(skillId: string): SkillManifest | null {
    return this.registry.get(skillId);
  }

  public getStats(skillId: string): SkillStats {
    return this.registry.getStats(skillId);
  }

  public async loadFromDirectory(dirPath: string): Promise<number> {
    return this.registry.loadFromDirectory(dirPath);
  }

  /**
   * Refine a skill if failure patterns are detected (§10.6)
   */
  public async refine(skillId: string): Promise<SkillManifest | null> {
    const skill = this.registry.get(skillId);
    if (!skill) return null;

    const stats = this.registry.getStats(skillId);
    if (stats.totalExecutions < 3 || stats.successRate >= 0.85) {
      return null;
    }

    // Optimization: bump version patch and tag as refined
    const refined: SkillManifest = {
      ...skill,
      version: this.bumpPatchVersion(skill.version),
      tags: Array.from(new Set([...skill.tags, 'refined'])),
    };

    await this.registry.register(refined);
    return refined;
  }

  /**
   * Detect recurring multi-step patterns from execution traces (§10.5.1)
   */
  public async detectPatterns(
    recentPlanTraces?: Array<{ steps: string[]; success: boolean; duration: number }>
  ): Promise<PatternCandidate[]> {
    if (!recentPlanTraces || recentPlanTraces.length === 0) {
      return [];
    }

    const minOccurrences = 2;
    const subsequences = new Map<
      string,
      {
        stepSequence: string[];
        occurrences: number;
        successes: number;
        totalDuration: number;
      }
    >();

    for (const trace of recentPlanTraces) {
      const steps = trace.steps;
      for (let len = 2; len <= Math.min(8, steps.length); len++) {
        for (let start = 0; start <= steps.length - len; start++) {
          const subseq = steps.slice(start, start + len);
          const key = subseq.join(' → ');

          if (!subsequences.has(key)) {
            subsequences.set(key, {
              stepSequence: subseq,
              occurrences: 0,
              successes: 0,
              totalDuration: 0,
            });
          }

          const cand = subsequences.get(key)!;
          cand.occurrences++;
          if (trace.success) cand.successes++;
          cand.totalDuration += trace.duration;
        }
      }
    }

    const candidates: PatternCandidate[] = [];
    for (const item of subsequences.values()) {
      const successRate = item.occurrences > 0 ? item.successes / item.occurrences : 0;
      if (item.occurrences >= minOccurrences && successRate >= 0.5) {
        candidates.push({
          stepSequence: item.stepSequence,
          occurrences: item.occurrences,
          successRate,
          averageDuration: item.totalDuration / item.occurrences,
          contextSimilarity: 0.85,
        });
      }
    }

    candidates.sort(
      (a, b) => b.occurrences * b.successRate - a.occurrences * a.successRate
    );
    return candidates;
  }

  /**
   * Synthesize a new SkillManifest from a detected pattern (§10.5)
   */
  public async generateSkill(pattern: PatternCandidate): Promise<SkillManifest> {
    const rawId = `extracted_${ulid().toLowerCase()}`;
    const name = `auto_routine_${pattern.stepSequence.length}_steps`;

    const steps = pattern.stepSequence.map((stepDesc, idx) => {
      const toolMatch = stepDesc.match(/^([a-zA-Z0-9_-]+):?(.*)$/);
      const tool = toolMatch ? toolMatch[1]! : 'shell';
      return {
        id: `step_${idx + 1}`,
        action: {
          type: 'tool_call' as const,
          tool,
          argsTemplate: { command: stepDesc },
        },
        onFailure: 'abort' as const,
      };
    });

    const manifest: SkillManifest = {
      id: rawId,
      name,
      version: '0.1.0',
      description: `Automatically extracted multi-step skill composed of ${pattern.stepSequence.length} actions`,
      triggerPatterns: [`run ${name}`, ...pattern.stepSequence.slice(0, 2)],
      inputs: [
        {
          name: 'target',
          type: 'string',
          description: 'Target parameter',
          required: false,
          default: 'default',
        },
      ],
      outputs: [
        {
          name: 'result',
          type: 'string',
          description: 'Routine outcome',
        },
      ],
      requiredTools: Array.from(new Set(steps.map((s) => s.action.tool))),
      steps,
      origin: 'extracted',
      tags: ['extracted', 'automated'],
    };

    await this.register(manifest);
    return manifest;
  }

  private bumpPatchVersion(version: string): string {
    const parts = version.split('.').map(Number);
    if (parts.length === 3 && !parts.some(isNaN)) {
      return `${parts[0]}.${parts[1]}.${(parts[2] || 0) + 1}`;
    }
    return `${version}.1`;
  }
}
