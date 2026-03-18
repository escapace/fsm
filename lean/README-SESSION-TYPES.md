# Session-type semantic specification

## Purpose

This document defines the semantics of the protocol-boundary and projection layers for `@escapace/fsm` in language-independent terms. A reader should be able to determine:

- what a protocol-typed boundary does to a successful local dispatch or an external receive event,
- what a projected endpoint automaton looks like and where it comes from,
- what each semantic property guarantees and what it does not,

without consulting TypeScript source code. The specification is precise enough to encode directly in Lean 4.

This specification is **additive** over the flat EFSM semantics defined in `lean/README.md`. It does not replace that document. The EFSM layer provides machine definitions, snapshots, dispatch, selected-step replay, and draft semantics. This document adds two layers above it:

1. **Protocol boundaries** — trusted endpoint automata wrapped around local machines, with outbound sends and external checked receives.
2. **Projection** — restricted derivation of endpoint automata from a single source protocol description.

The layering is:

```text
lean/README.md           flat EFSM semantics
  ↓
this document §1–§5      protocol-boundary semantics
  ↓
this document §6–§10     projection semantics
```

## Scope

This specification covers the **semantic model** — the observable behavior of protocol-typed boundaries and projection. It deliberately excludes:

- projection correctness for the full MPST literature class,
- automata-based implementability checking,
- queue contents, mailbox semantics, and selective receive,
- transport delivery guarantees,
- global deadlock-freedom, liveness, or subject-reduction claims,
- parallel composition with fork and join,
- dynamic participants or connection actions,
- failure, retry, reconnect, or crash semantics,
- compatibility, subtyping, or refinement reasoning,
- runtime monitoring or code-generation semantics,
- TypeScript type-level encoding details.

These are either future extensions or implementation details. The proofs target the semantic layer only.

## Academic background

The design is informed by the CFSM/MPST literature, specifically:

- Deniélou and Yoshida, *Multiparty Session Types Meet Communicating Automata* (ESOP 2012)
- Deniélou and Yoshida, *Multiparty Compatibility in Communicating Automata* (2013)
- Lange and Yoshida, *Verifying Asynchronous Interactions via Communicating Session Automata* (2019)
- Majumdar, Mukund, Stutz, and Zufferey, *Generalising Projection in Asynchronous Multiparty Session Types* (CONCUR 2021)
- Li, Stutz, Wies, and Zufferey, *Complete Multiparty Session Type Projection with Automata* (CAV 2023)
- Tirore, Bengtson, and Carbone, *A Sound and Complete Projection for Global Types* (ITP 2023)
- Tirore, Bengtson, and Carbone, *Multiparty Asynchronous Session Types: A Mechanised Proof of Subject Reduction* (ECOOP 2025)

The key conclusions carried forward: endpoint automata are the correct local artifact; syntax-directed projection should separate projectability from translation; richer asynchronous semantics should not be imported into the first proof phase.

---

# Part I — Protocol-boundary semantics

## 1 — Definitions

### 1.1 — Dependency on the EFSM layer

This specification assumes the flat EFSM semantics defined in `lean/README.md`. In particular, it relies on:

- machine definitions, machine snapshots, and successful selected local steps,
- replay of selected local steps (`applySelected`, `replayTrace`),
- draft handles, root draft commit, and cursor semantics.

### 1.2 — Protocol label

A **protocol label** `ℓ` identifies one protocol-visible communication action at a local boundary.

```text
ℓ = (id, direction, peer, message)
```

where:

- `id` is a stable label identifier,
- `direction ∈ {send, receive}`,
- `peer` is a peer or role identifier,
- `message` is a protocol message identifier.

### 1.3 — Endpoint state

An **endpoint state** is an opaque identifier from a finite set, representing one role's local protocol position.

### 1.4 — Endpoint transition

An **endpoint transition** `u` is a tuple:

```text
u = (id, source, label, target)
```

where `source` and `target` are endpoint states and `label` is a protocol label.

### 1.5 — Endpoint automaton

