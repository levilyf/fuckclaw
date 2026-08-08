import fs from 'node:fs';
import path from 'node:path';

export class ArtifactStore {
  constructor(private artifactsDir: string) {}

  saveArtifact(name: string, content: string | Buffer): string {
    if (!fs.existsSync(this.artifactsDir)) {
      fs.mkdirSync(this.artifactsDir, { recursive: true });
    }
    const target = path.join(this.artifactsDir, name);
    fs.writeFileSync(target, content);
    return target;
  }

  readArtifact(name: string): Buffer | null {
    const target = path.join(this.artifactsDir, name);
    if (!fs.existsSync(target)) {
      return null;
    }
    return fs.readFileSync(target);
  }
}
