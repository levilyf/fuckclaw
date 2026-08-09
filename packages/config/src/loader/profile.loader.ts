import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadConfigFile } from './file.loader.js';

/**
 * Profile loader boundary defined by §19.4.
 * Handles named configuration profiles (e.g., "work", "personal") stored in
 * ~/.fuckclaw/config/profiles/{profile_name}.toml (or custom profile directories).
 */
export function loadProfile(
  profileName: string,
  customProfilesDir?: string
): Record<string, unknown> {
  if (!profileName || profileName.trim().length === 0) {
    return {};
  }

  const profilesDir = customProfilesDir
    ? (customProfilesDir.startsWith('~/')
        ? path.join(os.homedir(), customProfilesDir.slice(2))
        : path.resolve(customProfilesDir))
    : path.join(os.homedir(), '.fuckclaw', 'config', 'profiles');

  const candidates = [
    path.join(profilesDir, `${profileName}.toml`),
    path.join(profilesDir, `${profileName}.json`),
    path.join(profilesDir, profileName),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      const config = loadConfigFile(candidate);
      if (config && Object.keys(config).length > 0) {
        return config;
      }
    }
  }

  return {};
}
