# @fuckclaw/cli

The `@fuckclaw/cli` package is the composition root and primary entry point for the FuckClaw framework.

## What it does
It wires together the 21 internal subsystems (Kernel, Memory, Reasoning, Multi-Agent, Tool Runtime, etc.) into a cohesive application. It provides the compiled binary (`fuckclaw`) that parses user commands, boots the interactive Terminal UI (TUI), and mounts the HTTP daemon.

## Intended Audience
- **End Users**: This is the package you interact with in your terminal.
- **Runtime Developers**: You edit this package if you are adding new global CLI flags or modifying the daemon bootstrap sequence.

## Typical Usage
You invoke this package globally from your terminal:

```bash
# Execute a multi-step task autonomously
fuckclaw run "Find failing tests in src/ and fix them"

# Launch the interactive streaming TUI
fuckclaw ask

# Start the background daemon (Event Bus, Scheduler, Web Dashboard)
fuckclaw serve --port 8420

# Check daemon health and active agent tasks
fuckclaw status

# Manage encrypted configuration
fuckclaw config set system.logLevel "debug"
```

## How it fits into FuckClaw
**Depends on:** Almost every package in the monorepo (`@fuckclaw/kernel`, `@fuckclaw/network`, `@fuckclaw/config`, etc.).
**Used by:** Nothing. It is the top of the dependency graph.

## Status
🟢 **Core**
All primary CLI commands (`run`, `ask`, `serve`, `status`, `config`, `mcp`, `plugins`) are wired up to the internal runtime and fully functional.
