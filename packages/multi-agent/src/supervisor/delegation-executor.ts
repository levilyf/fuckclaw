import { IObservability } from '@fuckclaw/observability';
import { IEventBus } from '@fuckclaw/event-bus';
import { IToolRuntime, ToolDefinition, ToolResult } from '@fuckclaw/tool-runtime';
import { LLMRouter } from '@fuckclaw/llm-router';
import { IMemorySystem } from '@fuckclaw/memory';
import { IWorkspaceManager } from '@fuckclaw/workspace';
import { IPersistenceLayer } from '@fuckclaw/persistence';
import { FuckClawError } from '@fuckclaw/core';
import { AgentDelegation, AgentResult, AgentInstance } from '../types.js';

class ScopedToolRuntime implements IToolRuntime {
  constructor(
    private underlying: IToolRuntime,
    private allowedTools: string[] | 'all'
  ) {}

  register(tool: any): void {
    this.underlying.register(tool);
  }

  unregister(name: string): boolean {
    return this.underlying.unregister(name);
  }

  has(name: string): boolean {
    if (this.allowedTools !== 'all' && !this.allowedTools.includes(name)) {
      return false;
    }
    return this.underlying.has(name);
  }

  get(name: string): any {
    if (this.allowedTools !== 'all' && !this.allowedTools.includes(name)) {
      return undefined;
    }
    return this.underlying.get(name);
  }

  list(): ToolDefinition[] {
    const all = this.underlying.list();
    if (this.allowedTools === 'all') {
      return all;
    }
    return all.filter((t) => this.allowedTools.includes(t.name));
  }

  async execute(name: string, args: Record<string, unknown>, context?: any): Promise<ToolResult> {
    if (this.allowedTools !== 'all' && !this.allowedTools.includes(name)) {
      throw new FuckClawError(
        'FC_TOOL_ACCESS_DENIED',
        `Agent is not permitted to access tool "${name}". Allowed tools: ${this.allowedTools.join(', ')}`
      );
    }
    return this.underlying.execute(name, args, context);
  }
}

export class DelegationExecutor {
  constructor(
    private logger: IObservability,
    private eventBus: IEventBus,
    private toolRuntime: IToolRuntime,
    private llmRouter: LLMRouter,
    private workspace?: IWorkspaceManager,
    private memory?: IMemorySystem,
    private persistence?: IPersistenceLayer
  ) {}

