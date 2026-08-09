# @fuckclaw/knowledge-graph

The `@fuckclaw/knowledge-graph` package manages complex, relationship-based structural data extracted from your workspace.

## What it does
While standard semantic memory stores isolated facts ("The API key is in .env"), the Knowledge Graph tracks *how things connect*. It maps entities (files, functions, concepts) and their directional relationships.

## Intended Audience
- **Researchers & Contributors**: This package operates invisibly in the background. It is utilized by the Planner and Reasoning engines to understand the blast radius of a code change before executing it.

## Key Behaviors
- **Entity & Relationship Mapping**: Tracks relationships like `DEPENDS_ON`, `IMPLEMENTS`, or `MODIFIED_BY`. (e.g., "Module A depends on Module B").
- **Graph Traversal**: Allows the reasoning engine to query dependencies. For example, before an agent deletes a file, it can query the graph to see what other modules will break.
- **FTS5 Integration**: Uses SQLite's Full Text Search (FTS5) to quickly locate nodes based on semantic content.

## How it fits into FuckClaw
**Depends on:** `@fuckclaw/persistence` (to store nodes and edges in SQLite tables).
**Used by:** `@fuckclaw/planner`, `@fuckclaw/reasoning`.

## Status
🟢 **Core**
Entity mapping and relational persistence in SQLite are fully functional.
*Limitations:* This is backed by relational SQLite tables, not a dedicated graph database (like Neo4j). It is highly optimized for local workspace introspection (thousands of files) but is not designed for massive enterprise data lakes.
