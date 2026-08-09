# @fuckclaw/persistence

The `@fuckclaw/persistence` package provides the unified, ACID-compliant database layer for the entire FuckClaw framework.

## What it does
It ensures that your agent's memory, state, anti-patterns, delegations, and task histories survive application restarts. 

## Intended Audience
- **Operators & Infrastructure Developers**: You will rarely interact with this package directly via code, but you rely on it to keep the agent's memory intact. The database files are stored locally on your machine, typically in `~/.fuckclaw/data`.

## Key Behaviors
- **SQLite & WAL**: Utilizes high-performance local SQLite databases configured with Write-Ahead Logging (WAL) for speed, concurrency, and reliability.
- **FTS5 Indexing**: Leverages SQLite's Full Text Search (FTS5) extension for lightning-fast lexical retrieval of memories and anti-patterns.
- **Automated Schema Migrations**: Safely manages database evolution over time, applying schemas for events (Version 1), memory stores (Version 3), planner graphs, and delegations automatically on boot.

## How it fits into FuckClaw
**Depends on:** `@fuckclaw/core`.
**Used by:** `@fuckclaw/memory`, `@fuckclaw/event-bus`, `@fuckclaw/knowledge-graph`, `@fuckclaw/multi-agent`.

## Status
🟢 **Core**
SQLite WAL & FTS5 implementations are fully robust and active.
*Deferred:* PostgreSQL drivers for distributed, multi-node deployments are explicitly deferred on the roadmap to maintain a zero-configuration, local-first architecture.