An **endpoint automaton** `E = (Q, q₀, U)` where:

- `Q` is a finite, non-empty, ordered set of distinct endpoint states,
- `q₀ ∈ Q` is the initial endpoint state,
- `U` is a finite, ordered list of endpoint transitions,
- every transition source and target belongs to `Q`.

Endpoint automata are trusted input to the boundary layer. Projection (Part II) explains where they come from.

### 1.6 — Endpoint candidate list

For endpoint state `q` and label `ℓ`, `endpointCandidates(q, ℓ)` is the subsequence of `U` containing exactly those transitions where `source = q` and `label = ℓ`, preserving declaration order.

### 1.7 — Boundary event kind

A boundary event kind classifies how a successful boundary step interacts with the protocol layer:

```text
BoundaryEventKind = { localOnly, protocolSend, protocolReceive }
```

### 1.8 — Protocol effect

A successful local selected step may carry an outbound protocol effect:

```text
ProtocolEffect = none | send(ℓ)
```

The derivation function `deriveEffect` is supplied as a boundary configuration parameter.

### 1.9 — External receive event

An **external receive event** `ρ` identifies one protocol-visible inbound communication presented to the boundary from outside the local machine:

```text
ρ = (label, payload?)
```

where `label` is a protocol label and `payload?` is optional data for the receive-to-machine mapping. The `boundaryReceive` function uses `ρ.label` directly for endpoint candidate lookup.

### 1.10 — Receive-to-machine mapping

A boundary configuration supplies a mapping from `(machineSnapshot, receiveEvent)` to a local machine step result:

```text
deriveReceiveStep(machineSnapshot, ρ) = success(rule, info) | machineFailure | unknownAction
```

This is a deterministic partial function. Its exact runtime authoring surface is outside the semantic model.

### 1.11 — Boundary-selected step

A **boundary-selected step** records one successful boundary operation:

```text
BoundarySelectedStep = {
  machineStep,
  eventKind,
  endpointTransition?,
  protocolLabel?,
  externalReceive?
}
```

Consistency conditions:

- `localOnly` ⟹ `endpointTransition`, `protocolLabel`, and `externalReceive` are all absent.
- `protocolSend` ⟹ `endpointTransition = some(u)`, `protocolLabel = some(ℓ)`, `u.label = ℓ`, `externalReceive` absent.
- `protocolReceive` ⟹ `endpointTransition = some(u)`, `protocolLabel = some(ℓ)`, `externalReceive = some(ρ)`, `u.label = ℓ`, `ρ.label = ℓ`.

### 1.12 — Boundary snapshot

A **boundary snapshot** is a pair:

```text
BoundarySnapshot = { machineSnapshot, endpointState }
```

No mailbox or queue state is included.

### 1.13 — Boundary service state

```text
BoundaryServiceState = { snapshot, cursor }
```

The cursor is monotonic and follows the same semantics as the EFSM `ServiceState` cursor.

### 1.14 — Boundary draft handle

```text
BoundaryDraft = { baseCursor, baseSnapshot, trace }
```

where `trace` is an append-only list of boundary-selected steps.

Derived values:

```text
currentSnapshot = replayBoundaryTrace(baseSnapshot, trace)
draftHeadCursor = baseCursor + length(trace)
```

## 2 — Boundary dispatch semantics

Boundary dispatch is the core operation. It validates protocol-visible effects of successful local transitions against the endpoint automaton.

### 2.1 — Dispatch delegation

Boundary dispatch begins by delegating to the existing local EFSM dispatch semantics.

Three outcomes:

1. Local dispatch rejects an undeclared action → boundary returns `unknownAction`.
2. Local dispatch returns failure → boundary returns `machineFailure`.
3. Local dispatch succeeds → protocol effect resolution (§2.2–§2.5).

### 2.2 — Boundary result type

```text
BoundaryDispatchResult = success(newSnapshot, step) | machineFailure | unknownAction | protocolViolation
```

### 2.3 — Local-only success

