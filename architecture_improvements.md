# Agent Communication Architecture Improvements

## Document Purpose

This document captures the current agent communication architecture, its strengths and weaknesses, and a detailed implementation plan for improving transport correctness, protocol safety, frontend integration, delegation, persistence, usability, observability, and harness policy.

It is intended to be the planning source for implementing each improvement as a separate workstream.

---

## 1. Executive Summary

The current architecture has a clear separation between frontend surfaces, the agent sidecar, provider runtimes, and workspace capabilities. It already supports streaming responses, reverse-RPC workspace operations, progress reporting, cancellation, and two forms of subagent delegation.

The largest architectural issue is inconsistency. Frontend clients independently manage raw WebSockets, reverse RPC is hand-written and weakly typed, run identity is tied primarily to mutable UI identifiers, and delegation semantics differ substantially by provider. Runtime state is held in memory, so interrupted work cannot be resumed.

The recommended target architecture introduces:

1. A versioned, typed message envelope.
2. Immutable conversation, run, message, and agent identities.
3. An atomic, socket-owned RPC manager.
4. One shared frontend `AgentHarnessClient`.
5. A provider-neutral delegation manager.
6. A durable append-only run event log.
7. Structured delegation contracts and an improved delegation UI.
8. Consistent telemetry, sequence tracking, and backpressure controls.
9. An adaptive delegation policy enforced by the harness.

The recommended priority is T1 through T4. T1 fixes immediate correctness issues; T2 and T3 establish a reliable communication foundation; T4 removes provider-dependent agent behavior. Persistence, delegation UX, and observability should follow after the protocol stabilizes.

---

## 2. Current Architecture

### 2.1 High-Level Flow

```text
Agent UI surfaces
  ├─ AgentTab
  ├─ Workspace/task execution
  ├─ Explorer/reconciliation
  ├─ Edge inspector
  └─ Inline chat
          │
          │ WebSocket messages
          ▼
agent-sidecar/src/server.ts
          │
          ├─ Routes agent chat, stop, and question responses
          ├─ Resolves reverse-RPC responses
          └─ Dispatches capability handlers
                    │
                    ▼
agent-sidecar/src/capabilities/agentChat.ts
          │
          ├─ Workspace tools
          ├─ Progress and questions
          ├─ Provider/runtime selection
          └─ Delegation
               ├─ Native Pi subagents
               └─ Managed-provider delegate_task
```

### 2.2 Frontend-to-Sidecar Transport

Major UI surfaces establish their own WebSocket connections to the local sidecar, commonly at `ws://localhost:4000`.

Relevant clients include:

- `src/components/tabs/AgentTab.tsx`
- `src/components/Workspace.tsx`
- `src/components/sidepane/useExplorerWebSocket.ts`
- `src/components/edgeinspector/useEdgeWebSocket.ts`
- `src/components/sidepane/ReconciliationGraphPane.tsx`
- `src/services/inlineChatService.ts`

Representative client-to-sidecar messages include:

- `agent_chat`
- `agent_chat_stop`
- `agent_question_response`
- `read_file_response`
- `write_file_response`
- `write_plan_response`
- Command permission and command-session messages

Representative sidecar-to-client messages include:

- `token`
- `log`
- `subagent_update`
- `agent_question`
- `read_file`
- `write_file`
- `write_plan`
- `agent_chat_complete`
- Command output and completion events

Routing primarily uses `tabId` or `nodeId`. The active identifier may also be attached directly to a socket as `__activeAgentTabId`.

#### Consequences

- Each surface duplicates connection and dispatch behavior.
- Reconnection, error normalization, and cancellation may differ by surface.
- A UI identifier serves as both presentation state and execution identity.
- Late events are difficult to distinguish from events belonging to a newer run in the same tab.

### 2.3 Reverse RPC

Some workspace operations are initiated by the sidecar but executed by the frontend. The sidecar sends a request, stores a pending resolver, and waits for a correlated response.

`agent-sidecar/src/services/websocket.ts` manages this using:

- A process-global pending-request map
- Incrementing request IDs such as `req_1`
- A default timeout of approximately 30 seconds
- Socket-specific cleanup when a connection closes

This is a functional request/response mechanism, but it is a hand-written RPC layer without a shared typed contract or runtime message validation.

#### Correctness risks

1. A request can be sent before its resolver is registered.
2. A sufficiently fast response can arrive before the pending entry exists.
3. Response lookup is global and may not strongly enforce socket ownership.
4. A send failure may only be logged, causing the caller to wait until timeout.
5. Duplicate or late responses do not have explicit, uniform handling.
6. Sequential request IDs are weak for diagnostics and collision avoidance across restarts.

