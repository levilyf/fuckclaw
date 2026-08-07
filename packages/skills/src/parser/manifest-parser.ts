import YAML from 'yaml';
import {
  SkillManifest,
  SkillStep,
  SkillAction,
  SkillInput,
  SkillOutput,
  SkillError,
} from '../types.js';

export class ManifestParser {
  public static parse(yamlContent: string): SkillManifest {
    let raw: unknown;
    try {
      raw = YAML.parse(yamlContent);
    } catch (err: any) {
      throw new SkillError(
        'FC_SKILL_VALIDATION_ERROR',
        `Failed to parse YAML skill manifest: ${err.message}`,
        { error: String(err) }
      );
    }

    if (!raw || typeof raw !== 'object') {
      throw new SkillError(
        'FC_SKILL_VALIDATION_ERROR',
        'Invalid skill manifest: expected root object'
      );
    }

    const obj = raw as Record<string, unknown>;

    // Validate top-level required properties
    if (!obj.id || typeof obj.id !== 'string') {
      throw new SkillError(
        'FC_SKILL_VALIDATION_ERROR',
        'Skill manifest must have a non-empty string "id"'
      );
    }

    if (!obj.name || typeof obj.name !== 'string') {
      throw new SkillError(
        'FC_SKILL_VALIDATION_ERROR',
        'Skill manifest must have a non-empty string "name"'
      );
    }

    const id = obj.id.trim();
    const name = obj.name.trim();
    const version = typeof obj.version === 'string' ? obj.version.trim() : '1.0.0';
    const description = typeof obj.description === 'string' ? obj.description.trim() : '';
    const origin = (obj.origin as any) || 'user_defined';
    const tags = Array.isArray(obj.tags) ? obj.tags.map(String) : [];
    const systemPromptAugment =
      typeof obj.systemPromptAugment === 'string' ? obj.systemPromptAugment : undefined;

    const triggerPatterns = Array.isArray(obj.triggerPatterns)
      ? obj.triggerPatterns.map(String)
      : [];

    const requiredTools = Array.isArray(obj.requiredTools)
      ? obj.requiredTools.map(String)
      : [];

    // Parse inputs
    const inputs: SkillInput[] = [];
    if (Array.isArray(obj.inputs)) {
      for (const inp of obj.inputs) {
        if (inp && typeof inp === 'object' && typeof inp.name === 'string') {
          inputs.push({
            name: inp.name.trim(),
            type: inp.type || 'string',
            description: inp.description || '',
            required: typeof inp.required === 'boolean' ? inp.required : true,
            default: inp.default,
          });
        }
      }
    }

    // Parse outputs
    const outputs: SkillOutput[] = [];
    if (Array.isArray(obj.outputs)) {
      for (const out of obj.outputs) {
        if (out && typeof out === 'object' && typeof out.name === 'string') {
          outputs.push({
            name: out.name.trim(),
            type: out.type || 'string',
            description: out.description || '',
          });
        }
      }
    }

    // Parse steps
    if (!Array.isArray(obj.steps) || obj.steps.length === 0) {
      throw new SkillError(
        'FC_SKILL_VALIDATION_ERROR',
        `Skill manifest ${id} must contain at least one step in "steps"`
      );
    }

    const steps: SkillStep[] = [];
    const stepIds = new Set<string>();

    for (let i = 0; i < obj.steps.length; i++) {
      const stepRaw = obj.steps[i];
      if (!stepRaw || typeof stepRaw !== 'object') {
        throw new SkillError(
          'FC_SKILL_VALIDATION_ERROR',
          `Step [${i}] in skill ${id} is not an object`
        );
      }

      const stepId = stepRaw.id ? String(stepRaw.id).trim() : `step_${i + 1}`;
      if (stepIds.has(stepId)) {
        throw new SkillError(
          'FC_SKILL_VALIDATION_ERROR',
          `Duplicate step id "${stepId}" in skill ${id}`
        );
      }
      stepIds.add(stepId);

      const action = this.parseAction(stepRaw.action, stepId, id);
      const onFailure = stepRaw.onFailure || 'abort';
      const condition = typeof stepRaw.condition === 'string' ? stepRaw.condition : undefined;
      const fallbackStepId =
        typeof stepRaw.fallbackStepId === 'string' ? stepRaw.fallbackStepId : undefined;

      steps.push({
        id: stepId,
        action,
        condition,
        onFailure,
        fallbackStepId,
      });
    }

    return {
      id,
      name,
      version,
      description,
      triggerPatterns,
      inputs,
      outputs,
      requiredTools,
      steps,
      systemPromptAugment,
      origin,
      tags,
    };
  }

  public static stringify(manifest: SkillManifest): string {
    return YAML.stringify(manifest);
  }

  private static parseAction(actionRaw: any, stepId: string, skillId: string): SkillAction {
    if (!actionRaw || typeof actionRaw !== 'object' || !actionRaw.type) {
      throw new SkillError(
        'FC_SKILL_VALIDATION_ERROR',
        `Step "${stepId}" in skill "${skillId}" has invalid or missing "action.type"`
      );
    }

    switch (actionRaw.type) {
      case 'tool_call':
        if (!actionRaw.tool || typeof actionRaw.tool !== 'string') {
          throw new SkillError(
            'FC_SKILL_VALIDATION_ERROR',
            `tool_call action in step "${stepId}" requires "tool" string`
          );
        }
        return {
          type: 'tool_call',
          tool: actionRaw.tool.trim(),
          argsTemplate: actionRaw.argsTemplate || {},
        };

      case 'llm_reason':
        if (!actionRaw.prompt || typeof actionRaw.prompt !== 'string') {
          throw new SkillError(
            'FC_SKILL_VALIDATION_ERROR',
            `llm_reason action in step "${stepId}" requires "prompt" string`
          );
        }
        return {
          type: 'llm_reason',
          prompt: actionRaw.prompt,
          outputVar: actionRaw.outputVar || `output_${stepId}`,
        };

      case 'sub_skill':
        if (!actionRaw.skillId || typeof actionRaw.skillId !== 'string') {
          throw new SkillError(
            'FC_SKILL_VALIDATION_ERROR',
            `sub_skill action in step "${stepId}" requires "skillId" string`
          );
        }
        return {
          type: 'sub_skill',
          skillId: actionRaw.skillId.trim(),
          inputMapping: actionRaw.inputMapping || {},
        };

      case 'conditional':
        if (!actionRaw.condition || typeof actionRaw.condition !== 'string') {
          throw new SkillError(
            'FC_SKILL_VALIDATION_ERROR',
            `conditional action in step "${stepId}" requires "condition" string`
          );
        }
        return {
          type: 'conditional',
          condition: actionRaw.condition,
          thenSteps: Array.isArray(actionRaw.thenSteps) ? actionRaw.thenSteps.map(String) : [],
          elseSteps: Array.isArray(actionRaw.elseSteps) ? actionRaw.elseSteps.map(String) : [],
        };

      case 'loop':
        if (!actionRaw.overVar || typeof actionRaw.overVar !== 'string') {
          throw new SkillError(
            'FC_SKILL_VALIDATION_ERROR',
            `loop action in step "${stepId}" requires "overVar" string`
          );
        }
        return {
          type: 'loop',
          overVar: actionRaw.overVar,
          bodySteps: Array.isArray(actionRaw.bodySteps) ? actionRaw.bodySteps.map(String) : [],
        };

      default:
        throw new SkillError(
          'FC_SKILL_VALIDATION_ERROR',
          `Unknown action type "${actionRaw.type}" in step "${stepId}"`
        );
    }
  }
}
