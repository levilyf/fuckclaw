import { z } from 'zod';

/**
 * Provider-level schema boundary defined by IMPLEMENTATION-SPEC §4.1.
 */
export const ProviderSchema = z.object({
  provider: z.string().default('openai-compatible'),
  baseUrl: z.string().url().optional(),
  model: z.string().default('gpt-4o'),
  apiKey: z.string().optional(),
});

export type ProviderConfig = z.infer<typeof ProviderSchema>;