If `deriveEffect(machineStep) = none`: machine state advances, endpoint state is unchanged, `eventKind = localOnly`.

### 2.4 — Protocol-send success

If `deriveEffect(machineStep) = send(ℓ)` and `endpointCandidates(q, ℓ)` is non-empty: select the first candidate `u` in declaration order. Machine and endpoint state advance together. The post-boundary endpoint state is `u.target`.

### 2.5 — Protocol violation

If `deriveEffect(machineStep) = send(ℓ)` but `endpointCandidates(q, ℓ)` is empty: return `protocolViolation`. The boundary snapshot is unchanged.

### 2.6 — Determinism

Boundary dispatch is deterministic given fixed guard behavior, fixed `deriveEffect`, and fixed endpoint transition order.

## 3 — Receive-side boundary semantics

A receive-side boundary operation is a second entry path alongside outbound dispatch. It processes externally supplied inbound protocol events.

### 3.1 — Receive-first ordering

The boundary checks endpoint legality for the receive label **before** accepting the corresponding local machine step. The external receive event triggers the operation, not a local transition.

### 3.2 — Receive result type

```text
BoundaryReceiveResult = success(newSnapshot, step) | machineFailure | unknownAction | protocolViolation
```

### 3.3 — Receive legality rule

If `endpointCandidates(q, ρ.label)` is empty, return `protocolViolation`. The boundary snapshot is unchanged.

### 3.4 — Receive success rule

If `endpointCandidates(q, ρ.label)` is non-empty, select the first candidate `u` in declaration order. Then apply the receive-to-machine mapping `deriveReceiveStep(machineSnapshot, ρ)`.

On mapping success with `rule` and `info`: compute the post-machine state as `(rule.target, applyReducer(rule, context, info))`, advance the endpoint to `u.target`, and record the step with `eventKind = protocolReceive`.

### 3.5 — Receive-side unknownAction and machineFailure

If endpoint candidates exist but the machine mapping returns `unknownAction` or `machineFailure`, reflect that result. The boundary snapshot is unchanged.

### 3.6 — Determinism

Receive-side boundary selection is deterministic given fixed endpoint transition order and deterministic receive-to-machine mapping.

## 4 — Replay and draft semantics

### 4.1 — Boundary step application

`applyBoundarySelected(snapshot, step)` applies a recorded successful boundary step:

- `localOnly`: apply machine step, endpoint state unchanged.
- `protocolSend`: apply machine step, advance endpoint state to `u.target`.
- `protocolReceive`: apply machine step, advance endpoint state to `u.target`. The `externalReceive` field is not re-examined during replay.

Replay does not re-run candidate selection, protocol legality checking, or the receive-to-machine mapping. It consumes the recorded step directly, as with selected-step replay in the base EFSM semantics.

### 4.2 — Boundary trace replay

```text
replayBoundaryTrace(snapshot, trace) → snapshot'
```

Left fold of `applyBoundarySelected` over the trace.

### 4.3 — Replay append law

```text
replayBoundaryTrace(snap, t₁ ++ t₂) = replayBoundaryTrace(replayBoundaryTrace(snap, t₁), t₂)
```

### 4.4 — Draft creation

`boundaryService.draft()` creates a boundary draft with:

- `baseCursor = boundaryService.cursor`,
- `baseSnapshot = boundaryService.snapshot`,
- `trace = []`.

### 4.5 — Draft dispatch and draft receive

Both apply their respective boundary operations against `currentSnapshot`.

- Success appends the boundary-selected step to the draft trace.
- Failure (`unknownAction`, `machineFailure`, `protocolViolation`) leaves the draft unchanged.

### 4.6 — Root commit

Root boundary draft commit follows the same cursor-gated structure as root commit in the EFSM layer.

If the live boundary service cursor still equals `baseCursor`, root commit succeeds by:

- replaying the boundary trace onto the live boundary snapshot in order,
- advancing the live cursor by `length(trace)`.

If the cursor differs, commit rejects as stale.

### 4.7 — Publication sequence