### 2.4 Agent Execution

`agent-sidecar/src/capabilities/agentChat.ts` assembles:

- Provider and runtime configuration
- Conversation history
- Workspace tools
- Progress reporting
- User questions
- Delegation policy
- Completion and cancellation behavior

Execution attempts to use `runPiAgentChat()` and then follows either the native Pi path or a managed-provider compatibility path.

### 2.5 Native Pi Delegation

Implemented in `agent-sidecar/src/services/piAgentChat.ts`.

The native path exposes operations such as:

- `Agent`
- `get_subagent_result`
- `steer_subagent`

It supports:

- Background subagents
- Persistent subagent handles during a run
- Result retrieval
- Steering
- Cancellation
- Turn limits
- Transcript monitoring
- Aggregation status
- Detailed `SubagentUpdate` events

Active runs are stored in the process-local `activePiRuns` map keyed by `tabId`.

### 2.6 Managed-Provider Delegation

Codex, Claude Code, and GitHub Copilot use a compatibility path in `agentChat.ts`, exposing a synchronous `delegate_task` tool.

Each call:

- Starts an independent LLM execution
- Receives read-only workspace tools
- Runs for a bounded number of rounds
- Returns findings synchronously to the parent tool call

This path does not offer the same persistent lifecycle as native Pi. It lacks stable agent handles, later steering, background join semantics, and consistent explicit cancellation.

### 2.7 Agent-to-Agent Communication

There is no direct peer-to-peer agent message bus.

```text
Parent model
  → delegation tool
  → isolated subagent runtime
  → tool result
  → parent model synthesis
```

Subagents do not directly communicate with one another. The frontend receives lifecycle projections through `subagent_update`, but it is not part of the result exchange.

This parent-mediated design is valuable for control and synthesis, but its lifecycle should be standardized and represented explicitly.

### 2.8 State and Persistence

Conversation messages are stored in Zustand under `agentChats`, with relevant code in:

- `src/store/slices/createAgentSlice.ts`

Chat histories are persisted under:

- `.axiom/chats/`

Persisted records generally contain user, console, and assistant messages. They do not fully persist:

- Active run state
- Subagent records
- Delegation results
- Pending RPCs
- Routing metadata
- Correlation metadata
- Event sequence numbers
- Provider lifecycle state

Subagent activity is maintained in local React state. The UI may omit raw subagent `result` and `error` fields, leaving the parent responsible for presenting a synthesized conclusion.

A sidecar or application restart therefore cannot resume an interrupted run.

---

## 3. Existing Strengths

The current design has several good foundations:

- Clear separation between UI, capability handlers, and provider runtimes.
- Read-only delegated investigations reduce concurrent-write conflicts.
- Pending reverse-RPC requests are cleaned up on socket disconnect.
- Native Pi subagents support bounded turns and cancellation.
- Progress and subagent activity are visible in the UI.
- The parent agent is explicitly responsible for synthesis.
- Harness policy prefers structured file tools over shell operations.
- Tool access can be restricted structurally for planning or VFS-only modes.
- The local sidecar provides a natural gateway where protocol, telemetry, and lifecycle controls can be centralized.

These strengths should be retained while the transport and lifecycle contracts are standardized.

---

## 4. Main Weaknesses

### 4.1 Incompatible Delegation Models

Native Pi offers background execution, persistent identities, result retrieval, steering, and cancellation. Managed providers offer a synchronous one-shot tool.

Effects:

- User experience depends on provider selection.
- Parent prompts require provider-specific expectations.
- UI controls cannot rely on a common lifecycle.
- Cancellation and status semantics are inconsistent.
- Tests must cover parallel behavior models.

### 4.2 No Durable Run Identity

Events are primarily associated with mutable `tabId` or `nodeId` values rather than an immutable `runId`.

Effects:

- Late events can be accepted by a newer run in the same tab.
- Logs and metrics are hard to correlate.
- Recovery cannot identify the exact interrupted execution.
- Cancellation may target presentation state rather than execution state.

### 4.3 Untyped and Unversioned Protocol

Core interfaces use broad types and distributed string literals, such as:

- `agentChat(ws, data: any)`
- `safeSend(payload: any)`
- Pending resolvers accepting `any`

There is no protocol version, handshake, runtime schema validation, or capability negotiation.

Effects:

- Client and server can silently drift.
- Invalid payloads fail deep in handlers.
- Refactoring has weak compiler protection.
- Backward compatibility is implicit rather than designed.

### 4.4 Request Registration Race

For at least the user-question flow, a request can be sent before the pending resolver is registered.

If a response arrives immediately, the server may not find the pending request and may discard it. The caller then waits until timeout.

