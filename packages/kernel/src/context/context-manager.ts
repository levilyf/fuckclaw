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
    let systemPrompt = `You are FuckClaw, an autonomous personal AI runtime.\nWorkspace Root: ${this.workspace.getRoot()}\nAvailable Tools: ${availableTools.join(', ')}`;

    // Memory recall injection (§4.8, §6.7)
    if (this.memorySystem) {
      const recalledContext = await this.memorySystem.retrieveForContext(task.description, 2000);
      if (recalledContext && recalledContext.trim().length > 0) {
        systemPrompt += `\n\n--- RECALLED MEMORY CONTEXT ---\n${recalledContext}\n--- END MEMORY CONTEXT ---`;
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
