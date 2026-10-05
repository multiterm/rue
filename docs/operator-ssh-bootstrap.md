# One-time operator SSH bootstrap on Mason

This is an SSH enrollment helper, **not** a completed Rue bot provisioner or a
PostgreSQL migration. It uses Mason's existing deployment identity in place; it
does not copy private keys, forward an SSH agent, or change SSH daemon configuration.

## Verified inventory

Source: `WRLD/honeycluster/provision/inventory/host_vars/`.

| Host | SSH connection | Existing controller identity |
| --- | --- | --- |
| Abby | `ansible@100.114.99.85:2220` | `~/.ssh/ansible-honey` |
| Stratus | `ansible@100.78.201.50:22` | `/Users/calvin/.ssh/ansible-honey` |
| Mason | `calvin@100.84.114.123:22` | `~/.ssh/github` |

All three endpoints reached SSH key exchange from the managed agent. These probes
sent no authentication and deliberately rejected unverified host keys. The earlier
Abby port-22 refusal was an incorrect-port probe, not an SSH outage.

The managed agent can read `/Volumes/MOTHERSHIP`, but cannot read Mason's
`/Users/calvin/.ssh`. The provisioning auth vault was inspected without printing
or saving decrypted values: it contains an Ansible password but no private SSH key.
Do not use that password against an unverified host or copy an entire personal
`.ssh` directory into an agent.

## Execute on Mason, as the existing operator

Use a native terminal/operator process on Mason, **not this managed container**.
Review the helper before execution. It reads the two target connection records
and uses `/usr/bin/ssh`, strict host-key checking, and Mason's existing
`~/.ssh/known_hosts`. If the controller identity is encrypted, unlock it through
Mason's normal local SSH-agent workflow; the agent is never forwarded remotely.

Read-only preflight:

```sh
cd /Volumes/MOTHERSHIP/dev/Projects/multiterm/rue
node scripts/deployment/bootstrap-infrastructure-ssh.mjs \
  --provision-dir ../../WRLD/honeycluster/provision \
  --public-bundle .sandblocks/recovery/infrastructure-ssh-public-49799108-4633-4772-9e5b-7d007ce14ffd.json \
  --expected-fingerprint SHA256:CunhryJ9v4Lyc2CfHT+7dM0ZcKQ4U2azAM8l+UY3kbM
```

Check the reported target identities and sudo check. Then explicitly authorize
the dedicated key for at most 24 hours, inheriting the existing **ansible account's
privileges**. This can be host-root access; it is not a restricted deployment API.
No new Unix account or sudo policy is created.

```sh
EXPIRY="$(node -p "new Date(Date.now()+24*60*60*1000).toISOString().replace(/\\.\\d{3}Z$/,'Z')")"
node scripts/deployment/bootstrap-infrastructure-ssh.mjs \
  --provision-dir ../../WRLD/honeycluster/provision \
  --public-bundle .sandblocks/recovery/infrastructure-ssh-public-49799108-4633-4772-9e5b-7d007ce14ffd.json \
  --expected-fingerprint SHA256:CunhryJ9v4Lyc2CfHT+7dM0ZcKQ4U2azAM8l+UY3kbM \
  --expires-at "$EXPIRY" --apply --acknowledge-host-admin
```

Both hosts must pass preflight before either is changed. Apply appends only the
new public key, with OpenSSH `restrict` and `expiry-time` options, to the existing
ansible account's default `authorized_keys`. Existing entries are preserved and
a private backup is retained under that account's `.ssh/rue-operator-backups/`.
The helper refuses symlinked authorization files, an existing copy of the key with
different restrictions, and failed sudo checks. It does not run a fleet playbook,
restart services, replace containers, or touch Rue's database.

A private-mode, **public-material-only** report is written under
`.sandblocks/recovery/infrastructure-operator-*.json`. It includes target-specific
pins exported from the already-trusted controller `known_hosts` file, not from
an unauthenticated scan. No private SSH key or Rue token is placed in the report.

An installed entry is not proof that the new identity can log in. The managed
operator must next verify authentication using its dedicated private key and the
reported trusted pins before any deployment. The helper reports
`newIdentityLoginVerified: false` and `botCreated: false` until separate checks are
performed; it does not change these to claim completion.

## Partial operations, expiry and revocation

- There are no automatic SSH retries. A failed/disconnected apply is marked
  `needs-reconciliation` in its report. Inspect the remote state first.
- Exact reapplication with the **same expiry** is idempotent. Reuse the original
  report's expiry, not a freshly computed timestamp. Different restrictions are
  refused rather than silently extending authorization.
- Revocation removes only this exact public-key entry on both hosts. Do not
  restore a whole historical `authorized_keys` file over unrelated changes.
- Expiry/removal blocks subsequent authentication, not an already-established
  session or background command. Root privileges can create persistence; this
  bootstrap is an explicit trust grant, not containment against a hostile agent.
- The dedicated private key remains in the current agent's private workspace.
  Provision it to the intended operator through an approved private mechanism;
  never put it into this repository or an image.

Creating the managed bot for `r@honeycluster.io` still requires a verified Rue
owner context. This helper neither invents that identity nor mints a login session.
See [infrastructure-bot-postgres.md](infrastructure-bot-postgres.md) for the remaining
bot and PostgreSQL deployment work.

## Tests

```sh
node --test quality/infrastructure-ssh-bootstrap.node.test.mjs
```

Validation tests and Linux temporary-filesystem shell fixtures exercise the
read-only path, expiry, restricted append, backup, idempotence and conflict refusal.
Identity/sudo checks are test doubles. These tests do not establish live host
access; the Linux-only fixtures are skipped on other platforms.
