export class TraceCompressor {
  static compress(content: string, maxChars: number = 1000): string {
    if (content.length <= maxChars) {
      return content;
    }
    return content.slice(0, maxChars) + '... [TRUNCATED]';
  }
}