The **publication sequence** of a committed trace is the subsequence of boundary-selected steps whose event kind is `protocolSend`, in replay order. This captures outbound protocol effects published during commit.

### 4.8 — Receive-aware commit semantics

Root commit for traces containing receive steps updates internal semantic state by replaying recorded successful steps. It does **not** claim republication, revalidation, or external-world persistence of recorded receive events. The commit soundness theorem is about snapshot equality, not external observation.

## 5 — Protocol-boundary properties

The following properties are derived from the semantics above and form the boundary theorem target set.

### PB1 — Boundary determinism

For any boundary snapshot, local action, and payload: if guard behavior is fixed and `deriveEffect` is deterministic, then boundary dispatch produces a unique result.

### PB2 — Local-only preservation

If boundary dispatch succeeds with `eventKind = localOnly`, then the machine component of the resulting snapshot equals the post-local-dispatch machine snapshot, and the endpoint state is unchanged.

### PB3 — Protocol-send soundness

If boundary dispatch succeeds with `eventKind = protocolSend` and emitted label `ℓ`, then the selected endpoint transition belongs to `endpointCandidates(q, ℓ)` in declaration order.

### PB4 — Protocol-violation characterization

Boundary dispatch returns `protocolViolation` if and only if local dispatch succeeded with a send effect whose endpoint candidates are empty.

### PB5 — Boundary replay equivalence

If boundary dispatch succeeds with post-boundary snapshot `snap'` and recorded step `bstep`, then `applyBoundarySelected(preSnap, bstep) = snap'`.

### PB6 — Boundary draft trace invariant

For every open boundary draft handle: `currentSnapshot = replayBoundaryTrace(baseSnapshot, trace)`.

### PB7 — Root boundary commit replay soundness

If a root boundary draft's parent cursor still equals `baseCursor` and the live boundary snapshot still equals `baseSnapshot`, then successful root commit yields a live boundary snapshot equal to the draft's `currentSnapshot`, with cursor advanced by `length(trace)`.

### PB7a — Empty-trace root commit

If the boundary draft trace is empty and cursor/snapshot still match, root commit is a no-op.

### PB8 — Root boundary publication-order soundness

If a root boundary draft commits successfully, the publication sequence decomposes over trace concatenation: `publishedLabels(t₁ ++ t₂) = publishedLabels(t₁) ++ publishedLabels(t₂)`.

### PR1 — Receive-boundary determinism

For any boundary snapshot and external receive event: if the receive-to-machine mapping is deterministic and endpoint transition order is fixed, the receive-side boundary operation produces a unique result.

### PR2 — Receive legality soundness

If the receive-side boundary operation succeeds with `eventKind = protocolReceive` and emitted label `ℓ`, then the selected endpoint transition belongs to `endpointCandidates(q, ℓ)` in declaration order.

### PR3 — Receive-violation characterization

The receive-side boundary operation returns `protocolViolation` if and only if `endpointCandidates(q, ρ.label)` is empty.

### PR4 — Receive replay equivalence

If the receive-side boundary operation succeeds with post-boundary snapshot `snap'` and recorded step `bstep`, then `applyReceiveBoundarySelected(preSnap, bstep) = snap'`.

### PR5 — Replay append law

Boundary replay over concatenated traces of receive-capable steps remains associative.

### PR6 — Receive-aware draft trace invariant

For every open receive-aware boundary draft handle: `currentSnapshot = replayReceiveBoundaryTrace(baseSnapshot, trace)`.

### PR7 — Receive-aware root commit replay soundness

If a receive-aware root boundary draft's parent cursor and snapshot still match, successful root commit yields a live boundary snapshot equal to the draft's `currentSnapshot`, with cursor advanced by `length(trace)`. This theorem is about internal semantic state only.

### PR7a — Empty-trace receive-aware root commit

If the receive-aware draft trace is empty and cursor/snapshot still match, root commit is a no-op.

## 6 — Transport-assumption boundary

This semantic model intentionally separates protocol legality from actual delivery.

**Assumed by the semantic model:**

