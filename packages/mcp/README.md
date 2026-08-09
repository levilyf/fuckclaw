# @fuckclaw/mcp

The `@fuckclaw/mcp` package integrates the Model Context Protocol (MCP), an open standard that allows AI agents to interact with external tools and data sources securely.

## What it does
This package enables FuckClaw to act as an MCP Client (consuming external tools like Slack or GitHub plugins) and an MCP Server (exposing FuckClaw's own local tools to other compatible MCP clients).

## Intended Audience
- **Power Users & Integrators**: If you want FuckClaw to read your company Jira board, or if you want an external chatbot (like Claude Desktop) to use FuckClaw's filesystem tools, you will configure MCP connections here.

## Key Behaviors
- **MCP Client Manager**: Dynamically connects to external MCP servers via `stdio` or `HTTP`, reads their JSON-RPC tool manifests, and injects them into FuckClaw's Tool Runtime.
- **MCP Server**: Exposes FuckClaw's sandboxed local tools and workspace context to external applications over standard MCP protocols.

## Typical Usage (CLI)
```bash
# List available MCP connections
fuckclaw mcp list

# Add a new external MCP server to FuckClaw's registry
fuckclaw mcp add local-jira "node /path/to/jira-mcp-server.js"
```

## How it fits into FuckClaw
**Depends on:** `@fuckclaw/tool-runtime`.
**Used by:** `@fuckclaw/cli`.
Tools discovered via MCP are wrapped in standard FuckClaw adapters and injected into the Tool Runtime, making them indistinguishable from native tools to the Reasoning engine.

## Status
🟢 **Core**
Local `stdio` and basic `HTTP` MCP client/server adapters are implemented.
*Limitations:* Complex authentication handshakes (like OAuth) for remote enterprise MCP servers are not supported natively and require custom plugins.
