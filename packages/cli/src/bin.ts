#!/usr/bin/env node
import {
  createFuckClawRuntime,
  executeAskCommand,
  executeRunCommand,
  executeStatusCommand,
  executeServeCommand,
  executeMcpCommand,
  executePluginsCommand,
  executeConfigCommand,
  InteractiveTUI,
} from './index.js';
import { runOnboardingWizard } from './tui/onboarding.js';
import { ANSI } from './tui/banner.js';

const args = process.argv.slice(2);
const command = args[0];
const subArgs = args.slice(1);

async function main() {
  if (!command || command === 'tui' || command === 'interactive') {
    const runtime = await createFuckClawRuntime({}, undefined, process.env, { allowUnconfiguredLLM: true });
    
    // First run detection
    const p = runtime.config.get().llm?.provider || 'anthropic';
    const configProviders = runtime.config.get().providers || {};
    const legacyApiKey = runtime.config.get().llm?.apiKey;
    const providerApiKey = configProviders[p]?.apiKey;
    
    if (!legacyApiKey && !providerApiKey) {
      console.log(`${ANSI.cyan}FuckClaw is not configured yet. Let's get you running.${ANSI.reset}\n`);
      await runOnboardingWizard(runtime);
      // Wait a moment and then start the console after setup finishes successfully.
      console.clear();
    }
    
    // Auto-launch the top-level console operator menu, not just the chat TUI
    const tui = new InteractiveTUI(runtime);
    
    // Check if we are running in full non-chat interactive mode
    if (command === 'tui' || command === 'interactive' || !command) {
      await (tui as any).showOperatorMenu();
    } else {
      await tui.start();
    }
    return;
  }

  if (command === '--help' || command === '-h' || command === 'help') {
    console.log(`
${ANSI.bold}${ANSI.cyan}FuckClaw - Autonomous Sovereign Intelligence Harness${ANSI.reset}

${ANSI.bold}Usage:${ANSI.reset}
  fuckclaw [command] [arguments...]

${ANSI.bold}Commands:${ANSI.reset}
  ${ANSI.cyan}ask <prompt>${ANSI.reset}                     Execute single-turn prompt
  ${ANSI.cyan}run <goal>${ANSI.reset}                       Autonomous multi-step planning & execution
  ${ANSI.cyan}status${ANSI.reset}                           Display status overview across all subsystems
  ${ANSI.cyan}serve [--port <port>]${ANSI.reset}            Start HTTP REST API and WebSocket gateway daemon
  ${ANSI.cyan}mcp [list|add] [args...]${ANSI.reset}         Inspect or connect Model Context Protocol servers
  ${ANSI.cyan}plugins [list]${ANSI.reset}                   Inspect installed and active dynamic plugins
  ${ANSI.cyan}config [key] [val]${ANSI.reset}               Inspect or modify configuration values
  ${ANSI.cyan}tui${ANSI.reset}                              Launch interactive top-level operator console
  ${ANSI.cyan}setup${ANSI.reset}                            Run the interactive onboarding wizard
  ${ANSI.cyan}--help, -h${ANSI.reset}                       Show this help message
`);
    process.exit(0);
  }

  const runtime = await createFuckClawRuntime({}, undefined, process.env, { allowUnconfiguredLLM: true });

  try {
    switch (command) {
      case 'setup':
        await runOnboardingWizard(runtime);
        break;

      case 'ask':
        await executeAskCommand(runtime, subArgs.join(' '));
        break;

      case 'run':
        await executeRunCommand(runtime, subArgs.join(' '));
        break;

      case 'status':
        await executeStatusCommand(runtime);
        break;

      case 'serve': {
        const portIdx = subArgs.indexOf('--port');
        const rawPort = portIdx !== -1 ? subArgs[portIdx + 1] : undefined;
        const port = rawPort ? parseInt(rawPort, 10) : 8420;
        await executeServeCommand(runtime, { port });
        break;
      }

      case 'mcp': {
        const mcpSub = subArgs[0] || 'list';
        await executeMcpCommand(runtime, mcpSub, ...subArgs.slice(1));
        break;
      }

      case 'plugins': {
        const pluginSub = subArgs[0] || 'list';
        await executePluginsCommand(runtime, pluginSub);
        break;
      }

      case 'config': {
        const cfgKey = subArgs[0];
        const cfgVal = subArgs[1];
        await executeConfigCommand(runtime, cfgKey, cfgVal);
        break;
      }

      default:
        console.error(`Unknown command: "${command}". Run "fuckclaw --help" for available commands.`);
        process.exitCode = 1;
        break;
    }
  } finally {
    if (command !== 'serve') {
      await runtime.shutdown();
    }
  }
}

main().catch((err) => {
  console.error(`\nFatal CLI Error: ${err.message || String(err)}`);
  process.exit(1);
});
