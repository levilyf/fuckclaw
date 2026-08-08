import { LLMRouter } from '@fuckclaw/llm-router';
import { IObservability } from '@fuckclaw/observability';
import { TaskPlan, PlanStep, Dependency, ReplanPolicy } from '../types.js';
import { DAGBuilder } from '../decomposition/dag-builder.js';
import { FuckClawError } from '@fuckclaw/core';
import { ulid } from 'ulidx';

export class DynamicReplanner {
  private readonly defaultPolicy: ReplanPolicy = {
    maxReplans: 3,
    maxReplanTokens: 50000,
    replanCooldownMs: 1000,
    escalateAfterFailures: 2,
  };

  constructor(
    private logger: IObservability,
    private llmRouter?: LLMRouter,
    private policy?: Partial<ReplanPolicy>
  ) {}

  /**
   * Generates a revised TaskPlan when a step fails during execution.
   */
  async replan(
    currentPlan: TaskPlan,
    failedStepId: string,
    errorMessage: string
  ): Promise<TaskPlan> {
    const policy = { ...this.defaultPolicy, ...this.policy };

    if (currentPlan.version >= policy.maxReplans + 1) {
      throw new FuckClawError(
        'FC_PLANNER_MAX_REPLANS_EXCEEDED',
        `Plan ${currentPlan.id} exceeded maximum allowed replans (${policy.maxReplans})`
      );
    }

    const failedStep = currentPlan.steps.find((s) => s.id === failedStepId);
    if (!failedStep) {
      throw new FuckClawError(
        'FC_PLANNER_STEP_NOT_FOUND',
        `Failed step ${failedStepId} not found in plan ${currentPlan.id}`
      );
    }

    this.logger.log({
      level: 'warn',
      message: `Replanning plan ${currentPlan.id} (version ${currentPlan.version}) due to failure in step: "${failedStep.description}"`,
      metadata: { failedStepId, error: errorMessage },
    });

    const completedSteps = currentPlan.steps.filter((s) => s.state === 'completed');
    const remainingSteps = currentPlan.steps.filter(
      (s) => s.id !== failedStepId && s.state !== 'completed'
    );

    let recoverySteps: PlanStep[] = [];
    let updatedDependencies: Dependency[] = [];

    if (this.llmRouter) {
      recoverySteps = await this.generateRecoveryStepsWithLLM(
        currentPlan.goal,
        failedStep,
        errorMessage,
        completedSteps
      );
    } else {
      recoverySteps = this.generateRecoveryStepsHeuristically(failedStep, errorMessage);
    }

    // Build the new step list:
    // [Completed Steps] + [Recovery Fix Steps] + [Retried/Adjusted Failed Step] + [Remaining Steps]
    const newSteps: PlanStep[] = [...completedSteps];
    const newStepIds: string[] = [];

    for (const recStep of recoverySteps) {
      newSteps.push(recStep);
      newStepIds.push(recStep.id);
    }

    // Reset failed step to pending so it runs after recovery
    const retriedFailedStep: PlanStep = {
      ...failedStep,
      state: 'pending',
      error: undefined,
      result: undefined,
    };
    newSteps.push(retriedFailedStep);

    for (const remStep of remainingSteps) {
      newSteps.push({
        ...remStep,
        state: 'pending',
      });
    }

    // Reconstruct dependencies:
    // 1. Keep existing dependencies between already completed steps
    const completedIds = new Set(completedSteps.map((s) => s.id));
    for (const dep of currentPlan.dependencies) {
      if (completedIds.has(dep.from) && completedIds.has(dep.to)) {
        updatedDependencies.push(dep);
      }
    }

    // 2. Recovery steps depend on whatever the failed step depended on
    const failedPrereqs = currentPlan.dependencies
      .filter((d) => d.to === failedStepId)
      .map((d) => d.from);

    if (recoverySteps.length > 0) {
      for (const pId of failedPrereqs) {
        updatedDependencies.push({ from: pId, to: recoverySteps[0]!.id });
      }

      // Chain recovery steps sequentially if multiple
      for (let i = 1; i < recoverySteps.length; i++) {
        updatedDependencies.push({
          from: recoverySteps[i - 1]!.id,
          to: recoverySteps[i]!.id,
        });
      }

      // Retried failed step depends on the last recovery step
      updatedDependencies.push({
        from: recoverySteps[recoverySteps.length - 1]!.id,
        to: retriedFailedStep.id,
      });
    } else {
      for (const pId of failedPrereqs) {
        updatedDependencies.push({ from: pId, to: retriedFailedStep.id });
      }
    }

    // 3. Downstream steps that depended on the failed step now depend on the retried failed step
    const downstreamDeps = currentPlan.dependencies.filter((d) => d.from === failedStepId);
    for (const d of downstreamDeps) {
      updatedDependencies.push({
        from: retriedFailedStep.id,
        to: d.to,
      });
    }

    // 4. Preserve existing dependencies between downstream steps
    for (const dep of currentPlan.dependencies) {
      if (dep.from !== failedStepId && dep.to !== failedStepId) {
        if (!completedIds.has(dep.to)) {
          // Verify both endpoints exist in newSteps
          const hasFrom = newSteps.some((s) => s.id === dep.from);
          const hasTo = newSteps.some((s) => s.id === dep.to);
          if (hasFrom && hasTo) {
            updatedDependencies.push(dep);
          }
        }
      }
    }

    // Validate DAG acyclicity and sort
    const validatedSteps = DAGBuilder.topologicalSort(newSteps, updatedDependencies);

    const replanned: TaskPlan = {
      ...currentPlan,
      version: currentPlan.version + 1,
      steps: validatedSteps,
      dependencies: updatedDependencies,
      replannedAt: Date.now(),
      rationale: `Replanned version ${currentPlan.version + 1} after failure in step ${failedStep.index}: "${errorMessage}"`,
    };

    this.logger.log({
      level: 'info',
      message: `Plan ${replanned.id} successfully replanned to version ${replanned.version} with ${replanned.steps.length} steps`,
    });

    return replanned;
  }

