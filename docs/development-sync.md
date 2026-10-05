# Local development synchronization

```sh
pnpm exec rune sync-development   # upload, rebuild libraries, run full deployed checks
pnpm exec rune watch-development  # continuously synchronize local edits to development
```

Both Rue's `sync-development` runner and watcher now parse runtime TypeScript/JavaScript **before** uploading source. Syntax errors abort that attempt without a remote sync/build and report only file/line/diagnostic codes. Run `node scripts/deployment/check-development-syntax.mjs` independently. This executes no source and is not a typecheck or an immutable-snapshot guarantee: edits racing an upload still require care. Direct Sandblocks CLI calls bypass this Rue-side gate. Tests/builds remain necessary.

The Rue watcher was restarted on 2026-10-01 to load the guard and completed a synchronization. Its old process did not exit on SIGTERM; after confirming its identity, no child process and no active Rue workspace operation, it was terminated and its stale lock preserved rather than blindly deleted. The other application's watcher was not touched.

`sync-development` also verifies Sandblocks' recorded quality state after the CLI returns. A zero CLI exit code alone is insufficient: required checks must pass for the current source revision. The root Docker allowlist includes only the seven browser-check source/config files needed by `Dockerfile.sandblocks-e2e`; it continues to exclude deployment state, credentials and nested worktrees.

Sync is one-way, local to the bound mutable development sandbox. It includes
uncommitted source files, but never promotes preview or production. Release
candidates must come from committed source on `pre` or `prod`.

The watcher serializes uploads and snapshots before each run, retaining edits
made while an upload/build is running. Application-only edits use Vite/tsx hot
reload. Library changes run the shared-library build in the development workspace.
The first iteration and changes to dependency manifests/lockfiles also run the
frozen install. Ordinary library source edits do not repeatedly reinstall live
node_modules. Failed runs retry with bounded backoff (up to 60 seconds), or after
the next source edit; inspect the protected logs. A changed sandbox/project/workspace stops the watcher. A lock in
`.sandblocks/local-sync.lock` prevents duplicate watchers; remove a stale lock
only after confirming its owner has stopped.

Watch mode defaults to no browser checks per save. Set `RUE_SYNC_CHECKS=smoke`
or `full` to opt in, or run `sync-development` after stopping the watcher.
Closing the terminal/session does not stop an explicitly detached watcher;
reboots do. PID and background logs are local-only under `.sandblocks/`.

## Storage is not source

The development API's private database and encryption key are mounted from
`/vol/nvme/docker/rue/development/data` on Abby. Do not sync or upload this
folder. The rollout provisions independent private `preview/data` and
`production/data` directories under the same host parent. Preview is initialized
from a consistent backup of its previous canonical database; production starts
with its own empty database and independent encryption key.

These mounts are operator-managed, not part of Sandblocks' current manifest
volume lifecycle. A full replacement of an API container must reattach its
environment's private data mount **before** acceptance/promotion. Preserve its
matching encryption key and take a consistent SQLite backup first. Never reuse
another environment's mutable directory or regenerate a key over encrypted
settings. Source/HMR sync and normal container restart retain the existing mount.
