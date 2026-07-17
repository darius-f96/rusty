# Pi command capability

`run_command` lets a Pi agent run a non-interactive process in the physical
workspace. It is available to interactive Agent Tab and Global Chat executions
when their selected skill enables it. Task Nodes never receive command tools;
they only generate VFS code changes. Graph reconciliation also keeps the model
VFS-only, then invokes a sidecar-controlled build verifier after reconciliation.

## Architecture

- `tools/runCommandTool.ts` is the Pi adapter and streams activity to the UI.
- `../services/commandPermissions.ts` owns authorization and memory-only grants.
- `../services/commandExecution.ts` validates paths, spawns processes, captures
  output, applies timeouts, and stops all processes associated with a session.
- `../services/reconciliationBuildVerification.ts` temporarily overlays
  reconciled VFS files, invokes the approved detected build through the same
  process runner, and restores physical files in a `finally` block.
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
- `allow_session`: remember the exact normalized tuple of executable, argument
  list, and canonical working directory for this Pi session.

Session grants live only in Sidecar memory. Different arguments, directories,
agent nodes, or tabs require another decision. A timeout is not part of the
grant signature because changing it cannot change what process is executed.

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
Graph reconciliation never gives `run_command` to the model: its deterministic
Stage 2 verifier requests permission for a detected build command before any
temporary physical file overlay is created.
