import { z } from 'zod';

export const ProviderConfigSchema = z.object({
  provider: z.string().default('openai-compatible'),
  baseUrl: z.string().url().optional(),
  apiKey: z.string().optional(),
  model: z.string().default('default-model'),
  temperature: z.number().min(0).max(2).default(0.7),
  maxTokens: z.number().int().positive().default(4096),
  timeoutMs: z.number().int().positive().default(60000),
});

export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;

export const GlobalConfigSchema = z.object({
  /** Workspace directory configurations (§7) */
  workspace: z.object({
    root: z.string().default('~/.fuckclaw'),
    dataDir: z.string().default('data'),
    logDir: z.string().default('logs'),
    cacheDir: z.string().default('cache'),
    pluginsDir: z.string().default('plugins'),
    skillsDir: z.string().default('skills'),
    snapshotsDir: z.string().default('snapshots'),
  }).default({}),

  /** System-level operational parameters */
  system: z.object({
    logLevel: z.enum(['debug', 'info', 'warn', 'error', 'fatal']).default('info'),
    maxConcurrentTasks: z.number().int().positive().default(4),
    shutdownTimeoutMs: z.number().int().positive().default(10000),
    metricsEnabled: z.boolean().default(true),
  }).default({}),

  /** Logging legacy alias compatibility */
  logging: z.object({
    level: z.enum(['debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  }).default({}),

  /** Memory system parameters (§6) */
  memory: z.object({
    consolidationIntervalMs: z.number().int().positive().default(3600000),
    dreamingEnabled: z.boolean().default(false),
    vectorDimension: z.number().int().positive().default(128),
    maxEpisodicRetentionDays: z.number().int().positive().default(90),
    stabilityFactor: z.number().positive().default(7.0),
  }).default({}),

  /** Task and financial budget limits (§4.5, §18.2) */
  budget: z.object({
    dailyLimitUsd: z.number().nonnegative().default(10.0),
    monthlyLimitUsd: z.number().nonnegative().default(100.0),
    defaultTaskLimitUsd: z.number().nonnegative().default(1.0),
  }).default({}),

  /** Autonomous Scheduler parameters (§13) */
  scheduler: z.object({
    enabled: z.boolean().default(true),
    timezone: z.string().default('UTC'),
    webhookPort: z.number().int().positive().default(8421),
  }).default({}),

  /** Primary and fallback LLM configurations (§12) */
  llm: ProviderConfigSchema.optional(),
  providers: z.record(ProviderConfigSchema).default({}),

  /** Tool Runtime configuration parameters (§9) */
  tools: z.record(z.record(z.unknown())).default({}),

  /** Plugin configurations (§16) */
  plugins: z.record(z.record(z.unknown())).default({}),
});

export type GlobalConfig = z.infer<typeof GlobalConfigSchema>;

export interface IConfigManager {
  get(): GlobalConfig;
  get<T>(path: string, defaultValue?: T): T;
  update(path: string, value: unknown): Promise<void>;
  on<T>(path: string, handler: (newValue: T) => void): () => void;
  reload(): Promise<void>;
  dumpRedacted(): Record<string, unknown>;
}

export interface ConfigManagerOptions {
  cwd?: string;
  globalConfigPath?: string;
  projectConfigPath?: string;
  overrides?: Record<string, unknown>;
  environment?: NodeJS.ProcessEnv;
}
