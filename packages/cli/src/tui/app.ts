import readline from 'node:readline';
import { FuckClawRuntimeInstance } from '../index.js';
import { renderBanner, ANSI } from './banner.js';
import { renderStatusBar } from './status-bar.js';
import { StreamRenderer } from './stream-renderer.js';
import { executeStatusCommand } from '../commands/status.command.js';

export class InteractiveTUI {
  private rl?: readline.Interface;
  private isRunning = false;

  constructor(private runtime: FuckClawRuntimeInstance) {}

  public async start(): Promise<void> {
    this.isRunning = true;
    console.clear();
    console.log(renderBanner());

    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: `${ANSI.bold}${ANSI.magenta}fuckclaw>${ANSI.reset} `,
    });

    this.rl.prompt();

    this.rl.on('line', async (line) => {
      const trimmed = line.trim();
      if (!trimmed) {
        this.rl?.prompt();
        return;
      }

      if (trimmed === '/exit' || trimmed === '/quit') {
        this.stop();
        return;
      }

      if (trimmed === '/clear') {
        console.clear();
        console.log(renderBanner());
        this.rl?.prompt();
        return;
      }

      if (trimmed === '/help') {
        console.log(`\n${ANSI.bold}Available Commands:${ANSI.reset}`);
        console.log(`  ${ANSI.cyan}/status${ANSI.reset}   - Display system overview and active tasks`);
        console.log(`  ${ANSI.cyan}/clear${ANSI.reset}    - Clear the terminal screen`);
        console.log(`  ${ANSI.cyan}/exit${ANSI.reset}     - Exit interactive session`);
        console.log(`  <prompt>  - Execute natural language prompt or autonomous goal\n`);
        this.rl?.prompt();
        return;
      }

      if (trimmed === '/status') {
        await executeStatusCommand(this.runtime);
        this.rl?.prompt();
        return;
      }

      // Execute prompt as task
      try {
        const task = await this.runtime.kernel.submitTask({
          description: trimmed,
          source: { type: 'user' },
        });

        if (task.output) {
          StreamRenderer.renderFinalResponse(task.output);
        } else if (task.error) {
          StreamRenderer.renderError(task.error.message);
        }
      } catch (err: unknown) {
        StreamRenderer.renderError((err as Error).message || String(err));
      }

      // Render updated status bar
      const tasks = this.runtime.kernel.listTasks();
      const tools = this.runtime.toolRuntime ? this.runtime.toolRuntime.list() : [];
      console.log(
        renderStatusBar({
          kernelState: this.runtime.kernel.getState(),
          activeTasks: tasks.filter((t) => t.state === 'executing').length,
          toolCount: tools.length,
          uptimeSeconds: Math.floor(process.uptime()),
        })
      );

      this.rl?.prompt();
    });

    this.rl.on('close', () => {
      if (this.isRunning) {
        this.stop();
      }
    });
  }

  public stop(): void {
    this.isRunning = false;
    this.rl?.close();
    console.log(`\n${ANSI.dim}Goodbye from FuckClaw.${ANSI.reset}\n`);
    process.exit(0);
  }
}
