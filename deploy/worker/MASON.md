# Mason: bounded Docker VM and worker preparation

## Additional workspace roots — prepared, not deployed

The updated SDK/API/UI/worker and filesystem-v3 agent image support explicitly
approved absolute workspace directories outside MOTHERSHIP. They do not give a
running agent permission to add VM shares or expose the host's whole home/root.
The historical deployments below do not establish v3 acceptance.

On native Mason (Node 24), keep an operator-owned mode-0600
`~/.local/state/rue/workspace-roots.json` with a JSON array of additional canonical
existing directories, for example `["/Users/calvin/workspaces"]`. Keep this file,
enrollment and private Colima/Docker state outside all approved shares. MOTHERSHIP
remains the legacy share; at most seven additional disjoint roots are supported.
Use `--workspace-roots-file PATH` on every helper invocation for a custom file.

During planned host maintenance, back up private state and configuration, drain
and stop affected agents/supervisor, and add exactly those virtiofs shares while
preserving the existing VM, disks, resources, cache override and forwarding flags.
Do not recreate the VM or auto-resume/replay work. Run the helper's `--check`; it
checks exact share membership, canonical sources and fresh markers. Then install
the reviewed compatible manager and configure the root policy. Capacity-only
changes preserve existing runtime policy, including roots, rather than clearing it.

Build and inspect a filesystem-v3 image and update only the selected agent through
the immutable-image update path. Keep the existing default image for other agents
if they must remain on v2. After inspecting a selected v3 image, the manager can
advertise `managed-filesystem-v2`; each boot still checks its actual image and
approved paths. Release the compatible API/UI before enabling this capability.
A same-Pi-version security/feature rebuild can be selected through the explicit
image update API even when the automatic newer-Pi UI offers no update.

The native verifier rejects unsafe cache case aliases; on a case-insensitive
source, a whole-MOTHERSHIP grant may therefore fail closed. Prefer a narrower
project directory, not a workaround that disables the cache check. Live v3
virtiofs/descriptor checks and controlled rollout are still outstanding; no SSH
keys or other directories have been shared by this source change.
See [Workspace & permissions](../../docs/workspace-permissions.md).

## Shared-memory concurrency (deployed 2026-09-25)

Mason's persisted agent limit was explicitly raised **1 → 10** after deploying
manager `sha256:13e7882666c19ae2f8b54260522f5b23fa9a5655b567463feaea39df8aeed6db`.
Worker generation **17** is online; the existing agent is running/idle at revision
**32**. No extra agents or model requests were started. The immutable runtime
image remains `sha256:0a610eb0b980650655d767ca460829f1815c7ba3324e5c2b4e309486c36aa44c`.

Authenticated revision-fenced stop/drain preceded the manager replacement. The
new instance waited for the prior control lease to expire before activation and
resume. Enrollment checksum, session bytes, workspace archive comparison, VM boot,
other runtime-policy fields and active Docker context `abby` were preserved.
Docker inspection and kernel cgroups confirmed the unchanged per-agent limits;
the agent remained unable to read the administrative cache or Docker socket.
Private backups are retained in `rue-mason-shared-memory-20260925-backup` and on
Mason under `~/.local/state/rue/shared-memory-20260925/`. The prior manager image
is tagged `rue-worker:before-shared-memory-20260925`.

Validation: 32 worker tests, 10 shared-memory/update/bootstrap tests, three Mason
deployment checks, and worker TypeScript passed. This is not a ten-agent load test.

New manager configurations default to **10 agents**. Existing persisted limits are
preserved: installing the binary alone does not change them. For future capacity
changes, drain/stop through the revision-fenced procedure and stop the supervisor
before configuring and restarting it on Mason:

```sh
node scripts/deployment/mason-worker.mjs --configure-runtime --agent-limit 10
node scripts/deployment/mason-worker.mjs --start
```

