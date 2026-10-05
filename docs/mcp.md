# Managed MCP tools

MCP stdio tools are implemented for isolated, dashboard-managed Pi agents. Development Mason advertises `managed-mcp-v1`; an enrollment-only host or older runtime cannot accept MCP configuration. HTTP/SSE MCP transports, OAuth, resources/prompts browsing and sampling are not implemented. Manual Pi sessions keep their independently reviewed integrations.

## Configure and use

1. Open **Settings → MCP → Add MCP connection**.
2. Supply an executable available inside the agent image or private workspace, and a JSON array of arguments. Rue does not expand a shell or install packages automatically. **Arguments are visible metadata; never place credentials there.**
3. Put credentials in the masked environment JSON object. Acknowledge trust in the program: it can execute code and access the selected agent's workspace and delivered credentials.
4. Under **Remote agents**, create an agent with **Coding** permissions and select up to four MCP connections. Or use **Configure tools and MCP** on an existing agent, acknowledge the change, save, then resume. Saving configuration stops the existing runtime and fences its previous grant; active work may be interrupted, never replayed.

Saving a profile does not start a service or grant it to every agent. There are at most 32 active profiles per owner. Read-only permission rejects MCP even if a server describes its tools as read-only. Provider-key sharing and tool-output/thinking sharing remain independent.

## Credentials and revocation

Migrations 14–15 store environment values with the existing owner/profile-bound AES-GCM key. Metadata reads neither select nor decrypt ciphertext. One client-generated UUID makes unchanged creation retries idempotent; identity changes and conflicting retries fail closed. Secrets never enter browser storage or SDK query-cache metadata.

Only the current worker lease/generation and managed revision/boot can receive the selected profiles. The per-agent root-only bootstrap passes data to UID 1000 over stdin. MCP children receive selected environment values plus minimal PATH/HOME/LANG, not the supervisor secret, socket, inherited process secrets or provider credentials.

Any code inside an authorized agent can potentially access credentials delivered to that agent. **Removal cannot recall copied plaintext.** Removing a profile erases its active ciphertext, stops affected agents, fences their grants, and removes the profile from their configurations. Resume without it, or configure a replacement. The supervisor replaces the bootstrap with a revoked marker when removing the stopped container; history/workspace volumes remain. Offline hosts cannot be scrubbed until they recover. Backups and exported copies are not erased.

## Protocol and execution bounds

- MCP TypeScript SDK 1.30.0; inline, namespaced Pi SDK 0.85.1 tool registration. MCP names cannot shadow built-in tools.
- No shell transport, inherited diagnostics, automatic reconnect/retry, sampling, elicitation or server-directed provider calls.
- One MiB maximum stdio frame/buffer, bounded catalog/schema depth, 64 tools, bounded pagination, ten-second setup requests and sixty-second tool calls.
- Text, images, embedded text resources and resource-link metadata are supported. Other content types fail explicitly, rather than silently truncating a result. This does not establish browser image mirroring support.
- Cancellation or transport failure is ambiguous for external side effects. The adapter does not replay the call.
- The independent root guardian grants one bounded bootstrap window, then caps authority by **both worker and relay leases**. A frozen Pi/MCP event loop cannot renew itself using a healthy supervisor's lease.

## Verification

Storage/HTTP tests cover encryption, metadata-only reads, owner and credential namespaces, explicit coding consent, idempotency, configuration changes and revocation. Actual SDK stdio tests cover execution, environment isolation, ordered content, error status, catalog registration in Pi and oversized frames. Desktop/mobile Playwright checks use mocked APIs.

An authenticated disposable Mason canary verified encrypted synthetic-credential delivery, Pi catalog readiness, tool execution as UID 1000, guardian termination after SIGSTOP of Pi while the supervisor remained healthy, automatic recovery, profile revocation, bootstrap scrubbing and separately authorized purge. Canary worker/runtime resources were removed and the worker credential revoked. **No provider inference or physical-device test is claimed.**