### 4.5 Weak Response Ownership

Although a pending request can store its originating socket, global request resolution does not clearly guarantee that the response came from that same socket.

This creates a correctness and isolation risk when multiple clients are connected.

### 4.6 Failed Sends Become Misleading Timeouts

A safe-send helper may log a closed socket or send error without rejecting the pending request. The caller experiences a timeout rather than the actual transport failure.

This increases latency and makes diagnosis harder.

### 4.7 Duplicated Frontend WebSocket Logic

Multiple React components and services independently implement:

- Connection setup
- Message parsing
- Routing
- File RPC responses
- Stop behavior
- Reconnect behavior
- Error handling

This creates behavioral drift and makes protocol migration expensive.

### 4.8 No Resumability

Active agents, pending requests, and lifecycle state are held in memory. Restarting either application component loses the execution state.

### 4.9 Limited Observability

The architecture lacks a consistent model for:

- Trace and run IDs
- Request latency
- Queue wait time
- Provider latency
- Tool duration
- Token and turn accounting
- Payload size
- Retry count
- Reconnect count
- Sequence-gap detection
- Cancellation latency
- Timeline export

### 4.10 Prompt-Driven Concurrency

The policy asks models to issue multiple tool calls concurrently, but actual concurrency depends on provider behavior. The harness does not fully own scheduling, fairness, or collection.

---

## 5. Target Architecture

```text
UI components
      │
      ▼
Typed AgentHarnessClient
      │
      │ versioned envelopes
      ▼
Harness Gateway
      │
      ├─ Connection/session registry
      ├─ Run registry
      ├─ Socket-owned RPC manager
      ├─ Event log
      ├─ Delegation scheduler
      ├─ Telemetry and backpressure
      └─ Provider adapters
           ├─ Pi adapter
           ├─ Codex adapter
           ├─ Claude adapter
           └─ Copilot adapter
```

### 5.1 Common Message Envelope

Every message should carry stable identity and ordering metadata.

```typescript
interface AgentEnvelope<T> {
  protocolVersion: number
  conversationId: string
  runId: string
  messageId: string
  correlationId?: string
  agentId: string
  parentAgentId?: string
  sequence: number
  timestamp: string
  type: AgentEventType
  payload: T
}
```

#### Field responsibilities

- `protocolVersion`: controls compatibility.
- `conversationId`: groups related runs and history.
- `runId`: identifies one immutable execution.
- `messageId`: uniquely identifies the envelope.
- `correlationId`: links a response or completion to its request.
- `agentId`: identifies the producing or target agent.
- `parentAgentId`: represents delegation hierarchy.
- `sequence`: detects missing, duplicate, or reordered events.
- `timestamp`: supports diagnostics and timeline rendering.
- `type`: selects the validated payload schema.
- `payload`: contains type-specific data.

### 5.2 Common Delegation Lifecycle

All providers should expose one harness-level contract:

```typescript
interface DelegationManager {
  spawn(task: DelegatedTask): Promise<AgentHandle>
  send(agentId: string, message: string): Promise<void>
  steer(agentId: string, instruction: string): Promise<void>
  join(agentId: string): Promise<DelegationResult>
  cancel(agentId: string, reason?: string): Promise<void>
  list(runId: string): Promise<AgentHandle[]>
}
```

Provider adapters may emulate unsupported provider features, but the parent and UI should see one consistent lifecycle.

### 5.3 Structured Delegated Tasks

```typescript
interface DelegatedTask {
  objective: string
  scope: string[]
  excludedScope?: string[]
  expectedOutput: "findings" | "review" | "recommendation"
  evidenceRequired: boolean
  maxTurns: number
  timeoutMs: number
}
```

This contract makes scope, budget, evidence requirements, and output expectations machine-readable.

---

## 6. T1 — Fix Immediate Transport Correctness

**Priority:** Critical  
**Risk:** Low  
**Estimated effort:** 2–3 weeks  
**Dependencies:** None  
**Influences:** T2 and T3

### Objective

Eliminate known reverse-RPC races and misleading timeout behavior without requiring a broad architectural migration.

### Primary files

- `agent-sidecar/src/services/websocket.ts`
- `agent-sidecar/src/server.ts`
- `agent-sidecar/src/capabilities/agentChat.ts`

### Required changes

1. Introduce one atomic `request()` operation.
2. Register the pending request before sending.
3. If sending fails, remove and reject the pending request immediately.
4. Generate UUID-style request identifiers.
5. Store the exact originating socket or connection identity.
6. Require a matching socket when resolving a response.
7. Handle duplicate and late responses explicitly.
8. Use structured error codes for timeout, disconnect, wrong owner, duplicate response, invalid payload, and send failure.
9. Ensure disconnect cleanup rejects all requests owned by that socket.
10. Add request lifecycle logging with request ID, type, run ID, and elapsed time.

