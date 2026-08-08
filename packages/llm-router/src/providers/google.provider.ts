import { ILLMProvider, GenerationRequest, GenerationResponse } from '../types.js';

export class GoogleProvider implements ILLMProvider {
  name = 'google';

  async generate(_request: GenerationRequest): Promise<GenerationResponse> {
    throw new Error('Google provider boundary is defined by the Implementation Specification but is not implemented in the current milestone.');
  }
}
