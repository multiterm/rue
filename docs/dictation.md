# Webapp dictation

The smaller microphone is always visible. With an empty (or whitespace-only) draft, a separate round audio-wave button occupies the right-hand primary action slot. Text or attachments switch only that audio-wave button to the send arrow. Both voice controls use the same browser dictation session (transcription into the draft, not a separate voice-chat service or saved audio attachment). While recording, the primary action stays **Stop dictation**, even as words arrive. Stopping never auto-sends. Unsupported browsers show a disabled voice button with an explanation; typing still enables send.

The browser recognizer uses one utterance at a time and restarts while the mic is
on. Only the latest hypothesis for that utterance is shown; older cumulative
result slots are never concatenated. Pauses and `no-speech` events restart with a
short backoff rather than displaying an error. Explicit stop, hidden pages,
navigation, permission errors, and unmount stop recording/restarts.

## Conservative local formatting

English finalized results receive punctuation-spacing cleanup and capitalization
at explicit sentence boundaries. Interim text is left alone. Clicking the mic to
stop waits for the browser's final result (or the existing two-second timeout),
then runs a local, deterministic punctuation pass over **only the text added by
that dictation session**. Existing typed text is preserved. A final period is
added to plain prose ending in a letter when no ending punctuation is present.
Existing question marks, commas, colons, and numeric endings are preserved.

Punctuation cleanup is quiet: no post-recording cleanup notice or undo button is shown. Clicking or tapping the draft (including the inline attachment editor) immediately aborts recording, unlocks editing, and detaches speech callbacks. This editing stop preserves the current text without waiting for final results or adding stop-time punctuation. Late speech cannot overwrite manual edits.

Cleanup never submits a message. It makes no external model/network request. Browser speech recognition itself may
use the browser vendor's speech service; this is not a claim of on-device audio
processing.

We do not insert commas based on pauses, infer question marks, delete repeated
words, or rewrite meaning. Code/URLs/paths/multiline text and non-English locales
are left alone by the formatter. Recognition ending is not treated as proof of a
sentence ending, so a natural hesitation does not insert a period.

Regression tests use simulated speech events in desktop/mobile Chromium and cover
cumulative hypotheses, stale events, stop/final-result ordering, pauses, failures,
quiet cleanup, click/tap-to-edit stops, and late-result isolation. Real microphones/browser speech services still require manual
checks.
