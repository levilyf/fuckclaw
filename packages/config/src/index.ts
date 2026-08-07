import { z } from 'zod';

export const GlobalConfigSchema = z.object({
  workspace: z.object({
    root: z.string().default('~/.fuckclaw'),
  }).default({}),
  logging: z.object({
    level: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  }).default({}),
  llm: z.object({
    provider: z.literal('openai-compatible').default('openai-compatible'),
    baseUrl: z.string().url(),
    apiKey: z.string().min(1),
    model: z.string().min(1),
  }).optional(),
});

export type GlobalConfig = z.infer<typeof GlobalConfigSchema>;

export interface IConfigManager {
  get(): GlobalConfig;
}

export class ConfigManager implements IConfigManager {
  private config: GlobalConfig;

  constructor(initialConfig: Partial<GlobalConfig> = {}) {
    this.config = GlobalConfigSchema.parse(initialConfig);
  }

  static fromEnvironment(environment: NodeJS.ProcessEnv = process.env): ConfigManager {
    const baseUrl = environment.FUCKCLAW_LLM_BASE_URL;
    const apiKey = environment.FUCKCLAW_LLM_API_KEY;
    const model = environment.FUCKCLAW_LLM_MODEL;

    return new ConfigManager({
      ...(baseUrl && apiKey && model
        ? {
            llm: {
              provider: 'openai-compatible' as const,
              baseUrl,
              apiKey,
              model,
            },
          }
        : {}),
    });
  }

  get(): GlobalConfig {
    return this.config;
  }
}
