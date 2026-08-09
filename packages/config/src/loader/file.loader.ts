import { existsSync, readFileSync } from 'node:fs';
import { parse as parseToml } from 'smol-toml';

/**
 * File loader boundary defined by §19.2.
 * Reads and parses TOML/JSON config files from filesystem paths.
 */
export function loadConfigFile(filePath: string): Record<string, unknown> {
  if (!existsSync(filePath)) {
    return {};
  }

  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf-8');
  } catch (err: any) {
    throw new Error(`Configuration file exists but is unreadable: ${filePath}: ${err.message}`);
  }

  if (filePath.endsWith('.json')) {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch (err: any) {
      throw new Error(`Malformed JSON configuration file: ${filePath}: ${err.message}`);
    }
  }

  try {
    return parseToml(raw) as Record<string, unknown>;
  } catch (tomlErr: any) {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      throw new Error(`Malformed TOML configuration file: ${filePath}: ${tomlErr.message}`);
    }
  }
}