The capacity-only configuration preserves the existing immutable agent image,
filesystem opt-in and rollout setting. It refuses configuration while the manager
holds its lock or any managed containers remain. Resume only the agents that were
previously running after verifying the new manager; preserve private volumes and
enrollment throughout. The commands above were executed during this rollout.

The 4 GiB container value is a **ceiling, not a reservation**. Admission now uses
Linux `MemAvailable` (including reclaimable cache), leaves 2 GiB host headroom plus
512 MiB startup allowance, and launches at most one agent every 15 seconds. It
also waits for a starting peer to connect (bounded at 90 seconds). Low memory or
disk space defers starts/reloads without killing existing agents or consuming
retry attempts. Existing CPU, RAM, process and tmpfs ceilings remain intact.

Ten light/idle agents can share memory; ten simultaneous heavy builds may not fit.
Admission control cannot guarantee zero OOMs from growth in already-running tasks.
Monitor real usage and reduce heavy-work concurrency or add RAM when necessary.

## Agent container resource rollout

Managed agents now receive **4 GiB RAM, 2 CPUs, 256 processes and a 512 MiB
no-exec `/tmp`** (tmpfs counts toward the RAM limit; swap is disabled). The
supervisor receives 1 GiB RAM, 1 CPU and 128 processes. Concurrency was not raised.

The worker resource tests (32) and TypeScript checks passed before building worker
`sha256:85323a4983809dd3ecdea29a0824a9aa2f90b921207eceb7b79c152f183ca4d9`.
Revision-fenced idle stop at 22, host drain, private backup and worker replacement
preceded separate activation/resume. Worker generation **15**, agent revision
**23** are online/running. Docker inspection and actual kernel cgroup limits
confirm the new profile. Enrollment, runtime image policy, session and workspace
were preserved; post-start filesystem-boundary checks passed. The VM boot ID and
active `abby` context are unchanged. No model prompt was submitted.

The runtime image was not changed. `rue-mason-resource-rollout-backup` retains
private state/workspace archives, and `rue-worker:before-resource-rollout` retains
the old worker image. Do not roll back the worker against current-profile running
containers: drain and stop them with the current worker first.

## VM resource resize

The dedicated `rue` VM now has **8 CPUs, 12 GiB RAM and a 20 GiB data disk** on
Mason's 10-core / 16 GiB host. Two cores and 4 GiB remain outside the VM budget
for macOS and host services. The data disk was 45% used, so it was not enlarged.

The agent was confirmed idle, stopped at revision 20, and the host drained before
the supervisor and VM were stopped. Private backups were retained in
`rue-mason-vm-resize-backup`; the original Colima configuration and metadata
checksums are under the operator's private `~/.local/state/rue/vm-resize-*`.
Engine identity, image IDs, existing volumes, enrollment, runtime policy, session
bytes and workspace contents were verified unchanged after restart. Only
MOTHERSHIP is shared, SSH-agent forwarding remains disabled, and active context
remains `abby`. No image deployment or container resource-profile change was
part of this VM resize. Worker generation 14 and agent revision 21 were confirmed
online/running after reactivation; the existing resume request was honored rather
than duplicated. Post-restart UID-1000 filesystem-boundary checks passed. The
agent limit at that point was still 512 MiB; the separate container resource
rollout above subsequently replaced that legacy profile.

## Latest workspace and sync development rollout

Mason is running/idle at worker generation **13**, agent revision **16**, with the user-approved `/Volumes/MOTHERSHIP` read/write grant. Its private cwd stays `/workspace`. Colima’s administrative cache is masked by a verified empty read-only tmpfs; host home, Docker socket and bootstrap credentials remain inaccessible to UID 1000. Existing file permissions still apply.

Runtime: `sha256:34f8e33dc2f7d86a389896fcb9e394ddf0f1778a52ff58529b05772eb47be117`. Worker: `sha256:1345b8c66b1e632097d7dd500f9e8662c6c686e90e5911de9006e7842f411dbb`. The runtime filesystem implementation label is `io.rue.filesystem=2`; the worker advertises `managed-filesystem-v1`.

