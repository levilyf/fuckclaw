import { FuckClawRuntimeInstance } from '../index.js';
import { ANSI } from '../tui/banner.js';

export async function executePluginsCommand(
  runtime: FuckClawRuntimeInstance,
  subCommand: string = 'list'
): Promise<void> {
  if (!runtime.pluginManager) {
    console.error('Plugin subsystem is not initialized');
    return;
  }

  if (subCommand === 'list') {
    const plugins = runtime.pluginManager.list();
    console.log(`\n${ANSI.bold}${ANSI.cyan}Installed Plugins (${plugins.length}):${ANSI.reset}`);
    if (plugins.length === 0) {
      console.log(`  ${ANSI.dim}No plugins currently loaded.${ANSI.reset}\n`);
      return;
    }
    plugins.forEach((p) => {
      console.log(
        `  • ${ANSI.bold}${p.manifest.name}${ANSI.reset} (${p.manifest.id}@${p.manifest.version}) - [${ANSI.green}${p.state}${ANSI.reset}]`
      );
      if (p.manifest.description) {
        console.log(`    ${ANSI.dim}${p.manifest.description}${ANSI.reset}`);
      }
    });
    console.log();
  } else {
    console.error(`Unknown plugin subcommand "${subCommand}". Available: list`);
  }
}
