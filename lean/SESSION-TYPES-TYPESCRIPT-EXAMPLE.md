# Session types in TypeScript — worked example

This document walks through every primary feature of the protocol-boundary and projection layers described in [`README-SESSION-TYPES.md`](./README-SESSION-TYPES.md) using a single scenario: a two-party file-transfer protocol between an **uploader** and a **storage** service.

The TypeScript API shown here is hypothetical. It illustrates the semantic model; the concrete surface may differ when the implementation ships.

---

## User story

> As a developer building a two-party file-transfer workflow, I need the protocol layer to (1) project a global protocol into per-role endpoint automata, (2) wrap each role's local EFSM in a boundary that enforces send/receive legality at runtime, and (3) support speculative draft execution with protocol-aware commit — so that my local state machine cannot emit messages the protocol forbids, and inbound messages that violate the current endpoint state are caught immediately.

---

## 1 — Define the local EFSM

Each role starts with a plain `@escapace/fsm` machine. This is the flat EFSM layer from [`README.md`](./README.md) — states, actions, guards, reducers, context.

```typescript
import { stateMachine } from '@escapace/fsm'

// ── States ──────────────────────────────────────────────────────────

enum UploaderState {
  Idle = 'Idle',
  Requesting = 'Requesting',
  Uploading = 'Uploading',
  Done = 'Done',
  Failed = 'Failed',
}

// ── Actions ─────────────────────────────────────────────────────────

enum UploaderAction {
  RequestSlot = 'RequestSlot',
  SlotGranted = 'SlotGranted',
  SlotDenied = 'SlotDenied',
  SendChunk = 'SendChunk',
  Ack = 'Ack',
  Complete = 'Complete',
}

// ── Payloads ────────────────────────────────────────────────────────

interface RequestSlotPayload {
  fileName: string
  sizeBytes: number
}

interface SlotGrantedPayload {
  slotId: string
  maxChunkBytes: number
}

interface SlotDeniedPayload {
  reason: string
}

interface SendChunkPayload {
  slotId: string
  offset: number
  data: Uint8Array
}

interface AckPayload {
  nextOffset: number
}

// ── Context ─────────────────────────────────────────────────────────

interface UploaderContext {
  fileName: string | null
  slotId: string | null
  offset: number
  totalSize: number
}

// ── Machine ─────────────────────────────────────────────────────────

const uploaderMachine = stateMachine()
  .state(UploaderState.Idle)
  .state(UploaderState.Requesting)
  .state(UploaderState.Uploading)
  .state(UploaderState.Done)
  .state(UploaderState.Failed)
  .initial(UploaderState.Idle)

  .action<UploaderAction.RequestSlot, RequestSlotPayload>(UploaderAction.RequestSlot)
  .action<UploaderAction.SlotGranted, SlotGrantedPayload>(UploaderAction.SlotGranted)
  .action<UploaderAction.SlotDenied, SlotDeniedPayload>(UploaderAction.SlotDenied)
  .action<UploaderAction.SendChunk, SendChunkPayload>(UploaderAction.SendChunk)
  .action<UploaderAction.Ack, AckPayload>(UploaderAction.Ack)
  .action(UploaderAction.Complete)

  .context<UploaderContext>(() => ({
    fileName: null,
    slotId: null,
    offset: 0,
    totalSize: 0,
  }))

  // Idle → Requesting: uploader asks for an upload slot
  .transition(
    UploaderState.Idle,
    UploaderAction.RequestSlot,
    UploaderState.Requesting,
    (ctx, action) => ({
      ...ctx,
      fileName: action.payload.fileName,
      totalSize: action.payload.sizeBytes,
    }),
  )

  // Requesting → Uploading: storage grants a slot
  .transition(
    UploaderState.Requesting,
    UploaderAction.SlotGranted,
    UploaderState.Uploading,
    (ctx, action) => ({
      ...ctx,
      slotId: action.payload.slotId,
    }),
  )

  // Requesting → Failed: storage denies the slot
  .transition(
    UploaderState.Requesting,
    UploaderAction.SlotDenied,
    UploaderState.Failed,
  )

  // Uploading → Uploading: send a data chunk
  .transition(
    UploaderState.Uploading,
    UploaderAction.SendChunk,
    UploaderState.Uploading,
    (ctx, action) => ({
      ...ctx,
      offset: action.payload.offset + action.payload.data.byteLength,
    }),
  )

  // Uploading → Uploading: storage acknowledges a chunk
  .transition(
    UploaderState.Uploading,
    UploaderAction.Ack,
    UploaderState.Uploading,
    (ctx, action) => ({
      ...ctx,
      offset: action.payload.nextOffset,
    }),
  )

  // Uploading → Done: all chunks sent and acknowledged
  .transition(
    UploaderState.Uploading,
    [
      UploaderAction.Complete,
      (ctx) => ctx.offset >= ctx.totalSize,
    ],
    UploaderState.Done,
  )
```

