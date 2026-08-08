export class ResourceLock {
  private activeLocks: Set<string> = new Set();

  acquire(resourceId: string): boolean {
    if (this.activeLocks.has(resourceId)) {
      return false;
    }
    this.activeLocks.add(resourceId);
    return true;
  }

  release(resourceId: string): void {
    this.activeLocks.delete(resourceId);
  }

  isLocked(resourceId: string): boolean {
    return this.activeLocks.has(resourceId);
  }
}
