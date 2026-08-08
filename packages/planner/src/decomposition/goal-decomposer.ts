import { LLMRouter } from '@fuckclaw/llm-router';
import { IObservability } from '@fuckclaw/observability';
import { TaskPlan, PlanStep, Dependency, GoalNode } from '../types.js';
import { DAGBuilder } from './dag-builder.js';
import { ulid } from 'ulidx';

export interface GoalDecompositionOptions {
  strategy?: 'sequential' | 'hierarchical' | 'parallel';
  maxSteps?: number;
}

export class GoalDecomposer {
  constructor(
    private logger: IObservability,
    private llmRouter?: LLMRouter
  ) {}

  /**
   * Decomposes a high-level goal into an executable TaskPlan with a validated DAG.
   */
  async decompose(
    goal: string,
    contextSummary: string = '',
    options: GoalDecompositionOptions = {}
  ): Promise<TaskPlan> {
    const planId = ulid();
    const rootGoalId = ulid();

    this.logger.log({
      level: 'info',
      message: `Decomposing goal: "${goal}"`,
      metadata: { planId },
    });

    let rawPlanData: {
      rationale?: string;
      steps: Array<{
        id?: string;
        description: string;
        dependsOn?: string[] | number[];
        optional?: boolean;
      }>;
    };

    if (this.llmRouter) {
      rawPlanData = await this.decomposeWithLLM(goal, contextSummary, options);
    } else {
      rawPlanData = this.decomposeHeuristically(goal);
    }

    // Convert raw steps into strongly typed PlanStep[]
    const stepIdMap = new Map<string | number, string>();
    const planSteps: PlanStep[] = [];
    const dependencies: Dependency[] = [];

    // Assign canonical ULIDs to all steps
    rawPlanData.steps.forEach((rawStep, idx) => {
      const stepId = rawStep.id && typeof rawStep.id === 'string' && rawStep.id.length > 5 
        ? rawStep.id 
        : ulid();
      stepIdMap.set(idx + 1, stepId);
      stepIdMap.set(String(idx + 1), stepId);
      if (rawStep.id) {
        stepIdMap.set(rawStep.id, stepId);
      }

      planSteps.push({
        id: stepId,
        index: idx + 1,
        goalId: rootGoalId,
        description: rawStep.description,
        type: { kind: 'subtask' },
        inputs: [],
        outputs: [{ name: 'result', type: 'string' }],
        estimate: { tokens: 1000, durationMs: 10000, cost: 0.01 },
        state: 'pending',
        retryPolicy: { maxRetries: 2, backoffMs: 1000, exponential: true },
        optional: !!rawStep.optional,
        checkpoint: true,
      });
    });

    // Build dependency edges
    rawPlanData.steps.forEach((rawStep, idx) => {
      const currentStepId = planSteps[idx]!.id;
      if (rawStep.dependsOn && Array.isArray(rawStep.dependsOn)) {
        for (const depRef of rawStep.dependsOn) {
          const fromStepId = stepIdMap.get(depRef) || stepIdMap.get(String(depRef));
          if (fromStepId && fromStepId !== currentStepId) {
            dependencies.push({
              from: fromStepId,
              to: currentStepId,
            });
          }
        }
      } else if (idx > 0 && options.strategy === 'sequential') {
        // By default in sequential mode, link each step to the previous one
        dependencies.push({
          from: planSteps[idx - 1]!.id,
          to: currentStepId,
        });
      }
    });

    // Validate and topologically sort the DAG
    const sortedSteps = DAGBuilder.topologicalSort(planSteps, dependencies);

    const rootGoal: GoalNode = {
      id: rootGoalId,
      description: goal,
      type: 'achievement',
      criteria: [{ description: 'All steps executed successfully' }],
      children: [],
      decomposition: 'all',
      state: 'pending',
    };

    const taskPlan: TaskPlan = {
      id: planId,
      goal,
      version: 1,
      strategy: options.strategy || 'hierarchical',
      rootGoal,
      steps: sortedSteps,
      dependencies,
      estimatedBudget: {
        maxTokens: sortedSteps.length * 2000,
        maxDuration: sortedSteps.length * 30000,
        maxToolCalls: sortedSteps.length * 5,
        maxLLMCalls: sortedSteps.length * 5,
        maxCost: sortedSteps.length * 0.05,
        consumed: { tokens: 0, duration: 0, toolCalls: 0, llmCalls: 0, cost: 0 },
      },
      confidence: 0.9,
      rationale: rawPlanData.rationale || 'Decomposed into DAG of dependent subtasks',
      createdAt: Date.now(),
    };

    this.logger.log({
      level: 'info',
      message: `Plan ${planId} generated with ${taskPlan.steps.length} steps and ${taskPlan.dependencies.length} dependencies`,
    });

    return taskPlan;
  }

