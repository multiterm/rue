# Pi agent status

**Bot settings → Agent status**, also available from the three-dot menu, displays Pi's last-reported runtime state, current directory, Git branch, provider/model, thinking level, context usage and token/cache/cost counters. Requested managed configuration remains separate from these observed values.

Managed runtimes report this allowlisted metadata with their authenticated relay heartbeat. The host manager receives the same report plus observation/lease timestamps in its existing authenticated agent snapshot. Older images report no status until updated. Relay leases advertise `agentStatusVersion: 1`; the bridge does not send the new health field to older servers, so opting in does not break their strict legacy heartbeat schemas. `/rue status` diagnostics show sharing preference and negotiated support separately.

Linked interactive Pi sessions opt in separately with **`/rue share-status`**, which asks for confirmation. **`/rue hide-status`** stops future reporting. Tool-output and thinking-content sharing remain independent. A thinking *level* is not thinking content. No prompt, tool output, summary, token, credential object or environment is included. Already delivered metadata cannot be recalled.

Usage totals follow the pinned Pi footer: assistant, tool-result, compaction and branch-summary usage across all session entries. Cache-hit percentage is for the last assistant response, not lifetime average. Model cost is Pi's reported estimate, not an account invoice or subscription charge. The subscription marker uses authentication metadata; it does not prove entitlement or quota.

Context comes from Pi's context-usage API. Unknown tokens/percent after compaction remain unknown rather than displaying zero. Auto-compaction is reported by managed runners; interactive extension contexts that do not expose that setting report it as unavailable. Directory is the actual Pi working directory, not a guessed host bind source. Branch lookup is a bounded, read-only Git operation; non-repositories and detached heads report no branch. Long strings are explicitly truncated.

Lease/heartbeat freshness determines whether the webapp labels a snapshot stale. Browser clock skew does not make old counters live. Stale values remain visible as last-reported data; they must not authorize execution. Disabling status sharing removes it from subsequent heartbeats, but does not erase historical backups or copies.

The conversation activity row shows **Compacting…** while fresh managed Pi status reports compaction, including automatic compaction. Native compaction start/end events prompt a heartbeat refresh. Stale/disconnected reports are not presented as live compaction. Compaction summaries are not published as assistant replies.

Provider error messages are mirrored using their original wording, not categorized into canned messages. JSON error envelopes contribute only their message field; recognized credentials are redacted, terminal controls removed, and long errors explicitly truncated at 16 KiB. Ordinary replies and existing thinking/tool-output consent remain unchanged. Compaction failures use the same error-message path. Rue's retry guidance stays separate from the provider text, and a mirrored provider error does not produce a second generic interruption bubble. Unknown/empty failures still have a generic fallback. This does not automatically retry requests or rewrite historical error messages.

Status metadata version 1 is validated with bounded fields and rejects unknown fields. It is owner-scoped in account APIs and host-scoped in manager snapshots. It has no effect on model configuration, grants, prompts or conversation history.
