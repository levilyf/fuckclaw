import { stringify } from 'smol-toml';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadProfile } from './profile.loader.js';
import { loadConfigFile } from './file.loader.js';
import { Keystore } from '../secrets/keystore.js';
import {
  GlobalConfig,
  GlobalConfigSchema,
  IConfigManager,
  ConfigManagerOptions,
} from '../schema/global-config.schema.js';

export class ConfigManager implements IConfigManager {
  private config: GlobalConfig;
  private listeners: Map<string, Set<(val: any) => void>> = new Map();
  private options: ConfigManagerOptions;

  constructor(initialOrOptions: Partial<GlobalConfig> | ConfigManagerOptions = {}) {
    if (
      'cwd' in initialOrOptions ||
      'globalConfigPath' in initialOrOptions ||
      'projectConfigPath' in initialOrOptions ||
      'profile' in initialOrOptions ||
      'profilesDir' in initialOrOptions ||
      'overrides' in initialOrOptions ||
      'environment' in initialOrOptions
    ) {
      this.options = initialOrOptions as ConfigManagerOptions;
      this.config = this.resolveLayeredConfig(this.options);
    } else {
      this.options = { overrides: initialOrOptions as Record<string, unknown> };
      this.config = this.resolveLayeredConfig(this.options);
    }
  }

  static fromEnvironment(environment: NodeJS.ProcessEnv = process.env): ConfigManager {
    return new ConfigManager({ environment });
  }

  /**
   * Resolves configuration hierarchy in order of precedence:
   * 1. Overrides / CLI arguments (Highest)
   * 2. Environment Variables
   * 3. Project Config (`fuckclaw.toml` or `.fuckclaw.toml`)
   * 4. Global Config (`~/.fuckclaw/config/fuckclaw.toml`)
   * 5. System Defaults (Lowest)
   */
  private resolveLayeredConfig(options: ConfigManagerOptions): GlobalConfig {
    const env = options.environment ?? process.env;
    const cwd = options.cwd ?? process.cwd();

    let merged: Record<string, any> = {};

    // 1. System Defaults (Base)
    const defaults = GlobalConfigSchema.parse({});
    merged = this.deepMerge(merged, defaults);

    // 2. Global TOML (~/.fuckclaw/config/fuckclaw.toml)
    const globalPath = this.resolveGlobalConfigPath(options);

    if (fs.existsSync(globalPath)) {
      try {
        const parsed = loadConfigFile(globalPath);
        merged = this.deepMerge(merged, parsed);
      } catch (err: any) {
        throw new Error(`Configuration error while loading ${globalPath}: ${err.message}`);
      }
    }

    // 3. Profile TOML (~/.fuckclaw/config/profiles/{profile}.toml) (§19.4)
    const activeProfile = options.profile ?? env.FUCKCLAW_PROFILE;
    if (activeProfile) {
      try {
        const profileConfig = loadProfile(activeProfile, options.profilesDir);
        if (profileConfig && Object.keys(profileConfig).length > 0) {
          merged = this.deepMerge(merged, profileConfig);
        }
      } catch {}
    }

    // 4. Project TOML (./fuckclaw.toml or ./.fuckclaw.toml)
    const projectCandidates = options.projectConfigPath
      ? [options.projectConfigPath]
      : [path.join(cwd, 'fuckclaw.toml'), path.join(cwd, '.fuckclaw.toml')];

    for (const cand of projectCandidates) {
      if (cand === '/dev/null') continue;
      const p = cand.startsWith('~/') ? path.join(os.homedir(), cand.slice(2)) : path.resolve(cand);
      if (fs.existsSync(p)) {
        try {
          const parsed = loadConfigFile(p);
          merged = this.deepMerge(merged, parsed);
          break; // Stop at first valid project config
        } catch (err: any) {
          throw new Error(`Configuration error while loading ${p}: ${err.message}`);
        }
      }
    }

    // 4. Environment Variables (§19.2)
    const envOverrides: Record<string, any> = {};
    if (env.FUCKCLAW_WORKSPACE_ROOT) {
      envOverrides.workspace = envOverrides.workspace || {};
      envOverrides.workspace.root = env.FUCKCLAW_WORKSPACE_ROOT;
    }
    if (env.FUCKCLAW_LOG_LEVEL) {
      const level = env.FUCKCLAW_LOG_LEVEL.toLowerCase();
      envOverrides.system = envOverrides.system || {};
      envOverrides.system.logLevel = level;
      envOverrides.logging = envOverrides.logging || {};
      envOverrides.logging.level = level;
    }
    if (env.FUCKCLAW_LLM_BASE_URL || env.FUCKCLAW_LLM_API_KEY || env.FUCKCLAW_LLM_MODEL) {
      envOverrides.llm = {
        provider: 'openai-compatible',
        baseUrl: env.FUCKCLAW_LLM_BASE_URL ?? merged.llm?.baseUrl,
        apiKey: env.FUCKCLAW_LLM_API_KEY ?? merged.llm?.apiKey,
        model: env.FUCKCLAW_LLM_MODEL ?? merged.llm?.model ?? 'default',
      };
    }
    merged = this.deepMerge(merged, envOverrides);

    // 5. Explicit Programmatic Overrides (Highest)
    if (options.overrides) {
      merged = this.deepMerge(merged, options.overrides);
    }

    // Synchronize logging.level with system.logLevel
    if (merged.system?.logLevel) {
      merged.logging = merged.logging || {};
      merged.logging.level = merged.system.logLevel;
    } else if (merged.logging?.level) {
      merged.system = merged.system || {};
      merged.system.logLevel = merged.logging.level;
    }

    return GlobalConfigSchema.parse(merged);
  }