### Suggested API

```typescript
interface RpcRequestOptions<TResponse> {
  type: string
  payload: unknown
  runId: string
  timeoutMs?: number
  validateResponse: (value: unknown) => TResponse
}

function request<TResponse>(
  socket: WebSocket,
  options: RpcRequestOptions<TResponse>
): Promise<TResponse>
```

### Correct ordering

```typescript
const requestId = crypto.randomUUID()

return new Promise<TResponse>((resolve, reject) => {
  pendingRequests.set(requestId, {
    socket,
    runId,
    resolve,
    reject,
    createdAt: Date.now(),
  })

  try {
    socket.send(JSON.stringify({
      type,
      requestId,
      runId,
      payload,
    }))
  } catch (error) {
    pendingRequests.delete(requestId)
    reject(new RpcSendError(requestId, error))
  }
})
```

### Response resolution rules

A response is accepted only if:

- The request ID exists.
- The response came from the registered socket or connection.
- The request has not already settled.
- The response payload passes validation.
- The response belongs to the expected run.

### Tests

Add focused tests for:

- Resolver registration occurs before send.
- Immediate synchronous response is accepted.
- Send failure rejects immediately.
- Socket close rejects owned requests.
- Response from another socket is rejected.
- Duplicate response is ignored or reported without double settlement.
- Late response receives a defined diagnostic.
- Timeout removes the pending entry.
- Invalid response payload rejects with a validation error.
- Concurrent requests cannot collide.

### Completion criteria

- No request can respond before registration.
- Failed sends do not become 30-second timeouts.
- Wrong-socket responses cannot settle requests.
- All terminal paths clean up pending state.
- Tests cover race, ownership, disconnect, timeout, and duplicate behavior.

---

## 7. T2 — Introduce a Shared Typed Protocol

**Priority:** High  
**Risk:** Low if migrated compatibly  
**Estimated effort:** 2–3 weeks  
**Depends on:** T1  
**Influences:** T3, T4, T5, T7

### Objective

Replace distributed untyped message literals with a shared, versioned protocol consumed by the frontend and sidecar.

### Proposed module

Create a shared protocol package or source directory containing:

- Envelope types
- Request/response unions
- Event unions
- Runtime schemas
- Error types
- Capability definitions
- Version constants
- Compatibility helpers

### Requirements

- Use discriminated unions.
- Validate incoming messages at runtime.
- Add `protocolVersion`, `runId`, `messageId`, and `sequence`.
- Define explicit terminal states.
- Standardize errors.
- Add a connection handshake.
- Negotiate supported protocol versions and capabilities.
- Temporarily accept legacy messages through a compatibility adapter.
- Emit deprecation diagnostics for legacy traffic.

### Example event union

```typescript
type AgentEvent =
  | AgentEnvelope<RunStartedPayload>
  | AgentEnvelope<TokenPayload>
  | AgentEnvelope<AgentSpawnedPayload>
  | AgentEnvelope<ToolStartedPayload>
  | AgentEnvelope<ToolCompletedPayload>
  | AgentEnvelope<RunCompletedPayload>
  | AgentEnvelope<RunFailedPayload>
```

### Suggested terminal states

- `completed`
- `failed`
- `cancelled`
- `timed_out`
- `disconnected`

### Handshake

The client should initially send:

```typescript
{
  type: "protocol.hello",
  supportedVersions: [2, 1],
  capabilities: ["rpc", "run-sequences", "delegation-controls"]
}
```

The sidecar should reply with the selected version and supported capabilities. Unsupported combinations should fail clearly rather than partially working.

### Migration approach

1. Define schemas without changing behavior.
2. Wrap outgoing modern messages in envelopes.
3. Parse both modern and legacy messages.
4. Migrate one message family at a time.
5. Add diagnostics for legacy paths.
6. Remove legacy support only after all frontend clients migrate.

### Tests

- Every message type accepts valid payloads.
- Invalid payloads fail at the boundary.
- Unknown message types are handled safely.
- Version negotiation selects the highest common version.
- Unsupported versions return a structured error.
- Legacy messages are wrapped correctly.
- Sequence and identity fields are required for modern messages.
- Protocol types compile for both frontend and sidecar.

### Completion criteria

- All modern messages use shared types and runtime validation.
- Protocol version is negotiated at connection time.
- Run and message identity exist on every modern envelope.
- Legacy use is measurable and isolated in one adapter.

---

## 8. T3 — Centralize the Frontend Client