- outbound protocol legality is checked against endpoint state,
- replay preserves recorded boundary-step order,
- root commit publishes staged outbound effects in replay order.

**Not guaranteed by the semantic model:**

- reliable delivery,
- exactly-once delivery,
- absence of duplication,
- adapter-level FIFO beyond what an integration explicitly provides,
- reconnect or resume behavior,
- correlation behavior beyond what later adapters may define.

Those are operational contracts of adapters or runtimes layered above this semantics.

---

# Part II — Projection semantics

## 7 — Source protocol definitions

### 7.1 — Identifier

An **identifier** is an opaque value with decidable equality. Used for protocols, roles, messages, interactions, graph nodes, endpoint states, endpoint transitions, and labels.

### 7.2 — Role set

A **role set** `R` is a finite, non-empty, ordered set of distinct role identifiers.

### 7.3 — Message interaction

A **message interaction** `ι` identifies one protocol-visible communication action:

```text
ι = (id, sender, receiver, message)
```

where `sender` and `receiver` belong to `R`. The constraint `sender ≠ receiver` is enforced by source validation (`syntaxWellFormed`), not by the interaction type itself.

### 7.4 — Source protocol description

A **source protocol description** is a finite artifact:

```text
G = (id, R, body)
```

where `R` is a finite, non-empty, ordered, distinct role set and `body` is a finite protocol syntax tree built from:

- `done` — terminal
- `interact(ι, next)` — one interaction followed by continuation
- `choice(chooser, branches)` — single-chooser branch point with ordered branches
- `loop(loopId, body)` — finite recursion with a loop identifier
- `continueLoop(loopId)` — back-edge to a named loop

### 7.5 — Normalized global graph

The **normalized global graph** is the proof-relevant and implementation-relevant intermediate representation between source syntax and projected endpoint automata.

For a source protocol `G`, normalization yields:

```text
NormGraph(G) = (N, n₀, F, E)
```

where:

- `N` is a finite, non-empty, ordered, distinct set of control-flow nodes,
- `n₀ ∈ N` is the initial node,
- `F ⊆ N` is the set of terminal nodes,
- `E` is a finite, ordered set of directed edges.

Each edge in `E` is either:

- an **interaction edge** labeled by a message interaction `ι`, or
- a **branch edge** labeled by `(chooser, label)`.

All edge sources and targets belong to `N`.

### 7.6 — Role-local event alphabet

For a fixed role `r`, the **role-local event alphabet** consists of:

```text
send(peer, message) | receive(peer, message)
```

where `peer ≠ r`.

### 7.7 — Rejection classes

Projection is partial over the full protocol language. Unsupported protocols are explicitly rejected:

```text
ProjectionRejection = {
  undeclaredRole,
  duplicateInteractionId,
  nonFiniteStateProtocol,
  nonSingleChooser,
  nonProjectableChoice,
  parallelCompositionUnsupported
}
```

### 7.8 — Projection result type

```text
ProjectionResult = success([(r₁, EA₁), ..., (rₙ, EAₙ)]) | rejection(reason)
```

where each `EA` is an endpoint automaton in the shape defined in §1.5.

## 8 — Supported fragment

The projection semantics is defined only over a restricted fragment. The following predicates gate admission.

### 8.1 — Single-chooser choice

Every choice node has exactly one chooser role. No multi-chooser or externally nondeterministic branch points are admitted.

### 8.2 — Finite normalization

The source protocol must normalize to a finite global graph. If normalization would require unbounded unfolding, projection is rejected.

### 8.3 — No parallel composition

The source protocol must not contain explicit fork/join or parallel-composition nodes.

### 8.4 — Structural projectability for uninvolved roles

For any choice node, every role not equal to the chooser must have a structurally decidable local view within the supported fragment. Protocols requiring hidden local-state distinctions beyond what the syntax-directed projection can express are rejected rather than approximated.

## 9 — Normalization semantics

### 9.1 — Purpose

Normalization exists to:

