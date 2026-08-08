export class BudgetTracker {
  private totalCostUsd = 0;
  private totalTokens = 0;

  record(costUsd: number, tokens: number): void {
    this.totalCostUsd += costUsd;
    this.totalTokens += tokens;
  }

  getTotalCost(): number {
    return this.totalCostUsd;
  }

  getTotalTokens(): number {
    return this.totalTokens;
  }
}
