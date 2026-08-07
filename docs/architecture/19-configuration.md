# §19 — Configuration

## 19.1 Purpose

The Configuration system manages the settings that govern FuckClaw's behavior. It provides a structured, typed, and layered approach to configuration, ensuring that the system can adapt to different environments and user preferences without code changes.

## 19.2 Configuration Layers

FuckClaw evaluates configuration in the following order of precedence (highest to lowest):

1. **Runtime Overrides**: Passed directly to API calls or CLI arguments
2. **Environment Variables**: E.g., `FUCKCLAW_LOG_LEVEL=debug`
3. **Project Config**: `fuckclaw.toml` in the current working directory
4. **Profile Config**: Active profile in `~/.fuckclaw/config/profiles/`
5. **Global Config**: `~/.fuckclaw/config/fuckclaw.toml`
6. **System Defaults**: Hardcoded in the application

## 19.3 Configuration Schema

The configuration is strongly typed and validated at startup using JSON Schema/Zod:

```typescript
interface GlobalConfig {
  /** Workspace configuration */
  workspace: {
    dataDir: string;
    logDir: string;
    cacheDir: string;
    pluginsDir: string;
  };
  
  /** System settings */
  system: {
    logLevel: 'debug' | 'info' | 'warn' | 'error' | 'fatal';
    maxConcurrentTasks: number;
    shutdownTimeoutMs: number;
    metricsEnabled: boolean;
  };
  
  /** Memory settings */
  memory: {
    consolidationIntervalMs: number;
    dreamingEnabled: boolean;
    vectorDimension: number;
    maxEpisodicRetentionDays: number;
  };
  
  /** LLM Provider configurations */
  providers: Record<string, ProviderConfig>; // (§12.3)
  
  /** Budget configurations */
  budget: {
    dailyLimitUsd: number;
    monthlyLimitUsd: number;
    defaultTaskLimitUsd: number;
  };
  
  /** Scheduler settings */
  scheduler: {
    enabled: boolean;
    timezone: string;
    webhookPort: number;
  };
  
  /** Networking */
  network: {
    apiPort: number;
    wsPort: number;
    host: string;
    corsAllowedOrigins: string[];
  };
  
  /** MCP settings */
  mcp: {
    clientEnabled: boolean;
    serverEnabled: boolean;
    serverPort: number;
    servers: MCPServerConfig[];
  };
  
  /** Plugin configurations */
  plugins: Record<string, Record<string, unknown>>;
}
```

## 19.4 Profiles

Profiles allow the operator to switch between different sets of configurations easily (e.g., `work`, `personal`, `experimental`).

```bash
# Profile management via CLI
fuckclaw profile list
fuckclaw profile create work
fuckclaw profile switch work
```

Profile configurations are stored in `~/.fuckclaw/config/profiles/{profile_name}.toml`. When a profile is active, its settings override the global config.

## 19.5 Project Configuration

When FuckClaw operates within a specific project directory (e.g., executing a command from the CLI inside a git repo), it looks for a local `.fuckclaw.toml` or `fuckclaw.toml`.

```toml
# Example project-level fuckclaw.toml
[project]
name = "auth-service"
language = "typescript"
frameworks = ["node", "express"]

[tools]
# Override default timeout for tests in this project
shell.timeoutMs = 120000

[memory]
# Prioritize specific context for this project
focusTags = ["auth", "security", "jwt"]

[skills]
# Ensure specific skills are always loaded
require = ["deploy_to_k8s", "run_jest_tests"]
```

## 19.6 Secrets Management

API keys and sensitive data are **never** stored in plain text `.toml` files.

1. **Environment Variables**: Primary mechanism (e.g., `ANTHROPIC_API_KEY`).
2. **Encrypted Keystore**: Stored in `~/.fuckclaw/config/env.json.enc`, encrypted with a local machine key or operator passphrase.

```typescript
interface ISecretManager {
  getSecret(key: string): Promise<string | null>;
  setSecret(key: string, value: string): Promise<void>;
  deleteSecret(key: string): Promise<void>;
}
```

## 19.7 Dynamic Configuration

Some configuration values can be updated at runtime without restarting the kernel:

```typescript
// The configuration manager emits events when config changes
configManager.on('change:system.logLevel', (newValue) => {
  logger.setLevel(newValue);
});

// Update configuration dynamically
await configManager.update('budget.dailyLimitUsd', 50.0);
```

## 19.8 Interfaces

```typescript
export interface IConfigManager {
  /** Get full configuration */
  get(): GlobalConfig;
  
  /** Get a specific value (dot notation) */
  get<T>(path: string, defaultValue?: T): T;
  
  /** Update a configuration value (persists to active profile or global) */
  update(path: string, value: unknown): Promise<void>;
  
  /** Switch active profile */
  setProfile(profileName: string): Promise<void>;
  
  /** Subscribe to configuration changes */
  on<T>(path: string, handler: (newValue: T) => void): () => void;
  
  /** Reload configuration from disk */
  reload(): Promise<void>;
}
```

## 19.9 Failure Modes

| Failure | Impact | Mitigation |
|---|---|---|
| Invalid configuration file syntax | Kernel fails to boot | Strict validation on load; fallback to last known good config or defaults |
| Missing required secret (e.g., API key) | Operations fail | Validate required secrets on boot; pause tasks and prompt user |
| Conflicting configurations (e.g., project vs global) | Unexpected behavior | Clear precedence rules; `fuckclaw config show` displays resolved values and their sources |

## 19.10 Future Improvements

1. **Configuration sync**: Sync configuration profiles across multiple machines (via Git or cloud)
2. **Interactive configuration UI**: Web dashboard for viewing and editing configuration
3. **Configuration validation plugins**: Allow plugins to define custom validation rules for their configuration sections
4. **Environment-aware defaults**: Automatically adjust defaults based on the host OS (e.g., path separators, available tools)