**Priority:** High  
**Risk:** Medium  
**Estimated effort:** 2–3 weeks  
**Depends on:** T2  
**Influences:** T5, T6, T7

### Objective

Replace raw WebSocket logic in individual UI surfaces with one typed `AgentHarnessClient`.

### Responsibilities

The client should own:

- Endpoint discovery
- Handshake and capability negotiation
- Connection lifecycle
- Reconnect with bounded exponential backoff
- Typed send and subscriptions
- RPC correlation
- Run cancellation
- Stale-run event rejection
- Sequence-gap detection
- Error normalization
- Connection health state
- Optional event replay after reconnect

### Proposed interface

```typescript
interface AgentHarnessClient {
  connect(): Promise<void>
  disconnect(): void
  startRun(input: StartRunInput): Promise<RunHandle>
  cancelRun(runId: string): Promise<void>
  respondToQuestion(input: QuestionResponse): Promise<void>
  subscribe(runId: string, listener: RunEventListener): Unsubscribe
  getConnectionState(): ConnectionState
}
```

### Migration targets

- `AgentTab.tsx`
- `Workspace.tsx`
- `useExplorerWebSocket.ts`
- `useEdgeWebSocket.ts`
- `ReconciliationGraphPane.tsx`
- `inlineChatService.ts`

### React integration

Components should subscribe to normalized run state or typed events. They should not:

- Construct protocol JSON.
- Parse arbitrary raw messages.
- Own retry timers.
- Infer stale events from tab state.
- Independently implement cancellation.

### Migration sequence

1. Implement the client and tests.
2. Migrate the lowest-risk surface.
3. Migrate inline chat and explorer hooks.
4. Migrate workspace execution.
5. Migrate AgentTab last, or earlier behind a feature flag.
6. Remove duplicated WebSocket helpers.

### Tests

- Connection and handshake success.
- Reconnection with backoff.
- Subscription isolation by run ID.
- Stale event rejection.
- Sequence-gap detection.
- Cross-surface cancellation consistency.
- RPC correlation.
- Error normalization.
- Cleanup when React components unmount.

### Completion criteria

- All major UI surfaces use one client.
- Raw WebSocket parsing is removed from components.
- Cancellation and reconnection work uniformly.
- Events from old runs cannot update current runs.

---

## 9. T4 — Unify Delegation Semantics

**Priority:** High  
**Risk:** Medium  
**Estimated effort:** 3–4 weeks  
**Depends on:** T2  
**Influences:** T5, T6, T7

### Objective

Expose one provider-neutral delegation lifecycle and move scheduling responsibility from model prompts into the harness.

### Required operations

- `spawn`
- `send`
- `steer`
- `join`
- `cancel`
- `list`

### Harness responsibilities

- Assign stable agent IDs.
- Track parent-child relationships.
- Enforce per-run concurrency limits.
- Queue excess work fairly.
- Apply per-agent timeout, turn, and token budgets.
- Emit consistent lifecycle events.
- Normalize provider errors and results.
- Cancel children when their run is cancelled.
- Record whether the parent consumed each result.

### Provider adapters

#### Pi adapter

Map native background agents, retrieval, steering, and cancellation to the common interface.

#### Managed-provider adapter

Initially emulate background execution with harness-managed promises and stable handles:

- Start provider execution asynchronously.
- Store status in a run registry.
- Buffer the result.
- Implement `join` by awaiting the buffered promise.
- Implement `cancel` using provider cancellation where available or cooperative abort signals.
- Return a structured unsupported-operation error only when a feature truly cannot be emulated.

### Structured result

```typescript
interface DelegationResult {
  agentId: string
  status: "completed" | "failed" | "cancelled" | "timed_out"
  findings: string
  evidence: Array<{
    path: string
    line?: number
    summary: string
  }>
  metadata: {
    turnsUsed: number
    tokensUsed?: number
    toolsCalled: string[]
    startedAt: string
    completedAt: string
  }
}
```

### Concurrency rules

- Define a per-run maximum.
- Queue tasks in the harness.
- Allow cancellation while queued.
- Emit `delegation.queued`, `delegation.started`, and terminal events.
- Avoid depending on whether a model/provider emits simultaneous tool calls.

### Tests

- Same lifecycle behavior across adapters.
- Stable agent identity.
- Join before and after completion.
- Cancellation while queued and while running.
- Steering behavior or defined unsupported result.
- Timeout and budget enforcement.
- Concurrency limit.
- Parent cancellation cascades.
- Results retain structured evidence.

### Completion criteria

- Parent code uses one delegation interface.
- Provider conditionals are removed from high-level orchestration.
- UI controls rely on common lifecycle states.
- Harness, not prompts, controls concurrency and collection.

