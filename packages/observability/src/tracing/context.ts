import { ISpan } from '../types.js';

export class TracingContext {
  private activeSpanStack: ISpan[] = [];

  push(span: ISpan): void {
    this.activeSpanStack.push(span);
  }

  pop(span: ISpan): void {
    const idx = this.activeSpanStack.indexOf(span);
    if (idx !== -1) {
      this.activeSpanStack.splice(idx, 1);
    }
  }

  getActive(): ISpan | undefined {
    return this.activeSpanStack[this.activeSpanStack.length - 1];
  }
}
