# Browser-approved CLI login

For a CLI and browser on the **same computer**:

```sh
export RUE_CONTROL_API_URL=https://YOUR-RUE-API
export RUE_CONTROL_WEB_URL=https://YOUR-RUE-WEBAPP
rue auth login
# Open the printed URL, sign in, compare the code, and explicitly approve.
rue auth status
rue control access
rue control agents
rue auth logout
```

No API key is copied into chat, a command argument, an environment variable, or a user-managed token file. Explicit `--token-file` / `RUE_CONTROL_TOKEN_FILE` remains available for existing automation; an explicitly configured file takes precedence and errors do not fall back to another identity.

## Authority and storage

- The browser uses its existing, verified human session and Rue's existing `POST /api-keys` → Tenancy issuer. Login does not fabricate a user session or introduce a new unauthenticated issuing API.
- Approval issues a **one-hour, self-owned** Rue key with `rue:hosts:read`, `rue:agents:read`, `rue:agents:write`, and `rue:agents:execute`. These permit agent lifecycle changes, including deletion; the approval page says so. They do not authorize host enrollment/management, runtime deployment, MCP administration, or platform/database administration.
- The CLI independently verifies the returned key against the chosen Rue API and checks its owner, key ID and bounded expiry before saving it.
- macOS uses Keychain through `/usr/bin/security`; Linux uses Secret Service through `/usr/bin/secret-tool`. Secret input goes through stdin, not process arguments. Entries use a separate `rue-control` namespace and a hash of the canonical HTTPS API origin, never provider-account storage.
- There is no silent plaintext-file or in-memory persistence fallback. An unavailable/locked credential store fails login. Windows is not implemented in this increment.
- `rue control` automatically reads the stored credential for its API origin. `rue auth status` verifies it remotely; it does not merely report that a local entry exists. Revocation and expiry remain server-enforced on subsequent requests.

## Transport and failure behavior

The five-minute approval request is carried in a URL fragment; no credential is placed in a URL. The CLI binds a random port on **127.0.0.1 only**. Callback handling validates the exact browser origin, Host, path, content type, bounded body and random state, with single-winner submission and bounded timeouts. The approval page refuses framing. The browser permits only the canonical loopback callback shape and an API origin matching its configured Rue API. The credential is delivered in a POST body, never browser local/session storage or rendered page text. Redirects are not followed. Browsers may ask permission to access the local application.

Issuance and callback submission are not automatically retried. Failed delivery attempts to revoke the newly issued key. An ambiguous acknowledgement can therefore revoke a key already saved by the CLI; use `auth status`, review Settings → API keys, and start a fresh login instead of assuming success. Cancellation during an OS write is also unconfirmed; it must not delete an unrelated concurrent login's key.

`auth logout` removes the local credential **only**. It is not server-side revocation. Revoke the key in Rue Settings → API keys to invalidate it elsewhere. Replacing a local login likewise does not revoke the prior key; it expires after its original lifetime unless revoked sooner.

## Scope of this implementation

This is an explicit browser/loopback approval flow, **not** an OAuth device-code grant. A browser on another machine cannot reach the initiating CLI's loopback listener. Generic headless service-identity enrollment and automatic renewal still require implementation; existing worker/relay identities retain only their existing authority and are not promoted to owner keys.

The development webapp route was checked live. Ten CLI/loopback/credential-store tests, eight desktop/mobile browser cases, and five API-key/issuer tests pass; browser/API tests use synthetic credentials. Core/webapp typechecks and the narrow rehearsal-script typecheck pass after rebuilding the existing SDK output, without dependency changes. The existing operator human session returned 401, and no successful owner approval or live CLI agent mutation has been claimed. A transient approval URL expires after five minutes; run `rue auth login` again if necessary.

PostgreSQL migration is separate. See [postgres-migration.md](postgres-migration.md); this login does not bypass storage cutover gates.