---

## 10. T5 — Add Durable Event Persistence

**Priority:** Medium  
**Risk:** Medium  
**Estimated effort:** 2–3 weeks  
**Depends on:** T3 and T4  
**Influences:** T6 and T7

### Objective

Persist an append-only event stream that supports auditing, recovery, and timeline reconstruction.

### Core events

```text
conversation.created
conversation.metadata_updated
run.started
run.completed
run.failed
run.cancelled
agent.spawned
agent.status_changed
agent.question_asked
agent.question_answered
tool.started
tool.completed
tool.failed
delegation.queued
delegation.started
delegation.completed
delegation.failed
```

Token streaming may be persisted as chunks, snapshots, or final assembled messages depending on storage requirements.

### Suggested event type

```typescript
interface AgentEvent<T = unknown> {
  protocolVersion: number
  conversationId: string
  runId: string
  messageId: string
  correlationId?: string
  agentId: string
  parentAgentId?: string
  timestamp: string
  sequence: number
  type: AgentEventType
  payload: T
}
```

### Persistence contract

```typescript
interface EventPersistence {
  append(runId: string, event: AgentEvent): Promise<void>
  query(
    runId: string,
    options?: {
      agentId?: string
      type?: AgentEventType
      afterSequence?: number
    }
  ): Promise<AgentEvent[]>
  deleteRun(runId: string): Promise<void>
}
```

### Initial storage option

A file-backed JSONL store under `.axiom/runs/<runId>/events.jsonl` is a reasonable first implementation.

Requirements:

- Append-only writes.
- Atomic or recoverable line appends.
- Strict event validation before persistence.
- Monotonic sequence assignment per run.
- Safe handling of a truncated final line.
- Configurable retention.
- Redaction or omission of sensitive and large payloads.

### Recovery behavior

On reconnect or application restart:

1. Load events for the run.
2. Replay them through a deterministic reducer.
3. Reconstruct messages, status, questions, tools, and delegations.
4. Mark executions that cannot actually resume as interrupted.
5. Resume only when a provider adapter supports it.
6. Request events after the last known sequence where possible.

### Data policy

Persist safe metadata and summaries by default. Avoid indiscriminately storing:

- Full file contents
- Secrets
- Large tool outputs
- Unredacted prompts with sensitive data
- Raw provider diagnostics containing credentials

### Tests

- Append and query.
- Filter by agent, type, and sequence.
- Monotonic sequence assignment.
- Run summary derivation.
- State replay.
- Truncated JSONL recovery.
- Retention deletion.
- Redaction.
- Process restart reconstruction.

### Completion criteria

- Significant lifecycle actions are persisted.
- UI state can be reconstructed deterministically.
- Interrupted runs are represented honestly.
- Retention and sensitive-data policies are configurable.

---

## 11. T6 — Improve Delegation Usability

**Priority:** Medium  
**Risk:** Low  
**Estimated effort:** 2 weeks  
**Depends on:** T4 and T5

### Objective

Make delegated work understandable, inspectable, and controllable without presenting competing final answers.

### Structured input

Delegations should explicitly state:

- Objective
- Scope
- Excluded scope
- Expected output
- Evidence requirement
- Turn budget
- Timeout

### UI requirements

The delegation panel should show:

- Why the work was delegated
- Exact scope
- Parent agent
- Current state
- Queue position where applicable
- Elapsed time
- Turn and token budget consumption
- Tools used
- Structured findings and evidence
- Whether the parent incorporated the result
- Cancel and steer controls
- Clear failure or timeout explanations

Results should remain collapsed by default so the parent remains the primary narrator.

### Accessibility and testability

- Every button, filter, and input should have a unique descriptive ID.
- Status should not rely on color alone.
- Interactive cards should use buttons rather than click-only containers.
- Controls should have accessible labels.
- Keyboard navigation and focus states should be supported.

### Suggested statuses

- Queued
- Running
- Awaiting parent
- Incorporated
- Completed but not incorporated
- Failed
- Cancelled
- Timed out

### Tests

- Structured task validation.
- Status rendering.
- Expand and collapse.
- Filtering.
- Cancel and steer actions.
- Accessibility checks.
- Parent incorporation indicator.
- Evidence links navigate to the correct file location.

### Completion criteria

- Users understand why each subagent exists and what it can inspect.
- Findings are discoverable but do not compete with the parent response.
- Cancellation and steering use the unified delegation manager.

---

## 12. T7 — Add Observability and Resilience

**Priority:** Medium to low  
**Risk:** Low if additive  
**Estimated effort:** 2–3 weeks  
**Depends on:** T2, T3, and T4

### Objective

Make failures diagnosable and streaming robust under load.

