import { ConfigManager, GlobalConfig } from '@fuckclaw/config';
import { Logger } from '@fuckclaw/observability';
import { PersistenceLayer } from '@fuckclaw/persistence';
import { EventBus } from '@fuckclaw/event-bus';
import { WorkspaceManager } from '@fuckclaw/workspace';
import { ToolRuntime, ShellTool, FilesystemTool } from '@fuckclaw/tool-runtime';
import { ILLMProvider, LLMRouter, OpenAICompatibleProvider } from '@fuckclaw/llm-router';
import { MemorySystem } from '@fuckclaw/memory';
import { AgentKernel, Task } from '@fuckclaw/kernel';
import { ReasoningEngine } from '@fuckclaw/reasoning';
import { Planner } from '@fuckclaw/planner';
import { Scheduler } from '@fuckclaw/scheduler';
import path from 'node:path';
import os from 'node:os';

export interface FuckClawRuntimeInstance {
  kernel: AgentKernel;
  planner: Planner;
  scheduler: Scheduler;
  shutdown: () => Promise<void>;
}

export async function createFuckClawRuntime(
  customConfig: Partial<GlobalConfig> = {},
  customLLMProvider?: ILLMProvider,
  environment: NodeJS.ProcessEnv = process.env
): Promise<FuckClawRuntimeInstance> {
  const environmentConfig = ConfigManager.fromEnvironment(environment).get();
  const rawRoot = customConfig.workspace?.root ?? environmentConfig.workspace?.root ?? '~/.fuckclaw';
  const resolvedRoot = rawRoot.startsWith('~/')
    ? path.join(os.homedir(), rawRoot.slice(2))
    : path.resolve(rawRoot);
  const persistencePath = rawRoot === ':memory:' ? ':memory:' : path.join(resolvedRoot, 'fuckclaw.db');

  const config = new ConfigManager({
    workspace: customConfig.workspace ?? environmentConfig.workspace,
    logging: customConfig.logging ?? environmentConfig.logging,
    ...(customConfig.llm
      ? { llm: customConfig.llm }
      : environmentConfig.llm
        ? { llm: environmentConfig.llm }
        : {}),
  });
  const logger = new Logger(config);
  const persistence = new PersistenceLayer(persistencePath, logger);
  const eventBus = new EventBus(persistence, logger);
  const workspace = new WorkspaceManager(config, logger);
  const memorySystem = new MemorySystem(persistence, logger, eventBus);

  const toolRuntime = new ToolRuntime(logger, eventBus);
  toolRuntime.register(new ShellTool());
  toolRuntime.register(new FilesystemTool(workspace));

  const llmRouter = new LLMRouter(logger, eventBus);
  if (customLLMProvider) {
    llmRouter.registerProvider(customLLMProvider);
  } else {
    const llm = config.get().llm;
    if (!llm || !llm.baseUrl || !llm.apiKey) {
      persistence.close();
      throw new Error(
        'OpenAI-compatible LLM configuration is required. Set FUCKCLAW_LLM_BASE_URL, FUCKCLAW_LLM_API_KEY, and FUCKCLAW_LLM_MODEL.'
      );
    }
    llmRouter.registerProvider(new OpenAICompatibleProvider({
      baseUrl: llm.baseUrl,
      apiKey: llm.apiKey,
      model: llm.model,
    }));
  }

  const kernel = new AgentKernel(
    config,
    logger,
    persistence,
    eventBus,
    workspace,
    toolRuntime,
    llmRouter,
    memorySystem
  );

  const reasoningEngine = new ReasoningEngine(logger, eventBus, toolRuntime, llmRouter);
  kernel.setReasoningEngine(reasoningEngine);

  const planner = new Planner(kernel, logger, eventBus, llmRouter, persistence);
  const scheduler = new Scheduler(kernel, logger, eventBus, workspace, persistence);

  await kernel.boot();
  await scheduler.start();

  return {
    kernel,
    planner,
    scheduler,
    shutdown: async () => {
      await scheduler.stop();
      await kernel.shutdown();
      persistence.close();
    },
  };
}

export async function runTaskCLI(prompt: string): Promise<Task> {
  const runtime = await createFuckClawRuntime();
  try {
    return await runtime.kernel.submitTask({ description: prompt });
  } finally {
    await runtime.shutdown();
  }
}