Nothing here is protocol-aware yet. The machine handles local state, guards, and context exactly as documented in `README.md` §1–§4.

---

## 2 — Declare the global protocol

A source protocol description (§7.4 of the session-types spec) captures the interaction structure shared by all roles.

The protocol builder follows the same accumulator-based staged typing as the EFSM builder in `src/types.ts`. Declarations (roles, messages) are chained calls that build a type-level model. The body is a tree expression whose helper functions are typed against that model.

```typescript
import { protocol } from '@escapace/fsm/protocol'

const fileTransfer = protocol()
  // ── Declaration phase (builder-style, staged types) ───────────
  //
  // Each .role() and .message() call appends to a type-level log and
  // folds into builder state. Duplicates are rejected at the call site
  // via Exclude<U, DeclaredRoles> / Exclude<U, DeclaredMessages> —
  // identical to how .state() and .action() work in the EFSM builder.
  //
  // .message<Name, Payload>() associates a payload type with the
  // message identifier. Messages with no payload omit the type parameter.

  .role('uploader')
  .role('storage')
  .message<'RequestSlot', RequestSlotPayload>('RequestSlot')
  .message<'SlotGranted', SlotGrantedPayload>('SlotGranted')
  .message<'SlotDenied', SlotDeniedPayload>('SlotDenied')
  .message<'SendChunk', SendChunkPayload>('SendChunk')
  .message<'Ack', AckPayload>('Ack')
  .message<'Complete'>('Complete')

  // ── Body phase (tree expression, typed against declarations) ──
  //
  // .body() is available only after at least two roles are declared.
  // The callback receives constructor functions whose parameters are
  // constrained by the accumulated role and message sets:
  //
  //   interact(id, sender, receiver, message, next)
  //     sender:   S extends Roles
  //     receiver: R extends Exclude<Roles, S>   (sender ≠ receiver)
  //     message:  M extends Messages
  //
  //   choice(chooser, branches)
  //     chooser:  C extends Roles
  //
  // A typo in a role or message name is a compile error, not a
  // runtime rejection.

  .body(({ interact, choice, loop, continueLoop, done }) =>
    interact('req', 'uploader', 'storage', 'RequestSlot',
      choice('storage', [
        ['granted', interact('grant', 'storage', 'uploader', 'SlotGranted',
          loop('transfer',
            interact('chunk', 'uploader', 'storage', 'SendChunk',
              interact('ack', 'storage', 'uploader', 'Ack',
                choice('uploader', [
                  ['more', continueLoop('transfer')],
                  ['finish', interact('cmp', 'uploader', 'storage', 'Complete', done)],
                ]),
              ),
            ),
          ),
        )],
        ['denied', interact('deny', 'storage', 'uploader', 'SlotDenied', done)],
      ]),
    ),
  )
```

### What the builder enforces at compile time

