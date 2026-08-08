/**
 * Keystore boundary defined by IMPLEMENTATION-SPEC §4.1.
 * Encrypted secret storage for API keys and credentials.
 */
export class Keystore {
  constructor() {
    // Structural boundary; encrypted keystore deferred to post-v1.0
  }

  async getSecret(_key: string): Promise<string | null> {
    return null;
  }

  async setSecret(_key: string, _value: string): Promise<void> {
    throw new Error('Keystore is a deferred structural boundary and is not implemented in the current milestone.');
  }

  async deleteSecret(_key: string): Promise<boolean> {
    return false;
  }
}
