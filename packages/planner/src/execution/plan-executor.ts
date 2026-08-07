import { IAgentKernel, Task } from '@fuckclaw/kernel';
import { IObservability } from '@fuckclaw/observability';
import { IEventBus } from '@fuckclaw/event-bus';
import { IPersistenceLayer } from '@fuckclaw/persistence';
import {
  TaskPlan,
  PlanExecutionResult,
  PlanReflection,
} from '../types.js';
import { DAGBuilder } from '../decomposition/dag-builder.js';
import { DynamicReplanner } from '../replanning/dynamic-replanner.js';
import { FuckClawError } from '@fuckclaw/core';

export class PlanExecutor {
  constructor(
    private kernel: IAgentKernel,
    private logger: IObservability,
    private eventBus: IEventBus,
    private replanner: DynamicReplanner,
    private persistence?: IPersistenceLayer
  ) {}

  /**
   * Executes a TaskPlan systematically through the Kernel.
   */
  async executePlan(initialPlan: TaskPlan): Promise<PlanExecutionResult> {
    let currentPlan = initialPlan;
    const planStartTime = Date.now();
    const completedStepIds = new Set<string>();
    const stepOutputs: Record<string, unknown> = {};
    const failureHistory: Array<{
      stepId: string;
      reason: string;
      wasRecoverable: boolean;
      resolution: string;
    }> = [];

    this.logger.log({
      level: 'info',
      module: 'planner',
      message: `Beginning execution of TaskPlan ${currentPlan.id} (version ${currentPlan.version}) for goal: "${currentPlan.goal}"`,
      metadata: { planId: currentPlan.id, totalSteps: currentPlan.steps.length },
    });

    this.persistPlanRecord(currentPlan);

    await this.eventBus.emit('plan.started', {
      planId: currentPlan.id,
      goal: currentPlan.goal,
      totalSteps: currentPlan.steps.length,
    });

    while (completedStepIds.size < currentPlan.steps.length) {
      // Find steps ready for execution (all dependencies completed)
      const readySteps = DAGBuilder.getReadySteps(
        currentPlan.steps,
        currentPlan.dependencies,
        completedStepIds
      );

      if (readySteps.length === 0) {
        // No steps ready, but we haven't completed all steps -> deadlock or blocked state
        const remaining = currentPlan.steps.filter((s) => !completedStepIds.has(s.id));
        throw new FuckClawError(
          'FC_PLANNER_EXECUTION_DEADLOCK',
          `Plan execution reached deadlock. ${remaining.length} steps remaining with unresolved dependencies.`
        );
      }

      // Execute ready steps (sequentially or in ready batches)
      for (const step of readySteps) {
        step.state = 'executing';
        this.logger.log({
          level: 'info',
          message: `Executing plan step [${step.index}/${currentPlan.steps.length}]: "${step.description}"`,
          metadata: { stepId: step.id, planId: currentPlan.id },
        });

        await this.eventBus.emit('plan.step.started', {
          planId: currentPlan.id,
          stepId: step.id,
          description: step.description,
        });

        try {
          // Submit subtask to Kernel
          const taskResult: Task = await this.kernel.submitTask({
            description: step.description,
            source: {
              type: 'plan',
              planId: currentPlan.id,
              stepId: step.id,
            },
            priority: 40,
          });

          if (taskResult.state === 'failed' || taskResult.error) {
            throw new Error(taskResult.error?.message || 'Task execution failed in Kernel');
          }

          // Step succeeded
          step.state = 'completed';
          step.result = {
            step: step.index,
            action: 'finish',
            observation: taskResult.output,
            success: true,
          };
          completedStepIds.add(step.id);
          stepOutputs[step.id] = taskResult.output;

          await this.eventBus.emit('plan.step.completed', {
            planId: currentPlan.id,
            stepId: step.id,
            output: taskResult.output,
          });
        } catch (err: any) {
          const errorMessage = err.message || String(err);
          step.state = 'failed';
          step.error = errorMessage;

          this.logger.log({
            level: 'warn',
            message: `Step ${step.id} failed: "${errorMessage}". Triggering dynamic replanning...`,
            metadata: { stepId: step.id, error: errorMessage },
          });

          await this.eventBus.emit('plan.step.failed', {
            planId: currentPlan.id,
            stepId: step.id,
            error: errorMessage,
          });

          // Check if step is optional
          if (step.optional) {
            step.state = 'skipped';
            completedStepIds.add(step.id);
            continue;
          }

          // Trigger Dynamic Replanning
          try {
            const replanned = await this.replanner.replan(
              currentPlan,
              step.id,
              errorMessage
            );

            failureHistory.push({
              stepId: step.id,
              reason: errorMessage,
              wasRecoverable: true,
              resolution: `Replanned to version ${replanned.version}`,
            });

            currentPlan = replanned;

            await this.eventBus.emit('plan.replanned', {
              planId: currentPlan.id,
              newVersion: currentPlan.version,
              totalSteps: currentPlan.steps.length,
            });

            // Break out of current ready batch to evaluate new ready steps in next loop iteration
            break;
          } catch (replanErr: any) {
            failureHistory.push({
              stepId: step.id,
              reason: errorMessage,
              wasRecoverable: false,
              resolution: `Replanning failed: ${replanErr.message || String(replanErr)}`,
            });

            const reflection = this.buildReflection(
              currentPlan,
              'failure',
              planStartTime,
              failureHistory
            );

            await this.eventBus.emit('plan.failed', {
              planId: currentPlan.id,
              error: errorMessage,
            });

            return {
              planId: currentPlan.id,
              success: false,
              version: currentPlan.version,
              completedSteps: completedStepIds.size,
              totalSteps: currentPlan.steps.length,
              output: `Plan failed at step "${step.description}": ${errorMessage}`,
              stepOutputs,
              reflection,
            };
          }
        }
      }
    }

    const durationMs = Date.now() - planStartTime;
    const finalStepOutput = currentPlan.steps[currentPlan.steps.length - 1]?.result?.observation;
    const summaryOutput = typeof finalStepOutput === 'string'
      ? finalStepOutput
      : `Successfully completed all ${currentPlan.steps.length} steps for goal: "${currentPlan.goal}"`;

    const reflection = this.buildReflection(
      currentPlan,
      'success',
      planStartTime,
      failureHistory
    );

    this.logger.log({
      level: 'info',
      message: `TaskPlan ${currentPlan.id} execution completed successfully in ${durationMs}ms (version ${currentPlan.version})`,
    });

    await this.eventBus.emit('plan.completed', {
      planId: currentPlan.id,
      version: currentPlan.version,
      durationMs,
      completedSteps: completedStepIds.size,
    });

    return {
      planId: currentPlan.id,
      success: true,
      version: currentPlan.version,
      completedSteps: completedStepIds.size,
      totalSteps: currentPlan.steps.length,
      output: summaryOutput,
      stepOutputs,
      reflection,
    };
  }

