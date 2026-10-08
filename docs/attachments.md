# Chat attachments

## Composer keyboard

On touch-first/mobile devices, **Return inserts a new line**; tap the up-arrow button to send. On desktop, **Enter sends** and **Shift+Enter inserts a new line**. This works in both the plain textarea and the inline attachment editor. The keyboard hint is Return, not Send.

Use the **paperclip beside +** to open the file picker immediately, choose **+ → Add photos & files**, paste files/screenshots, or drag files into the composer. The plus menu shows searchable, descriptive rows for Rue's available actions. Files appear at the remembered insertion point as inline chips; continue typing before or after them. Each chip has a remove button. **Take screenshot** uses the browser's screen-sharing chooser, waits for a rendered frame, and stops capture immediately afterward. On unsupported mobile browsers—or when sharing is cancelled/blocked—it opens a shared-UI dialog with a **Choose screenshot** image picker. Take the screenshot using the device controls first, review/crop sensitive content, then select it. Rue cannot programmatically capture other mobile apps or remove OS picture-in-picture overlays. The original message draft is preserved, capture errors release the busy state, and nothing is sent automatically.

Limits: 8 files, 10 MiB each, 20 MiB total per message; approximately 100 MiB stored attachments per account. Delete old conversations to free storage. Draft attachments remain in memory, separately per bot, and survive a failed send; they do not survive a page reload. Files are sent with the message, not uploaded when selected. Large videos must be shortened or compressed.

The API accepts optional ordered `content` alongside the backward-compatible `text` field on `POST /session/:id/message`:

```json
{"text":"See attachment","content":[{"type":"text","text":"Before "},{"type":"file","name":"notes.txt","mimeType":"text/plain","data":"SGVsbG8="},{"type":"text","text":" after"}]}
```

File bytes are base64-encoded in private SQLite message parts; deleting a conversation removes its parts. MIME types are normalized from signatures and text validation. Transcript polling returns file metadata, never base64 bytes. Downloads require the same account/session authorization as messages at `GET /session/:id/attachments/:partId` and use no-store, attachment disposition and nosniff headers. No public URLs or external image loads are introduced. Inline previews only allow PNG/JPEG/GIF/WebP and MP4/WebM; other formats download as files. HTML/SVG are never active previews.

## Agent delivery

- Cloud agents receive images as image content (requires a vision-capable model) and UTF-8 text-file contents, capped at 100,000 characters per file with a truncation notice. PDFs, videos and other binary files remain saved/downloadable, but cloud analysis of those formats is **not implemented**. The model receives an explicit limitation notice rather than a claim that it read them.
- Paired Pi receives files only after the existing remote-prompt approval/trust checks and durable start transition. Images are image content; other files are written to a private temporary directory as mode-0600 files with sanitized names, then referenced in the prompt for local tools. They are not executed or extracted automatically. Pi's ordinary tool permissions remain in force. These temporary files are removed when the Rue link disconnects; do not rely on their paths after reload/resume. Copies deliberately made by tools are not removed.
- Attachment bytes never enter the bridge retry outbox or saved link credentials. Input download requires the live bound instance and a running command; revocation, disabled prompting and replacement instances deny access.
- After updating the local extension, run `/reload` then `/rue resume` (restart Pi if version mismatch persists). Do not re-pair.

This does not add Pi-to-Rue image/tool-image mirroring or import prior Pi history.

## Verification

Core HTTP tests cover ordered persistence, account-isolated downloads, metadata-only polling, invalid/oversized files, retry conflicts, approved bridge delivery, private temporary files and revocation. The cloud test exercises persisted content through the real Pi harness with a faux provider. Browser tests cover picking, insertion-point typing, paste/drop, removal, retry drafts and limits on desktop/mobile Chromium. Real screen-sharing choosers, mobile photo libraries and live vision-model responses still need device testing.
