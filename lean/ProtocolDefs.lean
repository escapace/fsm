/-
  Protocol-boundary core type definitions.

  This file contains only type definitions — no functions or theorems.
  It defines the protocol-boundary layer over the existing flat EFSM model:
  protocol labels, endpoint transitions, endpoint automata, boundary event kinds,
  boundary selected steps, boundary snapshots, boundary service state,
  boundary draft handles, and boundary dispatch/commit result types.

  All types are parameterized by the same State, Action, Ctx, Payload as the
  EFSM core, plus additional protocol-layer identifiers.
-/
import Replay

/-! ### Protocol-layer identifier types

These are parameters, not concrete types. The semantic model requires only
decidable equality. -/

variable {State Action Ctx Payload : Type}
variable {LabelId PeerId MessageId EndpointStateId EndpointTransitionId : Type}

/-- Communication direction for a protocol label.
    Version one uses only `send`. The constructor `receive` is reserved
    for future extension. -/
inductive Direction where
  | send
  | receive
  deriving DecidableEq, Repr

/-- A protocol label identifies one protocol-visible communication action
    at a local boundary.

    Version one uses only `direction = send`. -/
structure ProtocolLabel (LabelId PeerId MessageId : Type) where
  /-- Stable label identifier. -/
  id : LabelId
  /-- Communication direction. -/
  direction : Direction
  /-- Peer or role identifier. -/
  peer : PeerId
  /-- Protocol message identifier. -/
  message : MessageId

/-- An endpoint transition in a projected local endpoint automaton. -/
structure EndpointTransition (EndpointStateId EndpointTransitionId LabelId PeerId MessageId : Type)
    where
  /-- Stable endpoint-transition identifier. -/
  id : EndpointTransitionId
  /-- Source endpoint state. -/
  source : EndpointStateId
  /-- Protocol label for this transition. -/
  label : ProtocolLabel LabelId PeerId MessageId
  /-- Target endpoint state. -/
  target : EndpointStateId

/-- A projected local endpoint automaton, trusted as input in version one.

    Well-formedness constraints:
    - `states` is non-empty and has no duplicates.
    - `initial` is a member of `states`.
    - Every transition source and target is a member of `states`. -/
structure EndpointAutomaton (EndpointStateId EndpointTransitionId LabelId PeerId MessageId : Type)
    [DecidableEq EndpointStateId] where
  /-- Finite ordered set of endpoint states. -/
  states : List EndpointStateId
  /-- Initial endpoint state. -/
  initial : EndpointStateId
  /-- Ordered list of endpoint transitions. -/
  transitions : List (EndpointTransition EndpointStateId EndpointTransitionId LabelId PeerId MessageId)
  /-- States are non-empty. -/
  states_nonempty : states ≠ []
  /-- States are distinct. -/
  states_nodup : states.Nodup
  /-- Initial state is declared. -/
  initial_mem : initial ∈ states
  /-- All transition sources and targets are declared. -/
  transitions_wf : ∀ u ∈ transitions, u.source ∈ states ∧ u.target ∈ states

/-- Boundary event kind classifying how a boundary-selected step
    interacts with the protocol layer.

    Version one has `localOnly` and `protocolSend`.
    Future versions may add `protocolReceive`. -/
inductive BoundaryEventKind where
  | localOnly
  | protocolSend
  deriving DecidableEq, Repr

/-- Protocol effect derived from a successful local selected step.
    Version one: either no protocol effect or one outbound send. -/
inductive ProtocolEffect (LabelId PeerId MessageId : Type) where
  | none
  | send (label : ProtocolLabel LabelId PeerId MessageId)

/-- A boundary-selected step records one successful boundary dispatch.

    Consistency conditions:
    - If `eventKind = localOnly`, then `endpointTransition = none`
      and `protocolLabel = none`.
    - If `eventKind = protocolSend`, then both are `some`, and
      `endpointTransition.label = protocolLabel`. -/
structure BoundarySelectedStep
    (State Action Ctx Payload : Type)
    (EndpointStateId EndpointTransitionId LabelId PeerId MessageId : Type) where
  /-- The underlying EFSM selected step. -/
  machineStep : SelectedStep State Action Ctx Payload
  /-- The boundary event kind. -/
  eventKind : BoundaryEventKind
  /-- The endpoint transition used (present iff protocolSend). -/
  endpointTransition : Option (EndpointTransition EndpointStateId EndpointTransitionId LabelId PeerId MessageId)
  /-- The protocol label emitted (present iff protocolSend). -/
  protocolLabel : Option (ProtocolLabel LabelId PeerId MessageId)

/-- A boundary snapshot: local machine snapshot paired with current
    endpoint state. -/
structure BoundarySnapshot (State Ctx EndpointStateId : Type) where
  /-- Local machine snapshot. -/
  machineSnapshot : Snapshot State Ctx
  /-- Current endpoint state. -/
  endpointState : EndpointStateId

/-- Boundary service state: boundary snapshot plus monotonic cursor.
    Reuses the same cursor semantics as the EFSM `ServiceState`. -/
structure BoundaryServiceState (State Ctx EndpointStateId : Type) where
  /-- Current boundary snapshot. -/
  snapshot : BoundarySnapshot State Ctx EndpointStateId
  /-- Monotonic root cursor. -/
  cursor : Nat

/-- Boundary draft handle: boundary version of `DraftHandle`.
    Stores base cursor, base boundary snapshot, and an append-only trace
    of boundary-selected steps. -/
structure BoundaryDraftHandle
    (State Action Ctx Payload : Type)
    (EndpointStateId EndpointTransitionId LabelId PeerId MessageId : Type) where
  /-- Parent cursor captured at draft creation. -/
  baseCursor : Nat
  /-- Boundary snapshot captured at draft creation. -/
  baseSnapshot : BoundarySnapshot State Ctx EndpointStateId
  /-- Append-only trace of boundary-selected steps. -/
  trace : List (BoundarySelectedStep State Action Ctx Payload EndpointStateId EndpointTransitionId LabelId PeerId MessageId)

/-- Result of a boundary dispatch operation. -/
inductive BoundaryDispatchResult
    (State Action Ctx Payload : Type)
    (EndpointStateId EndpointTransitionId LabelId PeerId MessageId : Type) where
  /-- Boundary dispatch succeeded. -/
  | success
      (newSnapshot : BoundarySnapshot State Ctx EndpointStateId)
      (step : BoundarySelectedStep State Action Ctx Payload EndpointStateId EndpointTransitionId LabelId PeerId MessageId)
  /-- Local dispatch returned failure (no candidates or all guards failed). -/
  | machineFailure
  /-- Local dispatch rejected an undeclared action. -/
  | unknownAction
  /-- Local dispatch succeeded but the emitted label is not admitted
      by the current endpoint state. -/
  | protocolViolation

/-- Result of committing a root boundary draft. -/
inductive BoundaryRootCommitResult (State Ctx EndpointStateId : Type) where
  /-- Commit succeeded; carries the new boundary service state. -/
  | success (newService : BoundaryServiceState State Ctx EndpointStateId)
  /-- Service cursor has advanced since draft creation. -/
  | outOfDate