  private persistPlanRecord(plan: TaskPlan, reflection?: PlanReflection) {
    if (!this.persistence) return;
    try {
      this.persistence.execute(
        `INSERT INTO plans (id, goal_id, goal_description, version, strategy, state, reflection_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           version = excluded.version,
           state = excluded.state,
           reflection_json = excluded.reflection_json,
           updated_at = excluded.updated_at`,
        [
          plan.id,
          plan.rootGoal.id,
          plan.goal,
          plan.version,
          plan.strategy,
          plan.steps.every((s) => s.state === 'completed') ? 'completed' : 'active',
          reflection ? JSON.stringify(reflection) : null,
          Date.now(),
          Date.now(),
        ]
      );
    } catch {}
  }

  private buildReflection(
    plan: TaskPlan,
    outcome: 'success' | 'partial_success' | 'failure',
    startTime: number,
    failures: Array<{
      stepId: string;
      reason: string;
      wasRecoverable: boolean;
      resolution: string;
    }>
  ): PlanReflection {
    const timeActual = Date.now() - startTime;
    const timeEstimate = plan.steps.reduce((sum, s) => sum + s.estimate.durationMs, 0);
    const tokenEstimate = plan.steps.reduce((sum, s) => sum + s.estimate.tokens, 0);

    return {
      planId: plan.id,
      outcome,
      estimateAccuracy: {
        tokenEstimate,
        tokenActual: plan.estimatedBudget.consumed.tokens,
        timeEstimate,
        timeActual,
        stepCountEstimate: plan.steps.length,
        stepCountActual: plan.steps.length,
      },
      failures,
      unnecessarySteps: [],
      lessonsLearned: failures.length > 0
        ? [`Encountered ${failures.length} recoverable failure(s) during execution that required dynamic replanning.`]
        : ['All planned steps executed cleanly according to DAG dependencies.'],
      completedAt: Date.now(),
    };
  }
}
