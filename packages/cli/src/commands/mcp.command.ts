import { FuckClawRuntimeInstance } from '../index.js';
import { ANSI } from '../tui/banner.js';

export async function executeMcpCommand(
  runtime: FuckClawRuntimeInstance,
  subCommand: string = 'list',
  ...args: (string | undefined)[]
): Promise<void> {
  if (!runtime.mcpManager) {
    console.error('MCP subsystem is not initialized');
    return;
  }

  if (subCommand === 'list') {
    const servers = runtime.mcpManager.listServers();
    console.log(`\n${ANSI.bold}${ANSI.cyan}Connected MCP Servers (${servers.length}):${ANSI.reset}`);
    if (servers.length === 0) {
      console.log(`  ${ANSI.dim}No MCP server connections active.${ANSI.reset}\n`);
      return;
    }
    servers.forEach((s) => {
      console.log(`  • ${ANSI.bold}${s.config.name}${ANSI.reset} (${s.config.id}) - [${ANSI.green}${s.state}${ANSI.reset}] (${s.toolCount} tools)`);
    });
    console.log();
  } else if (subCommand === 'connect' || subCommand === 'add') {
    const name = args[0];
    const command = args[1];
    const cmdArgs = args.slice(2).filter((a): a is string => typeof a === 'string');
    if (!name || !command) {
      console.error('Usage: fuckclaw mcp add <name> <command> [args...]');
      return;
    }
    await runtime.mcpManager.connect({
      id: name,
      name,
      transport: {
        type: 'stdio',
        command,
        args: cmdArgs,
      },
      autoConnect: true,
      autoReconnect: false,
      maxReconnectAttempts: 3,
    });
    console.log(`${ANSI.green}✓ Connected MCP server "${name}"${ANSI.reset}`);
  } else {
    console.error(`Unknown mcp subcommand "${subCommand}". Available: list, add`);
  }
}
