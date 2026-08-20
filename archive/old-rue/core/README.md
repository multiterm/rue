# @multiterm/rue-core

The LLM-agnostic agentic engine shared by every Rue surface.

**Planned contents** (extracted from `@multiterm/rue-desktop` in step 2 of the restructure):
- the generator-based query loop + recovery sub-loops (`runQuery`)
- the tool registry, tool types, tool-search / deferral
- model provider adapters (Anthropic, OpenRouter, Ollama)
- conversation compaction and token estimation

Host apps inject their own IO (file tools, MCP transport) behind the interfaces
this package defines.