  public async executeDelegation(
    instance: AgentInstance,
    delegation: AgentDelegation
  ): Promise<AgentResult> {
    const startTime = Date.now();
    const spec = instance.spec;

    this.logger.log({
      level: 'info',
      module: 'multi-agent',
      message: `Executing delegation ${delegation.id} with specialized agent "${spec.type}" (${spec.role})`,
      metadata: { delegationId: delegation.id, agentType: spec.type, task: delegation.task },
    });

    await this.eventBus.emit(`agent.${spec.type}.started`, {
      delegationId: delegation.id,
      parentTaskId: delegation.parentTaskId,
      agentType: spec.type,
      task: delegation.task,
    });

    const scopedRuntime = new ScopedToolRuntime(this.toolRuntime, spec.allowedTools);
    const availableToolDefs = scopedRuntime.list();
    const availableToolNames = availableToolDefs.map((t) => t.name);

    // 1. Retrieve specialized memory context (§15.2.1 memoryFocus)
    let memoryContext = '';
    if (this.memory) {
      const promptAugmentation = spec.memoryFocus.retrievalPrompt
        ? `${spec.memoryFocus.retrievalPrompt}: ${delegation.task}`
        : delegation.task;
      const retrieved = await this.memory.retrieveForContext(promptAugmentation, 1500);
      if (retrieved && retrieved.trim().length > 0) {
        memoryContext = `\n\n--- RELEVANT MEMORY CONTEXT (${spec.memoryFocus.priorityTypes.join(', ')}) ---\n${retrieved}\n--- END MEMORY CONTEXT ---`;
      }
    }

    // 2. Assemble focused agent prompt
    const systemPromptParts = [
      spec.systemPrompt,
      ``,
      `Workspace Root: ${this.workspace ? this.workspace.getRoot() : process.cwd()}`,
      `Available Tools for your role: ${availableToolNames.join(', ') || 'None (Reasoning only)'}`,
      memoryContext,
      ``,
      `Operational Directives:`,
      `1. Perform your specialized role diligently with high accuracy.`,
      `2. If tool use is required, emit JSON tool invocations formatted as: \`\`\`tool_call {"tool": "<name>", "args": { ... }} \`\`\``,
      `3. When your specialized work is complete, provide your final synthesized result clearly.`,
    ];

    let fullContext = `Parent Task Context: ${delegation.parentTaskId}\nTask Objective: ${delegation.task}`;
    if (delegation.context.files && delegation.context.files.length > 0) {
      fullContext += `\nRelevant Files: ${delegation.context.files.join(', ')}`;
    }
    if (delegation.context.data) {
      fullContext += `\nAdditional Context Data: ${JSON.stringify(delegation.context.data, null, 2)}`;
    }
    if (delegation.expectedOutput?.description) {
      fullContext += `\nExpected Output Format: ${delegation.expectedOutput.description}`;
    }

    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: systemPromptParts.filter(Boolean).join('\n') },
      { role: 'user', content: fullContext },
    ];

    let totalTokens = 0;
    let totalCost = 0;
    let finalOutput = '';
    const maxSteps = 5;

    for (let step = 1; step <= maxSteps; step++) {
      const response = await this.llmRouter.generate({
        messages,
        taskId: delegation.parentTaskId,
        maxTokens: delegation.budget.maxTokens || spec.maxBudget.maxTokens || 4000,
      });

      totalTokens += response.usage.totalTokens;
      totalCost += response.costUsd || 0;

      const assistantReply = response.content;
      messages.push({ role: 'assistant', content: assistantReply });

      // Emit progress event (§15.4)
      await this.eventBus.emit(`agent.${spec.type}.progress`, {
        delegationId: delegation.id,
        agentType: spec.type,
        step,
        contentPreview: assistantReply.slice(0, 100),
      });

      // Parse tool call if present
      const toolMatch = assistantReply.match(/```(?:tool_call|json)?\s*(\{\s*"tool":[\s\S]*?\})\s*```/i);
      if (toolMatch && toolMatch[1]) {
        try {
          const parsed = JSON.parse(toolMatch[1]);
          const toolName = parsed.tool;
          const toolArgs = parsed.args || {};

          this.logger.log({
            level: 'info',
            module: 'multi-agent',
            message: `Agent "${spec.type}" invoking allowed tool "${toolName}" on step ${step}`,
            metadata: { delegationId: delegation.id, toolName, toolArgs },
          });

          const toolRes = await scopedRuntime.execute(toolName, toolArgs, {
            taskId: delegation.parentTaskId,
            agentType: spec.type,
            delegationId: delegation.id,
          });

          messages.push({
            role: 'user',
            content: `Observation from tool "${toolName}":\n${JSON.stringify(toolRes, null, 2)}\n\nPlease proceed to synthesize your findings or complete the task.`,
          });
          continue;
        } catch (err: any) {
          messages.push({
            role: 'user',
            content: `Tool invocation error: ${err.message || String(err)}. Please adjust your approach or finalize your output.`,
          });
          continue;
        }
      }

      // If no tool calls or completed response, break
      finalOutput = assistantReply;
      break;
    }

    if (!finalOutput) {
      finalOutput = messages[messages.length - 1]?.content || 'Delegation completed with empty response.';
    }

    const durationMs = Date.now() - startTime;
    const result: AgentResult = {
      success: true,
      output: finalOutput,
      tokensUsed: totalTokens,
      costUsd: totalCost,
      durationMs,
    };

    delegation.result = result;
    delegation.state = 'completed';

    // Persist delegation in SQLite if persistence layer is provided (§15.3.2, §20.3)
    if (this.persistence) {
      try {
        this.persistence.execute(
          `INSERT OR REPLACE INTO delegations (id, parent_task_id, agent_type, task, context_json, expected_output_json, budget_json, timeout_ms, state, result_json, created_at, completed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            delegation.id,
            delegation.parentTaskId,
            delegation.agentType,
            delegation.task,
            JSON.stringify(delegation.context),
            delegation.expectedOutput ? JSON.stringify(delegation.expectedOutput) : null,
            JSON.stringify(delegation.budget),
            delegation.timeoutMs,
            delegation.state,
            JSON.stringify(result),
            Date.now() - durationMs,
            Date.now(),
          ]
        );
      } catch (err: any) {
        this.logger.log({
          level: 'warn',
          module: 'multi-agent',
          message: `Failed to persist delegation record in SQLite: ${err.message}`,
        });
      }
    }

    await this.eventBus.emit(`agent.${spec.type}.completed`, {
      delegationId: delegation.id,
      parentTaskId: delegation.parentTaskId,
      agentType: spec.type,
      success: true,
      result,
    });

    this.logger.log({
      level: 'info',
      module: 'multi-agent',
      message: `Agent "${spec.type}" completed delegation ${delegation.id} in ${durationMs}ms`,
      metadata: { delegationId: delegation.id, success: true, tokensUsed: totalTokens, costUsd: totalCost },
    });

    return result;
  }
}