  private async decomposeWithLLM(
    goal: string,
    contextSummary: string,
    _options: GoalDecompositionOptions
  ): Promise<{
    rationale?: string;
    steps: Array<{
      id?: string;
      description: string;
      dependsOn?: string[] | number[];
      optional?: boolean;
    }>;
  }> {
    const prompt = `You are the FuckClaw Deliberate Planner.
Your role is to decompose high-level autonomous goals into a rigorous, verifiable Directed Acyclic Graph (DAG) of executable subtasks.

High-Level Goal: "${goal}"
${contextSummary ? `Operational Context:\n${contextSummary}` : ''}

Planning Principles:
1. COMPLETE LIFECYCLE: Structure the plan to span necessary phases: environment discovery/inspection, concrete execution/implementation, and empirical verification (testing or checking state before finalization).
2. ACTIONABLE & CONCRETE: Every step description must be an unambiguous, actionable directive that an autonomous execution agent can fulfill using filesystem, shell, or reasoning tools.
3. ATOMIC & INDEPENDENT: Decompose into 2 to 6 focused subtasks. Do not combine unrelated actions into a single amorphous step.
4. EXPLICIT DEPENDENCY GRAPH: Clearly specify dependencies using 1-based step indices. Steps that do not depend on previous outputs should be executable as soon as prerequisites complete.
5. MANDATORY VERIFICATION: Include a verification or validation step prior to final delivery to confirm correctness with hard evidence.

Output Format:
Respond STRICTLY with a valid JSON object in the following format (no extraneous text outside the markdown code block):
\`\`\`json
{
  "rationale": "Strategic reasoning behind this decomposition and verification approach",
  "steps": [
    {
      "index": 1,
      "description": "Inspect and analyze relevant files, environment state, and constraints",
      "dependsOn": []
    },
    {
      "index": 2,
      "description": "Implement core changes or execute primary operations",
      "dependsOn": [1]
    },
    {
      "index": 3,
      "description": "Verify implementation via test suite, file inspection, or validation command",
      "dependsOn": [2]
    },
    {
      "index": 4,
      "description": "Finalize artifacts and output completion summary",
      "dependsOn": [3]
    }
  ]
}
\`\`\``;

    const response = await this.llmRouter!.generate({
      messages: [{ role: 'user', content: prompt }],
    });

    try {
      const match = response.content.match(/```(?:json)?\s*([\s\S]*?)\s*```/) || [null, response.content];
      const parsed = JSON.parse(match[1]?.trim() || response.content.trim());
      if (Array.isArray(parsed.steps) && parsed.steps.length > 0) {
        return parsed;
      }
    } catch {
      this.logger.log({
        level: 'warn',
        message: 'Failed to parse LLM plan decomposition JSON; falling back to heuristic decomposition',
      });
    }

    return this.decomposeHeuristically(goal);
  }

  private decomposeHeuristically(goal: string): {
    rationale: string;
    steps: Array<{ description: string; dependsOn?: number[] }>;
  } {
    // Standard 4-step engineering workflow for complex goals
    return {
      rationale: 'Standard 4-phase goal decomposition: Analyze -> Implement -> Verify -> Finalize',
      steps: [
        {
          description: `Analyze prerequisites and context for: ${goal}`,
          dependsOn: [],
        },
        {
          description: `Execute primary implementation for: ${goal}`,
          dependsOn: [1],
        },
        {
          description: `Verify and run test suite for: ${goal}`,
          dependsOn: [2],
        },
        {
          description: `Finalize artifacts and report outcome for: ${goal}`,
          dependsOn: [3],
        },
      ],
    };
  }
}
