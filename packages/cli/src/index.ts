import { ConfigManager, GlobalConfig, IConfigManager } from '@fuckclaw/config';
import { Logger, IObservability } from '@fuckclaw/observability';
import { PersistenceLayer, IPersistenceLayer } from '@fuckclaw/persistence';
import { EventBus, IEventBus } from '@fuckclaw/event-bus';
import { WorkspaceManager, IWorkspaceManager } from '@fuckclaw/workspace';
import { ToolRuntime, ShellTool, FilesystemTool, HttpTool, PythonTool, GitTool, DockerTool, IToolRuntime } from '@fuckclaw/tool-runtime';
import { ILLMProvider, LLMRouter, OpenAICompatibleProvider } from '@fuckclaw/llm-router';
import { MemorySystem, IMemorySystem } from '@fuckclaw/memory';
import { KnowledgeGraph, IKnowledgeGraph } from '@fuckclaw/knowledge-graph';
import { SkillsEngine, ISkillEngine } from '@fuckclaw/skills';
import { AgentKernel, Task } from '@fuckclaw/kernel';
import { ReasoningEngine } from '@fuckclaw/reasoning';
import { Planner } from '@fuckclaw/planner';
import { Scheduler } from '@fuckclaw/scheduler';
import { MCPManager } from '@fuckclaw/mcp';
import { PluginManager } from '@fuckclaw/plugins';
import { NetworkManager } from '@fuckclaw/network';
import { AgentOrchestrator } from '@fuckclaw/multi-agent';
import { SelfImprovementEngine } from '@fuckclaw/self-improvement';
import path from 'node:path';
import os from 'node:os';

export * from './client/api-client.js';
export * from './client/fuckclaw-client.js';
export * from './tui/App.js';
export * from './tui/banner.js';
export * from './tui/status-bar.js';
export * from './tui/stream-renderer.js';
export * from './tui/app.js';
export * from './tui/components/index.js';
export * from './tui/hooks/index.js';
export * from './commands/ask.command.js';
export * from './commands/run.command.js';
export * from './commands/status.command.js';
export * from './commands/serve.command.js';
export * from './commands/mcp.command.js';
export * from './commands/plugins.command.js';
export * from './commands/config.command.js';

export interface FuckClawRuntimeInstance {
  config: IConfigManager;
  logger: IObservability;
  persistence: IPersistenceLayer;
  eventBus: IEventBus;
  workspace: IWorkspaceManager;
  toolRuntime: IToolRuntime;
  kernel: AgentKernel;
  planner: Planner;
  scheduler: Scheduler;
  memory: IMemorySystem;
  knowledgeGraph: IKnowledgeGraph;
  skillsEngine: ISkillEngine;
  mcpManager: MCPManager;
  pluginManager: PluginManager;
  networkManager: NetworkManager;
  multiAgent: AgentOrchestrator;
  selfImprovement: SelfImprovementEngine;
  shutdown: () => Promise<void>;
}

export interface CreateRuntimeOptions {
  allowUnconfiguredLLM?: boolean;
}

