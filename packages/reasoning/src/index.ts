import { IObservability } from '@fuckclaw/observability';
import { IEventBus } from '@fuckclaw/event-bus';
import { ToolRuntime } from '@fuckclaw/tool-runtime';
import { LLMRouter, ChatMessage } from '@fuckclaw/llm-router';
import {
  Task,
  ContextBundle,
  StepResult,
  IReasoningEngineRunner,
} from '@fuckclaw/kernel';

export interface ParsedAction {
  type: 'tool' | 'finish';
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  finalResponse?: string;
  thought?: string;
}

export class ToolCallParser {
  /**
   * Parses structured action blocks or JSON from LLM output.
   * Format supported:
   * Thought: <thought>
   * Action: <tool_name>
   * Action Input: <json_arguments>
   * OR
   * Final Answer: <response>
   * OR
   * JSON block ```json { "tool": "...", "args": { ... }, "thought": "..." } ```
   */
  static parse(content: string): ParsedAction {
    const trimmed = content.trim();

    // 1. Check for JSON block
    const jsonMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/) || [null, trimmed];
    const candidateJson = jsonMatch[1]?.trim();
    if (candidateJson && (candidateJson.startsWith('{') && candidateJson.endsWith('}'))) {
      try {
        const parsed = JSON.parse(candidateJson);
        if (parsed.tool && parsed.tool !== 'finish') {
          return {
            type: 'tool',
            toolName: parsed.tool,
            toolArgs: parsed.args || {},
            thought: parsed.thought,
          };
        } else if (parsed.final_answer || parsed.answer) {
          return {
            type: 'finish',
            finalResponse: parsed.final_answer || parsed.answer,
            thought: parsed.thought,
          };
        }
      } catch {
        // Fall back to text parsing
      }
    }

    // 2. Check for Classic ReAct format
    const thoughtMatch = trimmed.match(/Thought:\s*(.*?)(?=\nAction:|\nFinal Answer:|$)/s);
    const actionMatch = trimmed.match(/Action:\s*([a-zA-Z0-9_-]+)/);
    const inputMatch = trimmed.match(/Action Input:\s*(\{[\s\S]*\}|"[^"]*"|[^\n]+)/);
    const finalAnswerMatch = trimmed.match(/Final Answer:\s*([\s\S]+)/);

    const thought = thoughtMatch && thoughtMatch[1] ? thoughtMatch[1].trim() : undefined;

    if (finalAnswerMatch && finalAnswerMatch[1]) {
      return {
        type: 'finish',
        finalResponse: finalAnswerMatch[1].trim(),
        thought,
      };
    }

    if (actionMatch && actionMatch[1]) {
      const toolName = actionMatch[1].trim();
      let toolArgs: Record<string, unknown> = {};
      if (inputMatch && inputMatch[1]) {
        try {
          toolArgs = JSON.parse(inputMatch[1].trim());
        } catch {
          toolArgs = { input: inputMatch[1].trim() };
        }
      }
      return {
        type: 'tool',
        toolName,
        toolArgs,
        thought,
      };
    }

    // Default: treat plain text response as final answer
    return {
      type: 'finish',
      finalResponse: trimmed,
      thought: 'Direct response generated',
    };
  }
}

export class ReasoningEngine implements IReasoningEngineRunner {
  private readonly maxSteps: number = 10;

  constructor(
    private logger: IObservability,
    private eventBus: IEventBus,
    private toolRuntime: ToolRuntime,
    private llmRouter: LLMRouter
  ) {}

  async runTask(
    task: Task,
    context: ContextBundle
  ): Promise<{ output: string; steps: StepResult[] }> {
    const steps: StepResult[] = [];
    const conversation: ChatMessage[] = [
      { role: 'system', content: context.systemPrompt },
      ...context.history,
    ];

    let currentStep = 0;

    while (currentStep < this.maxSteps) {
      currentStep++;

      // Check task cancellation
      if (task.cancellation.signal.aborted) {
        throw new Error('Task was cancelled during reasoning loop');
      }

      await this.eventBus.emit('reasoning.step.started', {
        taskId: task.id,
        step: currentStep,
      });

      // 1. Prompt LLM
      const response = await this.llmRouter.generate({
        messages: conversation,
      });

      // 2. Parse LLM intent
      const parsed = ToolCallParser.parse(response.content);

      if (parsed.type === 'finish') {
        const stepRes: StepResult = {
          step: currentStep,
          thought: parsed.thought,
          action: 'finish',
          observation: parsed.finalResponse,
          success: true,
        };
        steps.push(stepRes);

        await this.eventBus.emit('reasoning.step.completed', {
          taskId: task.id,
          step: currentStep,
          action: 'finish',
        });

        return {
          output: parsed.finalResponse || response.content,
          steps,
        };
      }

      if (parsed.type === 'tool' && parsed.toolName) {
        this.logger.log({
          level: 'info',
          message: `Reasoning step ${currentStep}: executing tool "${parsed.toolName}"`,
          metadata: { args: parsed.toolArgs },
        });

        // 3. Execute Tool
        const toolResult = await this.toolRuntime.execute(
          parsed.toolName,
          parsed.toolArgs
        );

        const stepRes: StepResult = {
          step: currentStep,
          thought: parsed.thought,
          action: parsed.toolName,
          observation: toolResult.output || toolResult.error,
          success: toolResult.success,
        };
        steps.push(stepRes);

        // 4. Feed observation back to conversation
        conversation.push({
          role: 'assistant',
          content: `Thought: ${parsed.thought || 'Executing tool'}\nAction: ${parsed.toolName}\nAction Input: ${JSON.stringify(parsed.toolArgs)}`,
        });

        conversation.push({
          role: 'user',
          content: `Observation: ${toolResult.success ? toolResult.output : 'ERROR: ' + toolResult.error}`,
        });

        await this.eventBus.emit('reasoning.step.completed', {
          taskId: task.id,
          step: currentStep,
          action: parsed.toolName,
          success: toolResult.success,
        });
      }
    }

    // Step limit reached
    return {
      output: `Reasoning loop concluded after maximum bounded steps (${this.maxSteps})`,
      steps,
    };
  }
}
