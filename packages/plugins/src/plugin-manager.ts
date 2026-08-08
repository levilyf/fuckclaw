import { IEventBus } from '@fuckclaw/event-bus';
import { IToolRuntime } from '@fuckclaw/tool-runtime';
import { ISkillEngine } from '@fuckclaw/skills';
import { IMemorySystem } from '@fuckclaw/memory';
import { IKnowledgeGraph } from '@fuckclaw/knowledge-graph';
import { IObservability } from '@fuckclaw/observability';
import { IWorkspaceManager } from '@fuckclaw/workspace';
import { Task } from '@fuckclaw/kernel';
import { PluginLoader } from './loader/plugin-loader.js';
import { PluginContextFactory } from './context/plugin-context-factory.js';
import { PluginRegistry } from './registry/plugin-registry.js';
import {
  IPluginManager,
  PluginManifest,
  Plugin,
  PluginInstance,
} from './types.js';
import path from 'node:path';

export class PluginManager implements IPluginManager {
  private loader: PluginLoader;
  private contextFactory: PluginContextFactory;
  private registry: PluginRegistry;

  constructor(
    eventBus: IEventBus,
    toolRuntime: IToolRuntime,
    logger: IObservability,
    private workspace?: IWorkspaceManager,
    skillEngine?: ISkillEngine,
    memory?: IMemorySystem,
    knowledgeGraph?: IKnowledgeGraph
  ) {
    this.loader = new PluginLoader(logger);
    this.contextFactory = new PluginContextFactory(
      eventBus,
      toolRuntime,
      logger,
      workspace,
      skillEngine,
      memory,
      knowledgeGraph
    );
    this.registry = new PluginRegistry(eventBus, logger);
  }

  public async discover(pluginsDir?: string): Promise<PluginManifest[]> {
    const targetDir =
      pluginsDir ||
      (this.workspace ? path.join(this.workspace.getDirectory('plugins'), 'registry') : path.join(process.cwd(), 'plugins'));

    const discovered = await this.loader.discover(targetDir);
    return discovered.map((d) => d.manifest);
  }

  public async load(
    manifestOrPath: PluginManifest | string,
    pluginModule?: Plugin,
    config: Record<string, unknown> = {}
  ): Promise<void> {
    let manifest: PluginManifest;
    let moduleToInit: Plugin;
    let location: string | undefined;

    if (typeof manifestOrPath === 'string') {
      location = manifestOrPath;
      const manifestPath = path.join(location, 'plugin.json');
      const discovered = await this.loader.discover(path.dirname(location));
      const found = discovered.find((d) => d.location === location);
      if (!found) {
        throw new Error(`Could not find valid plugin manifest at ${manifestPath}`);
      }
      manifest = found.manifest;
      moduleToInit = pluginModule || (await this.loader.loadModule(location, manifest.main));
    } else {
      manifest = manifestOrPath;
      this.loader.validateManifest(manifest);
      if (!pluginModule) {
        throw new Error(`Plugin module instance must be provided when loading via PluginManifest object`);
      }
      moduleToInit = pluginModule;
    }

    const context = this.contextFactory.createContext(manifest, config);
    const instance = this.registry.register(manifest, moduleToInit, context, location);
    await this.registry.initializePlugin(instance);
  }

  public async unload(pluginId: string): Promise<void> {
    return this.registry.unloadPlugin(pluginId);
  }

  public list(): PluginInstance[] {
    return this.registry.list();
  }

  public get(pluginId: string): PluginInstance | undefined {
    return this.registry.get(pluginId);
  }

  public async invokeTaskCreatedHook(task: Task): Promise<void> {
    return this.registry.invokeTaskCreatedHook(task);
  }

  public async invokeTaskCompletedHook(task: Task, result: unknown): Promise<void> {
    return this.registry.invokeTaskCompletedHook(task, result);
  }

  public async healthCheck(): Promise<Record<string, { healthy: boolean; message?: string }>> {
    return this.registry.healthCheck();
  }

  public async shutdown(): Promise<void> {
    const instances = this.registry.list();
    for (const inst of instances) {
      await this.unload(inst.manifest.id);
    }
  }
}
