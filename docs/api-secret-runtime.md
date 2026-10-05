# Rue API secrets with Dotlocker and Envx

## Status and boundary

Source integration is opt-in. No live secrets have been migrated and no service has
been restarted by adding this integration. Initially the encrypted runtime accepts
only `RUE_PUSH_PRIVATE_KEY`, `RUE_PUSH_PUBLIC_KEY` and `RUE_PUSH_SUBJECT`.
The database encryption key and per-agent credential grants remain untouched.

The dedicated configured namespace is `multiterm/rue` on
`https://preview.dotlocker.dev`. Provision/verify that namespace with its operator
before publishing; this document does not claim it already exists. Never use a
Portal token or put Rue credentials in Portal's runtime.

Unlike Portal's shared prepare/build loader, Rue loads secrets **only at API
startup**. No Envx auto-loader is installed at the workspace level. The frontend
build, webapp, docs and site do not invoke this wrapper or need decryption keys.
Do not broaden bootstrap secrets to stack/wildcard scope as a workaround.

## Prepare an existing VAPID pair without rotation

Use an existing, mode-0600 private file outside the repository containing exactly
those three values. Sandblocks' write-only secret metadata cannot supply their
values; use the original protected configuration or an authorized secure export.
Do not generate a new VAPID pair merely because the old one cannot be exported.

After installing the pinned dependencies:

```sh
node scripts/deployment/prepare-push-runtime.mjs \
  dev /private/existing-push.env /private/new-rue-push-bundle
```

This verifies the original pair, creates a new **Envx wrapping key**, and writes:

- `payload/.env`: encrypted values only, verified by decrypting and comparing.
- `bootstrap.env`: the separate `ENVX_PRIVATE_KEY_DEV`; mode 0600.

The input remains unchanged. Existing destination bundles are never overwritten.
Nothing is uploaded or deployed. The wrapping key is not the VAPID key.

With a separately authorized Rue-scoped publishing token in `DOTLOCKER_TOKEN`:

```sh
pnpm exec dotlocker push /private/new-rue-push-bundle/payload \
  --runtime dev --config config/dotlocker.config.json
```

**Push only `payload`, never the bundle root.** Pull back into another private
staging directory and compare the ciphertext hash before configuring deployment.
Retain the original VAPID file and wrapping key in authorized secure backup storage.
Do not print either file or pass credentials as command arguments.

## API-scoped deployment bindings

After releasing the Sandblocks app-scope forwarding correction, configure these
through the `rue/apps/api/deployment-secrets` scope for the selected environment:

| Setting | Development value/purpose |
| --- | --- |
| `RUE_SECRET_SOURCE` | `dotlocker` (explicit opt-in) |
| `RUE_SECRET_RUNTIME` | `dev` (explicit; never inferred from the build's NODE_ENV) |
| `DOTLOCKER_TOKEN` | Read-only, restricted to `multiterm/rue/dev/**:read` |
| `ENVX_PRIVATE_KEY_DEV` | Wrapping key from the verified private bundle |

Preview and production use separate runtime bindings and wrapping keys. Prefer a
separate read-only token per environment. Do not distribute publishing tokens to
runtime services.

The launcher pulls into a mode-0700 temporary directory, suppresses CLI output,
checks ciphertext and the VAPID pair, and removes the directory before starting
its child. Only the three decrypted push values are added to the API environment.
Bootstrap credentials and wildcard app envelopes are removed from that child.
Conflicting existing VAPID values, missing bootstrap keys, invalid ciphertext or
failed retrieval stop startup. Disabled opt-in preserves the direct-env startup
path. There is no fallback to another runtime or to newly generated VAPID keys.

The startup dependency on Dotlocker availability is intentional and fail-closed;
there is currently no persistent/offline ciphertext cache.

## Validation and activation

```sh
pnpm exec envx info --config config/envx.api.config.mjs
pnpm exec envx doctor --config config/envx.api.config.mjs
pnpm exec envx audit --config config/envx.api.config.mjs
node --test quality/api-secret-runtime.node.test.mjs
```

The explicit Envx config supports local `.locker/api/<runtime>/.env` inspection;
that ignored directory is NOT the API's shared deployment/build artifact. Doctor
is expected to fail until a runtime and its key are provisioned locally.

Release the Sandblocks scope correction, verify API-only resolution without
logging values, and use a storage-preserving API rollout. A restart of the old
container does not install the new command or refresh Docker's environment.
The existing Rue database/encryption-key mount must survive any replacement.
This integration does not remove that deployment prerequisite.

Then, as the signed-in Rue user, verify `/notifications/push` reports enabled,
enroll a device, send a test, and verify actual background delivery and click-through.
Source tests and successful builds alone do not establish live push readiness.
