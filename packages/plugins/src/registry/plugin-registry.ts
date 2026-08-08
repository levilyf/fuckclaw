import { IObservability } from '@fuckclaw/observability';
import { IEventBus } from '@fuckclaw/event-bus';
import { Task } from '@fuckclaw/kernel';
import { PluginInstance, PluginManifest, Plugin, PluginContext } from '../types.js';

export class PluginRegistry {
  private plugins = new Map<string, PluginInstance>();

  constructor(
    private eventBus: IEventBus,
    private logger?: IObservability
  ) {}

  public register(
    manifest: PluginManifest,
    module: Plugin,
    context: PluginContext,
    location?: string
  ): PluginInstance {
    if (this.plugins.has(manifest.id)) {
      throw new Error(`Plugin "${manifest.id}" is already registered`);
    }

    const instance: PluginInstance = {
      manifest,
      module,
      context,
      state: 'resolved',
      location,
      loadedAt: Date.now(),
    };

    this.plugins.set(manifest.id, instance);
    return instance;
  }

  public async initializePlugin(instance: PluginInstance): Promise<void> {
    instance.state = 'initializing';
    try {
      await instance.module.onInit(instance.context);
      instance.state = 'active';

      await this.eventBus.emit('plugin.initialized', {
        pluginId: instance.manifest.id,
        version: instance.manifest.version,
      });

      this.logger?.info?.(`Plugin "${instance.manifest.name}" (${instance.manifest.id}) initialized successfully`);
    } catch (err: unknown) {
      instance.state = 'error';
      instance.error = (err as Error).message;
      this.logger?.error?.(`Failed to initialize plugin "${instance.manifest.id}": ${(err as Error).message}`);
      throw err;
    }
  }

  public async unloadPlugin(pluginId: string): Promise<void> {
    const instance = this.plugins.get(pluginId);
    if (!instance) return;

    instance.state = 'stopping';
    try {
      if (typeof instance.module.onShutdown === 'function') {
        await instance.module.onShutdown(instance.context);
      }
      instance.state = 'stopped';
      this.plugins.delete(pluginId);

      await this.eventBus.emit('plugin.unloaded', { pluginId });
      this.logger?.info?.(`Plugin "${pluginId}" shut down cleanly and unloaded`);
    } catch (err: unknown) {
      instance.state = 'error';
      instance.error = (err as Error).message;
      this.plugins.delete(pluginId);
      this.logger?.error?.(`Error during shutdown of plugin "${pluginId}": ${(err as Error).message}`);
    }
  }

  public get(pluginId: string): PluginInstance | undefined {
    return this.plugins.get(pluginId);
  }

  public list(): PluginInstance[] {
    return Array.from(this.plugins.values());
  }

  public async invokeTaskCreatedHook(task: Task): Promise<void> {
    for (const instance of this.plugins.values()) {
      if (instance.state === 'active' && typeof instance.module.onTaskCreated === 'function') {
        try {
          await instance.module.onTaskCreated(task, instance.context);
        } catch (err: unknown) {
          this.logger?.warn?.(`Plugin ${instance.manifest.id} onTaskCreated hook error: ${(err as Error).message}`);
        }
      }
    }
  }

  public async invokeTaskCompletedHook(task: Task, result: unknown): Promise<void> {
    for (const instance of this.plugins.values()) {
      if (instance.state === 'active' && typeof instance.module.onTaskCompleted === 'function') {
        try {
          await instance.module.onTaskCompleted(task, result, instance.context);
        } catch (err: unknown) {
          this.logger?.warn?.(`Plugin ${instance.manifest.id} onTaskCompleted hook error: ${(err as Error).message}`);
        }
      }
    }
  }

  public async healthCheck(): Promise<Record<string, { healthy: boolean; message?: string }>> {
    const results: Record<string, { healthy: boolean; message?: string }> = {};
    for (const [id, instance] of this.plugins.entries()) {
      if (instance.state !== 'active') {
        results[id] = { healthy: false, message: `State is ${instance.state}: ${instance.error || 'Inactive'}` };
        continue;
      }

      if (typeof instance.module.healthCheck === 'function') {
        try {
          results[id] = await instance.module.healthCheck(instance.context);
        } catch (err: unknown) {
          results[id] = { healthy: false, message: `Health check threw: ${(err as Error).message}` };
        }
      } else {
        results[id] = { healthy: true };
      }
    }
    return results;
  }
}
