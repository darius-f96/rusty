# Pi command capability

`run_command` lets a Pi agent run a non-interactive process in the physical
workspace. It is available to interactive Agent Tab and Global Chat executions
when their selected skill enables it. Task Nodes never receive command tools;
they only generate VFS code changes. Graph reconciliation uses its own bounded,
VFS-only model/tool loop and never invokes a build or physical command.

## Architecture

- `tools/runCommandTool.ts` is the Pi adapter and streams activity to the UI.
- `../services/commandPermissions.ts` owns authorization and memory-only grants.
- `../services/commandExecution.ts` validates paths, spawns processes, captures
  output, applies timeouts, and stops all processes associated with a session.
- The frontend `commandPermissionService.ts` queues requests from every Sidecar
  WebSocket. `CommandPermissionPresenter.tsx` connects that service to the
  app-level `CommandPermissionDialog.tsx` view.

The split is deliberate: the Pi tool cannot execute until the authorization
service resolves, while the UI view has no process-running responsibility.

## Permission contract

Every command sends a `command_permission_request` before it is spawned. The UI
returns one of these decisions:

- `deny`: do not execute.
- `allow_once`: execute this request only.
- `allow_session`: for a normal-risk direct executable, remember the executable
  for this Pi session. Elevated/destructive commands and commands mediated by
  an interpreter or dispatcher remember only the exact normalized tuple.

Session grants live only in Sidecar memory. A normal-risk grant for a direct
executable such as `grep` covers different arguments and working directories in
the same workspace and Pi session. A change to an elevated or destructive
operation asks again. Shells, interpreters, package/build runners, and other
dispatchers always use exact-command grants because their outer executable does
not reveal what code they will run. Agent nodes and tabs do not share grants. A
timeout is not part of the exact grant signature because changing it cannot
change what process is executed.

## Execution boundaries

- Input is structured as `program`, `args`, `cwd`, and `timeoutMs`.
- Processes use `shell: false`; Axiom passes arguments literally rather than
  interpreting pipes, substitutions, redirects, or command chains. An
  explicitly approved interpreter may still interpret its own input.
- `cwd` is canonicalized and must resolve inside the current workspace. Symlink
  traversal outside the workspace is rejected.
- Commands are non-interactive (`stdin` is closed), inherit the Sidecar
  environment, and may therefore access credentials already available there.
- Output streams live to the originating chat console. Completion refreshes the
  physical workspace explorer and Git status. Captured output returned to Pi is
  bounded to the most recent 100,000 characters per stream.
- Timeout defaults to five minutes and is capped at thirty minutes.
- Stop cancels the Pi run and sends `SIGTERM` to its process group, followed by
  `SIGKILL` after a short grace period if necessary.
- Pi's unrestricted built-in `bash` tool is removed process-wide, including
  from isolated subagent sessions. A subagent that needs a command returns that
  need to its parent; the parent invokes `run_command` through this approval
  path. This prevents delegation from bypassing the dialog.

`run_command` always targets physical workspace state. Task and Global Chat
`write_file` operations still target their Axiom-tab VFS, so terminal commands
must never be described as VFS writes.

Task Nodes structurally filter `run_command` from skill-provided tool lists.
Graph reconciliation never gives `run_command` to the model; it can only read
and reconcile overlapping paths in the current canvas VFS. Completed collision
files are tracked in a persistent per-file ledger under a synthetic
reconciliation owner. Non-overlapping changes remain TaskNode-owned.
