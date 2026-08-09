import { IObservability } from '@fuckclaw/observability';
import { LLMRouter } from '@fuckclaw/llm-router';
import { AntiPatternRecord, ReasoningTrace } from '../types.js';
import { AntiPatternStore } from './anti-pattern-store.js';

export class FailureAnalyzer {
  constructor(
    private store: AntiPatternStore,
    private logger: IObservability,
    private llmRouter?: LLMRouter
  ) {}

  public async analyzeTrace(trace: ReasoningTrace): Promise<AntiPatternRecord | null> {
    if (trace.success) {
      return null;
    }

    this.logger.log({
      level: 'info',
      module: 'self-improvement',
      message: `Analyzing failure trace for task ${trace.taskId}: "${trace.goal}"`,
      metadata: { taskId: trace.taskId, error: trace.error?.message },
    });

    const failedStep = trace.steps.find((s) => !s.success) || trace.steps[trace.steps.length - 1];
    const errorMessage = trace.error?.message || failedStep?.observation || 'Unknown execution failure';

    let context = trace.goal;
    let mistake = failedStep?.action || 'Execution failed';
    let consequence = errorMessage;
    let correctiveAction = 'Diagnose prerequisites, verify environment, and validate parameters before retrying.';

    if (this.llmRouter) {
      try {
        const prompt = [
          `You are the Failure Analysis engine of FuckClaw AI Self-Improvement (§23.3.2).`,
          `Analyze the following failed task execution trace and extract a structured Anti-Pattern record.`,
          ``,
          `Task Goal: ${trace.goal}`,
          `Error: ${errorMessage}`,
          `Failed Step Action: ${failedStep?.action || 'N/A'}`,
          `Failed Step Observation: ${failedStep?.observation || 'N/A'}`,
          ``,
          `Output ONLY a valid JSON object matching this exact schema:`,
          `{`,
          `  "context": "<concise description of the problem context/domain>",`,
          `  "mistake": "<specific improper action or faulty assumption made>",`,
          `  "consequence": "<what went wrong as a result>",`,
          `  "correctiveAction": "<concrete, actionable instruction to prevent this failure in future tasks>"`,
          `}`,
        ].join('\n');

        const response = await this.llmRouter.generate({
          messages: [{ role: 'user', content: prompt }],
          taskId: trace.taskId,
          maxTokens: 500,
        });

        const jsonMatch = response.content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          if (parsed.context && parsed.mistake && parsed.consequence && parsed.correctiveAction) {
            context = parsed.context;
            mistake = parsed.mistake;
            consequence = parsed.consequence;
            correctiveAction = parsed.correctiveAction;
          }
        }
      } catch (err: any) {
        this.logger.log({
          level: 'warn',
          module: 'self-improvement',
          message: `LLM-driven failure analysis fell back to heuristic: ${err.message}`,
        });
      }
    }

    return this.store.record({
      context,
      mistake,
      consequence,
      correctiveAction,
      confidence: 1.0,
      occurrences: 1,
      sourceTaskId: trace.taskId,
    });
  }
}
