import { intro, outro, select, text, confirm, isCancel, spinner, note } from '@clack/prompts';
import { FuckClawRuntimeInstance } from '../index.js';
import { ANSI } from './banner.js';
import path from 'node:path';
import os from 'node:os';

export async function runOnboardingWizard(runtime: FuckClawRuntimeInstance): Promise<void> {
  console.clear();
  intro(`${ANSI.bold}${ANSI.cyan}FuckClaw - Initial Setup & Onboarding${ANSI.reset}`);

  note(
    'FuckClaw is an autonomous agent framework that runs locally on your machine.\n' +
    'It can execute shell commands, read/write files, and plan multi-step tasks.\n' +
    'Before we begin, we need to configure your LLM provider and workspace.',
    'Welcome'
  );

  // 1. Choose Provider
  const provider = await select({
    message: 'Which LLM Provider would you like to use?',
    options: [
      { value: 'anthropic', label: 'Anthropic (Claude 3.5 Sonnet)' },
      { value: 'google', label: 'Google (Gemini 1.5 Pro)' },
      { value: 'openai', label: 'OpenAI (GPT-4o)' },
      { value: 'skip', label: 'Skip for now (some features will be disabled)' },
    ],
  });
  if (isCancel(provider)) {
    outro('Onboarding cancelled.');
    process.exit(0);
  }

  const p = provider as string;
  let apiKey = '';

  if (p !== 'skip') {
    // 2. Get API Key
    const keyResp = await text({
      message: `Enter your API key for ${p}:`,
      placeholder: 'sk-...',
      validate: (value) => {
        if (!value || typeof value !== 'string' || !value.trim()) return 'API key is required to run the agent.';
        return;
      },
    });
    if (isCancel(keyResp)) {
      outro('Onboarding cancelled.');
      process.exit(0);
    }
    apiKey = keyResp as string;
  }

  // 3. Configure Workspace
  const defaultWorkspace = path.join(os.homedir(), '.fuckclaw');
  const workspacePath = await text({
    message: 'Where should FuckClaw store its memory, snapshots, and databases?',
    initialValue: defaultWorkspace,
    placeholder: defaultWorkspace,
  });
  if (isCancel(workspacePath)) {
    outro('Onboarding cancelled.');
    process.exit(0);
  }

  // 4. Budget
  const budget = await text({
    message: 'Set a maximum USD cost limit per task (to prevent runaway bills):',
    initialValue: '1.00',
    placeholder: '1.00',
  });
  if (isCancel(budget)) {
    outro('Onboarding cancelled.');
    process.exit(0);
  }

  const s = spinner();
  s.start('Saving configuration and initializing databases...');

  try {
    if (p !== 'skip') {
      await runtime.config.update(`providers.${p}.apiKey`, apiKey);
      
      // Set a sensible default model based on provider
      let defaultModel = 'default';
      if (p === 'anthropic') defaultModel = 'claude-3-5-sonnet-20241022';
      if (p === 'google') defaultModel = 'gemini-1.5-pro';
      if (p === 'openai') defaultModel = 'gpt-4o';
      
      await runtime.config.update(`providers.${p}.model`, defaultModel);
      await runtime.config.update('llm.provider', p);
      await runtime.config.update('llm.model', defaultModel);
    }
    
    await runtime.config.update('workspace.root', workspacePath);
    await runtime.config.update('budget.defaultTaskLimitUsd', parseFloat(budget as string) || 1.0);

    // Give persistence a moment to initialize in the new directory
    await new Promise((resolve) => setTimeout(resolve, 1000));
    s.stop('Configuration saved successfully to ~/.fuckclaw/config/fuckclaw.toml (Secrets encrypted via AES-256-GCM).');
  } catch (err: any) {
    s.stop(`Failed to save configuration: ${err.message}`);
    outro('Setup failed.');
    process.exit(1);
  }

  // 5. Test Task
  if (p !== 'skip') {
    const runTest = await confirm({
      message: 'Would you like to run a quick test task to verify the setup?',
      initialValue: true,
    });

    if (isCancel(runTest)) {
      outro('Onboarding cancelled.');
      process.exit(0);
    }

    if (runTest) {
      s.start('Executing test task: "Identify the current operating system and user."');
      try {
        const task = await runtime.kernel.submitTask({
          description: 'Identify the current operating system and user using shell commands. Be concise.',
          source: { type: 'user' },
        });
        s.stop(`Test Task Completed! Output: ${task.output}`);
      } catch (err: any) {
        s.stop(`Test Task Failed: ${err.message}`);
      }
    }
  }

  note(
    'FuckClaw is ready!\n\n' +
    'Run `fuckclaw run "<task>"` for headless execution.\n' +
    'Run `fuckclaw ask` to enter the interactive console.\n' +
    'Run `fuckclaw serve` to boot the daemon and Web Dashboard.',
    'Next Steps'
  );

  outro('Setup complete. Welcome to FuckClaw.');
}
