export class FuckClawError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'FuckClawError';
  }
}

export interface SystemEvent {
  id: string;
  timestamp: string;
  type: string;
  payload: Record<string, unknown>;
}
