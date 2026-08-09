# @fuckclaw/plugins

The `@fuckclaw/plugins` package provides a safe, lifecycle-managed extension system for the FuckClaw framework.

## What it does
It allows third-party developers to inject custom tools, memory stores, or event listeners into the runtime without having to fork or modify the core monorepo code.

## Intended Audience
- **Plugin Authors & Integrators**: If you want to extend FuckClaw with proprietary company tools, custom API integrations, or specialized reasoning strategies, you will build a package that hooks into this plugin system.

## Key Behaviors
- **Lifecycle Management**: Safely discovers, loads, initializes, and unloads external plugins.
- **Context Injection**: Provides plugins with a restricted, safe API to interact with the Event Bus, Tool Runtime, and Memory systems, preventing rogue plugins from accidentally wiping the core SQLite database.
- **Plugin Registry**: Keeps track of active plugins and their granted permissions.

## Typical Usage
```bash
# List installed plugins
fuckclaw plugins list
```

## How it fits into FuckClaw
**Depends on:** `@fuckclaw/core`, `@fuckclaw/tool-runtime`.
**Used by:** `@fuckclaw/cli` (during boot).

## Status
🟢 **Core (Partial Sandboxing)**
The plugin lifecycle and registry are fully implemented. 
*Limitations:* Plugins currently run in the same Node.js process as the main daemon. Strict V8 isolate sandboxing for untrusted third-party plugins is not implemented; you should only install plugins from trusted sources.
