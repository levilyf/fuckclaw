# @fuckclaw/config

The `@fuckclaw/config` package manages configuration merging, profile switching, and secure secret storage for the FuckClaw ecosystem.

## What it does
Instead of relying on scattered `.env` files, this package centralizes configuration into a deterministic, multi-layered system. It parses TOML files, merges them with environment variables, and encrypts sensitive API keys using local AES-256-GCM authenticated encryption.

## Intended Audience
- **End Users**: You interact with the configuration schemas via the CLI.
- **Plugin Authors**: You rely on this package to read user preferences for your custom tools.

## Typical Usage (Configuration Precedence)
The package merges settings in this order (Highest to Lowest):
1. **CLI Overrides** (`fuckclaw --overrides="..."`)
2. **Environment Variables** (e.g., `FUCKCLAW_LLM_API_KEY`)
3. **Project Config** (`./.fuckclaw.toml` in your current directory)
4. **Profile Config** (`~/.fuckclaw/config/profiles/dev.toml`)
5. **Global Config** (`~/.fuckclaw/config/fuckclaw.toml`)

### Common Config Keys
- `providers.anthropic.apiKey`: Encrypted API token.
- `system.logLevel`: Console verbosity (`info`, `debug`, `error`).
- `budget.defaultTaskLimitUsd`: Maximum allowed API spend per task (e.g., `1.50`).
- `workspace.root`: The directory where snapshots and SQLite databases are stored.

## How it fits into FuckClaw
**Depends on:** `@fuckclaw/core` (for standard errors).
**Used by:** `@fuckclaw/cli` (to bootstrap), `@fuckclaw/llm-router` (to read keys), and the rest of the framework.

## Status
🟢 **Core**
TOML parsing, layered merging, and local AES-256-GCM encryption are fully active. 
*Deferred:* Distributed KMS (Key Management Service) integration is intentionally excluded; encryption relies on a local machine key.
