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

  // 1. Choose Compatibility Backend
  const compatibility = await select({
    message: 'Which API compatibility backend would you like to use?',
    options: [
      { value: 'openai', label: 'OpenAI Compatible (ChatGPT, vLLM, Ollama, local-ai)' },
      { value: 'anthropic', label: 'Anthropic Compatible (Claude)' },
      { value: 'google', label: 'Google Compatible (Gemini)' },
      { value: 'skip', label: 'Skip for now (some features will be disabled)' },
    ],
  });
  if (isCancel(compatibility)) {
    outro('Onboarding cancelled.');
    process.exit(0);
  }

  const p = compatibility as string;
  let baseUrl = '';
  let apiKey = '';
  let model = '';

  if (p !== 'skip') {
    // 2. Base URL
    let defaultBaseUrl = '';
    if (p === 'openai') defaultBaseUrl = 'https://api.openai.com/v1';
    if (p === 'anthropic') defaultBaseUrl = 'https://api.anthropic.com';
    if (p === 'google') defaultBaseUrl = 'https://generativelanguage.googleapis.com';

    const baseUrlResp = await text({
      message: `Enter the Base URL for the ${p} compatible endpoint:`,
      initialValue: defaultBaseUrl,
      placeholder: defaultBaseUrl,
    });
    if (isCancel(baseUrlResp)) {
      outro('Onboarding cancelled.');
      process.exit(0);
    }
    baseUrl = baseUrlResp as string;

    // 3. API Key
    const keyResp = await text({
      message: `Enter your API key for the ${p} backend (leave blank if local/unauthenticated):`,
      placeholder: 'sk-...',
    });
    if (isCancel(keyResp)) {
      outro('Onboarding cancelled.');
      process.exit(0);
    }
    apiKey = keyResp as string;

    // 4. Model Selection Flow
    const modelSelectionMode = await select({
      message: 'How would you like to select the model?',
      options: [
        { value: 'manual', label: 'Type the model name manually' },
        { value: 'auto', label: 'Fetch available models from the endpoint' },
      ],
    });
    if (isCancel(modelSelectionMode)) {
      outro('Onboarding cancelled.');
      process.exit(0);
    }

    if (modelSelectionMode === 'auto') {
      const s = spinner();
      s.start(`Fetching models from ${baseUrl}...`);
      
      try {
        // Mock fetch or true fetch logic goes here.
        // For CLI environment, we'll try to use the raw endpoint or fallback gracefully.
        if (p === 'openai') {
           const headers: Record<string, string> = {
              'Content-Type': 'application/json'
           };
           if (apiKey.trim()) {
              headers['Authorization'] = `Bearer ${apiKey}`;
           }
           const res = await fetch(`${baseUrl}/models`, { headers });
           if (!res.ok) {
             throw new Error(`HTTP Error ${res.status}: ${res.statusText}`);
           }
           const data = await res.json();
           const models = data.data?.map((m: any) => ({ value: m.id, label: m.id })) || [];
           s.stop(`Fetched ${models.length} models.`);
           
           if (models.length > 0) {
             const selectedModel = await select({
                message: 'Select a model:',
                options: models.slice(0, 50), // cap to avoid UI overflow
             });
             if (isCancel(selectedModel)) {
               outro('Onboarding cancelled.');
               process.exit(0);
             }
             model = selectedModel as string;
           } else {
             note('No models returned from endpoint.', 'Model Discovery Failed');
             model = await manualModelPrompt(p);
           }
        } else {
          s.stop('Model discovery is not supported for this compatibility backend yet.');
          note('This backend does not expose model listing.', 'Model Discovery Unavailable');
          model = await manualModelPrompt(p);
        }
      } catch (err: any) {
        s.stop(`Failed to fetch models: ${err.message}`);
        note('Please verify the base URL and API key, or enter the model name manually.', 'Connection Failed');
        model = await manualModelPrompt(p);
      }
    } else {
      model = await manualModelPrompt(p);
    }
  }

  async function manualModelPrompt(backend: string): Promise<string> {
    let defaultModel = '';
    if (backend === 'anthropic') defaultModel = 'claude-3-5-sonnet-20241022';
    if (backend === 'google') defaultModel = 'gemini-1.5-pro';
    if (backend === 'openai') defaultModel = 'gpt-4o';

    const m = await text({
      message: 'Enter the exact model name/ID:',
      initialValue: defaultModel,
      placeholder: defaultModel,
      validate: (v) => !v || !v.trim() ? 'Model name is required' : undefined,
    });
    if (isCancel(m)) {
      outro('Onboarding cancelled.');
      process.exit(0);
    }
    return m as string;
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
      await runtime.config.update(`providers.${p}.baseUrl`, baseUrl);
      await runtime.config.update(`providers.${p}.model`, model);
      
      await runtime.config.update('llm.provider', p);
      await runtime.config.update('llm.model', model);
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

  let testSuccess = false;

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
        // We must reinitialize the LLMRouter using the new configuration
        // because the runtime instance passed to onboarding was instantiated
        // with the OLD configuration (often "unconfigured-fallback").
        const OpenAICompatibleProvider = (await import('@fuckclaw/llm-router')).OpenAICompatibleProvider;
        const llmRouter = runtime.kernel.llmRouter;
        llmRouter.registerProvider(
          new OpenAICompatibleProvider({
            baseUrl,
            apiKey,
            model,
          }),
          true // make default
        );

        const task = await runtime.kernel.submitTask({
          description: 'Identify the current operating system and user using shell commands. Be concise.',
          source: { type: 'user' },
        });

        if (task.output && task.state === 'completed') {
          s.stop(`Test Task Completed! Output: ${task.output}`);
          testSuccess = true;
        } else {
          throw new Error(task.error?.message || 'Task completed without output.');
        }
      } catch (err: any) {
        s.stop(`Test Task Failed: ${err.message}`);
        
        note(
          'The configuration was saved, but FuckClaw could not execute a test task.\n\n' +
          `Reason:\n${err.message}\n\n` +
          'Your configuration has NOT been marked as verified.',
          '× Test task failed'
        );

        const nextAction = await select({
          message: 'What would you like to do?',
          options: [
             { value: 'retry', label: 'Retry test task' },
             { value: 'continue', label: 'Continue without testing (unverified setup)' },
             { value: 'exit', label: 'Exit' }
          ]
        });

        if (nextAction === 'exit' || isCancel(nextAction)) {
          process.exit(1);
        }
      }
    } else {
      note('You chose to skip the test task. Setup is unverified.', 'Unverified Setup');
    }
  }

  if (p === 'skip') {
    note(
      'FuckClaw has been initialized without an active LLM Provider.\n' +
      'Capabilities will be severely limited until configured.',
      'Limited Mode'
    );
  } else if (testSuccess) {
    note(
      'FuckClaw is ready!\n\n' +
      'Run `fuckclaw run "<task>"` for headless execution.\n' +
      'Run `fuckclaw ask` to enter the interactive console.\n' +
      'Run `fuckclaw serve` to boot the daemon and Web Dashboard.',
      'Next Steps'
    );
  }

  if (testSuccess) {
    outro('Setup complete. Welcome to FuckClaw.');
  } else if (p === 'skip' || !testSuccess) {
    outro('Setup complete (Unverified).');
  }
}
