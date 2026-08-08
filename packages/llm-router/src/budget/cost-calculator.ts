export class CostCalculator {
  static calculate(promptTokens: number, completionTokens: number): number {
    // Default pricing: $3.00/M input, $15.00/M output
    const inputRate = 3.0 / 1_000_000;
    const outputRate = 15.0 / 1_000_000;
    return Number((promptTokens * inputRate + completionTokens * outputRate).toFixed(6));
  }
}
