# @fuckclaw/memory

The `@fuckclaw/memory` package provides FuckClaw with a persistent sense of history. It transitions the framework from a stateless chatbot into a continuously learning agent.

## What it does
It records what the agent does, analyzes it in the background, and seamlessly feeds relevant context back into future tasks.

## Intended Audience
- **All Users**: You benefit from this package automatically when the agent recalls how you prefer to write tests or where your environment variables are located.

## Key Behaviors
- **Episodic Store**: Records exact step-by-step logs of what the AI did during a task. Traces are losslessly compressed using Zstandard to save disk space.
- **Semantic Store**: Extracts factual knowledge (e.g., "The production API key is located in .env.prod") using vector embeddings.
- **Procedural Store**: Extracts step-by-step workflows (e.g., "How to deploy to Vercel") into execution graphs indexed with SQLite FTS5 (Full Text Search).
- **Consolidation Daemon**: Runs in the background (typically triggered by the Scheduler), converting raw episodic traces into generalized semantic and procedural memories.
- **Dreaming Engine**: Runs during idle cycles to audit facts, find associations, and resolve contradictions (e.g., replacing an old memory stating "We use React 17" with a new one stating "We use React 18").

## How it fits into FuckClaw
**Depends on:** `@fuckclaw/persistence` (SQLite & FTS5), `@fuckclaw/workspace` (Zstandard compression).
**Used by:** `@fuckclaw/kernel` (to build context), `@fuckclaw/scheduler` (to trigger daemons).

## Status
🟢 **Core**
SQLite storage, FTS5 lexical retrieval, trace compression, and consolidation daemons are fully implemented.
*Limitations:* The Semantic store relies on local embeddings and SQLite lexical search. External vector databases (Pinecone, Milvus) are not integrated, prioritizing a local-first, privacy-focused approach.