- remove dependence on user-facing syntax shape,
- make control flow explicit,
- provide the intermediate representation that projection operates over.

### 9.2 — Rules

Normalization maps source protocol syntax to graph components. The entry node for each recursive call is the graph node at which that syntax fragment begins.

- `done` → marks the entry node as terminal. No outgoing edges.
- `interact(ι, next)` → allocates a fresh target node, adds an interaction edge from entry to target, then normalizes `next` from the target.
- `choice(chooser, [])` → marks the entry node as terminal.
- `choice(chooser, (label, body) :: rest)` → allocates a fresh branch node, adds a branch edge from entry to branch node, normalizes `body` from the branch node, then normalizes `choice(chooser, rest)` from the same entry node.
- `loop(loopId, body)` → registers `(loopId, entryNode)` in the loop map, then normalizes `body` from the same entry node.
- `continueLoop(loopId)` → if `loopId` is found in the loop map, adds a branch edge from entry to the registered target. If not found, marks entry as terminal.

### 9.3 — Interaction-target freshness

Each interaction edge's target is allocated with an ID strictly above all previously used IDs. This structural invariant ensures that interaction-edge targets never collide with nodes from earlier normalization steps.

### 9.4 — Determinism

Normalization is deterministic for fixed input and fixed identifier strategy.

### 9.5 — Graph construction

After normalization, `buildGraph` validates well-formedness (non-empty nodes, nodup, initial membership, terminal subset, edge validity). If validation fails, normalization returns `none`, and projection rejects with `nonFiniteStateProtocol`.

## 10 — Projection semantics

### 10.1 — Role-local view

For role `r` and interaction `ι = (id, sender, receiver, message)`:

- `r = sender` ⟹ projected label has `direction = send`, `peer = receiver`
- `r = receiver` ⟹ projected label has `direction = receive`, `peer = sender`
- otherwise ⟹ no endpoint transition for `r`

### 10.2 — State construction

Endpoint states are derived from canonical role-local control positions induced by the normalized graph.

Multiple graph nodes may map to the same endpoint state when they differ only by **role-silent control flow** — branch edges and uninvolved interaction edges that do not produce local events for `r`. This collapse preserves the role-local trace set.

### 10.3 — Transition construction

For each role-relevant interaction edge in the normalized graph, projection creates one endpoint transition with:

- `source` = the endpoint state for the pre-step role-local position,
- `target` = the endpoint state for the post-step role-local position,
- `label` = the generated protocol label for role `r`,
- `id` = a deterministic transition identifier.

Transitions preserve declaration order.

### 10.4 — Silent-edge handling

Branch edges and uninvolved interaction edges are **silent** for role `r`. The projector ensures their source and target map to the same endpoint state. This is validated by a confluence check: for every silent edge, the source and target have equal endpoint-state assignments.

### 10.5 — Initial state

The projected endpoint automaton for each role begins at endpoint state `0`, corresponding to the normalized graph's initial node.

### 10.6 — Rejection

If any fragment predicate fails, or if the confluence check fails for any role, projection returns `rejection(reason)`. No partial output is produced.

### 10.7 — Pipeline

`projectProtocol` implements the full pipeline:

```text
Source protocol
  → validate syntaxWellFormed        (reject undeclaredRole)
  → validate interactionIdsDistinct  (reject duplicateInteractionId)
  → normalize: normalizeSyntax → buildGraph
                                     (reject nonFiniteStateProtocol)
  → check allSingleChooser           (reject nonSingleChooser)
  → projectAllRoles: projectRole per role
                                     (reject nonProjectableChoice)
  → success: ordered list of (role, EndpointAutomaton) pairs
```

## 11 — Projection properties

The following properties are derived from the projection semantics above.

### PJ1 — Projection determinism

For any fixed source protocol description, normalization and projection produce a unique result.

### PJ2 — Output well-formedness

If projection succeeds for role `r`, the generated endpoint automaton satisfies the well-formedness conditions: non-empty states, distinct states, initial state declared, every transition source and target declared.

