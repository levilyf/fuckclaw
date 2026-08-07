import { ConfigManager } from '@fuckclaw/config';
import { Logger } from '@fuckclaw/observability';
import { PersistenceLayer } from '@fuckclaw/persistence';
import { EventBus } from '@fuckclaw/event-bus';
import { WorkspaceManager } from '@fuckclaw/workspace';
import { ToolRuntime, ShellTool, FilesystemTool } from '@fuckclaw/tool-runtime';
import { LLMRouter, MockLLMProvider } from '@fuckclaw/llm-router';

async function verticalSlice() {
  console.log('=== FuckClaw Milestone 2 Execution Spine Demo ===');

  // 1. Initialize Base Infrastructure
  const config = new ConfigManager({ logging: { level: 'info' } });
  const logger = new Logger(config);
  const db = new PersistenceLayer(':memory:', logger);
  const bus = new EventBus(db, logger);

  // 2. Initialize Workspace
  const workspace = new WorkspaceManager(config, logger);
  await workspace.init();
  logger.log({ level: 'info', message: 'Workspace initialized', metadata: { root: workspace.getRoot() } });

  // 3. Initialize Tool Runtime with Native Tools
  const toolRuntime = new ToolRuntime(logger, bus);
  toolRuntime.register(new ShellTool());
  toolRuntime.register(new FilesystemTool(workspace));

  // 4. Initialize LLM Router
  const llmRouter = new LLMRouter(logger, bus);
  llmRouter.registerProvider(new MockLLMProvider('mock-claude', 'I will write a greeting file to test the workspace.'));

  // 5. Simulate "Thinking" (LLM Router call)
  logger.log({ level: 'info', message: 'Simulating prompt ingestion to LLM Router...' });
  const llmPlan = await llmRouter.generate({
    messages: [{ role: 'user', content: 'Generate a greeting artifact in the workspace.' }]
  });
  logger.log({ level: 'info', message: 'LLM reasoning output', metadata: { response: llmPlan.content } });

  // 6. Simulate "Acting" (Tool Execution Pipeline)
  logger.log({ level: 'info', message: 'Executing tool to fulfill action...' });
  const toolResult = await toolRuntime.execute('filesystem', {
    action: 'write',
    path: 'workspace/greeting.txt',
    content: 'Hello from FuckClaw Milestone 2 Execution Spine!'
  });
  logger.log({ level: 'info', message: 'Tool execution result', metadata: { output: toolResult.output, success: toolResult.success } });

  // Verify File Existence via Shell Tool
  const verifyResult = await toolRuntime.execute('shell', {
    command: `cat ${workspace.resolvePath('workspace', 'greeting.txt')}`
  });
  logger.log({ level: 'info', message: 'Verification read via shell tool', metadata: { content: verifyResult.output.trim() } });

  // 7. Cleanup
  db.close();
  console.log('=== Milestone 2 Execution Spine Demo Complete ===');
}

verticalSlice().catch(err => {
  console.error('Fatal error during Milestone 2 demo:', err);
  process.exit(1);
});
