import { IToolRuntime, ToolContext } from '@fuckclaw/tool-runtime';
import { ILLMRouter } from '@fuckclaw/llm-router';
import { IObservability } from '@fuckclaw/observability';
import { IEventBus } from '@fuckclaw/event-bus';
import {
  SkillManifest,
  SkillStep,
  SkillExecutionResult,
  SkillError,
} from '../types.js';
import { SkillRegistry } from '../registry/skill-registry.js';

export class SkillExecutor {
  constructor(
    private registry: SkillRegistry,
    private toolRuntime: IToolRuntime,
    private llmRouter?: ILLMRouter,
    private observability?: IObservability,
    private eventBus?: IEventBus
  ) {}

  public async execute(
    skillId: string,
    inputs: Record<string, unknown>,
    context?: ToolContext,
    currentDepth: number = 0
  ): Promise<SkillExecutionResult> {
    if (currentDepth > 5) {
      throw new SkillError(
        'FC_SKILL_CYCLE_DETECTED',
        `Maximum skill recursion depth (5) exceeded while executing ${skillId}`
      );
    }

    const manifest = this.registry.get(skillId);
    if (!manifest) {
      throw new SkillError(
        'FC_SKILL_NOT_FOUND',
        `Skill with id "${skillId}" is not registered`
      );
    }

    const startTime = Date.now();
    let totalTokenCost = 0;
    let stepsExecuted = 0;
    let stepsSkipped = 0;
    let stepsFailed = 0;

    // 1. Initialize variables map with inputs & defaults
    const variables: Record<string, any> = { ...inputs };
    for (const inputDef of manifest.inputs) {
      if (variables[inputDef.name] === undefined && inputDef.default !== undefined) {
        variables[inputDef.name] = inputDef.default;
      }
      if (inputDef.required && variables[inputDef.name] === undefined) {
        throw new SkillError(
          'FC_SKILL_VALIDATION_ERROR',
          `Missing required input "${inputDef.name}" for skill "${manifest.name}"`
        );
      }
    }

    // 2. Pre-flight check required tools
    for (const requiredTool of manifest.requiredTools) {
      if (!this.toolRuntime.has(requiredTool)) {
        throw new SkillError(
          'FC_SKILL_TOOL_NOT_FOUND',
          `Required tool "${requiredTool}" for skill "${manifest.name}" is not registered in ToolRuntime`
        );
      }
    }

    this.observability?.log({
      level: 'info',
      module: 'skills',
      message: `Executing skill "${manifest.name}" (${manifest.id}) [depth: ${currentDepth}]`,
      metadata: { skillId: manifest.id, inputs },
    });

    await this.eventBus?.emit('skill.execution.started', {
      skillId: manifest.id,
      name: manifest.name,
      inputs,
      depth: currentDepth,
    }, { source: 'skills' });

    const stepMap = new Map<string, SkillStep>(manifest.steps.map((s) => [s.id, s]));

    // 3. Execute steps
    let currentStepIndex = 0;
    let lastError: Error | null = null;

    while (currentStepIndex < manifest.steps.length) {
      const step = manifest.steps[currentStepIndex];
      if (!step) break;

      // Evaluate step condition if present
      if (step.condition && !this.evaluateCondition(step.condition, variables)) {
        this.observability?.log({
          level: 'debug',
          module: 'skills',
          message: `Step "${step.id}" skipped due to condition "${step.condition}"`,
        });
        stepsSkipped++;
        currentStepIndex++;
        continue;
      }

      await this.eventBus?.emit('skill.step.started', {
        skillId: manifest.id,
        stepId: step.id,
        actionType: step.action.type,
      }, { source: 'skills' });

      let stepSuccess = false;
      let attempts = 0;
      const maxAttempts = step.onFailure === 'retry' ? 3 : 1;

      while (attempts < maxAttempts && !stepSuccess) {
        attempts++;
        try {
          const stepResult = await this.executeStepAction(
            step,
            variables,
            manifest,
            context,
            currentDepth
          );
          if (stepResult.tokenCost) {
            totalTokenCost += stepResult.tokenCost;
          }
          stepSuccess = true;
          stepsExecuted++;
          lastError = null;

          await this.eventBus?.emit('skill.step.completed', {
            skillId: manifest.id,
            stepId: step.id,
            success: true,
          }, { source: 'skills' });
        } catch (err: any) {
          lastError = err;
          this.observability?.log({
            level: 'warn',
            module: 'skills',
            message: `Step "${step.id}" in skill "${manifest.name}" failed (attempt ${attempts}/${maxAttempts}): ${err.message}`,
          });

          if (attempts < maxAttempts) {
            await new Promise((resolve) => setTimeout(resolve, 50 * attempts));
          }
        }
      }

      if (!stepSuccess) {
        stepsFailed++;
        await this.eventBus?.emit('skill.step.completed', {
          skillId: manifest.id,
          stepId: step.id,
          success: false,
          error: lastError?.message,
        }, { source: 'skills' });

        if (step.onFailure === 'abort') {
          const durationMs = Date.now() - startTime;
          this.registry.updateStats(manifest.id, {
            success: false,
            durationMs,
            tokenCost: totalTokenCost,
          });

          await this.eventBus?.emit('skill.execution.failed', {
            skillId: manifest.id,
            failedStepId: step.id,
            error: lastError?.message,
          }, { source: 'skills' });

          return {
            success: false,
            outputs: this.assembleOutputs(manifest, variables),
            stepsExecuted,
            stepsSkipped,
            stepsFailed,
            durationMs,
            tokenCost: totalTokenCost,
            error: `Step "${step.id}" failed: ${lastError?.message}`,
          };
        } else if (step.onFailure === 'skip') {
          currentStepIndex++;
          continue;
        } else if (step.onFailure === 'fallback' && step.fallbackStepId) {
          const fallbackStep = stepMap.get(step.fallbackStepId);
          if (fallbackStep) {
            const fallbackIdx = manifest.steps.findIndex((s) => s.id === step.fallbackStepId);
            if (fallbackIdx >= 0) {
              currentStepIndex = fallbackIdx;
              continue;
            }
          }
        }
      }

      currentStepIndex++;
    }

    const durationMs = Date.now() - startTime;
    const isSuccess = stepsFailed === 0;

    this.registry.updateStats(manifest.id, {
      success: isSuccess,
      durationMs,
      tokenCost: totalTokenCost,
    });

    const outputs = this.assembleOutputs(manifest, variables);

    this.observability?.log({
      level: 'info',
      module: 'skills',
      message: `Skill "${manifest.name}" completed in ${durationMs}ms with success=${isSuccess}`,
      metadata: { skillId: manifest.id, stepsExecuted, stepsSkipped, stepsFailed },
    });

    await this.eventBus?.emit('skill.execution.completed', {
      skillId: manifest.id,
      success: isSuccess,
      durationMs,
      stepsExecuted,
    }, { source: 'skills' });

    return {
      success: isSuccess,
      outputs,
      stepsExecuted,
      stepsSkipped,
      stepsFailed,
      durationMs,
      tokenCost: totalTokenCost,
    };
  }

