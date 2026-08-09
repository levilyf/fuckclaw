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
  registerConfiguredProvider,
} from './index.js';
import { runOnboardingWizard } from './tui/onboarding.js';
import { ANSI } from './tui/banner.js';
import { Keystore } from '@fuckclaw/config';
import path from 'node:path';
import os from 'node:os';

const args = process.argv.slice(2);
const command = args[0];
const subArgs = args.slice(1);

/**
 * Detect whether a provider is properly configured (not just has defaults).
 * For unauthenticated local endpoints: baseUrl + model is sufficient.
 * For remote endpoints: baseUrl + model + apiKey (from keystore or config).
 */
async function isProviderConfigured(runtime: Awaited<ReturnType<typeof createFuckClawRuntime>>): Promise<boolean> {
  const cfg = runtime.config.get();
  const llm = cfg.llm || {} as any;
  const providerName = (llm as any).provider || 'anthropic';
  const providers = cfg.providers || {};
  const providerCfg = (providers as any)[providerName] || {};
  const baseUrl = (providerCfg as any).baseUrl || (llm as any).baseUrl || '';
  const model = (providerCfg as any).model || (llm as any).model || '';

  if (!baseUrl || !model || model === 'default-model') {
    return false;
  }

  // Check if local unauthenticated endpoint
  try {
    const hostname = new URL(baseUrl).hostname.toLowerCase();
    const isLocal = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname.startsWith('192.168.') || hostname.startsWith('10.') || /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname);
    if (isLocal) return true;
  } catch {}

  // Remote endpoint: check for API key in config or keystore
  const configApiKey = (providerCfg as any).apiKey || (llm as any).apiKey || '';
  if (configApiKey) return true;

  try {
    const keystorePath = (runtime.config as any).getKeystorePath?.() ||
      path.join(os.homedir(), '.fuckclaw', 'config', 'env.json.enc');
    const keystore = new Keystore(keystorePath);
    const secret = await keystore.getSecret(`providers.${providerName}.apiKey`);
    if (secret) return true;
  } catch {}

  return false;
}

async function main() {
  // Default launch (no command) → chat mode with onboarding if needed
  if (!command) {
    const runtime = await createFuckClawRuntime({}, undefined, process.env, { allowUnconfiguredLLM: true, disableConsoleLogging: true });

    const configured = await isProviderConfigured(runtime);

    if (!configured) {
      console.log(`${ANSI.cyan}FuckClaw is not configured yet. Let's get you running.${ANSI.reset}\n`);
      await runOnboardingWizard(runtime);
      // Re-register the provider after onboarding
      await registerConfiguredProvider(runtime.config, runtime.llmRouter, process.env);
      console.clear();
    }

    // Launch interactive chat mode (NOT operator menu)
    const tui = new InteractiveTUI(runtime);
    await tui.start();
    return;
  }

  // Explicit `tui` or `interactive` → operator console
  if (command === 'tui' || command === 'interactive') {
    const runtime = await createFuckClawRuntime({}, undefined, process.env, { allowUnconfiguredLLM: true, disableConsoleLogging: true });

    const configured = await isProviderConfigured(runtime);
    if (!configured) {
      console.log(`${ANSI.cyan}FuckClaw is not configured yet. Let's get you running.${ANSI.reset}\n`);
      await runOnboardingWizard(runtime);
      await registerConfiguredProvider(runtime.config, runtime.llmRouter, process.env);
      console.clear();
    }

    const tui = new InteractiveTUI(runtime);
    await (tui as any).showOperatorMenu();
    return;
  }

  if (command === '--help' || command === '-h' || command === 'help') {
    console.log(`
${ANSI.bold}${ANSI.cyan}FuckClaw - Autonomous Sovereign Intelligence Harness${ANSI.reset}

${ANSI.bold}Usage:${ANSI.reset}
  fuckclaw [command] [arguments...]

${ANSI.bold}Commands:${ANSI.reset}
  ${ANSI.cyan}(no command)${ANSI.reset}                      Launch interactive chat mode
  ${ANSI.cyan}ask <prompt>${ANSI.reset}                     Execute single-turn prompt
  ${ANSI.cyan}run <goal>${ANSI.reset}                       Autonomous multi-step planning & execution
  ${ANSI.cyan}status${ANSI.reset}                           Display status overview across all subsystems
  ${ANSI.cyan}serve [--port <port>]${ANSI.reset}            Start HTTP REST API and WebSocket gateway daemon
  ${ANSI.cyan}mcp [list|add] [args...]${ANSI.reset}         Inspect or connect Model Context Protocol servers
  ${ANSI.cyan}plugins [list]${ANSI.reset}                   Inspect installed and active dynamic plugins
  ${ANSI.cyan}config [key] [val]${ANSI.reset}               Inspect or modify configuration values
  ${ANSI.cyan}tui${ANSI.reset}                              Launch operator console (health, providers, tools, etc.)
  ${ANSI.cyan}setup${ANSI.reset}                            Run the interactive onboarding wizard
  ${ANSI.cyan}--help, -h${ANSI.reset}                       Show this help message
`);
    process.exit(0);
  }

  const runtime = await createFuckClawRuntime({}, undefined, process.env, { allowUnconfiguredLLM: true, disableConsoleLogging: command === 'setup' || command === 'ask' });

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