The rollout used revision-fenced stop, host drain, private backups, immutable images and separate resume. Enrollment checksum, session bytes and workspace archive comparison passed. A UID-1000 synthetic file was created/read/deleted in MOTHERSHIP; existing project-file read/write access was checked without modifying its contents. A real sync request produced a live heartbeat with zero pending uploads and an unchanged transcript; no prompt or inference was submitted. Colima was not restarted and active Docker context remains `abby`.

The initial creation exposed two Docker inspection compatibility cases (omitted `ReadOnly: false` and inherited image labels). Both gained regression coverage; the never-started container was removed without deleting volumes. Whole-volume cache protection then received independent native negative tests. Backups remain in `rue-mason-workspace-rollout-backup` and `rue-mason-workspace-protected-backup`. Do not resume an older unprotected image with a whole-volume grant.

See [Workspace & permissions](../../docs/workspace-permissions.md) and [live sync](../../docs/connection-hardening.md).

## Previous OAuth development rollout

Mason now runs the OAuth-capable images: worker generation **9**, agent revision **5**, observed running/idle. The authenticated API advertises `managed-codex-v1`, eight pinned Codex models, and server-side OAuth runtime support. The existing saved OAuth connection is ready with **zero agent grants**; this rollout did not grant it or switch Mason away from OpenAI.

The agent was confirmed idle and stopped through revision-checked manager controls. The host was drained, all its retained agents verified stopped, and the supervisor/runtime policy updated before reactivation and agent resume. A new instance waited out the prior execution lease instead of bypassing fencing. Enrollment checksum, session bytes, workspace archive comparison, mount boundary and active `abby` context all passed preservation checks.

Runtime: `sha256:d7fe3acaea8be8c9c9619678b6b38f7e86aa06617561b9088b3177627031ca8f`. Worker: `sha256:b9a9b518eba8a195cc5c2cd0f06bb776f5631e9a20665e117a344d0edf783a3a`. Previous images remain tagged `before-oauth-rollout`; `rue-mason-oauth-rollout-backup` holds private VM state/workspace archives and the previous runtime policy. No actual OAuth model inference or refresh was requested. See [OAuth setup](../../docs/codex-oauth.md).

## Previous status/compaction development rollout

The status/compaction-capable images are deployed. SSH must explicitly use `-i ~/.ssh/github -o IdentitiesOnly=yes`; default identity selection failed despite Mason being reachable.

The idle Mason agent was stopped at revision 2 and resumed at revision 3 through the authenticated manager API. Worker generation 7 is online with `managed-compact-v1`; the agent is observed running and reports `/workspace`, no Git branch, `openai / gpt-6-astra`, thinking `low`, and idle state through `/terminal/computers`. These are observed runtime values, not inferred from configuration.

Enrollment checksum was unchanged. All 11 original session entries were preserved byte-for-byte, and the workspace archive comparison passed. The `rue-mason-status-rollout-backup` private VM volume retains state/workspace archives and the previous runtime policy; `before-status-rollout` image tags retain prior images. A root helper without DAC capabilities could not read UID-1000 state; the backup was completed as UID 1000 instead. The incomplete archive is retained separately, not used as the backup.

Runtime image: `sha256:b488149fa1ce6822095155c51646e2220c8e22f0b746210232c0a2db8d520873`. Worker image: `sha256:0e3ff5f2ac29870204d2404c0f3b4ce862e58dce3b3cd299765e9042519c79a6`. Only MOTHERSHIP remains shared; active Docker context remains `abby`. No model request or live compaction was issued.

## Historical preparation inventory and state

Mason's connection comes from `WRLD/honeycluster/provision/inventory/host_vars/hl-mason.yml`: macOS, `calvin`, Tailscale address `100.84.114.123`, identity file `~/.ssh/github`. SSH used batch mode and strict host-key checking; no credential contents were printed or copied into this repository.