### PJ3 — Label-shape correctness

If projection succeeds, every generated endpoint transition label matches the corresponding source interaction:

- send exactly when the role is sender,
- receive exactly when the role is receiver,
- peer equal to the opposite role,
- message equal to the source message identifier.

### PJ4 — Role-local trace correspondence

For each role `r` in the supported fragment, the trace language of the projected endpoint automaton equals the role-local trace set of the normalized protocol for `r`.

A **role-local trace** is the subsequence of interactions involving `r` along any finite path from the initial node, rewritten as local events. The **endpoint trace language** is the set of event sequences produced by finite paths through the endpoint automaton from its initial state.

This is the strongest property in the projection layer.

### PJ5 — Rejection soundness

If projection returns a named rejection class, the corresponding source-level check failed:

- `undeclaredRole` ⟹ `syntaxWellFormed` is false.
- `duplicateInteractionId` ⟹ `interactionIdsDistinct` is false.
- `nonFiniteStateProtocol` ⟹ both pre-checks passed but graph construction returned `none`.
- `nonSingleChooser` ⟹ normalization succeeded but `allSingleChooser` returned false.
- `nonProjectableChoice` ⟹ `allSingleChooser` passed but `projectAllRoles` returned `none`.
- `parallelCompositionUnsupported` ⟹ not currently emitted by the pipeline.

### Label traceability

Every endpoint transition's `label.id` equals the `id` of its originating source interaction.

### Endpoint-state identity

Two graph nodes map to the same endpoint state if and only if they share a common silent ancestor — a node from which both are reachable via silent edges only.

### Endpoint-transition identity

Each endpoint transition traces to a source graph interaction with matching `id` and `message`.

## 12 — Determinism and identity commitments

The projection semantics adopts the following commitments. These are not incidental implementation properties; later theorem statements may quantify over them.

| Commitment | Semantic content |
| --- | --- |
| Deterministic normalization | Fixed input and identifier strategy produce a unique normalized graph. |
| Deterministic projection | Fixed normalized graph and identifier strategy produce unique endpoint automata. |
| Stable label identity | Generated `ProtocolLabel.id` values are stable across regeneration from the same source. |
| Stable endpoint-state identity | Endpoint states are characterized by silent-closure equivalence classes over the normalized graph. |
| Stable endpoint-transition identity | Each transition traces to a source graph interaction with matching id and message fields. |

## 13 — Out of scope

The following are explicitly excluded from the current semantic model and proof work:

- Full sound-and-complete projection for the full MPST class.
- Automata-based implementability checking.
- Asynchronous subject reduction.
- Queue or mailbox semantics.
- Transport or observation guarantees.
- Runtime monitoring correctness.
- Compatibility or refinement reasoning.
- Global deadlock-freedom of arbitrary distributed systems.
- Nested boundary drafts (exist in the EFSM layer but not yet extended to the boundary layer).

## 14 — Lean proof files

The Lean proof files in `lean/` encode and verify the semantic properties listed in §5 and §11.

### Protocol-boundary files

| File | Content | Properties |
| --- | --- | --- |
| `ProtocolDefs.lean` | Protocol labels, endpoint transitions/automata, boundary snapshots, event kinds, result types | — |
| `ProtocolDispatch.lean` | `endpointCandidates`, `boundaryDispatch`, helper lemmas | — |
| `ProtocolReplay.lean` | `applyBoundarySelected`, `replayBoundaryTrace`, append law | PB5 |
| `ProtocolDraft.lean` | Boundary drafts, root commit, publication sequence | PB6, PB7, PB7a, PB8 |
| `ProtocolSoundness.lean` | Boundary determinism, preservation, send soundness, violation characterization | PB1–PB4 |
| `ProtocolReceiveDefs.lean` | External receive events, receive-capable boundary step/draft types | — |
| `ProtocolReceiveDispatch.lean` | `boundaryReceive`, receive-side helpers | — |
| `ProtocolReceiveReplay.lean` | Receive-aware replay and append law | PR4, PR5 |
| `ProtocolReceiveDraft.lean` | Receive-aware drafts and root commit | PR6, PR7, PR7a |
| `ProtocolReceiveSoundness.lean` | Receive determinism, legality, violation characterization | PR1–PR3 |

