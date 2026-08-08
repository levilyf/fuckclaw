import { IObservability } from '@fuckclaw/observability';
import { IEventBus } from '@fuckclaw/event-bus';
import { IToolRuntime } from '@fuckclaw/tool-runtime';
import { LLMRouter, ChatMessage } from '@fuckclaw/llm-router';
import { Task, ContextBundle, StepResult } from '@fuckclaw/kernel';
import { ToolCallParser } from '../parsers/tool-call-parser.js';

export class ReActLoop {
  constructor(
    private logger: IObservability,
    private eventBus: IEventBus,
    private toolRuntime: IToolRuntime,
    private llmRouter: LLMRouter,
    private maxSteps: number = 10
  ) {}

  async execute(
    task: Task,
    context: ContextBundle
  ): Promise<{ output: string; steps: StepResult[] }> {
    const steps: StepResult[] = [];
    const conversation: ChatMessage[] = [
      { role: 'system', content: this.buildSystemPrompt(context) },
      ...context.history,
    ];

    let currentStep = 0;
    let toolCalls = 0;
    const startedAt = Date.now();
    const requiresTool = this.taskRequiresTool(task.description);

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
      this.assertBudget(task, startedAt);
      const response = await this.llmRouter.generate({
        messages: conversation,
      });
      task.budget.consumed.llmCalls++;
      task.budget.consumed.tokens += response.usage.totalTokens;
      task.budget.consumed.duration = Date.now() - startedAt;

      // 2. Parse LLM intent
      const parsed = ToolCallParser.parse(response.content);

      if (parsed.type === 'finish') {
        if (requiresTool && toolCalls === 0) {
          conversation.push({ role: 'assistant', content: response.content });
          conversation.push({
            role: 'user',
            content: 'CRITICAL: The task explicitly requires filesystem or shell execution. You emitted Final Answer without invoking any tools. Do not simulate or claim actions without real execution. Respond with a valid Action and Action Input now.',
          });
          if (currentStep === this.maxSteps) {
            throw new Error('Reasoning loop did not invoke a tool for a task that requires filesystem or shell execution');
          }
          continue;
        }

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
        if (task.budget.consumed.toolCalls >= task.budget.maxToolCalls) {
          throw new Error('Task exceeded its tool call budget');
        }
        this.logger.log({
          level: 'info',
          module: 'reasoning',
          message: `Reasoning step ${currentStep}: executing tool "${parsed.toolName}"`,
          metadata: { args: parsed.toolArgs },
        });

        // 3. Execute Tool
        const toolResult = await this.toolRuntime.execute(
          parsed.toolName,
          parsed.toolArgs
        );
        toolCalls++;
        task.budget.consumed.toolCalls++;
        task.budget.consumed.duration = Date.now() - startedAt;

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
    if (requiresTool && toolCalls === 0) {
      throw new Error('Reasoning loop did not invoke a tool for a task that requires filesystem or shell execution');
    }

    return {
      output: `Reasoning loop concluded after maximum bounded steps (${this.maxSteps})`,
      steps,
    };
  }

  private buildSystemPrompt(context: ContextBundle): string {
    return `${context.systemPrompt}

ReAct Execution Protocol:
- Available tools: ${context.availableTools.join(', ')}.
- To execute a tool, emit EXACTLY this format:
Thought: <concise analysis of current state, objective, and rationale for the next action>
Action: <exact tool name from available tools>
Action Input: <valid, well-formed JSON object matching the tool's schema>

- After receiving an Observation:
  1. Inspect the tool output carefully. If the tool returned an ERROR or unexpected output, diagnose the failure, explain your hypothesis in your next Thought, and try a corrected or alternative approach. Do not repeat the exact same failing action unchanged.
  2. If the tool succeeded, evaluate whether the objective is fully satisfied or if further steps (such as verifying file content or running checks) are required.

- When and ONLY when the task is fully achieved and verified (or for pure informational queries that require no tool actions):
Thought: <concise summary of verified outcomes and completion evidence>
Final Answer: <clear, direct response to the user with the final result>

Strict Execution Rules:
- Never claim an action succeeded unless you have observed successful tool output.
- Never invent imaginary tool names or fake APIs; only use the declared available tools.
- If the task requires filesystem modifications or command execution, you MUST execute the required tool calls before providing Final Answer.
- If the requested information is already available in the Recalled Memory Context or from general knowledge without needing external system modifications, answer directly with Final Answer without invoking tools.`;
  }

  private taskRequiresTool(description: string): boolean {
    const isExplicitFileOrExec =
      /\b(create|write|read|list|delete|run|execute)\b/i.test(description) &&
      /\b(file|workspace|directory|command|shell|script|\.txt|\.json|\.ts|\.js|\.md)\b/i.test(description);

    const isMemoryIntent = /\b(remember|recall|my name|what is my|who am i|favorite)\b/i.test(description);

    return isExplicitFileOrExec && !isMemoryIntent;
  }

  private assertBudget(task: Task, startedAt: number): void {
    const consumed = task.budget.consumed;
    consumed.duration = Date.now() - startedAt;
    if (consumed.llmCalls >= task.budget.maxLLMCalls) {
      throw new Error('Task exceeded its LLM call budget');
    }
    if (consumed.toolCalls >= task.budget.maxToolCalls) {
      throw new Error('Task exceeded its tool call budget');
    }
    if (consumed.tokens >= task.budget.maxTokens) {
      throw new Error('Task exceeded its token budget');
    }
    if (consumed.duration >= task.budget.maxDuration) {
      throw new Error('Task exceeded its duration budget');
    }
  }
}