The pre-existing `default` Colima profile was stopped. The active Docker context was **Abby**, not Mason. It was left unchanged. A separate **rue** Colima profile now runs on Mason with 2 CPUs, 2 GiB RAM, 20 GiB data disk, VZ/virtiofs, Docker, and no forwarded SSH agent. Its only host-directory share is `/Volumes/MOTHERSHIP`, read/write: the approved application-data ceiling.

Colima initially added its default read-only cache outside that root. This was corrected using the supported `XDG_CACHE_HOME=/Volumes/MOTHERSHIP/.rue-colima-cache` override. The private Colima control state stays under `~/.colima`, outside the share; the original home cache was not deleted or moved. Docker engine/image IDs, named volumes and the active Abby context were verified unchanged after restart. The first boot retained an obsolete guest mount alias from the old fstab; a second boot reconciled it. Final checks reject **all** extra shares, including nested shares and read-only caches.

The worker image `rue-worker:mason` was built on `colima-rue` for ARM64. A network-disabled, read-only, capability-dropped image ran `--version` successfully (`0.1.0`), including its real lock-taking entry point with temporary memory-backed lock state. Without a writable state mount, the entry point fails closed as expected. A non-root container verified an approved read-only MOTHERSHIP bind; a bind of the host SSH directory was rejected because it is absent from the VM. That initial image smoke test did not use authentication. Development enrollment was subsequently performed with an owner-authorized, privately stored credential.

The legacy builder attempt was cancelled while preparing its context and produced no image/cache. The successful BuildKit build transferred a 15.13 kB context. Root and Dockerfile-specific ignore files now both deny deployment state, dependencies and worktrees by default. Never build against the active/default context accidentally.

**The enrollment-only worker daemon is now running and was observed online. No managed agent container is running.** Owner credentials were issued through the operator CLI for the authorized development account and stored outside the shared tree; no credentials were added to source. The disposable PostgreSQL test container was removed. The old Colima profile and active Abby context remain unchanged.

## Reproducible VM setup

Run on Mason, not against Abby:

```sh
XDG_CACHE_HOME=/Volumes/MOTHERSHIP/.rue-colima-cache COLIMA_HOME="$HOME/.colima" \
colima start --profile rue --cpus 8 --memory 12 --disk 20 \
  --activate=false --mount /Volumes/MOTHERSHIP:w --ssh-agent=false \
  --vm-type vz --mount-type virtiofs --runtime docker
node scripts/deployment/mason-worker.mjs --check
docker --context colima-rue buildx build --builder colima-rue --load \
  -f deploy/worker/Dockerfile -t rue-worker:mason .
```

Resource baseline: each new agent is capped at 4 GiB RAM / 2 CPUs / 256 processes, with a 512 MiB no-exec `/tmp`; the manager is capped at 1 GiB / 1 CPU / 128 processes. An 8 GiB VM supports one fully budgeted agent plus manager/OS headroom. For multiple simultaneous agents, provision at least `4 GiB × agent count + 1 GiB`, with additional OS/build headroom, and enough host CPU capacity. That is the fully provisioned worst-case budget, not an idle-agent reservation. The shared-memory admission policy above uses actual available memory instead of dividing host RAM by each agent's maximum; configured concurrency still requires an explicit operator change for existing hosts.

For an existing VM, drain/stop agents and the supervisor before resizing Colima. Preserve the private volumes and all existing approved mount/security flags. Build/deploy the updated worker image, start the supervisor, and resume/reload agents through Rue so their containers are recreated with the new limits. Legacy containers remain recognizable for safe removal; source sync alone does not resize running containers. Do not use `docker update` to partially change a resource profile: ownership checks require an exact supported profile, and tmpfs changes require recreation.

Always supply that cache override when starting/restarting this profile; an ordinary Colima start can reintroduce the default outside cache. Do not move Colima's private control directory into MOTHERSHIP. The cache under MOTHERSHIP contains runtime assets, not enrollment secrets, and is always masked from agents, including those explicitly granted the surrounding volume.