| Constraint | Mechanism |
| --- | --- |
| Roles form a literal union (`'uploader' \| 'storage'`) | `.role()` accumulates into builder state |
| Duplicate role / message rejected | `Exclude<U, Declared>` on parameter type |
| Sender and receiver ∈ role set | Body helpers constrain to `Roles` |
| Sender ≠ receiver | Receiver typed as `Exclude<Roles, Sender>` |
| Message ∈ declared message set | Body helpers constrain to `Messages` |
| Chooser ∈ role set | `choice()` first parameter constrained to `Roles` |
| Message payload types propagate downstream | Boundary `deriveReceiveStep` infers payload per message |

### What remains a runtime check

Interaction ID uniqueness and loop-ID/continueLoop agreement require accumulating state across sibling and nested nodes within a single tree expression. TypeScript's inference cannot thread an accumulator through a recursive literal, so these stay as runtime pipeline checks — `interactionIdsDistinct` and normalization (§10.9), consistent with PJ5 rejection soundness. This mirrors how the EFSM builder leaves guard correctness to runtime.

### Additional pipeline constraints (§10.9)

- The protocol normalizes to a finite graph (`buildGraph`).
- Every choice has a single chooser (`allSingleChooser`).

If any check fails, projection returns a typed rejection (§7.7) instead of endpoint automata.

---

## 3 — Project endpoint automata

Projection (§10) transforms the global protocol into one endpoint automaton per role. Each automaton captures only the interactions that role participates in; interactions between other roles are silent edges that merge endpoint states.

```typescript
import { projectProtocol } from '@escapace/fsm/protocol'

const projection = projectProtocol(fileTransfer)

if (!projection.ok) {
  // Typed rejection: 'undeclaredRole' | 'duplicateInteractionId' | ...
  throw new Error(`Projection failed: ${projection.reason}`)
}

// projection.endpoints is [['uploader', EndpointAutomaton], ['storage', EndpointAutomaton]]
const [, uploaderEndpoint] = projection.endpoints.find(([role]) => role === 'uploader')!
// The storage role's endpoint would be used to construct the storage-side boundary.
const [, storageEndpoint]  = projection.endpoints.find(([role]) => role === 'storage')!
```

Properties guaranteed by successful projection:

- **PJ2 — Well-formedness:** non-empty distinct states, initial state declared, all transition endpoints valid.
- **PJ3 — Label-shape correctness:** each transition label matches the source interaction — direction, peer, and message are correct.
- **PJ4 — Trace correspondence:** the endpoint automaton's trace language equals the role-local trace set of the global protocol.
- **PJ1 — Determinism:** regeneration from the same source produces identical automata.

---

## 4 — Create a protocol boundary

A boundary (§1.12–§1.14) wraps the local EFSM and an endpoint automaton into a single service. It enforces protocol legality on every dispatch.

```typescript
import { boundary } from '@escapace/fsm/protocol'

const uploaderService = boundary({
  machine: uploaderMachine,
  endpoint: uploaderEndpoint,

  // §1.8 — Map local actions to protocol effects.
  // Actions not listed produce ProtocolEffect.none (local-only).
  deriveEffect: {
    [UploaderAction.RequestSlot]: () => ({ send: 'RequestSlot' }),
    [UploaderAction.SendChunk]:   () => ({ send: 'SendChunk' }),
    [UploaderAction.Complete]:    () => ({ send: 'Complete' }),
  },

  // §1.10 — Map inbound protocol labels to local machine actions.
  // Labels not listed produce unknownAction on receive.
  //
  // Because .message<Name, Payload>() associated payload types during
  // protocol declaration, the payload parameter in each mapping is
  // automatically narrowed:
  //   'SlotGranted' → SlotGrantedPayload
  //   'SlotDenied'  → SlotDeniedPayload
  //   'Ack'         → AckPayload
  //
  // Without the builder, these would be `unknown` or require manual
  // annotation at every entry.
  deriveReceiveStep: {
    SlotGranted: (payload) => ({ action: UploaderAction.SlotGranted, payload }),
    SlotDenied:  (payload) => ({ action: UploaderAction.SlotDenied,  payload }),
    Ack:         (payload) => ({ action: UploaderAction.Ack,         payload }),
  },
})
```

