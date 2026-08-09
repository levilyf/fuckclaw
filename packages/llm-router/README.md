# @fuckclaw/llm-router

The `@fuckclaw/llm-router` package handles all communication with external AI providers, optimizing generation requests for cost, latency, and capability.

## What it does
Instead of hardcoding the framework to use a single LLM API, this package abstracts provider interactions. It routes tasks to the appropriate model based on complexity, tracks exact token usage, calculates costs in USD, and intercepts identical requests to return cached responses instantly.

## Intended Audience
- **All Users & Operators**: You care about this package when configuring your API keys, checking your token expenditure, or managing rate limits.

## Key Behaviors
- **Native Providers**: Built-in, dependency-free integrations for Anthropic (`https://api.anthropic.com/v1/messages`) and Google Gemini.
- **Tier Routing**: Automatically routes simple tasks to cheaper/faster models (e.g., Claude Haiku) and complex tasks to heavy models (e.g., Claude Sonnet).
- **Response Cache**: A content-addressable SHA-256 cache. If the agent makes the exact same request (same messages, model, and temperature), it returns the cached response in milliseconds, costing $0.
- **Budget Enforcer**: Tracks the `maxCostUsdPerTask` budget. If an agent goes rogue and starts draining tokens, the router aborts the generation before the bill spikes.

## Configuration
Managed via `@fuckclaw/config`:
```toml
[providers.anthropic]
apiKey = "..."
defaultModel = "claude-3-5-sonnet-20241022"
```

## How it fits into FuckClaw
**Depends on:** `@fuckclaw/config`
**Used by:** `@fuckclaw/reasoning`, `@fuckclaw/planner`, `@fuckclaw/self-improvement`.

## Status
🟢 **Core**
Anthropic, Google, token tracking, caching, and budget enforcement are fully implemented.
*Limitations:* OpenAI compatibility is available via a generic provider, but native token counting logic is currently optimized specifically for Anthropic and Google APIs.
