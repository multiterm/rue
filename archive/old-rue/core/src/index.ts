// @multiterm/rue-core — the LLM-agnostic agentic engine.
//
// Step 2 of the restructure extracts the query loop, tool registry, model
// provider adapters, and compaction here from @multiterm/rue-desktop so every Rue
// surface (desktop, cli, webapp, mobile) shares one engine. Host apps supply
// their own IO implementations (file tools, MCP transport) behind the
// interfaces this package defines.
export const RUE_CORE_VERSION = '0.0.0'
