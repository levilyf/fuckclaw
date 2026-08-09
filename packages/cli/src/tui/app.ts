import readline from 'node:readline';
import { FuckClawRuntimeInstance } from '../index.js';
import { renderBanner, ANSI } from './banner.js';
import { renderStatusBar } from './status-bar.js';
import { StreamRenderer } from './stream-renderer.js';
import { executeStatusCommand } from '../commands/status.command.js';
import { select, isCancel, text, note } from '@clack/prompts';

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
        console.log(`  ${ANSI.cyan}/menu${ANSI.reset}     - Open the interactive operator console menu`);
        console.log(`  ${ANSI.cyan}/clear${ANSI.reset}    - Clear the terminal screen`);
        console.log(`  ${ANSI.cyan}/exit${ANSI.reset}     - Exit interactive session`);
        console.log(`  <prompt>  - Execute natural language prompt or autonomous goal\n`);
        this.rl?.prompt();
        return;
      }

      if (trimmed === '/menu') {
        // Pause readline while Clack takes over
        this.rl?.pause();
        await this.showOperatorMenu();
        this.rl?.resume();
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

  private async showOperatorMenu(): Promise<void> {
    this.isRunning = true;
    console.clear();
    console.log(renderBanner());

    while (this.isRunning) {
      const action = await select({
        message: 'Operator Console',
        options: [
          { value: 'run_task', label: '▶ Run Task' },
          { value: 'tasks', label: '📋 Tasks (Active/History)' },
          { value: 'status', label: '📊 System Status & Health' },
          { value: 'providers', label: '🔑 Providers & Configuration' },
          { value: 'workspace', label: '📁 Workspace' },
          { value: 'memory', label: '🧠 Memory' },
          { value: 'tools', label: '🛠️  Tools' },
          { value: 'plugins', label: '🧩 Plugins' },
          { value: 'mcp', label: '🔌 MCP Connections' },
          { value: 'scheduler', label: '⏰ Scheduler' },
          { value: 'multi_agent', label: '🤖 Multi-Agent' },
          { value: 'self_improvement', label: '📈 Self-Improvement' },
          { value: 'logs', label: '📋 Logs & Timeline' },
          { value: 'chat', label: '💬 Switch to Streaming Chat' },
          { value: 'exit', label: '🔙 Exit' },
        ],
      });

      if (isCancel(action) || action === 'exit') {
        this.stop();
        return;
      }
      
      if (action === 'chat') {
        await this.start();
        return;
      }

      switch (action) {
        case 'run_task':
          await this.interactiveRunTask();
          break;
        case 'status':
          await this.viewHealthStatus();
          await this.pause();
          break;
        case 'tasks':
          await this.viewTaskManagement();
          break;
        case 'providers':
          await this.manageProviders();
          break;
        case 'workspace':
          await this.viewWorkspace();
          break;
        case 'memory':
          await this.viewMemory();
          break;
        case 'tools':
          this.viewTools();
          await this.pause();
          break;
        case 'plugins':
          await this.viewPlugins();
          break;
        case 'mcp':
          await this.viewMCP();
          break;
        case 'scheduler':
          this.viewScheduler();
          await this.pause();
          break;
        case 'multi_agent':
          await this.viewMultiAgent();
          break;
        case 'self_improvement':
          await this.viewSelfImprovement();
          break;
        case 'logs':
          await this.viewLogs();
          break;
      }
    }
  }

  private async viewHealthStatus(): Promise<void> {
    console.clear();
    const rt = this.runtime;
    const llm = rt.config.get().llm;
    const providerStatus = llm?.provider ? `CONNECTED (${llm.provider})` : 'UNCONFIGURED';
    
    let mcpCount = 0;
    try {
      mcpCount = rt.mcpManager ? rt.mcpManager.listServers().length : 0;
    } catch (err) {
      mcpCount = 0;
    }
    
    let pluginCount = 0;
    try {
      pluginCount = rt.pluginManager ? rt.pluginManager.list().length : 0;
    } catch (err) {
      pluginCount = 0;
    }

    let kernelState = 'UNAVAILABLE';
    try {
       kernelState = rt.kernel ? rt.kernel.getState().toUpperCase() : 'UNAVAILABLE';
    } catch (err) {
       kernelState = 'ERROR';
    }

    const status = `
${ANSI.bold}System Health Overview${ANSI.reset}

Kernel          ${kernelState === 'IDLE' || kernelState === 'EXECUTING' ? ANSI.green + 'READY' + ANSI.reset : ANSI.yellow + kernelState + ANSI.reset}
Persistence     ${ANSI.green}CONNECTED${ANSI.reset}
LLM Provider    ${llm?.provider ? ANSI.green + providerStatus + ANSI.reset : ANSI.red + providerStatus + ANSI.reset}
Memory          ${rt.memory ? ANSI.green + 'READY' + ANSI.reset : ANSI.red + 'UNAVAILABLE' + ANSI.reset}
Tool Runtime    ${rt.toolRuntime ? ANSI.green + 'READY' + ANSI.reset : ANSI.red + 'UNAVAILABLE' + ANSI.reset}
Scheduler       ${rt.scheduler ? ANSI.green + 'RUNNING' + ANSI.reset : ANSI.yellow + 'STOPPED' + ANSI.reset}
MCP             ${rt.mcpManager ? ANSI.green + mcpCount + ' connections' + ANSI.reset : ANSI.red + 'UNAVAILABLE' + ANSI.reset}
Plugins         ${rt.pluginManager ? ANSI.green + pluginCount + ' loaded' + ANSI.reset : ANSI.red + 'UNAVAILABLE' + ANSI.reset}
Workspace       ${rt.config.get().workspace?.root || '~/.fuckclaw'}
`;
    console.log(status);
  }

  private async interactiveRunTask(): Promise<void> {
    const goal = await text({
      message: 'Enter the task description:',
      placeholder: 'e.g., Refactor src/auth.ts to use bcrypt',
      validate: (value) => {
        if (!value || typeof value !== 'string' || !value.trim()) return 'Task description is required.';
        return;
      },
    });

    if (isCancel(goal)) return;

    try {
      console.log(`\n${ANSI.cyan}Submitting task to Kernel...${ANSI.reset}`);
      const task = await this.runtime.kernel.submitTask({
        description: goal as string,
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
    await this.pause();
  }

  private async viewTaskManagement(): Promise<void> {
    const action = await select({
      message: 'Task Management',
      options: [
        { value: 'active', label: 'Active Tasks' },
        { value: 'history', label: 'Recent Task History' },
        { value: 'back', label: '🔙 Back' }
      ]
    });

    if (isCancel(action) || action === 'back') return;

    if (action === 'active') {
      const tasks = this.runtime.kernel.listTasks();
      if (tasks.length === 0) {
        note('No tasks are currently active or queued.', 'Active Tasks');
      } else {
        let msg = '';
        tasks.forEach((t) => {
          msg += `[${t.state.toUpperCase()}] ${t.id} - ${t.description.substring(0, 60)}...\n`;
        });
        note(msg.trim(), 'Active Tasks');
      }
    } else if (action === 'history') {
      try {
        const repo = (this.runtime.persistence as any).taskRepo;
        if (!repo) {
          note('Task repository is unavailable.', 'Error');
        } else {
          const recentTasks = await repo.listRecent(10);
          if (recentTasks.length === 0) {
            note('No recent tasks found in history.', 'Task History');
          } else {
            let msg = '';
            recentTasks.forEach((t: any) => {
              msg += `[${t.state.toUpperCase()}] ${t.id} - ${t.description.substring(0, 60)}...\n`;
            });
            note(msg.trim(), 'Recent Task History (Last 10)');
          }
        }
      } catch (err: any) {
        note(`Failed to fetch history: ${err.message}`, 'Error');
      }
    }
    await this.pause();
  }

  private async manageProviders(): Promise<void> {
    const llm = this.runtime.config.get().llm;
    const pProviders = this.runtime.config.get().providers || {};
    const currentProvider = llm?.provider || 'none';
    
    // Mask API key for display
    let maskedKey = 'none';
    const activeKey = pProviders[currentProvider]?.apiKey || llm?.apiKey;
    if (activeKey) {
      if (activeKey.length > 8) {
        maskedKey = `${activeKey.substring(0, 4)}••••••••••••${activeKey.substring(activeKey.length - 4)}`;
      } else {
        maskedKey = '••••••••';
      }
    }

    note(
      `Active Compatibility Backend: ${currentProvider}\n` +
      `Active Model: ${pProviders[currentProvider]?.model || llm?.model || 'default'}\n` +
      `Base URL: ${pProviders[currentProvider]?.baseUrl || 'default'}\n` +
      `API Key: ${maskedKey}`,
      'Current LLM Configuration'
    );

    const provider = await select({
      message: 'Select a compatibility backend to configure:',
      options: [
        { value: 'openai', label: 'OpenAI Compatible (ChatGPT, vLLM, Ollama, local-ai)' },
        { value: 'anthropic', label: 'Anthropic Compatible (Claude)' },
        { value: 'google', label: 'Google Compatible (Gemini)' },
        { value: 'back', label: '🔙 Back' },
      ],
    });

    if (isCancel(provider) || provider === 'back') return;

    const p = provider as string;

    let defaultBaseUrl = '';
    if (p === 'openai') defaultBaseUrl = 'https://api.openai.com/v1';
    if (p === 'anthropic') defaultBaseUrl = 'https://api.anthropic.com';
    if (p === 'google') defaultBaseUrl = 'https://generativelanguage.googleapis.com';

    const baseUrlResp = await text({
      message: `Enter the Base URL for the ${p} compatible endpoint:`,
      initialValue: defaultBaseUrl,
      placeholder: defaultBaseUrl,
    });
    if (isCancel(baseUrlResp)) return;
    const baseUrl = baseUrlResp as string;

    const apiKey = await text({
      message: `Enter new API key for the ${p} backend (leave blank if local/unauthenticated):`,
      placeholder: 'sk-...',
    });

    if (isCancel(apiKey)) return;
    const key = apiKey as string;

    const modelSelectionMode = await select({
      message: 'How would you like to select the model?',
      options: [
        { value: 'manual', label: 'Type the model name manually' },
        { value: 'auto', label: 'Fetch available models from the endpoint' },
      ],
    });
    
    if (isCancel(modelSelectionMode)) return;

    let model = '';
    if (modelSelectionMode === 'auto') {
      try {
        if (p === 'openai') {
           const headers: Record<string, string> = {
              'Content-Type': 'application/json'
           };
           if (key.trim()) {
              headers['Authorization'] = `Bearer ${key}`;
           }
           const res = await fetch(`${baseUrl}/models`, { headers });
           if (!res.ok) {
             throw new Error(`HTTP Error ${res.status}: ${res.statusText}`);
           }
           const data = await res.json();
           const models = data.data?.map((m: any) => ({ value: m.id, label: m.id })) || [];
           
           if (models.length > 0) {
             const selectedModel = await select({
                message: 'Select a model:',
                options: models.slice(0, 50),
             });
             if (isCancel(selectedModel)) return;
             model = selectedModel as string;
           } else {
             note('No models returned from endpoint.', 'Model Discovery Failed');
             model = await this.manualModelPrompt(p);
           }
        } else {
          note('This backend does not expose model listing.', 'Model Discovery Unavailable');
          model = await this.manualModelPrompt(p);
        }
      } catch (err: any) {
        note(`Failed to fetch models: ${err.message}`, 'Connection Failed');
        model = await this.manualModelPrompt(p);
      }
    } else {
      model = await this.manualModelPrompt(p);
    }

    try {
      await this.runtime.config.update(`providers.${p}.apiKey`, key);
      await this.runtime.config.update(`providers.${p}.baseUrl`, baseUrl);
      await this.runtime.config.update(`providers.${p}.model`, model);
      await this.runtime.config.update('llm.provider', p);
      await this.runtime.config.update('llm.model', model);
      note(`Configuration updated securely in keystore for ${p}.`, 'Success');
    } catch (err: any) {
      StreamRenderer.renderError(`Failed to update config: ${err.message}`);
    }
    await this.pause();
  }

  private async manualModelPrompt(backend: string): Promise<string> {
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
    
    // We handle cancellation higher up or return empty string if cancelled
    if (isCancel(m)) return defaultModel;
    return m as string;
  }

  private viewTools(): void {
    if (!this.runtime.toolRuntime) {
      note('Tool Runtime is not initialized.', 'Tools');
      return;
    }
    const tools = this.runtime.toolRuntime.list();
    if (tools.length === 0) {
      note('No tools are registered.', 'Tools');
      return;
    }
    let msg = '';
    tools.forEach((t) => {
      msg += `• ${ANSI.bold}${t.name}${ANSI.reset}: ${t.description}\n`;
    });
    note(msg.trim(), `Registered Tools (${tools.length})`);
  }

  private async viewWorkspace(): Promise<void> {
    const ws = this.runtime.workspace;
    const wsRoot = this.runtime.config.get().workspace?.root || '~/.fuckclaw';
    
    note(`Root Directory: ${wsRoot}\nInitialized: ${ws ? 'Yes' : 'No'}`, 'Workspace Overview');
    
    const action = await select({
      message: 'Workspace Actions',
      options: [
        { value: 'snapshots', label: 'View Snapshots' },
        { value: 'back', label: '🔙 Back' }
      ]
    });

    if (isCancel(action) || action === 'back') return;

    if (action === 'snapshots') {
      try {
        if (!ws) throw new Error('Workspace Manager unavailable');
        const snapshots = await (ws as any).zstdArchiver?.listSnapshots() || [];
        if (snapshots.length === 0) {
          note('No compressed snapshots found.', 'Snapshots');
        } else {
          note(snapshots.join('\n'), `Available Snapshots (${snapshots.length})`);
        }
      } catch (err: any) {
        note(err.message, 'Snapshot Error');
      }
    }
    await this.pause();
  }

  private async viewMemory(): Promise<void> {
    if (!this.runtime.memory) {
      note('Memory System is not initialized.', 'Memory');
      await this.pause();
      return;
    }
    
    const action = await select({
      message: 'Memory Inspection',
      options: [
        { value: 'summary', label: 'Working Memory Summary' },
        { value: 'search', label: 'Search Semantic Facts' },
        { value: 'consolidate', label: 'Run Consolidation Cycle' },
        { value: 'back', label: '🔙 Back' }
      ]
    });

    if (isCancel(action) || action === 'back') return;

    if (action === 'summary') {
      try {
        const workingMemory = (this.runtime.memory as any).workingMemory;
        if (!workingMemory) throw new Error('Working Memory unavailable');
        const summary = await workingMemory.summarizeContext();
        note(summary || 'Working memory is empty.', 'Context Summary');
      } catch (err: any) {
        note(`Failed to generate summary: ${err.message}`, 'Error');
      }
    } else if (action === 'search') {
      const query = await text({
        message: 'Enter search term:',
        placeholder: 'e.g., database migrations',
      });
      
      if (!isCancel(query) && query.toString().trim()) {
        try {
          const semanticStore = (this.runtime.memory as any).semanticStore;
          if (!semanticStore) throw new Error('Semantic Store unavailable');
          const results = await semanticStore.search(query.toString().trim(), 5);
          if (results.length === 0) {
            note('No matching facts found.', 'Search Results');
          } else {
            let msg = '';
            results.forEach((r: any) => {
              msg += `• [${(r.confidence * 100).toFixed(0)}%] ${r.fact}\n`;
            });
            note(msg.trim(), `Semantic Facts (${results.length})`);
          }
        } catch (err: any) {
          note(`Search failed: ${err.message}`, 'Error');
        }
      }
    } else if (action === 'consolidate') {
      console.log(`\n${ANSI.cyan}Running consolidation...${ANSI.reset}`);
      try {
        const report = await this.runtime.memory.runConsolidationCycle();
        note(
          `Episodes Processed: ${report.episodesProcessed}\n` +
          `Facts Extracted: ${report.factsExtracted}`,
          'Consolidation Report'
        );
      } catch (err: any) {
        note(`Consolidation failed: ${err.message}`, 'Error');
      }
    }
    
    await this.pause();
  }

  private async viewMultiAgent(): Promise<void> {
    const ma = this.runtime.multiAgent;
    if (!ma) {
      note('Multi-Agent subsystem is not available.', 'Multi-Agent');
      await this.pause();
      return;
    }

    const agents = (ma as any).pool ? (ma as any).pool.getRegisteredAgents?.() || [] : [];
    let msg = `Registered Roles: ${agents.length}\n\n`;
    agents.forEach((a: any) => {
      msg += `• ${ANSI.bold}${a.role}${ANSI.reset}\n`;
      msg += `  Budget: $${a.budgetUsd} | Instance Limit: ${a.instanceLimit}\n`;
      msg += `  Tools: ${a.toolWhitelist.join(', ')}\n\n`;
    });

    note(msg.trim(), 'Agent Roles (§15.2)');
    await this.pause();
  }

  private async viewSelfImprovement(): Promise<void> {
    const si = this.runtime.selfImprovement;
    if (!si) {
      note('Self-Improvement subsystem is not available.', 'Self-Improvement');
      await this.pause();
      return;
    }

    try {
      const store = (si as any).antiPatternStore;
      if (!store) throw new Error('Anti-Pattern Store unavailable');
      const patterns = await store.getRecentAntiPatterns(5);
      
      if (patterns.length === 0) {
        note('No anti-patterns detected recently.', 'Self-Improvement (§23)');
      } else {
        let msg = '';
        patterns.forEach((p: any) => {
          msg += `Pattern [Confidence: ${(p.confidence * 100).toFixed(0)}%]\n`;
          msg += `Context: ${p.context}\n`;
          msg += `Mistake: ${p.mistake}\n`;
          msg += `Correction: ${p.correctiveAction}\n\n`;
        });
        note(msg.trim(), 'Recent Anti-Patterns');
      }
    } catch (err: any) {
      note(err.message, 'Self-Improvement Error');
    }
    await this.pause();
  }

  private async viewLogs(): Promise<void> {
    const action = await select({
      message: 'Observability & Logs',
      options: [
        { value: 'audit', label: 'Recent Audit Logs' },
        { value: 'back', label: '🔙 Back' }
      ]
    });

    if (isCancel(action) || action === 'back') return;

    if (action === 'audit') {
      try {
        const logger = this.runtime.logger;
        // The logger interface exposes the audit logger in the default configuration
        const logs = (logger as any).auditLogger?.getRecentEntries ? await (logger as any).auditLogger.getRecentEntries(10) : [];
        if (logs.length === 0) {
          note('No recent audit logs available or audit logging disabled.', 'Audit Logs');
        } else {
          let msg = '';
          logs.forEach((l: any) => {
            msg += `[${new Date(l.timestamp).toISOString()}] ${l.action} - ${l.status}\n`;
          });
          note(msg.trim(), 'Recent Audit Logs (Last 10)');
        }
      } catch (err: any) {
        note(`Failed to fetch logs: ${err.message}`, 'Log Error');
      }
    }
    await this.pause();
  }

  private async viewPlugins(): Promise<void> {
    const pm = this.runtime.pluginManager;
    if (!pm) {
      note('Plugin subsystem is not available.', 'Plugins');
      await this.pause();
      return;
    }

    try {
      const plugins = pm.list();
      if (plugins.length === 0) {
        note('No plugins are currently loaded.', 'Plugins');
      } else {
        let msg = '';
        plugins.forEach((p: any) => {
          msg += `• ${ANSI.bold}${p.manifest?.name || p.manifest?.id}${ANSI.reset} (v${p.manifest?.version || 'unknown'})\n`;
          msg += `  Status: ${p.status?.toUpperCase() || 'UNKNOWN'}\n`;
          msg += `  Author: ${p.manifest?.author || 'Unknown'}\n\n`;
        });
        note(msg.trim(), `Loaded Plugins (${plugins.length})`);
      }
    } catch (err: any) {
      note(`Failed to list plugins: ${err.message}`, 'Plugins Error');
    }
    await this.pause();
  }

  private async viewMCP(): Promise<void> {
    const mcp = this.runtime.mcpManager;
    if (!mcp) {
      note('MCP subsystem is not available.', 'Model Context Protocol');
      await this.pause();
      return;
    }

    try {
      const servers = mcp.listServers();
      if (servers.length === 0) {
        note('No MCP servers are currently connected.', 'Model Context Protocol');
      } else {
        let msg = '';
        servers.forEach((s: any) => {
          msg += `• ${ANSI.bold}${s.id}${ANSI.reset} (${s.name || 'Unknown'})\n`;
          msg += `  Transport: ${s.transportType || 'Unknown'}\n`;
          msg += `  Status: ${s.status || 'CONNECTED'}\n\n`;
        });
        note(msg.trim(), `Active MCP Connections (${servers.length})`);
      }
    } catch (err: any) {
      note(`Failed to list MCP connections: ${err.message}`, 'MCP Error');
    }
    await this.pause();
  }

  private viewScheduler(): void {
    if (!this.runtime.scheduler) {
      note('Scheduler is not initialized.', 'Scheduler');
      return;
    }
    const cronJobs = (this.runtime.scheduler as any).cronRunner?.getJobs() || [];
    if (cronJobs.length === 0) {
      note('No cron jobs are currently registered.', 'Scheduler Triggers');
    } else {
      let msg = '';
      cronJobs.forEach((job: any) => {
        msg += `• [${job.expression}] ${job.id}\n`;
      });
      note(msg.trim(), `Active Scheduler Triggers (${cronJobs.length})`);
    }
  }

  private async pause(): Promise<void> {
    await text({
      message: 'Press Enter to continue...',
      placeholder: '',
      defaultValue: '',
    });
  }
}
