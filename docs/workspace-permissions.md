# Workspace & permissions

Managed agents can receive explicit read-only or read/write directory grants
at absolute host paths, including directories outside `/Volumes/MOTHERSHIP`,
provided the host operator has explicitly approved and shared their roots.
Configure per-agent grants in the bot’s **Workspace & permissions** page. `/workspace` remains the private working directory; host access is not
implicit in VM sharing or in coding-tool permission.

## Consent and lifecycle

- Legacy MOTHERSHIP opt-in remains `RUE_WORKER_MOTHERSHIP=true`, with filesystem
  image labels `2` or `3` and worker capability `managed-filesystem-v1`.
- Additional roots require operator-owned `workspaceRoots` in the persisted worker
  runtime policy (`RUE_WORKER_WORKSPACE_ROOTS` is a JSON array during configuration),
  an updated worker/API/UI, and a selected agent image with `io.rue.filesystem=3`.
  Eligible workers advertise `managed-filesystem-v2` after inspecting a v3 image.
  The worker checks the selected agent's image and approved roots again at boot;
  a host capability alone does not establish that every agent has been upgraded.
- Configurations are owner/revision fenced and require separate filesystem
  acknowledgement. Provider/model, credential and MCP grants are preserved;
  tool-output and thinking sharing remain independent controls.
- Up to eight literal existing directories, bounded to 2 KiB, can be selected.
  Traversal, symlinks, duplicate paths, unapproved roots, runtime/control paths,
  whole home directories and direct administrative-state/cache grants are rejected. A read-only parent may contain a writable
  child; a writable parent cannot have a user-defined read-only exclusion.
- **Apply permissions and stop** fences the old runtime. Resume is separate.
  Replacing only that agent container terminates its processes, detached children
  and open descriptors; no VM restart is needed. State, workspace and Pi history
  are retained. Copied data and completed effects cannot be revoked. Nothing is
  automatically replayed.

## Actual security boundary

The worker creates only exact approved, nonrecursive, `rprivate` Docker binds.
Read-only mounts deny content **and metadata** changes for Pi tools, shell commands,
subprocesses and stdio MCP servers. Normal Unix file permissions still apply.
Inventory validation checks mount sources/targets, access flags, propagation,
private volumes, immutable image, labels and runtime isolation settings.

A source-path check followed by a Docker bind would have a rename race. Instead,
a bounded, network-disabled, credential-free native helper opens each source
component with `O_PATH | O_NOFOLLOW`, requires the approved virtiofs filesystem,
and holds inode descriptors. V3 additionally matches each root against the
host's kernel mount table and the helper's mount table: it must be an actual
virtiofs share root, not a symlink/subdirectory bind hiding a different source.
Only the credential-free helper gets the read-only host mount-table file; that
file is never mounted into the agent. A root-only Unix socket transfers those descriptors
with `SCM_RIGHTS` and a fresh boot nonce. Before any Pi or MCP code starts, the
guardian verifies that the mounted directories have those device/inode identities,
the exact read/write flags and usable UID-1000 access. Missing shares, source
replacement, wrong descriptors and absent proofs fail closed. The helper exits
or times out; no proof descriptors reach the agent tools.

Whole-volume grants additionally mask Colima’s administrative cache with an
empty, mode-000, read-only tmpfs. The native verifier independently checks this
mask and rejects a case alias that exposes the underlying cache. On a
case-insensitive source, whole-volume access can therefore fail closed: choose a
narrow project directory rather than disabling the check. This protects the cache
when a whole-volume grant passes verification. Supervisor enrollment, Docker storage and Colima private control state
remain outside the shared tree. The agent receives no Docker socket, host PID
namespace, privileged mode or supervisor private volume.

Whole-volume access **does expose other readable secrets and writable code in
that volume**. Prefer narrow grants. Host tools later executing writable shared
code are outside this filesystem boundary; this is not a complete host-security
sandbox or network sandbox. Linked interactive Pi agents are not converted into
managed containers by these controls.

## Activation of additional roots

This is source implementation, not evidence of an installed image or live grant.
On Mason, maintain a private mode-0600
`~/.local/state/rue/workspace-roots.json` containing the additional existing,
canonical directories, for example `["/Users/calvin/workspaces"]`. Do not put the
file, enrollment, Colima control state or Docker data within approved roots.
Roots must be disjoint; Mason retains the MOTHERSHIP share and permits at most
seven additional roots (eight total). Each agent still receives only its own
explicit directory grants, never every shared root.

A native operator must add matching virtiofs shares to the dedicated VM and run
`node scripts/deployment/mason-worker.mjs --check` with Node 24. Use
`--workspace-roots-file PATH` on every operation when using a nondefault file.
The helper rejects unexpected/nested shares and verifies fresh host/VM markers;
it never silently adds VM shares or exposes the whole host/home directory.
Missing configuration does not erase persisted roots during capacity changes.

Release the compatible API/UI first. Build and inspect the worker and v3 agent
images, then install the updated manager and root policy through the documented
operator maintenance procedure. Preserve the existing default image if other
agents must stay on v2; use the single-agent immutable-image update for the
selected agent, then apply its filesystem grant and explicitly resume it.
Changing VM shares or manager policy requires planned host maintenance, unlike
an ordinary per-agent grant change within already approved shares. Do not restart
other agents or replay uncertain work automatically. Prefer a dedicated credential
directory over sharing an entire personal `.ssh` directory.

## Verification

Legacy coverage includes policy validation, independent consent/capability/revision
checks, exact Docker inventory (including omitted false flags and inherited image
labels), browser configuration, native descriptor/source-swap tests, read-only
content/metadata denial, native Pi read/write/edit/bash and Git compatibility,
and a real stdio MCP subprocess inheriting the restrictions. Production helper
proofs for the legacy protocol have also crossed real Mason container namespaces.
That does **not** establish live acceptance of v3.

For v3, 100 targeted checks pass: policy/native-parser tests, worker fixtures,
API filesystem tests, related regressions and four desktop/mobile browser cases.
All five affected package typechecks pass. API tests used isolated Linux Node 22
and better-sqlite3 11.10.0, leaving the checkout's macOS native binding untouched.
Both production and synthetic-test native binaries compile
with warnings treated as errors. The native policy test requires a Linux compiler
(`RUE_NATIVE_CC_JSON` can select one); without it that case skips rather than
claiming native validation. Full privileged descriptor tests, a v3 image
build, actual Mason virtiofs attestation and a controlled single-agent rollout
remain required before declaring this active. Synthetic native fixture modes
`external-read` and `external-write` exercise `/shared/test` in
`src/sandbox/mount-proof-test.py`; provide that tmpfs plus `/control` when running
the test image. `RUE_MOUNT_TEST` bypasses actual virtiofs/host-anchor checks and
must never be used in a production image. The broader storage test file also has
an unrelated Codex-catalog assertion failure; filesystem tests pass separately.

Development rollout preservation checks compare enrollment, session bytes and
workspace archives. UID-1000 checks create/read/delete only a synthetic temporary
file in the approved volume, check existing project-file access without modifying
it, and verify that bootstrap credentials, host home, Docker socket and the
administrative cache remain inaccessible. No inference request is needed.

The earlier Landlock ABI-4 launcher remains an unused investigation artifact.
Its strict metadata-denial policy broke Git; it is **not** the deployed boundary.
Native mount fixtures use synthetic data and never copy credentials.

See [managed workers](managed-workers.md), [Mason deployment](../deploy/worker/MASON.md)
and [connection hardening](connection-hardening.md).