### Required telemetry dimensions

Key all telemetry by available identity fields:

- `conversationId`
- `runId`
- `agentId`
- `requestId`
- `messageId`
- Provider
- Tool

### Metrics

- RPC latency and timeout count
- Provider request latency
- Tool duration and failure rate
- Queue wait time
- Token and turn usage
- Payload and response sizes
- Retry count
- Reconnect count
- Sequence gaps
- Cancellation latency
- Delegation concurrency
- Active and pending request counts
- Dropped, coalesced, or delayed stream events

### Backpressure

Token and log streams require bounded behavior.

Recommended strategy:

1. Observe WebSocket buffered amount.
2. Pause or coalesce low-priority streaming events above a threshold.
3. Preserve terminal, question, error, and control events.
4. Batch token chunks where safe.
5. Bound memory by bytes as well as item count.
6. Emit metrics whenever data is delayed, coalesced, or dropped.
7. Resume in order when pressure falls.

Do not assume a Node WebSocket exposes a stream-style `drain` event; implement against the actual library API.

### Timeline export

Provide a safe diagnostic timeline containing:

- Run metadata
- Agent lifecycle
- RPC durations
- Tool durations
- Provider durations
- Sequence gaps
- Errors and cancellation
- Redacted payload summaries

### Tests

- Request duration tracking.
- Error and retry accounting.
- Aggregation per run and agent.
- Bounded queue behavior.
- FIFO ordering for non-coalesced events.
- Priority preservation.
- Token batching.
- Memory limit enforcement.
- Sequence-gap reporting.

### Completion criteria

- A failed run can be diagnosed by run ID.
- Metrics distinguish provider, tool, transport, and user-cancellation delays.
- Slow clients cannot cause unbounded sidecar memory growth.

---

## 13. Harness-Usage Policy Improvements

### Current problem

A blanket requirement to delegate most non-trivial tasks creates avoidable latency, token overhead, and UI complexity. Delegation should be used when it adds measurable value rather than simply because a task spans multiple files.

### Recommended adaptive policy

Delegate when at least one condition applies:

1. The investigation is independently scoped.
2. Parallel execution materially reduces latency.
3. An independent review improves confidence.
4. A specialist runtime or tool set is required.
5. The parent can continue useful work while the task runs.

Skip delegation when:

1. The task is small or obvious.
2. Work is tightly coupled to the parent's immediate next action.
3. The subagent would repeat the parent's context gathering.
4. Delegation overhead exceeds the expected work.
5. The task requires writes and the parent-only-write policy applies.
6. The available subagent has no useful capability difference.

### Enforcement recommendations

The harness should:

- Require a short benefit classification: coverage, parallelism, independent review, or specialization.
- Enforce token, turn, and time budgets.
- Require structured evidence for investigative tasks.
- Keep delegated tools read-only unless an explicit safe write model is introduced.
- Record whether each result was joined and incorporated.
- Warn when a run completes with unused results.
- Own scheduling rather than asking the model to create concurrency.
- Limit agent fan-out and nesting depth.

### Parent responsibilities

The parent agent should:

1. State what is delegated and why.
2. Provide precise scope.
3. Specify the expected result schema.
4. Integrate findings rather than paste them.
5. Resolve conflicts among findings.
6. Remain the only source of the final answer.

---

## 14. Dependencies

- **T1**
  - Depends on: none
  - Influences: T2, T3

- **T2**
  - Depends on: T1
  - Influences: T3, T4, T5, T7

- **T3**
  - Depends on: T2
  - Influences: T5, T6, T7

- **T4**
  - Depends on: T2
  - Influences: T5, T6, T7

- **T5**
  - Depends on: T3, T4
  - Influences: T6, T7

- **T6**
  - Depends on: T4, T5

- **T7**
  - Depends on: T2, T3, T4

### Critical path

```text
T1 → T2 → T4 → T5 → T6
          └→ T3 ─┘
          └────────→ T7
```

---

## 15. Suggested Delivery Sequence

### Phase 1: Correctness foundation

Implement T1.

Deliverables:

- Atomic RPC request API
- Immediate send-failure rejection
- Socket ownership checks
- Race and timeout tests

### Phase 2: Protocol and frontend foundation

Implement T2, followed by T3. Some preparatory work can overlap, but frontend migration should target the stable shared protocol.

Deliverables:

- Shared schemas
- Handshake
- Modern message envelope
- Legacy adapter
- Central frontend client
- Migrated UI surfaces

### Phase 3: Delegation foundation

Implement T4.

Deliverables:

- Delegation manager
- Provider adapters
- Run registry
- Harness scheduler
- Stable agent handles
- Unified cancellation and join

