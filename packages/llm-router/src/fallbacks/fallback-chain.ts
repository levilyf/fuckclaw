import { IObservability } from '@fuckclaw/observability';
import { ILLMProvider, GenerationRequest, GenerationResponse } from '../types.js';

export class FallbackChain {
  constructor(private logger?: IObservability) {}

  async execute(providers: ILLMProvider[], request: GenerationRequest): Promise<GenerationResponse> {
    let lastError: unknown;

    for (const provider of providers) {
      try {
        return await provider.generate(request);
      } catch (err) {
        lastError = err;
        this.logger?.log({
          level: 'warn',
          module: 'llm-router',
          message: `Provider "${provider.name}" failed in fallback chain, trying next`,
          metadata: { error: String(err) },
        });
      }
    }

    throw new Error(`All LLM providers failed. Last error: ${String(lastError)}`);
  }
}