The boundary now tracks two pieces of state (§1.12):

- The local machine snapshot (state + context).
- The current endpoint state within the projected automaton.

---

## 5 — Outbound dispatch (send)

Dispatching a protocol-visible action goes through the boundary dispatch path (§2.1–§2.5).

```typescript
// Local-only action (if one existed): machine advances, endpoint state unchanged.
// Protocol-send action: machine advances, endpoint advances together.

const sent = uploaderService.do(UploaderAction.RequestSlot, {
  fileName: 'report.pdf',
  sizeBytes: 131_072, // 128 KB — two 64 KB chunks
})

console.log(sent)                          // true
console.log(uploaderService.state)         // 'Requesting'
console.log(uploaderService.endpointState) // endpoint state after 'RequestSlot' send transition
```

What happens under the hood:

1. Local EFSM dispatch runs (§2.1 delegation). If guards fail → `false`.
2. `deriveEffect` maps the action to `send('RequestSlot')`.
3. `endpointCandidates(currentEndpointState, 'RequestSlot')` must be non-empty (§2.4). If empty → `ProtocolViolation` throw (§2.5).
4. First candidate in declaration order is selected. Machine and endpoint advance together.

### Error cases

| Outcome | Runtime behavior |
| --- | --- |
| Undeclared action | Throw (consistent with EFSM §2.1) |
| Guards fail / no candidates | Return `false`, snapshot unchanged |
| Protocol violation (send label not legal at current endpoint state) | Throw `ProtocolViolation` |

---

## 6 — Inbound receive

When an external message arrives, the boundary receive path (§3.1–§3.5) processes it. The endpoint is checked **before** the local machine step.

```typescript
// Storage granted our slot — external receive event.
// The payload type is inferred as SlotGrantedPayload from the protocol
// builder's .message<'SlotGranted', SlotGrantedPayload>() declaration.
const received = uploaderService.receive({
  label: 'SlotGranted',
  payload: { slotId: 'slot-42', maxChunkBytes: 65_536 },
})

console.log(received)                      // true
console.log(uploaderService.state)         // 'Uploading'
console.log(uploaderService.endpointState) // endpoint state after 'SlotGranted' receive transition
```

Sequence:

1. Check `endpointCandidates(currentEndpointState, 'SlotGranted')`. If empty → `ProtocolViolation` throw (§3.3).
2. Select the first candidate. Look up the `deriveReceiveStep` mapping to find the local action and payload (§3.4).
3. Run local EFSM dispatch for that action. If it fails → `false`.
4. Machine and endpoint advance together. `eventKind = protocolReceive`.

Had the storage denied the slot instead of granting it (a different run from
the initial endpoint state after `RequestSlot`), the receive path would take
the other branch:

```typescript
// Alternative scenario — not part of the running example above.
// From the Requesting endpoint state, both SlotGranted and SlotDenied
// are valid receive labels.
service.receive({
  label: 'SlotDenied',
  payload: { reason: 'quota exceeded' },
})
// service.state === 'Failed'
```

---

## 7 — Subscriptions

Subscriptions follow the same semantics as the base EFSM layer (§3 of `README.md`). The boundary delegates to the underlying service. Subscribers see post-transition state and context but not endpoint-state or protocol-label information in the change record (§4.9 of the session-types spec).

