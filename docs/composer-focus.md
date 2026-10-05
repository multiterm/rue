# Composer focus and agent switching

A refreshed session list previously replaced the current selection with its first
entry whenever the active ID was absent. A stale list immediately after creation
could therefore change the composer key, remove the focused input, and dismiss a
mobile keyboard while the user was typing.

Selection now changes automatically only when there is no active selection.
Missing list entries are checked through the owner-bound session endpoint, while
the last matching selected-session metadata remains available. A missing/error
list is not permission to switch the user's conversation. Explicit deletion and
manual agent selection still work normally; an externally deleted conversation
can show its request errors without silently redirecting a draft to another bot.

Switching also:

- Cancels obsolete message/part reads through TanStack Query's AbortSignal.
- Reuses recently loaded transcripts for five seconds while retaining SSE updates
  and remote polling.
- Defers cached transcript rendering behind the header/composer update; content
  from another agent is never displayed under the selected agent's header.
- Allows drafting/attaching in another agent while a send is pending. Concurrent
  sends are still disabled; this does not replay or duplicate pending requests.
- Finishes a send without waiting for unrelated account-wide query refreshes.

Owner/session keys on composers remain intentional for draft/attachment isolation.
They are not removed as a shortcut for focus preservation.

Browser regressions at 1280px and 412px cover creation-dialog focus, stale list
refreshes, retained composer DOM/focus, viewport height changes, cancellation of
slow previous-agent reads, separate drafts/attachments, failed-send recovery and
conversation search. API responses are mocked. Actual iOS/Android software-keyboard
behavior still requires a device acceptance check.