### Projection files

| File | Content | Properties |
| --- | --- | --- |
| `ProjectionDefs.lean` | Source protocol syntax, normalized graph, rejection classes | — |
| `ProjectionNormalize.lean` | `normalizeSyntax`, `buildGraph`, `normalizeProtocol`, normalization-shape theorems | — |
| `ProjectionProject.lean` | `projStepFn`, `projectRole`, `projectProtocol`, lookup lemmas | PJ1, PJ2 |
| `ProjectionPaths.lean` | Graph/endpoint path types, role-local view, compressed-trace bridge, trace-set equivalence | — |
| `ProjectionInvariants.lean` | Fold invariants, origin construction, transition-to-edge mapping, PJ3, PJ4, PJ5 | PJ3, PJ4, PJ5 |
| `ProjectionSoundness.lean` | End-to-end trace equality, endpoint-state/transition identity theorems | PJ4 (e2e), §12 identity |

### Implementation notes

The Lean formalization uses separate types for send-only and receive-capable boundary steps (`BoundarySelectedStep` and `ReceiveBoundarySelectedStep`) with corresponding separate event-kind types, replay functions, and draft handles. This preserves the additive file structure — the receive-side files extend the send-only files without modifying them. The semantic model above presents a unified view; the Lean code achieves the same semantics through type-level separation.

PJ4 (trace correspondence) is proved through a compressed-trace bridge: graph paths convert to `CompressedTrace` objects (alternating silent-reachability segments and visible steps, using `Mathlib.Logic.Relation.ReflTransGen`), which then convert to endpoint paths and back. The backward direction relies on an origin function constructed to prove that each endpoint state is silently forward-reachable from a canonical ancestor node.

### Proof invariants

- All 31 Lean files in `lean/` compile cleanly (16 covered by this document, 15 by `lean/README.md`).
- Zero sorries across all files.
- Standard axioms only: `propext` and `Quot.sound`.
- Proof scope is limited to semantic behavior; no dependency on JavaScript allocation or object identity.

---

# Addendum — Future directions

The following are identified as planned or possible future work. They are recorded here for traceability, not as semantic commitments.

### Stronger projection fragment

Possible later extensions within the syntax-directed family: richer recursion handling, stronger branch-equivalence checks for uninvolved roles, wider but still explicit projectable fragment with named predicates.

### Automata-based projection backend

A future semantic phase may define a stronger backend over the same normalized global graph: global automaton construction, per-role erasure, determinization via subset construction, implementability conditions. This should reuse the same front-end semantic objects and endpoint automaton output shape.

### Monitoring and runtime enforcement

The monitoring literature (Bocchi et al. 2015, van den Heuvel et al. 2023) supports runtime enforcement as a later layer around endpoint artifacts. The stable identity hooks (labels, states, transitions) are preserved for this purpose.

### Compatibility and subtyping

The asynchronous subtyping literature (Chen et al. 2022) supports future compatibility and safe-replacement reasoning. The endpoint artifact shape and identity commitments are designed to remain compatible.

### Nested boundary drafts

Nested drafts exist in the EFSM layer but are not yet extended to the boundary layer. Extension should follow the same append-and-replay structure.

### Publication semantics for receive events

Commit for receive-containing traces is currently a theorem about internal semantic state only. Future work may define publication-order or external-observation semantics for receive events, requiring transport or adapter-layer assumptions not currently in scope.

### Transport-level adapter contracts

Future adapter specifications may formalize: reliability properties, duplication and retry behavior, reconnect and resume semantics, transport-level correlation. These remain outside the Lean theorem boundary.

### Separation of admissibility checking from translation

The current projection pipeline mixes some admissibility behavior into the construction path. PJ5 theorems prove soundness against the pipeline as-is. A future refactor could make the separation explicit.
