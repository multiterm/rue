# Rue worker installation — enrollment milestone

Worker 0.2 supports managed Pi agents, lifecycle operations and independently approved directory grants. The enrollment-only 0.1 milestone below is historical; it did not launch agents. See [managed workers](../../docs/managed-workers.md), [workspace permissions](../../docs/workspace-permissions.md) and the current [Mason rollout](MASON.md). There is no automatic updater.

## Enable and enroll

1. Enable Keyname and set `RUE_MANAGED_WORKERS=true` on Rue's core API; restart that API. The feature is disabled by default. No additional inbound port is needed; the existing HTTPS ingress must support `/worker-client/socket` WebSocket upgrades.
2. In Rue, open **Settings → Hosts**. Name the host (for example Mason), acknowledge root/Docker control, and enroll.
3. Record the worker ID and HTTPS API origin. Save the displayed secret in a **root-owned, mode-0600 file** on the target host, e.g. `/etc/rue-worker/credential.secret`. Use a protected editor/file transfer, not a command-line argument or chat message. It is displayed once and is stored hashed by the API. A lost creation response is safe to retry; if the secret was lost, rotate it.

Enrollment itself does not grant access to any user's existing Pi sessions. Worker credentials cannot call browser/account or terminal-agent APIs.

## Docker Compose

From this directory in a Rue checkout on the target host:

```sh
cp worker.env.example .env
# Edit non-secret values in .env; set RUE_WORKER_SECRET_PATH to the protected file.
docker compose config --quiet
docker compose build
docker compose up -d
docker compose exec worker rue-worker doctor
docker compose exec worker rue-worker status
```

`doctor` performs a bounded read-only Docker probe; it does not create containers. `status` is **last reported local state**, not proof that a process or remote agent is alive. The dashboard lists authoritative server observations and lease status.

The supervisor runs as UID 0 with the Docker socket. **Docker socket access is equivalent to host-administrator access.** Capability drops and `no-new-privileges` do not change that fact. No host root filesystem, external data volume, provider credential, host PID namespace, or privileged mode is mounted by this milestone. There are no published ports.

The Docker build context is restricted to worker source using `Dockerfile.dockerignore`; secrets, `.sandblocks`, `.worktrees`, local dependencies and other applications are excluded. Source builds use pinned tool/dependency versions. For distributed releases, build and verify the image first, then set `RUE_WORKER_IMAGE` to its approved digest. No public worker image is claimed to exist yet.

Compose provides a kernel-held `flock` on the persistent state volume, an init process, restart supervision, resource limits and rotated logs. Do not clone enrollment credentials or run separate Compose projects with the same worker ID. A second instance cannot replace a still-valid lease. After an ungraceful restart, a new process may wait up to 60 seconds for the previous lease to expire.

Run one Compose project per enrolled worker. A distinct project/state volume still requires a distinct enrollment. Do not use `docker compose down -v` as an update command.

## Native executable

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm --dir packages/libs/sdk exec tsc -p tsconfig.json
pnpm --dir packages/apps/worker build
pnpm --dir packages/apps/worker build:binary
packages/apps/worker/dist/rue-worker --help
```

`build` emits a Node 22+ CLI; `build:binary` uses Bun 1.3.14 to emit a standalone executable for the build host. For Linux release binaries, build in the Linux image/on the target architecture or supply Bun's explicit compile target; do not copy a macOS executable to Mason.

For new enrollment, use a generic Tenancy key with Rue's Enrollment grants. Set `RUE_WORKER_API_URL`, `RUE_API_KEY_FILE` (a private mode-0600 file), `RUE_WORKER_NAME`, `RUE_ACKNOWLEDGE_HOST_CONTROL=true`, and optionally `RUE_WORKER_STATE_DIR`; run `rue-worker enroll-key`. This exchanges the same API key for internal fenced transport identity in private `link.json`. Subsequent `run` reads that link. The raw `enroll` and `enroll-project` commands are removed. Existing Mason state is preserved; do not enroll it again. Explicit transport recovery can still configure the complete API URL/worker ID/private secret-file tuple, without mixing it with partial saved state.

On Linux, supervise native `rue-worker run` under systemd and use `flock --no-fork --nonblock <state-dir>/daemon.lock <binary> run`, as Compose does. Never invoke a second daemon to obtain status; use the read-only `status` command.

## Recovery and rotation

Healthy WebSockets remain open. Heartbeats run every 15 seconds and renew a 60-second authority lease. The client has independent acknowledgement deadlines and monotonic/wall-clock expiry checks. Network failures retry with bounded jitter; unknown protocols and invalid credentials stop the process. Compose may retry a stopped process, but it cannot re-enroll, bypass revocation, or gain authority with an invalid credential. Logs contain sanitized error codes, not frames or credentials.

Drain/activate changes are revision-checked, audited and pushed immediately. They currently record host intent only: there are no managed agents to drain yet. Rotation is **immediate**, without an overlap window: it fences the old stream and requires replacing the host's credential file and restarting the worker. Revocation is irreversible for that enrollment. Neither action deletes host files.

The API initially supports a single Rue core instance. Do not load-balance worker streams across independent SQLite stores or rely on the process-local event bus for cross-replica delivery.

## Mason rollout

See [the Mason deployment record](MASON.md). A dedicated Colima VM now bounds application file sharing to the approved MOTHERSHIP root (including its relocated runtime cache); the ARM64 worker image is built and smoke-tested there. Authenticated enrollment and managed execution now run in development. Per-agent directory assignments require separate consent and verified UID-1000 access; do not mount the entire tree merely to make setup pass. A whole-volume grant always excludes administrative cache assets.
