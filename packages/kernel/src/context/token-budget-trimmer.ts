export class TokenBudgetTrimmer {
  static trimHistory<T extends { content: string }>(
    messages: T[],
    maxTokens: number,
    approxCharsPerToken: number = 4
  ): T[] {
    const maxChars = maxTokens * approxCharsPerToken;
    let totalChars = 0;
    const result: T[] = [];

    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]!;
      if (totalChars + msg.content.length > maxChars) {
        break;
      }
      totalChars += msg.content.length;
      result.unshift(msg);
    }

    return result;
  }
}