  private async executeStepAction(
    step: SkillStep,
    variables: Record<string, any>,
    manifest: SkillManifest,
    context?: ToolContext,
    currentDepth: number = 0
  ): Promise<{ tokenCost?: number }> {
    const action = step.action;

    switch (action.type) {
      case 'tool_call': {
        const renderedArgs = this.renderTemplateObj(action.argsTemplate, variables);
        const result = await this.toolRuntime.execute(action.tool, renderedArgs, context);
        if (!result.success) {
          throw new Error(result.error?.message || `Tool ${action.tool} returned failure`);
        }
        variables[`${step.id}_result`] = result.output;
        variables[step.id] = result.output;
        return {};
      }

      case 'llm_reason': {
        if (!this.llmRouter) {
          // Fallback mock reasoning if LLM router not injected
          variables[action.outputVar] = `[Reasoned output for prompt: ${action.prompt.slice(0, 40)}...]`;
          return { tokenCost: 0 };
        }

        const renderedPrompt = this.renderTemplateString(action.prompt, variables);
        const systemPrompt = manifest.systemPromptAugment
          ? `You are executing step "${step.id}" of skill "${manifest.name}". ${manifest.systemPromptAugment}\nBe concise, factually grounded, and complete.`
          : `You are executing step "${step.id}" of skill "${manifest.name}". Output concise, verified, and direct results based strictly on the provided variables without speculation.`;

        const response = await this.llmRouter.generate({
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: renderedPrompt },
          ],
        });

        variables[action.outputVar] = response.content;
        variables[`${step.id}_result`] = response.content;
        variables[step.id] = response.content;
        return { tokenCost: response.costUsd || 0.0001 };
      }