export async function createFuckClawRuntime(
  customConfig: Partial<GlobalConfig> = {},
  customLLMProvider?: ILLMProvider,
  environment: NodeJS.ProcessEnv = process.env,
  options: CreateRuntimeOptions = {}
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

  const toolRuntime = new ToolRuntime(logger, eventBus);
  toolRuntime.register(new ShellTool());
  toolRuntime.register(new FilesystemTool(workspace));
  toolRuntime.register(new HttpTool());
  toolRuntime.register(new PythonTool());
  toolRuntime.register(new GitTool());
  toolRuntime.register(new DockerTool());

  const llmRouter = new LLMRouter(logger, eventBus);
  if (customLLMProvider) {
    llmRouter.registerProvider(customLLMProvider, true);
  } else {
    const llm = config.get().llm;
    if (llm && llm.baseUrl && llm.apiKey) {
      llmRouter.registerProvider(
        new OpenAICompatibleProvider({
          baseUrl: llm.baseUrl,
          apiKey: llm.apiKey,
          model: llm.model,
        }),
        true
      );
    } else if (options.allowUnconfiguredLLM) {
      llmRouter.registerProvider(
        {
          name: 'unconfigured-fallback',
          generate: async () => {
            throw new Error(
              'No LLM provider configured. Please set FUCKCLAW_LLM_BASE_URL, FUCKCLAW_LLM_API_KEY, and FUCKCLAW_LLM_MODEL or update ~/.fuckclaw/config/fuckclaw.toml.'
            );
          },
        },
        true
      );
    } else {
      persistence.close();
      throw new Error(
        'OpenAI-compatible LLM configuration is required. Set FUCKCLAW_LLM_BASE_URL, FUCKCLAW_LLM_API_KEY, and FUCKCLAW_LLM_MODEL.'
      );
    }
  }

  const memorySystem = new MemorySystem(persistence, logger, eventBus);
  const knowledgeGraph = new KnowledgeGraph(persistence, logger, eventBus);

  const skillsEngine = new SkillsEngine(toolRuntime, llmRouter, logger, eventBus);
  await skillsEngine.loadFromDirectory(workspace.getDirectory('skills'));

  const reasoningEngine = new ReasoningEngine(logger, eventBus, toolRuntime, llmRouter);

  const kernel = new AgentKernel(
    config,
    logger,
    persistence,
    eventBus,
    workspace,
    toolRuntime,
    llmRouter,
    memorySystem,
    reasoningEngine
  );

  const planner = new Planner(kernel, logger, eventBus, llmRouter, persistence);
  const scheduler = new Scheduler(kernel, logger, eventBus, workspace, persistence);

  // Multi-Agent & Self-Improvement Subsystems (§15, §23)
  const selfImprovement = new SelfImprovementEngine(
    persistence,
    logger,
    eventBus,
    llmRouter,
    skillsEngine
  );
  kernel.setNegativeConstraintProvider((query) => selfImprovement.getNegativeConstraints(query));

  eventBus.subscribe('kernel.task.completed', async (evt) => {
    try {
      const taskId = String(evt.payload.taskId || '');
      const success = Boolean(evt.payload.success);
      const errorMsg = evt.payload.error ? String(evt.payload.error) : undefined;
      const output = evt.payload.output ? String(evt.payload.output) : '';

      await selfImprovement.processTrace({
        taskId,
        goal: output || taskId,
        success,
        error: errorMsg ? { code: 'EXECUTION_ERROR', message: errorMsg } : undefined,
        steps: [],
      });
    } catch {}
  });

  const multiAgent = new AgentOrchestrator(
    logger,
    eventBus,
    toolRuntime,
    llmRouter,
    workspace,
    memorySystem,
    persistence
  );

  // Milestone 7 Subsystems
  const mcpManager = new MCPManager(toolRuntime, workspace, knowledgeGraph, logger);
  const pluginManager = new PluginManager(
    eventBus,
    toolRuntime,
    logger,
    workspace,
    skillsEngine,
    memorySystem,
    knowledgeGraph
  );
  const networkManager = new NetworkManager(
    kernel,
    eventBus,
    logger,
    {
      host: '127.0.0.1',
      port: 8420,
    },
    memorySystem,
    knowledgeGraph,
    toolRuntime,
    scheduler
  );

  await kernel.boot();
  await scheduler.start();

  return {
    config,
    logger,
    persistence,
    eventBus,
    workspace,
    toolRuntime,
    kernel,
    planner,
    scheduler,
    memory: memorySystem,
    knowledgeGraph,
    skillsEngine,
    mcpManager,
    pluginManager,
    networkManager,
    multiAgent,
    selfImprovement,
    shutdown: async () => {
      await networkManager.stop();
      await pluginManager.shutdown();
      await mcpManager.shutdown();
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
