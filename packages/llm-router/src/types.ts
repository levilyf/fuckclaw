export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface GenerationRequest {
  messages: ChatMessage[];
  provider?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  taskId?: string;
}

export interface GenerationResponse {
  content: string;
  provider: string;
  model: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  costUsd?: number;
  latencyMs?: number;
}

export interface ILLMProvider {
  name: string;
  generate(request: GenerationRequest): Promise<GenerationResponse>;
}

export interface ILLMRouter {
  registerProvider(provider: ILLMProvider, isDefault?: boolean): void;
  generate(request: GenerationRequest): Promise<GenerationResponse>;
  estimateCost(model: string, promptTokens: number, completionTokens: number): number;
}
