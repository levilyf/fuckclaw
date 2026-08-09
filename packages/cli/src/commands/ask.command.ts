import { FuckClawRuntimeInstance } from '../index.js';
import { StreamRenderer } from '../tui/stream-renderer.js';
import { Task, TaskState } from '@fuckclaw/kernel';

function stringifyObservation(value: unknown): string {
  if (value === undefined || value === null) return '';
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

export function renderTaskResult(task: Task): void {
  if (task.state === TaskState.CANCELLED) {
    StreamRenderer.renderError(`Task ${task.id} was cancelled.`);
    return;
  }

  if (task.state === TaskState.FAILED || task.error) {
    StreamRenderer.renderError(task.error?.message ?? `Task ${task.id} failed without a structured error.`);
    return;
  }

  if (task.state === TaskState.COMPLETED) {
    if (task.output !== undefined && task.output.trim().length > 0) {
      StreamRenderer.renderFinalResponse(task.output);
      return;
    }

    const visibleStep = [...(task.results ?? [])]
      .reverse()
      .find((step) => step.success && stringifyObservation(step.observation).trim().length > 0);
    if (visibleStep) {
      StreamRenderer.renderFinalResponse(stringifyObservation(visibleStep.observation));
      return;
    }

    StreamRenderer.renderWarning(
      `Task completed but produced no user-visible output. Task ID: ${task.id}. ` +
        `State: ${task.state}. Steps: ${task.results?.length ?? 0}.`
    );
    return;
  }

  StreamRenderer.renderWarning(`Task ${task.id} ended in state "${task.state}" without user-visible output.`);
}

export async function executeAskCommand(runtime: FuckClawRuntimeInstance, prompt: string): Promise<void> {
  if (!prompt || !prompt.trim()) {
    console.error('Error: Prompt cannot be empty');
    return;
  }

  try {
    const task = await runtime.kernel.submitTask({
      description: prompt,
      source: { type: 'user' },
    });

    renderTaskResult(task);
  } catch (err: unknown) {
    StreamRenderer.renderError((err as Error).message || String(err));
  }
}
