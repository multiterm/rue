# PWA session restoration

Rue remembers Keyname browser-session tokens in origin-local storage, scoped to
the configured Keyname API origin. Before loading Keyname's sessionStorage-based
browser client, Rue restores its token set. OAuth state remains tab-scoped; it is
not copied into persistent storage. Passwords are never stored.

On cold start and foreground/online return, Rue requests a sufficiently fresh
access token and checks the Keyname session. Refresh uses the Keyname client's
existing refresh mechanism and the server's expiry/revocation policy. A network
failure retains remembered credentials for retry rather than treating it as a
logout. An invalid/revoked session clears them. Logout clears local/tab copies,
blocks late SDK events from restoring them and propagates to other open tabs.

Rue's direct credential-login token is also remembered, but must pass a server
session check on reopening. That login path currently supplies no refresh token;
it does not gain an artificial lifetime extension from browser persistence.

Persistent browser storage is JavaScript-readable, just like the existing browser
client's tab storage. This change does not introduce an HttpOnly-cookie session.
Use Sign out on shared devices. Private browsing, browser data clearing, PWA
removal, storage eviction and server expiration can still require sign-in.

Tests cover a 412px Chromium page closing completely and a new page reopening
with empty tab storage, expired access-token refresh, transient checks, revocation,
cross-tab logout and late SDK events. Authentication endpoints are mocked; this
is not a physical iOS/Android or live Keyname identity acceptance test.
