import { FuckClawRuntimeInstance } from '../index.js';
import { StreamRenderer } from '../tui/stream-renderer.js';

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

    if (task.output) {
      StreamRenderer.renderFinalResponse(task.output);
    } else if (task.error) {
      StreamRenderer.renderError(task.error.message);
    }
  } catch (err: unknown) {
    StreamRenderer.renderError((err as Error).message || String(err));
  }
}
