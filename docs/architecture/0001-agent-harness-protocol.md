# ADR 0001: Versioned Agent Harness Boundary

- Status: Accepted
- Date: 2026-07-21

## Context

Agent surfaces previously opened independent WebSockets and exchanged unversioned flat objects. Reverse RPC used a process-global resolver map with send-before-register and response-ownership risks. Execution identity was normally a mutable tab or node ID.

## Decision

The frontend uses one `AgentHarnessClient` connection. A temporary WebSocket-shaped facade keeps existing component handlers compatible while transport ownership moves into the client. LSP sockets remain separate because they speak the language-server protocol rather than the agent protocol.

Modern traffic uses protocol version 2 and carries conversation, run, message, agent, sequence, and timestamp identity. Connections negotiate capabilities with `protocol.hello` and `protocol.welcome`. The sidecar accepts legacy flat messages only through the shared parser and logs their use.

Reverse RPC is registered before send, uses UUID request IDs, validates responses, enforces socket and run ownership, rejects on send/timeout/disconnect, and reports duplicate or late responses explicitly.

Managed-provider delegation uses a harness scheduler with stable handles, structured tasks and results, bounded concurrency, timeout, join, and cancellation. Native Pi behavior remains behind its provider runtime while its lifecycle events use the shared frontend projection; moving its internal operations behind the same manager is a follow-up adapter migration.

Significant Agent Chat lifecycle events are appended to `.axiom/runs/<safe-run-name>/events.jsonl`. Payloads are redacted and bounded, and replay marks non-terminal executions as interrupted after restart.

## Compatibility and rollback

- Legacy inbound messages remain accepted during migration.
- UI surfaces use `createAgentHarnessSocket()` as a compatibility facade; each can be converted from flat event handlers to typed subscriptions independently.
- Disabling the facade migration consists of restoring direct socket construction in an individual surface.
- Event persistence is additive. Disabling recorder construction leaves execution behavior unchanged.
- Managed delegation can fall back to direct provider execution by removing the manager wrapper without changing provider calls.

## Operational policy

- Reverse RPC and terminal controls are priority traffic.
- Token events may be coalesced under socket pressure.
- Low-priority streaming events are bounded by bytes and may be dropped with telemetry.
- Metrics are exposed from the local sidecar at `/metrics`.
- Persisted events omit prompts and file contents by default; sensitive keys are redacted and large strings are truncated.
