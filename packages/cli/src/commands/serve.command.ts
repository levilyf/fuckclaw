import { FuckClawRuntimeInstance } from '../index.js';
import { ANSI } from '../tui/banner.js';

export async function executeServeCommand(
  runtime: FuckClawRuntimeInstance,
  options: { port?: number; host?: string } = {}
): Promise<void> {
  if (!runtime.networkManager) {
    console.error('Network manager is not initialized in runtime');
    return;
  }

  const { host, port } = await runtime.networkManager.start({
    host: options.host || '127.0.0.1',
    port: options.port !== undefined ? options.port : 8420,
  });

  console.log(`\n${ANSI.bold}${ANSI.green}FuckClaw Gateway Server Active!${ANSI.reset}`);
  console.log(`  • REST API:   ${ANSI.cyan}http://${host}:${port}/api${ANSI.reset}`);
  console.log(`  • WebSocket:  ${ANSI.cyan}ws://${host}:${port}${ANSI.reset}`);
  console.log(`  • Health:     ${ANSI.dim}http://${host}:${port}/api/system/health${ANSI.reset}`);
  console.log(`\nPress Ctrl+C to terminate server.\n`);

  // Keep process running until interrupt
  await new Promise<void>((resolve) => {
    process.on('SIGINT', () => {
      console.log('\nShutting down server...');
      resolve();
    });
  });
}
