# Local development synchronization

```sh
pnpm exec rune sync-development   # upload, rebuild libraries, run full deployed checks
pnpm exec rune watch-development  # continuously synchronize local edits to development
```

Sync is one-way, local to the bound mutable development sandbox. It includes
uncommitted source files, but never promotes preview or production. Release
candidates must come from committed source on `pre` or `prod`.

The watcher serializes uploads and snapshots before each run, retaining edits
made while an upload/build is running. Application-only edits use Vite/tsx hot
reload. Library or dependency changes additionally run the frozen install and
shared-library build in the development workspace. The first watch iteration
also builds libraries. Failed runs retry after the next source edit; inspect the
protected logs. A changed sandbox/project/workspace stops the watcher. A lock in
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