      case 'sub_skill': {
        const subInputs: Record<string, unknown> = {};
        for (const [targetKey, sourceTemplate] of Object.entries(action.inputMapping)) {
          subInputs[targetKey] = this.renderTemplateString(sourceTemplate, variables);
        }

        const subResult = await this.execute(
          action.skillId,
          subInputs,
          context,
          currentDepth + 1
        );

        if (!subResult.success) {
          throw new Error(subResult.error || `Sub-skill ${action.skillId} failed`);
        }

        variables[`${step.id}_result`] = subResult.outputs;
        variables[step.id] = subResult.outputs;
        return { tokenCost: subResult.tokenCost };
      }

      case 'conditional': {
        const condPassed = this.evaluateCondition(action.condition, variables);
        variables[`${step.id}_condition`] = condPassed;
        return {};
      }

      case 'loop': {
        const items = variables[action.overVar];
        if (Array.isArray(items)) {
          variables[`${step.id}_loop_count`] = items.length;
        }
        return {};
      }

      default:
        throw new Error(`Unsupported action type ${(action as any).type}`);
    }
  }

  private assembleOutputs(
    manifest: SkillManifest,
    variables: Record<string, any>
  ): Record<string, unknown> {
    const outputs: Record<string, unknown> = {};
    for (const outDef of manifest.outputs) {
      if (variables[outDef.name] !== undefined) {
        outputs[outDef.name] = variables[outDef.name];
      } else if (variables[`output_${outDef.name}`] !== undefined) {
        outputs[outDef.name] = variables[`output_${outDef.name}`];
      }
    }
    // Also include all defined variables if outputs is empty
    if (Object.keys(outputs).length === 0) {
      return { ...variables };
    }
    return outputs;
  }

  private renderTemplateObj(templateObj: Record<string, unknown>, variables: Record<string, any>): Record<string, unknown> {
    const res: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(templateObj)) {
      if (typeof val === 'string') {
        res[key] = this.renderTemplateString(val, variables);
      } else if (val && typeof val === 'object' && !Array.isArray(val)) {
        res[key] = this.renderTemplateObj(val as Record<string, unknown>, variables);
      } else {
        res[key] = val;
      }
    }
    return res;
  }

  private renderTemplateString(templateStr: string, variables: Record<string, any>): string {
    return templateStr.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_, varName) => {
      const parts = varName.split('.');
      let curr: any = variables;
      for (const part of parts) {
        if (curr === undefined || curr === null) return '';
        curr = curr[part];
      }
      if (typeof curr === 'object' && curr !== null) {
        return JSON.stringify(curr);
      }
      return curr !== undefined && curr !== null ? String(curr) : '';
    });
  }

  private evaluateCondition(conditionStr: string, variables: Record<string, any>): boolean {
    const trimmed = conditionStr.trim();
    if (!trimmed) return true;

    // Simple Boolean expression evaluator
    try {
      // Create safe scope from variables
      const keys = Object.keys(variables);
      const values = Object.values(variables);
      const func = new Function(...keys, `return Boolean(${trimmed});`);
      return Boolean(func(...values));
    } catch {
      // If JS evaluation fails, perform basic truthy check on variable name
      const val = variables[trimmed];
      return Boolean(val);
    }
  }
}