  private async generateRecoveryStepsWithLLM(
    goal: string,
    failedStep: PlanStep,
    errorMessage: string,
    completedSteps: PlanStep[]
  ): Promise<PlanStep[]> {
    const prompt = `You are the FuckClaw Dynamic Replanner.
An execution step in an active task plan has failed. Formulate 1 or 2 concrete, targeted remediation steps to diagnose and eliminate the root cause of the failure so the goal can proceed to completion.

High-Level Goal: "${goal}"
Completed Steps (Verified):
${completedSteps.map((s) => `- Step ${s.index}: ${s.description} [COMPLETED]`).join('\n') || 'None'}

Failed Step:
- Step Index: ${failedStep.index}
- Description: "${failedStep.description}"
- Failure Observation / Error: "${errorMessage}"

Replanning Directives:
1. ROOT-CAUSE REMEDIATION: Address the specific failure mechanism (e.g., missing directory or file, compile/test failure, incorrect arguments, broken syntax).
2. CONCRETE ACTIONS: Describe exact remedial tasks (e.g., "Diagnose error and fix broken syntax in <file>", "Create missing parent directory and reset permissions", "Inspect diagnostic logs and adjust configuration").
3. PERSISTENT RESOLUTION: Do not propose steps that surrender or skip essential work. Ensure the remediation creates the necessary conditions for the retried step to succeed.
4. BOUNDED SCOPE: Produce only 1 or 2 atomic recovery steps directly necessary to restore viability before the failed step is retried.

Output Format:
Respond STRICTLY with a JSON object in this format:
\`\`\`json
{
  "recoverySteps": [
    {
      "description": "Specific diagnostic and remedial action to resolve the failure"
    }
  ]
}
\`\`\``;

    try {
      const response = await this.llmRouter!.generate({
        messages: [{ role: 'user', content: prompt }],
      });
      const match = response.content.match(/```(?:json)?\s*([\s\S]*?)\s*```/) || [null, response.content];
      const parsed = JSON.parse(match[1]?.trim() || response.content.trim());
      if (Array.isArray(parsed.recoverySteps) && parsed.recoverySteps.length > 0) {
        return parsed.recoverySteps.map((rs: { description: string }, idx: number) => ({
          id: ulid(),
          index: failedStep.index,
          goalId: failedStep.goalId,
          description: `[Recovery ${idx + 1}] ${rs.description}`,
          type: { kind: 'subtask' },
          inputs: [],
          outputs: [{ name: 'recovery_result', type: 'string' }],
          estimate: { tokens: 1000, durationMs: 10000, cost: 0.01 },
          state: 'pending',
          retryPolicy: { maxRetries: 1, backoffMs: 1000, exponential: false },
          optional: false,
          checkpoint: true,
        }));
      }
    } catch {
      this.logger.log({
        level: 'warn',
        message: 'LLM replanning generation failed; using heuristic recovery step',
      });
    }

    return this.generateRecoveryStepsHeuristically(failedStep, errorMessage);
  }

  private generateRecoveryStepsHeuristically(
    failedStep: PlanStep,
    errorMessage: string
  ): PlanStep[] {
    return [
      {
        id: ulid(),
        index: failedStep.index,
        goalId: failedStep.goalId,
        description: `Diagnose and remediate error: "${errorMessage}" for step "${failedStep.description}"`,
        type: { kind: 'subtask' },
        inputs: [],
        outputs: [{ name: 'remediation_result', type: 'string' }],
        estimate: { tokens: 1000, durationMs: 10000, cost: 0.01 },
        state: 'pending',
        retryPolicy: { maxRetries: 1, backoffMs: 1000, exponential: false },
        optional: false,
        checkpoint: true,
      },
    ];
  }
}
