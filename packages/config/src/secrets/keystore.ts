import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export interface KeystorePayload {
  version: number;
  salt: string; // hex
  iv: string; // hex
  tag: string; // hex
  ciphertext: string; // hex
}

export interface IKeystore {
  getSecret(key: string): Promise<string | null>;
  setSecret(key: string, value: string): Promise<void>;
  deleteSecret(key: string): Promise<boolean>;
  listKeys(): Promise<string[]>;
}

/**
 * Keystore implementation defined by §19.6.
 * Encrypted secret storage for API keys and credentials using AES-256-GCM.
 */
export class Keystore implements IKeystore {
  private filePath: string;
  private passphrase?: string;
  private cache: Map<string, string> = new Map();
  private loaded: boolean = false;

  constructor(filePath?: string, passphrase?: string) {
    const rawPath = filePath ?? path.join(os.homedir(), '.fuckclaw', 'config', 'env.json.enc');
    this.filePath = rawPath.startsWith('~/')
      ? path.join(os.homedir(), rawPath.slice(2))
      : path.resolve(rawPath);
    this.passphrase = passphrase ?? process.env.FUCKCLAW_KEYSTORE_KEY ?? 'fuckclaw-local-default-passphrase';
  }

  private deriveKey(passphrase: string, salt: Buffer): Buffer {
    return crypto.pbkdf2Sync(passphrase, salt, 100_000, 32, 'sha256');
  }

  private loadSecrets(): void {
    if (this.loaded) return;
    this.loaded = true;

    if (!fs.existsSync(this.filePath)) {
      return;
    }

    try {
      const fileData = fs.readFileSync(this.filePath, 'utf8');
      const payload: KeystorePayload = JSON.parse(fileData);

      if (!payload.salt || !payload.iv || !payload.tag || !payload.ciphertext) {
        throw new Error('Invalid keystore file format');
      }

      const salt = Buffer.from(payload.salt, 'hex');
      const iv = Buffer.from(payload.iv, 'hex');
      const tag = Buffer.from(payload.tag, 'hex');
      const ciphertext = Buffer.from(payload.ciphertext, 'hex');

      const key = this.deriveKey(this.passphrase!, salt);
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(tag);

      const decrypted = Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]).toString('utf8');

      const data = JSON.parse(decrypted);
      if (data && typeof data === 'object') {
        for (const [k, v] of Object.entries(data)) {
          if (typeof v === 'string') {
            this.cache.set(k, v);
          }
        }
      }
    } catch (err: any) {
      if (err.message && err.message.includes('auth')) {
        throw new Error(`Failed to decrypt keystore: Invalid passphrase or corrupted keystore authentication tag`);
      }
      throw new Error(`Failed to load encrypted keystore: ${err.message}`);
    }
  }

  private saveSecrets(): void {
    const parentDir = path.dirname(this.filePath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    const plainObject: Record<string, string> = {};
    for (const [k, v] of this.cache.entries()) {
      plainObject[k] = v;
    }
    const plaintext = JSON.stringify(plainObject);

    const salt = crypto.randomBytes(16);
    const iv = crypto.randomBytes(12);
    const key = this.deriveKey(this.passphrase!, salt);

    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();

    const payload: KeystorePayload = {
      version: 1,
      salt: salt.toString('hex'),
      iv: iv.toString('hex'),
      tag: tag.toString('hex'),
      ciphertext: ciphertext.toString('hex'),
    };

    fs.writeFileSync(this.filePath, JSON.stringify(payload, null, 2), 'utf8');
  }

  async getSecret(key: string): Promise<string | null> {
    this.loadSecrets();
    return this.cache.get(key) ?? null;
  }

  async setSecret(key: string, value: string): Promise<void> {
    this.loadSecrets();
    this.cache.set(key, value);
    this.saveSecrets();
  }

  async deleteSecret(key: string): Promise<boolean> {
    this.loadSecrets();
    const deleted = this.cache.delete(key);
    if (deleted) {
      this.saveSecrets();
    }
    return deleted;
  }

  async listKeys(): Promise<string[]> {
    this.loadSecrets();
    return Array.from(this.cache.keys());
  }
}
