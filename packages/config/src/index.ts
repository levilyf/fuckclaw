import { z } from 'zod';

export const GlobalConfigSchema = z.object({
  workspace: z.object({
    root: z.string().default('~/.fuckclaw'),
  }).default({}),
  logging: z.object({
    level: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  }).default({}),
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

  get(): GlobalConfig {
    return this.config;
  }
}
