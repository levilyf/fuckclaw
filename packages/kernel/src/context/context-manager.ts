import { IWorkspaceManager } from '@fuckclaw/workspace';
import { IToolRuntime } from '@fuckclaw/tool-runtime';
import { IMemorySystem } from '@fuckclaw/memory';
import { Task, ContextBundle } from '../types.js';

export class ContextManager {
  constructor(
    private workspace: IWorkspaceManager,
    private toolRuntime: IToolRuntime,
    private memorySystem?: IMemorySystem
  ) {}

  async buildContext(task: Task): Promise<ContextBundle> {
    const availableTools = this.toolRuntime.list().map((t) => t.name);
    let systemPrompt = [
      `You are FuckClaw, a sovereign, high-agency autonomous AI operating system runtime.`,
      `Workspace Root: ${this.workspace.getRoot()}`,
      `Available Tools: ${availableTools.join(', ')}`,
      ``,
      `Core Operational Directives:`,
      `1. TASK COMMITMENT: Complete the user's objective fully and reliably. Do not surrender early or settle for superficial answers when concrete execution is requested.`,
      `2. REAL RUNTIME EXECUTION: Use the real runtime tools (filesystem, shell, etc.) to perform actions in the workspace. Never simulate, pretend, or hallucinate tool execution.`,
      `3. EVIDENCE-BASED VERIFICATION: Verify all state changes (e.g., file creation, command exit status, test runs) through tool inspection before declaring success. Never claim completion without proof.`,
      `4. PERSISTENCE & RESILIENCE: If a tool or command fails, analyze the exact error output, diagnose the root cause, adjust parameters or strategy, and retry through valid alternative paths. Only declare a blocker if all viable execution paths are exhausted.`,
      `5. NO INVENTED MECHANISMS: Do not fabricate nonexistent tool names, imaginary APIs, or artificial confirmation gates. Adhere strictly to the real available tools and workspace environment.`,
    ].join('\n');

    // Memory recall injection (§4.8, §6.7)
    if (this.memorySystem) {
      const recalledContext = await this.memorySystem.retrieveForContext(task.description, 2000);
      if (recalledContext && recalledContext.trim().length > 0) {
        systemPrompt += `\n\n--- RECALLED MEMORY CONTEXT ---\n${recalledContext}\nGround your understanding in these verified historical facts and experiences where relevant.\n--- END MEMORY CONTEXT ---`;
      }
    }

    return {
      taskId: task.id,
      description: task.description,
      systemPrompt,
      history: [{ role: 'user', content: task.description }],
      availableTools,
    };
  }
}
