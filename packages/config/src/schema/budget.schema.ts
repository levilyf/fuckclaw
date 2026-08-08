import { z } from 'zod';

/**
 * Budget schema boundary defined by IMPLEMENTATION-SPEC §4.1.
 */
export const BudgetSchema = z.object({
  maxCostPerTaskUsd: z.number().default(0.50),
  maxCostPerSessionUsd: z.number().default(5.00),
  maxConcurrentRequests: z.number().int().default(4),
});

export type BudgetConfig = z.infer<typeof BudgetSchema>;
