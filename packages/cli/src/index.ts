import { ConfigManager } from '@fuckclaw/config';
import { Logger } from '@fuckclaw/observability';
import { PersistenceLayer } from '@fuckclaw/persistence';
import { EventBus } from '@fuckclaw/event-bus';
import { WorkspaceManager } from '@fuckclaw/workspace';
import { ToolRuntime, ShellTool, FilesystemTool } from '@fuckclaw/tool-runtime';
import { LLMRouter, MockLLMProvider } from '@fuckclaw/llm-router';
import { AgentKernel, Task } from '@fuckclaw/kernel';
import { ReasoningEngine } from '@fuckclaw/reasoning';

export interface FuckClawRuntimeInstance {
  kernel: AgentKernel;
  shutdown: () => Promise<void>;
}

export async function createFuckClawRuntime(
  customConfig: Record<string, unknown> = {},
  customLLMProvider?: any
): Promise<FuckClawRuntimeInstance> {
  const config = new ConfigManager(customConfig);
  const logger = new Logger(config);
  const persistence = new PersistenceLayer(':memory:', logger);
  const eventBus = new EventBus(persistence, logger);
  const workspace = new WorkspaceManager(config, logger);

  const toolRuntime = new ToolRuntime(logger, eventBus);
  toolRuntime.register(new ShellTool());
  toolRuntime.register(new FilesystemTool(workspace));

  const llmRouter = new LLMRouter(logger, eventBus);
  if (customLLMProvider) {
    llmRouter.registerProvider(customLLMProvider);
  } else {
    // Default dynamic mock provider that produces a final answer
    llmRouter.registerProvider(new MockLLMProvider('default', 'Final Answer: Task completed successfully.'));
  }

  const kernel = new AgentKernel(
    config,
    logger,
    persistence,
    eventBus,
    workspace,
    toolRuntime,
    llmRouter
  );

  const reasoningEngine = new ReasoningEngine(logger, eventBus, toolRuntime, llmRouter);
  kernel.setReasoningEngine(reasoningEngine);

  await kernel.boot();

  return {
    kernel,
    shutdown: async () => {
      await kernel.shutdown();
      persistence.close();
    },
  };
}

export async function runTaskCLI(prompt: string): Promise<Task> {
  const runtime = await createFuckClawRuntime();
  try {
    const task = await runtime.kernel.submitTask({ description: prompt });
    return task;
  } finally {
    await runtime.shutdown();
  }
}