The check enforces the dedicated local socket, matches the SSH-inspected VM's engine ID to Docker's engine ID, rejects every unapproved share (including nested shares), and checks that SSH-agent forwarding is absent. Short-lived non-secret marker directories verify the running VM's actual host sources, rather than trusting mount labels or a potentially stale configuration file. Only those marker directories are removed afterward. Raw Docker/Colima commands can bypass the helper; this is not a host-wide policy hook.

## Enrollment and Compose

The Rue API must have Keyname authentication and `RUE_MANAGED_WORKERS=true`. The Rue development deployment now enables this flag; production configuration is unchanged. The existing development database and matching encryption key were backed up before the API restart and preserved. Preserve the API's existing database/encryption-key mount if changing its deployment command; see `docs/development-sync.md`.

An authenticated owner creates **Mason** under Settings → API keys/Hosts and acknowledges supervisor authority. Save the one-time `rue_worker_…` credential in a private, mode-0600, owner-held file **outside every approved share and Colima's shared cache**, for example under `~/.local/state/rue/mason/`. Do not paste it into chat, command arguments, Git, `.sandblocks`, or an agent workspace.

```sh
node scripts/deployment/mason-worker.mjs --enroll \
  --api-origin https://YOUR-RUE-API \
  --worker-id UUID-FROM-RUE \
  --secret-file "$HOME/.local/state/rue/mason/worker.key"
node scripts/deployment/mason-worker.mjs --start
```

Enrollment is transferred over stdin into the private VM-only `rue-mason-worker-private` volume, not through a host secret bind or container environment. The helper refuses symlinks, hard links, loose permissions and existing enrollment. It verifies a local Docker volume without driver options (not a disguised host bind/plugin), and resolves its storage path inside the checked VM to reject state backed by MOTHERSHIP. It never silently overwrites or re-pairs a host. Enrollment and Compose refuse registry pulls and use only the locally prepared image. `mason.compose.yaml` uses the saved origin-bound link, a read-only root filesystem, resource/log limits, a kernel lock, and no inbound ports. Only this trusted supervisor gets the VM Docker socket and its private volume. Rotate credentials through a separately reviewed stop/update/restart operation; enrollment is intentionally not a rotation shortcut.

## Boundaries and remaining runtime work

The Docker socket grants administration of the **VM**, including all its shared directories and Docker volumes. Merely binding that socket read-only would not reduce its API authority. This is not confinement of a compromised supervisor to one container.

MOTHERSHIP includes provisioning and development files which may contain secrets. It is a maximum allowed root, **not a default mount for every agent**. Agents require explicit directory assignments and verified ownership/write permissions; no supervisor credentials, Docker socket, host PID namespace, privileged mode, or private state volume. Writable shared code may later be executed by host tools: a filesystem boundary is not a complete security sandbox against that workflow or credentials already stored in the approved tree.

Mason now runs worker 0.2.0, generation 3, with pinned local runtime policy, unchanged enrollment and zero managed agents. It advertises execution, purge and MCP capabilities. Development enables both managed-worker and managed-agent flags; production is unchanged. Authenticated disposable canaries verified lifecycle/restart recovery, preserved history/workspaces, separate purge, MCP synthetic-credential delivery and UID-1000 execution, frozen-Pi guardian fencing, revocation and bootstrap scrubbing. Canary hosts were revoked and resources removed. No provider inference is claimed.

The actual VM host share remains only `/Volumes/MOTHERSHIP`, and active Docker context remains `abby`. Explicit MOTHERSHIP directory grants are now implemented; legacy mount aliases remain unsupported. Broader failure-matrix acceptance and live generic Tenancy verifier provisioning remain separate work. No Tenancy project token is accepted as a worker secret. See [MCP](../../docs/mcp.md) and [managed workers](../../docs/managed-workers.md).