```typescript
const unsubscribe = uploaderService.subscribe((change) => {
  console.log(`${change.action.source} → ${change.state} via ${change.action.type}`)

  // Endpoint state is available as a synchronous read within the callback.
  console.log(`endpoint: ${uploaderService.endpointState}`)
})

// Drive through the upload loop
uploaderService.do(UploaderAction.SendChunk, {
  slotId: 'slot-42',
  offset: 0,
  data: new Uint8Array(65_536),
})
// Subscriber fires: "Uploading → Uploading via SendChunk"

uploaderService.receive({
  label: 'Ack',
  payload: { nextOffset: 65_536 },
})
// Subscriber fires: "Uploading → Uploading via Ack"

unsubscribe()
```

---

## 8 — Drafts with protocol awareness

Drafts (§4 of `README.md`, §4.4–§4.8 of the session-types spec) provide speculative execution. A boundary draft tracks both machine and endpoint state.

```typescript
const draft = uploaderService.draft()

// Speculate: send another chunk, receive ack, then complete
draft.do(UploaderAction.SendChunk, {
  slotId: 'slot-42',
  offset: 65_536,
  data: new Uint8Array(65_536),
})

draft.receive({
  label: 'Ack',
  payload: { nextOffset: 131_072 },
})

// Guard check: offset >= totalSize
draft.do(UploaderAction.Complete)

console.log(draft.state)  // 'Done'
// Live service is still in 'Uploading' — draft is isolated.
console.log(uploaderService.state) // 'Uploading'
```

### Commit

Root commit (§4.6) replays the draft trace onto the live service. Each step fires subscriber callbacks in order. The publication sequence (§4.7) captures the outbound sends — `SendChunk` and `Complete` — in trace order. The `Ack` receive step is not in the publication sequence.

```typescript
draft.commit()

console.log(uploaderService.state) // 'Done'
// If a subscriber were active, it would receive three notifications
// in trace order: SendChunk, Ack, Complete (§4.11 of README.md).
```

### Stale drafts

If the live service advances between draft creation and commit, the cursor check fails.
The following is a standalone illustration assuming the service is in `Uploading` state:

```typescript
// Assume service is in Uploading state with a valid slotId
const d1 = service.draft()
const d2 = service.draft()

d1.do(UploaderAction.SendChunk, { slotId: 'slot-42', offset: 0, data: new Uint8Array(64) })
d1.commit() // succeeds — cursor matches

d2.do(UploaderAction.SendChunk, { slotId: 'slot-42', offset: 0, data: new Uint8Array(64) })
try {
  d2.commit() // throws DraftCommitConflict — cursor advanced by d1's commit
} catch (error) {
  // handle conflict: discard d2 and retry from current state
}
```

### Nested drafts

The EFSM layer supports nested drafts (`README.md` §4.8, §4.10), but the boundary layer does not yet extend them (session-types spec §13). Nested boundary drafts are a planned future extension. Once available, the pattern would follow the same append-and-replay structure:

```typescript
// Future — not yet supported at the boundary layer.
// Assume service is in Uploading state with a valid slotId.
const parent = service.draft()
parent.do(UploaderAction.SendChunk, { slotId: 'slot-42', offset: 0, data: new Uint8Array(64) })

const child = parent.draft()
child.receive({ label: 'Ack', payload: { nextOffset: 64 } })
child.commit() // merges into parent's trace

parent.commit() // replays combined trace onto live service
```

---

## 9 — Protocol violation examples

Violations are configuration or sequencing errors, not normal runtime conditions.

### Send-side violation (§2.5)

A send-side `ProtocolViolation` occurs when the local EFSM dispatch **succeeds** (the
transition exists and guards pass) but `deriveEffect` produces a send label that the
endpoint automaton does not admit at the current endpoint state. The EFSM runs first
(§2.1); if it returns `false`, the boundary returns `false` without reaching the
protocol check.

In a correctly configured boundary — where the machine transitions and protocol
interactions are aligned — send violations do not arise through normal use. They
indicate a configuration error: an action mapped to a send label that the endpoint
does not expect at that point.

