import { z } from 'zod';

/**
 * System-level schema boundary defined by IMPLEMENTATION-SPEC §4.1.
 * Re-exports from the existing global-config schema until full decomposition.
 */
export const SystemSchema = z.object({
  dataDir: z.string().default('~/.fuckclaw'),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  telemetryEnabled: z.boolean().default(false),
});

export type SystemConfig = z.infer<typeof SystemSchema>;