  get(): GlobalConfig;
  get<T>(path: string, defaultValue?: T): T;
  get<T>(path?: string, defaultValue?: T): T | GlobalConfig {
    if (!path) {
      return this.config;
    }
    const parts = path.split('.');
    let current: any = this.config;
    for (const part of parts) {
      if (current === undefined || current === null) {
        return defaultValue as T;
      }
      current = current[part];
    }
    return (current !== undefined ? current : defaultValue) as T;
  }

  async update(keyPath: string, value: unknown): Promise<void> {
    const parts = keyPath.split('.');
    const cloned = JSON.parse(JSON.stringify(this.config));
    let target = cloned;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i]!;
      if (!target[part] || typeof target[part] !== 'object') {
        target[part] = {};
      }
      target = target[part];
    }
    target[parts[parts.length - 1]!] = value;

    this.config = GlobalConfigSchema.parse(cloned);
    
    // Save to the global config file
    try {
      const globalConfigPath = this.resolveGlobalConfigPath(this.options);
      if (keyPath.endsWith('.apiKey') && typeof value === 'string' && value.length > 0) {
        const keystore = new Keystore(this.resolveKeystorePath(this.options));
        await keystore.setSecret(keyPath, value);
      }
      const dir = path.dirname(globalConfigPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      // Clone again to remove secrets before writing to TOML
      const safeConfig = JSON.parse(JSON.stringify(this.config));
      // Scrub API keys before plaintext TOML serialization.
      if (safeConfig.llm && 'apiKey' in safeConfig.llm) {
        delete safeConfig.llm.apiKey;
      }
      if (safeConfig.providers) {
        for (const key of Object.keys(safeConfig.providers)) {
          if (safeConfig.providers[key] && 'apiKey' in safeConfig.providers[key]) {
            delete safeConfig.providers[key].apiKey;
          }
        }
      }
      
      const tomlContent = stringify(safeConfig);
      fs.writeFileSync(globalConfigPath, tomlContent, 'utf-8');
      
      // Keystore handles actual secrets persistence externally.
    } catch (e: any) {
       throw new Error(`Failed to write configuration file: ${e.message}`);
    }

    // Notify listeners for this keyPath
    const pathListeners = this.listeners.get(keyPath);
    if (pathListeners) {
      for (const listener of pathListeners) {
        try {
          listener(value);
        } catch {}
      }
    }
  }

  on<T>(keyPath: string, handler: (newValue: T) => void): () => void {
    if (!this.listeners.has(keyPath)) {
      this.listeners.set(keyPath, new Set());
    }
    this.listeners.get(keyPath)!.add(handler);
    return () => {
      this.listeners.get(keyPath)?.delete(handler);
    };
  }

  async setProfile(profileName: string): Promise<void> {
    this.options = { ...this.options, profile: profileName };
    await this.reload();
  }

  async reload(): Promise<void> {
    this.config = this.resolveLayeredConfig(this.options);
  }

  /**
   * Dumps configuration with all secret tokens and API keys redacted (§19.6)
   */
  dumpRedacted(): Record<string, unknown> {
    const raw = JSON.parse(JSON.stringify(this.config));
    if (raw.llm?.apiKey) {
      raw.llm.apiKey = '[REDACTED]';
    }
    if (raw.providers) {
      for (const p of Object.keys(raw.providers)) {
        if (raw.providers[p]?.apiKey) {
          raw.providers[p].apiKey = '[REDACTED]';
        }
      }
    }
    return raw;
  }

  public getGlobalConfigPath(): string {
    return this.resolveGlobalConfigPath(this.options);
  }

  public getKeystorePath(): string {
    return this.resolveKeystorePath(this.options);
  }

  private resolveHome(options: ConfigManagerOptions): string {
    return options.environment?.HOME || options.environment?.USERPROFILE || os.homedir();
  }

  private resolveGlobalConfigPath(options: ConfigManagerOptions): string {
    const home = this.resolveHome(options);
    const rawPath = options.globalConfigPath ?? path.join(home, '.fuckclaw', 'config', 'fuckclaw.toml');
    return rawPath.startsWith('~/') ? path.join(home, rawPath.slice(2)) : path.resolve(rawPath);
  }

  private resolveKeystorePath(options: ConfigManagerOptions): string {
    return path.join(path.dirname(this.resolveGlobalConfigPath(options)), 'env.json.enc');
  }

  private deepMerge(target: Record<string, any>, source: Record<string, any>): Record<string, any> {
    const result = { ...target };
    for (const key of Object.keys(source)) {
      const sourceVal = source[key];
      const targetVal = target[key];
      if (
        sourceVal !== undefined &&
        sourceVal !== null &&
        typeof sourceVal === 'object' &&
        !Array.isArray(sourceVal) &&
        typeof targetVal === 'object' &&
        !Array.isArray(targetVal)
      ) {
        result[key] = this.deepMerge(targetVal || {}, sourceVal);
      } else if (sourceVal !== undefined) {
        result[key] = sourceVal;
      }
    }
    return result;
  }
}
