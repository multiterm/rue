# Bot attention notices

The chat's **Bot setup needs attention** container is an error summary, not a readiness checklist.

- Hide it for healthy idle/working/compacting agents, pending initial checks, startup, intentional stop/removal, and ordinary OAuth refresh.
- Show only errors associated with the selected owner's bot/connection. A remote-computer lookup failure must not flag an unrelated cloud chat.
- Require actual lease/heartbeat evidence before classifying an online observation as timed out. Do not redisplay stale upload/task failures from disconnected observations.
- Keep independent errors visible together, deduplicate repeated codes, and provide a separately titled tutorial for each supported diagnostic.
- Prefer request creation order when choosing the latest task. A late failure update on an older task must not override a newer successful/active request. Working/compacting agents do not show an old failed-task notice.
- Preserve distinct runtime diagnostics for capacity, mounts, unavailable runtimes, ownership, authority, models and failed updates. Failed startup can be diagnosed before pairing; an automatic stop caused by a runtime failure is not treated as an intentional healthy stop.
- Distinguish failed, interrupted, expired/uncertain and provably undispatched tasks. Only undispatched work links to the explicit Expired Requests review flow.
- Guides are advisory. Opening/closing them never sends a prompt, restarts an agent, changes credentials/grants, or replays work. Drafts and history remain intact. Unknown runtime failures receive generic instructions rather than exposing raw server diagnostics.

Implementation: `agent-setup-help.ts`, `managed-prompt-preflight.ts`, and `chat-credential-notice.tsx` in `packages/apps/webapp/src`.

Validation:

```sh
node --import tsx --test quality/agent-setup-help.node.test.mjs quality/attention-errors.node.test.mjs quality/managed-prompt-preflight.node.test.mjs
node node_modules/typescript/bin/tsc -p packages/apps/webapp/tsconfig.json --noEmit
```

26 targeted tests, webapp typechecking and the Vite production build passed. Existing browser coverage is in `quality/chat-credential-notice.browser.test.mjs`; browser execution in this agent container is blocked by missing Chromium system libraries. No deployment or live agent mutation was performed for this change.
