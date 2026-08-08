export class LockManager {
  private locks: Set<string> = new Set();

  async acquire(key: string): Promise<() => void> {
    while (this.locks.has(key)) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    this.locks.add(key);
    return () => {
      this.locks.delete(key);
    };
  }

  isLocked(key: string): boolean {
    return this.locks.has(key);
  }
}
