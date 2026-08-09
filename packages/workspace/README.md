# @fuckclaw/workspace

The `@fuckclaw/workspace` package manages the physical files, directories, and safety boundaries for the AI's execution environment.

## What it does
It ensures that when the AI writes code or modifies files, it does so safely. The most critical feature of this package is **State Rollback**: it can take highly compressed snapshots of a directory before the AI touches it, and instantly restore that snapshot if the task fails or corrupts your data.

## Intended Audience
- **All Users**: If you ask FuckClaw to do a massive refactor on your codebase, you rely on this package to snapshot the workspace first. If the AI hallucinates destructive commands, you can roll back to the clean snapshot automatically.

## Key Behaviors
- **Snapshot Archiver**: Creates `.tar.zst` (Zstandard) archives of the working directory. Zstandard is used because it compresses large node_modules directories exceptionally fast.
- **Integrity Verification**: Generates and verifies SHA-256 hashes of snapshots (via `.meta.json` manifests) to ensure backups haven't been tampered with or corrupted.
- **Rollback Engine**: Instantly decompresses a snapshot and restores the exact filesystem state.
- **Path Confinement**: Enforces strict directory boundaries, ensuring the agent cannot use path traversal tricks (e.g., `../../etc/passwd`) to escape the designated workspace root.

## How it fits into FuckClaw
**Depends on:** `@fuckclaw/core`.
**Used by:** `@fuckclaw/tool-runtime` (enforcing path rules before the `filesystem` tool operates).

## Status & Caveats
🟢 **Core**
Snapshot creation, SHA-256 hashing, and rollback are fully implemented.
*Caveat: Host Dependencies.* This package executes `tar` and `zstd` via child processes for maximum performance. You **must** have `tar` and `zstd` installed on your host operating system for snapshots to function.
