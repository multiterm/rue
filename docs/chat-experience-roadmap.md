# Chat experience expansion

This is a staged implementation, not a claim that every item is available.

## Design references and repository findings

- Rue's existing Grok-inspired layout remains the base: quiet chrome, compact bot
  list, spacious thread, rounded composer. Compare public product references:
  https://grok.com, https://chatgpt.com, https://claude.com/product/cowork and
  https://wisprflow.ai. No authenticated competitor sessions were inspected.
- Shared expectations: Markdown/GFM, fenced code + copy, safe links, readable
  streaming, visible progress, accessible timestamps, draft-preserving failures,
  explicit agent location, keyboard navigation, reduced-motion support, dictation
  that does not silently submit, and scroll-to-latest without stealing reading position.
- Portal has both a legacy `react-custom-scrollbars` wrapper and a shadcn/Radix
  ScrollArea. Rue adopts the latter under its shared UI package, with GDS tokens,
  rather than importing the legacy wrapper's React 19 hydration workarounds.
- Portal auth exchanges verified Keyname identity for its own application session.
  Its cookie must not be copied or treated as a Rue bearer token. Rue already uses
  Keyname's hosted client for sign-in and existing-session discovery.
- Keypost uses verified membership-scoped organization/project APIs and checks the
  active project before selecting a mapped workspace. A folder/group in Rue is
  organization of personal bots, **not** a tenant or authorization boundary.

## Delivery stages

1. Shared web/desktop/responsive-web chat primitives: Markdown/code, copy, progress,
   skeletons, timestamps, GDS scrolling, remote icon, sticky health banner and
   explicit reconnect guidance. No raw HTML or automatic external image loading.
2. Personal bot groups/labels/colors, management slash commands, multiline composer,
   and opt-in browser dictation with capability detection and a visible microphone
   indicator. Native Expo parity requires platform-appropriate components, not DOM
   components inside React Native.
3. Dedicated session-authorization presentation/optional auth app: shared Portal
   form chrome, secure redirect allowlist, one-time pairing approval, verified SSO
   handoff and cross-app appearance synchronization. On sandblocks.dev, never set a
   parent-domain cookie shared with unrelated sandbox tenants.
4. Desktop dictation: isolated preload API, opt-in persisted shortcut, allowlisted
   IPC, trusted navigation, microphone permissions, floating recording indicator,
   stop-on-sign-out/session-switch, and native packaged tests on supported OSes.
   Browser speech recognition is not a substitute for an audited native transcription
   backend and must not be advertised as universally available in Electron.
5. Tenancy: configure the trusted Keyname Tenancy origin, map organization/project
   IDs in storage, migrate personal data without changing ownership, enforce member
   and role checks on every resource/stream/remote command, isolate caches, and
   invalidate access on membership removal. Include hostile cross-tenant tests.
   Never implement tenancy merely by adding a client-provided scope header or
   replacing an authenticated user subject with an organization ID.

## Current increment and verification

Stages 1–2 are implemented for web/responsive web and the shared desktop renderer.
The pairing forms now use compact Portal-style shared chrome. Native Expo also
preserves failed drafts and reuses remote-prompt idempotency IDs on retry, but does
not yet have the full rich-chat UI. Account switches replace the query cache;
stream invalidations are coalesced instead of issuing requests for every token.

The web composer uses an expandable two-row layout. Dictation animates only in
its microphone button, immediately left of Send; there is no floating recording
indicator. Interim and final speech snapshots update the draft without duplicate
words. The draft is read-only while recording to avoid overwriting manual edits;
stop recording to edit or send. Backgrounding, navigation, and recognition errors
stop recording while retaining the latest draft. Browser speech support and
microphone/speech-service permissions are required.

The composer now has adjacent plus-actions and info buttons with anchored,
non-modal popovers. Idle microphones have a color-5 outline (falling back to Rue's
semantic border token), switch to primary styling while recording, and disable
Send. Remote banners use green/connected, red/disconnected, and yellow/uncertain
status dots; Reconnect appears only for a known disconnection. A heartbeat older
than 20 seconds is shown as delayed until the API reports offline (30 seconds).
Failed health checks show uncertainty instead of claiming the computer is online.
The latest-message overlay aligns to the conversation column. Settings content
has no outer top/right/bottom inset; its internal reading padding is retained.

Verified locally: `rune quality-static`, 62 web browser checks, 4 Expo-web checks,
and 2 desktop-renderer/security checks. The bound development sandbox's full
check also passed. Browser dictation tests use a mocked speech API; these results
do not certify real microphones, packaged desktop applications, or iOS/Android
native builds. Stages 3–5 remain incomplete, including cross-app appearance/SSO
handoff, native floating dictation, and server-enforced tenancy.

## Explicitly deferred rather than faked

Attachments need private upload/download authorization, quotas, and model capability
checks. Cloud stop/retry/edit-and-branch need durable run IDs and cancellation, not
just stopping browser rendering. Remote reassignment must preserve one bot per Pi
session and require explicit revocation/re-pairing; an offline bot never falls back
to a cloud provider. No hidden reasoning is uploaded or invented for thinking UI.