```typescript
// Hypothetical misconfiguration: imagine a machine that allows SendChunk
// from Idle state, with deriveEffect mapping it to send('SendChunk').
// The EFSM dispatch succeeds (transition exists), but the endpoint
// automaton at the initial state only admits send('RequestSlot').
//
// Result: ProtocolViolation throw — the endpoint rejects the send label.
```

### Receive-side violation (§3.3)

A receive-side `ProtocolViolation` occurs when the endpoint check runs **before** the
local machine step (§3.1) and finds no candidates. This is the more natural violation
path — external messages can arrive in unexpected order.

```typescript
// If an ack arrives while the endpoint is still in the Requesting state
// (after RequestSlot, before SlotGranted/SlotDenied):
try {
  service.receive({ label: 'Ack', payload: { nextOffset: 0 } })
} catch (error) {
  // ProtocolViolation: endpointCandidates(requestingEndpointState, 'Ack')
  // is empty. Only 'SlotGranted' and 'SlotDenied' are valid receives here.
}
```

---

## 10 — Projection rejection

When the source protocol violates structural requirements, projection returns a typed rejection instead of proceeding.

```typescript
// With the builder, sender ≠ receiver is enforced at compile time:
// the receiver parameter is typed as Exclude<Roles, Sender>, so
// passing the same role for both is a type error.
//
// Other structural violations surface at projection time:

const badProtocol = protocol()
  .role('a')
  .role('b')
  .message<'Ping'>('Ping')
  .message<'Ping'>('Ping')   // ← compile error: 'Ping' already declared
```

Structural issues that pass compile-time checks (e.g., duplicate interaction IDs
within the body tree) are caught by the projection pipeline:

```typescript
const result = projectProtocol(someProtocol)

if (!result.ok) {
  console.error(result.reason) // typed as ProjectionRejection
}
```

Rejection classes (§7.7):

| Rejection | Cause |
| --- | --- |
| `undeclaredRole` | Role in an interaction not in the declared set |
| `duplicateInteractionId` | Two interactions share an ID |
| `nonFiniteStateProtocol` | Normalization produces an unbounded graph |
| `nonSingleChooser` | A choice has multiple chooser roles |
| `nonProjectableChoice` | Confluence check fails for an uninvolved role |
| `parallelCompositionUnsupported` | Reserved; not currently emitted by the pipeline |

---

## 11 — Feature summary

| Feature | Spec reference | Demonstrated in |
| --- | --- | --- |
| Local EFSM (states, actions, guards, reducers, context) | `README.md` §1–§3 | §1 |
| Protocol builder (roles, messages with typed payloads) | Session-types §7.2–§7.4 | §2 |
| Protocol body (interact, choice, loop, done) | Session-types §7.4 | §2 |
| Compile-time role/message validation | — (type-level) | §2, §10 |
| Projection to endpoint automata | Session-types §10 | §3 |
| Boundary construction with effect/receive maps | Session-types §1.8, §1.10 | §4 |
| Typed receive payloads via message declarations | — (type-level) | §4, §6 |
| Outbound dispatch (local-only and protocol-send) | Session-types §2.1–§2.5 | §5 |
| Inbound receive with endpoint-first checking | Session-types §3.1–§3.5 | §6 |
| Subscriptions with endpoint-state read | Session-types §4.9 | §7 |
| Protocol-aware drafts (root, commit, conflict) | Session-types §4.4–§4.8 | §8 |
| Nested boundary drafts (future) | Session-types §13 | §8 |
| Protocol violation detection (send and receive) | Session-types §2.5, §3.3 | §9 |
| Projection rejection with typed reasons | Session-types §7.7, §10.8 | §10 |
| Composition (flat EFSM feature, orthogonal) | `README.md` §11 | — |

---

## Transport boundary

The protocol boundary enforces **local legality** — whether the current endpoint state admits a given send or receive. It does not guarantee delivery, ordering, deduplication, or any transport-level property (§6 of the session-types spec). Those concerns belong to adapter layers built above the boundary.
