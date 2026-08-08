import { ConversationTurn, WorkingMemorySnapshot } from '../types.js';

export class WorkingMemory {
  public sessionId: string;
  public activeTaskId: string | null = null;
  private scratchpad: Map<string, unknown> = new Map();
  private turnBuffer: ConversationTurn[] = [];

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  set(key: string, value: unknown): void {
    this.scratchpad.set(key, value);
  }

  get<T>(key: string): T | undefined {
    return this.scratchpad.get(key) as T | undefined;
  }

  delete(key: string): boolean {
    return this.scratchpad.delete(key);
  }

  appendTurn(turn: ConversationTurn): void {
    this.turnBuffer.push(turn);
  }

  getTurns(): readonly ConversationTurn[] {
    return this.turnBuffer;
  }

  clearTurns(): void {
    this.turnBuffer = [];
  }

  snapshot(): WorkingMemorySnapshot {
    const scratchpadObj: Record<string, unknown> = {};
    for (const [k, v] of this.scratchpad) {
      scratchpadObj[k] = v;
    }
    return {
      sessionId: this.sessionId,
      activeTaskId: this.activeTaskId,
      scratchpad: scratchpadObj,
      turnBuffer: [...this.turnBuffer],
    };
  }

  restore(snap: WorkingMemorySnapshot): void {
    this.sessionId = snap.sessionId;
    this.activeTaskId = snap.activeTaskId;
    this.scratchpad.clear();
    for (const [k, v] of Object.entries(snap.scratchpad)) {
      this.scratchpad.set(k, v);
    }
    this.turnBuffer = [...snap.turnBuffer];
  }
}
