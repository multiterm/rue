# Git status in the chat header

Agents with the updated runtime/extension report a bounded, read-only Git snapshot
for their actual working directory. The right side of the sticky chat header shows
a branch icon and `remote / branch`. Remote means the configured remote name (for
example `origin`), not its URL. Credentials and remote URLs are never reported.
Detached HEAD and repositories without remotes are supported. No repository or no
Git telemetry means no control; the UI does not scan other mounted directories.

The dialog lists up to 50 existing local branches and marks the current branch.
Selecting another branch followed by **Ask agent to switch** sends an ordinary
conversation request through existing authorization and queue handling. It keeps
any unsent draft intact. No browser or server directly checks out a branch.
The request asks the agent to verify the directory/current branch, preserve changes,
and stop if switching is unsafe. It does not authorize force checkout, reset, clean,
stash, branch creation or changes to remotes. Existing tool permissions still apply.
A successful request submission is not proof that the branch changed; the header
waits for the agent's next metadata report. Failed/uncertain requests are not replayed.

Deployment requires both the API's optional Git-status schema and the updated
managed runtime image or linked Rue extension. Existing running containers do not
acquire this telemetry from a webapp hot reload. No host or agent was restarted as
part of this implementation.

Validation: disposable real Git repositories (including detached HEAD, unborn HEAD,
nested directories, remote-URL exclusion and branch-list bounds), API schema parsing,
SDK/core/webapp/runtime TypeScript checks, and desktop/mobile mocked browser tests.
