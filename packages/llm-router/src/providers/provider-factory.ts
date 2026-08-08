import { ILLMProvider } from '../types.js';
import { OpenAICompatibleProvider, OpenAICompatibleProviderOptions } from './openai.provider.js';
import { MockLLMProvider } from './mock.provider.js';

export class ProviderFactory {
  static createOpenAI(options: OpenAICompatibleProviderOptions): ILLMProvider {
    return new OpenAICompatibleProvider(options);
  }

  static createMock(name?: string, content?: string): ILLMProvider {
    return new MockLLMProvider(name, content);
  }
}
