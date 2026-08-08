import fs from 'node:fs';
import path from 'node:path';
import { IObservability } from '@fuckclaw/observability';
import { PluginManifest, Plugin } from '../types.js';

export class PluginLoader {
  constructor(private logger?: IObservability) {}

  public async discover(pluginsDir: string): Promise<{ manifest: PluginManifest; location: string }[]> {
    const discovered: { manifest: PluginManifest; location: string }[] = [];
    if (!fs.existsSync(pluginsDir)) {
      return discovered;
    }

    const entries = fs.readdirSync(pluginsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const pluginPath = path.join(pluginsDir, entry.name);
        const manifestPath = path.join(pluginPath, 'plugin.json');
        if (fs.existsSync(manifestPath)) {
          try {
            const raw = fs.readFileSync(manifestPath, 'utf8');
            const manifest = JSON.parse(raw) as PluginManifest;
            this.validateManifest(manifest);
            discovered.push({ manifest, location: pluginPath });
          } catch (err: unknown) {
            this.logger?.warn?.(`Invalid plugin manifest at ${manifestPath}: ${(err as Error).message}`);
          }
        }
      }
    }

    return discovered;
  }

  public validateManifest(manifest: PluginManifest): void {
    if (!manifest.id || typeof manifest.id !== 'string') {
      throw new Error('Plugin manifest must define a valid "id" string');
    }
    if (!manifest.name || typeof manifest.name !== 'string') {
      throw new Error('Plugin manifest must define a valid "name" string');
    }
    if (!manifest.version || typeof manifest.version !== 'string') {
      throw new Error('Plugin manifest must define a valid "version" string');
    }
    if (!manifest.main || typeof manifest.main !== 'string') {
      throw new Error('Plugin manifest must define a valid "main" entry point');
    }
    if (!Array.isArray(manifest.capabilities)) {
      manifest.capabilities = [];
    }
    if (!manifest.requirements) {
      manifest.requirements = { minVersion: '1.0.0' };
    }
  }

  public async loadModule(pluginLocation: string, mainPath: string): Promise<Plugin> {
    const fullPath = path.isAbsolute(mainPath) ? mainPath : path.join(pluginLocation, mainPath);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`Plugin entry point not found: ${fullPath}`);
    }

    try {
      const imported = await import(fullPath);
      const pluginModule = (imported.default || imported) as Plugin;
      if (!pluginModule || typeof pluginModule.onInit !== 'function') {
        throw new Error(`Plugin module at ${fullPath} does not export onInit function`);
      }
      return pluginModule;
    } catch (err: unknown) {
      throw new Error(`Failed to import plugin module from ${fullPath}: ${(err as Error).message}`);
    }
  }
}
