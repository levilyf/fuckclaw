import { ILLMProvider, GenerationRequest, GenerationResponse } from '../types.js';

export class AnthropicProvider implements ILLMProvider {
  name = 'anthropic';

  async generate(_request: GenerationRequest): Promise<GenerationResponse> {
    throw new Error('Anthropic provider boundary is defined by the Implementation Specification but is not implemented in the current milestone.');
  }
}
