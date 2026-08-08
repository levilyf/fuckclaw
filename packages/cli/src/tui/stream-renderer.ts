import { ANSI } from './banner.js';

export class StreamRenderer {
  public static renderThought(thought: string): void {
    if (!thought) return;
    process.stdout.write(`${ANSI.dim}${ANSI.italic}💭 ${thought}${ANSI.reset}\n`);
  }

  public static renderToolCall(toolName: string, args: unknown): void {
    const serializedArgs = typeof args === 'object' && args !== null ? JSON.stringify(args) : String(args);
    process.stdout.write(
      `${ANSI.yellow}⚡ Tool Call: ${ANSI.bold}${toolName}${ANSI.reset}${ANSI.yellow}(${ANSI.dim}${serializedArgs}${ANSI.yellow})${ANSI.reset}\n`
    );
  }

  public static renderToolResult(_toolName: string, success: boolean, output: unknown, durationMs?: number): void {
    const statusSymbol = success ? `${ANSI.green}✓${ANSI.reset}` : `${ANSI.red}✗${ANSI.reset}`;
    const duration = durationMs ? ` ${ANSI.dim}(${durationMs}ms)${ANSI.reset}` : '';
    const outStr = typeof output === 'object' && output !== null ? JSON.stringify(output, null, 2) : String(output);

    process.stdout.write(`   ${statusSymbol} Output${duration}:\n`);
    const indented = outStr
      .split('\n')
      .map((l) => `     ${ANSI.dim}${l}${ANSI.reset}`)
      .join('\n');
    process.stdout.write(`${indented}\n`);
  }

  public static renderFinalResponse(content: string): void {
    process.stdout.write(`\n${ANSI.cyan}${ANSI.bold}FuckClaw:${ANSI.reset}\n${content}\n\n`);
  }

  public static renderError(errMessage: string): void {
    process.stdout.write(`\n${ANSI.red}${ANSI.bold}Error:${ANSI.reset} ${ANSI.red}${errMessage}${ANSI.reset}\n\n`);
  }
}
