#!/usr/bin/env node
import { runTaskCLI } from './index.js';

const args = process.argv.slice(2);
const command = args[0];
const prompt = args.slice(1).join(' ');

async function main() {
  if (!command || command === '--help' || command === '-h') {
    console.log(`FuckClaw CLI - Personal AI Operating System (Milestone 3)
Usage:
  fuckclaw run "<task description>"   Submit and execute a task
  fuckclaw --help                     Show help
`);
    process.exit(0);
  }

  if (command === 'run') {
    if (!prompt) {
      console.error('Error: Task description required. Example: fuckclaw run "Create a file"');
      process.exit(1);
    }

    console.log(`[FuckClaw CLI] Submitting task: "${prompt}"`);
    try {
      const task = await runTaskCLI(prompt);
      console.log(`\n--- Task Result [State: ${task.state}] ---`);
      console.log(`Task ID: ${task.id}`);
      console.log(`Output:\n${task.output || '(no output)'}`);
      if (task.results && task.results.length > 0) {
        console.log(`\nSteps Executed: ${task.results.length}`);
        task.results.forEach((s) => {
          console.log(`  [Step ${s.step}] Action: ${s.action} | Success: ${s.success}`);
          if (s.observation !== undefined) {
            console.log(`    Observation: ${String(s.observation)}`);
          }
        });
      }
      if (task.state === 'failed') {
        console.error(`Task error: ${task.error?.message ?? 'unknown failure'}`);
        process.exitCode = 1;
      }
    } catch (err: any) {
      console.error(`\nTask Failed: ${err.message}`);
      process.exit(1);
    }
  } else {
    console.error(`Unknown command: ${command}. Use "fuckclaw --help" for guidance.`);
    process.exit(1);
  }
}

main();
