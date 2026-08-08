import { ILLMProvider, GenerationRequest, GenerationResponse } from '../types.js';

export class MockLLMProvider implements ILLMProvider {
  constructor(
    public readonly name: string = 'mock',
    private defaultContent: string = 'Mock response',
    private tokenUsage: { promptTokens: number; completionTokens: number; totalTokens: number } = {
      promptTokens: 10,
      completionTokens: 10,
      totalTokens: 20,
    }
  ) {}

  async generate(request: GenerationRequest): Promise<GenerationResponse> {
    return {
      content: this.defaultContent,
      provider: this.name,
      model: request.model ?? 'mock-v1',
      usage: this.tokenUsage,
    };
  }
}