### Phase 4: Recovery and usability

Implement T5 and T6.

Deliverables:

- Event store
- Replay reducer
- Recovery API
- Delegation panel
- Evidence and incorporation views

### Phase 5: Operational maturity

Implement T7.

Deliverables:

- Structured metrics
- Timeline export
- Backpressure controls
- Sequence and reconnect diagnostics

---

## 16. Initial Estimates

| Task | Duration | Approximate effort | Risk |
|---|---:|---:|---|
| T1 — Transport correctness | 2–3 weeks | 80 hours | Low |
| T2 — Typed protocol | 2–3 weeks | 80 hours | Low |
| T3 — Frontend client | 2–3 weeks | 100 hours | Medium |
| T4 — Delegation unification | 3–4 weeks | 120 hours | Medium |
| T5 — Event persistence | 2–3 weeks | 80 hours | Medium |
| T6 — Delegation UX | 2 weeks | 60 hours | Low |
| T7 — Observability | 2–3 weeks | 80 hours | Low |
| **Total** | **15–19 weeks** | **~600 hours** | |

These estimates should be recalibrated after code-level design and test inventory for each task.

---

## 17. Risk Assessment and Rollback

### T1

**Risk:** Localized behavioral change in RPC ordering.  
**Mitigation:** Focused unit tests and compatibility wrapper.  
**Rollback:** Restore old helper while retaining new tests.

### T2

**Risk:** Client/server version mismatch.  
**Mitigation:** Legacy adapter and capability handshake.  
**Rollback:** Continue accepting legacy messages.

### T3

**Risk:** Regression across several UI surfaces.  
**Mitigation:** Migrate incrementally behind a feature flag.  
**Rollback:** Revert individual surfaces to their prior transport.

### T4

**Risk:** Provider lifecycle differences cannot be perfectly emulated.  
**Mitigation:** Normalize the common subset and return explicit capability errors.  
**Rollback:** Feature-flag unified delegation per provider.

### T5

**Risk:** Storage growth, corruption, or sensitive-data retention.  
**Mitigation:** JSONL recovery, redaction, limits, retention policy, and feature flag.  
**Rollback:** Disable persistence while retaining in-memory event emission.

### T6

**Risk:** UI complexity.  
**Mitigation:** Collapsed-by-default panel and progressive disclosure.  
**Rollback:** Hide the panel without changing core execution.

### T7

**Risk:** Telemetry overhead or backpressure bugs.  
**Mitigation:** Sampling, byte limits, and load tests.  
**Rollback:** Disable metrics export or stream coalescing independently.

---

## 18. Success Criteria

### T1 complete

- No send-before-register race.
- Send failures reject immediately.
- Response ownership is enforced.
- Duplicate, late, timeout, and disconnect paths are tested.

### T2 complete

- Modern messages are validated.
- Protocol version is negotiated.
- Stable IDs and sequences appear on every modern event.
- Legacy traffic is isolated and measurable.

### T3 complete

- One client serves all UI surfaces.
- Components no longer parse raw messages.
- Reconnect, cancellation, and stale-run rejection are uniform.

### T4 complete

- All providers use the same delegation interface.
- Harness controls concurrency.
- Stable agent handles support status, join, and cancellation.
- Results use a structured schema.

### T5 complete

- Significant lifecycle events are persisted.
- Run state can be replayed after restart.
- Retention and redaction policies exist.

### T6 complete

- Delegation purpose, scope, status, budget, and findings are inspectable.
- Users can cancel and steer where supported.
- The UI indicates whether findings were incorporated.

### T7 complete

- Runs are traceable by run ID.
- RPC, provider, tool, and queue latency are distinguishable.
- Stream buffering is bounded.
- Sequence gaps and reconnects are visible.

---

## 19. Planning Checklist for Each Workstream

Before implementing any task:

1. Confirm exact current files and owners.
2. Inventory existing tests.
3. Write an architecture decision record for public contracts.
4. Define compatibility and feature-flag strategy.
5. Define measurable acceptance criteria.
6. Identify migration order.
7. Define rollback steps.
8. Confirm privacy and retention implications.
9. Add the smallest useful telemetry before rollout.
10. Run a post-migration cleanup to remove obsolete code.

---

## 20. Recommended Immediate Next Step

Begin with a dedicated T1 design and implementation plan. It should include:

- The current pending-request data structure.
- Every request creator and response resolver.
- Socket-disconnect behavior.
- Concrete error classes and codes.
- Atomic request API design.
- A complete focused test matrix.
- A migration that does not yet depend on the larger typed-protocol work.

Once T1 is merged, establish the T2 envelope and schema package before performing broad frontend or delegation refactors.
