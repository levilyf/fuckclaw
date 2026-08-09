# @fuckclaw/network

The `@fuckclaw/network` package provides external connectivity, APIs, and web interfaces for the FuckClaw daemon.

## What it does
It hosts the HTTP API and WebSocket servers that allow external clients, the TUI, and the Web Dashboard to interact with the core engine running in the background.

## Intended Audience
- **Operators & Integrators**: If you run `fuckclaw serve`, this package boots up. You will interact with these endpoints if you are building custom CI/CD webhooks or viewing the browser dashboard.

## Key Behaviors
- **HTTP API Server**: Provides RESTful endpoints (`/api/dashboard/overview`) for submitting tasks, checking agent status, querying memory, and retrieving observability metrics.
- **WebSocket Streaming**: Enables real-time streaming of agent thoughts, tool outputs, and execution traces to connected clients.
- **Web Dashboard**: Serves a built-in, single-page HTML application (`/dashboard`) for visual monitoring of the agent framework.

## Typical Usage
```bash
# Starts the network daemon on port 3000
fuckclaw serve --port 3000

# You can now navigate to http://localhost:3000/dashboard
```

## How it fits into FuckClaw
**Depends on:** `@fuckclaw/kernel` (to dispatch tasks), `@fuckclaw/event-bus` (to stream live updates over WebSockets).
**Used by:** `@fuckclaw/cli` (during the `serve` command).

## Status
🟢 **Core**
Express-based HTTP, WebSockets, and the Dashboard endpoints are fully functional.
*Deferred:* Native OS Desktop wrappers (Tauri) and experimental voice-pipeline endpoints are on the future roadmap.
