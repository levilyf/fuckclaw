import { FuckClawRuntimeInstance } from '../index.js';
import { ANSI } from '../tui/banner.js';

export async function executeStatusCommand(runtime: FuckClawRuntimeInstance): Promise<void> {
  const kernelState = runtime.kernel.getState();
  const tasks = runtime.kernel.listTasks();
  const tools = runtime.toolRuntime ? runtime.toolRuntime.list() : [];
  const skills = runtime.skillsEngine ? runtime.skillsEngine.list() : [];
  const triggers = runtime.scheduler ? runtime.scheduler.listTriggers() : [];
  const plugins = runtime.pluginManager ? runtime.pluginManager.list() : [];
  const mcpServers = runtime.mcpManager ? runtime.mcpManager.listServers() : [];

  console.log(`\n${ANSI.bold}${ANSI.cyan}FuckClaw Subsystem Status Overview:${ANSI.reset}`);
  console.log(`${ANSI.dim}────────────────────────────────────────────────────────${ANSI.reset}`);
  console.log(`  • Kernel State:        ${ANSI.green}${kernelState.toUpperCase()}${ANSI.reset}`);
  console.log(`  • Active / Total Tasks: ${ANSI.bold}${tasks.filter((t) => t.state === 'executing').length} / ${tasks.length}${ANSI.reset}`);
  console.log(`  • Registered Tools:    ${ANSI.bold}${tools.length}${ANSI.reset}`);
  console.log(`  • Registered Skills:   ${ANSI.bold}${skills.length}${ANSI.reset}`);
  console.log(`  • Scheduled Triggers:  ${ANSI.bold}${triggers.length}${ANSI.reset}`);
  console.log(`  • Loaded Plugins:      ${ANSI.bold}${plugins.length}${ANSI.reset}`);
  console.log(`  • Active MCP Servers:  ${ANSI.bold}${mcpServers.length}${ANSI.reset}`);
  console.log(`  • Network Port:        ${runtime.networkManager ? `${ANSI.bold}${runtime.networkManager.getPort()}${ANSI.reset}` : 'Disabled'}`);
  console.log(`${ANSI.dim}────────────────────────────────────────────────────────${ANSI.reset}\n`);
}
