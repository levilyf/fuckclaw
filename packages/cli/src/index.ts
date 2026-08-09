import { ConfigManager, GlobalConfig, IConfigManager, Keystore } from '@fuckclaw/config';
import { Logger, IObservability } from '@fuckclaw/observability';
import { PersistenceLayer, IPersistenceLayer } from '@fuckclaw/persistence';
import { EventBus, IEventBus } from '@fuckclaw/event-bus';
import { WorkspaceManager, IWorkspaceManager } from '@fuckclaw/workspace';
import { ToolRuntime, ShellTool, FilesystemTool, HttpTool, PythonTool, GitTool, DockerTool, IToolRuntime } from '@fuckclaw/tool-runtime';
import { ILLMProvider, LLMRouter, ProviderFactory } from '@fuckclaw/llm-router';
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
export * from './tui/app.js';
export * from './tui/onboarding.js';
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
  llmRouter: LLMRouter;
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
  disableConsoleLogging?: boolean;
}

function resolveHome(environment: NodeJS.ProcessEnv = process.env): string {
  return environment.HOME || environment.USERPROFILE || os.homedir();
}

function resolvePathWithHome(rawPath: string, environment: NodeJS.ProcessEnv = process.env): string {
  return rawPath.startsWith('~/') ? path.join(resolveHome(environment), rawPath.slice(2)) : path.resolve(rawPath);
}

function resolveGlobalConfigPath(environment: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveHome(environment), '.fuckclaw', 'config', 'fuckclaw.toml');
}

function isLocalEndpoint(rawUrl: string): boolean {
  try {
    const hostname = new URL(rawUrl).hostname.toLowerCase();
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname.startsWith('192.168.') || hostname.startsWith('10.') || /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname);
  } catch {
    return false;
  }
}

function isOpenAICompatibleProvider(name: string): boolean {
  return name === 'openai' || name === 'openai-compatible';
}

export async function registerConfiguredProvider(
  config: IConfigManager,
  llmRouter: LLMRouter,
  environment: NodeJS.ProcessEnv = process.env
): Promise<boolean> {
  const cfg = config.get();
  const providers = cfg.providers || {};
  const llm = cfg.llm || {} as any;
  const activeProviderName = (llm as any).provider || 'anthropic';
  const providerConfig = (providers as any)[activeProviderName] || {};
  const rawProviderConfig = Object.keys(providerConfig).length > 0 ? providerConfig : llm;
  const baseUrl = (providerConfig as any).baseUrl || (rawProviderConfig as any).baseUrl || (llm as any).baseUrl || '';
  const model = (providerConfig as any).model || (rawProviderConfig as any).model || (llm as any).model || 'default';
  const secretKey = `providers.${activeProviderName}.apiKey`;
  const keystorePath = path.join(path.dirname(resolveGlobalConfigPath(environment)), 'env.json.enc');
  const keystore = new Keystore(keystorePath);
  const persistedSecret = await keystore.getSecret(secretKey);
  const apiKey = (providerConfig as any).apiKey || (rawProviderConfig as any).apiKey || (llm as any).apiKey || persistedSecret || '';

  const hasEndpoint = typeof baseUrl === 'string' && baseUrl.trim().length > 0;
  const hasModel = typeof model === 'string' && model.trim().length > 0;
  const hasAuth = typeof apiKey === 'string' && apiKey.trim().length > 0;
  const isCompatible = activeProviderName === 'openai' || activeProviderName === 'openai-compatible' || activeProviderName === 'anthropic' || activeProviderName === 'google';
  const canUseUnauthenticatedLocal = isOpenAICompatibleProvider(activeProviderName) && hasEndpoint && isLocalEndpoint(baseUrl);

  if (!isCompatible || !hasModel || !(hasAuth || canUseUnauthenticatedLocal)) {
    return false;
  }

  if (isOpenAICompatibleProvider(activeProviderName) && !hasEndpoint) {
    return false;
  }

  llmRouter.registerProvider(
    ProviderFactory.createOpenAI({
      baseUrl: baseUrl || '',
      apiKey: apiKey || '',
      model,
    }),
    true
  );
  return true;
}

export async function createFuckClawRuntime(
  customConfig: Partial<GlobalConfig> = {},
  customLLMProvider?: ILLMProvider,
  environment: NodeJS.ProcessEnv = process.env,
  options: CreateRuntimeOptions = {}
): Promise<FuckClawRuntimeInstance> {
  const globalConfigPath = resolveGlobalConfigPath(environment);
  const overrides: Record<string, unknown> = {};
  if (customConfig.workspace) overrides.workspace = customConfig.workspace;
  if (customConfig.logging) overrides.logging = customConfig.logging;
  if (customConfig.providers) overrides.providers = customConfig.providers;
  if (customConfig.llm) overrides.llm = customConfig.llm;

  const config = new ConfigManager({
    environment,
    globalConfigPath,
    overrides,
  });

  // Resolve workspace directory from the final layered config, not from stale partial config.
  const rawRoot = config.get().workspace?.root ?? '~/.fuckclaw';
  const resolvedRoot = rawRoot === ':memory:' ? ':memory:' : resolvePathWithHome(rawRoot, environment);
  const persistencePath = rawRoot === ':memory:' ? ':memory:' : path.join(resolvedRoot, 'fuckclaw.db');
  const logger = new Logger(config);
  
  // Conditionally disable console logging for TUI/Interactive interfaces
  // We use a private convention to override log level dynamically
  if (options.disableConsoleLogging) {
     (config as any)._interactiveOverrideLogLevel = 'error';
  }

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

  // Register Providers
  const llmRouter = new LLMRouter(logger, eventBus);
  
  if (options.allowUnconfiguredLLM) {
    llmRouter.registerProvider(
      {
        name: 'unconfigured-fallback',
        generate: async () => {
          const err = new Error(
            'No LLM provider configured. Please run `fuckclaw setup` or set API keys in your environment.'
          ) as any;
          err.code = 'CONFIGURATION_ERROR';
          throw err;
        },
      },
      true
    );
  }

  if (customLLMProvider) {
    llmRouter.registerProvider(customLLMProvider, true);
  } else {
    const configured = await registerConfiguredProvider(config, llmRouter, environment);
    if (!configured && !options.allowUnconfiguredLLM) {
      persistence.close();
      const err = new Error(
        'LLM configuration is required. Please run `fuckclaw setup` or set a compatible base URL/model and API key where required.'
      ) as any;
      err.code = 'CONFIGURATION_ERROR';
      throw err;
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
      
      const errorCode = (evt.payload.error as any)?.code || 'EXECUTION_ERROR';

      // Skip config/bootstrap errors from polluting the self-improvement anti-pattern database
      if (errorCode === 'CONFIGURATION_ERROR') {
        return;
      }

      await selfImprovement.processTrace({
        taskId,
        goal: output || taskId,
        success,
        error: errorMsg ? { code: errorCode, message: errorMsg } : undefined,
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
    llmRouter,
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
