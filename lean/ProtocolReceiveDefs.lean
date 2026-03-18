/-
  Protocol-boundary receive-side core type definitions.

  This file contains only type definitions — no functions or theorems.
  It defines the receive-side extension over the version-one protocol-boundary
  layer: external receive events, receive-capable event kinds, receive-capable
  boundary-selected steps, receive machine results, boundary receive results,
  and receive-aware boundary draft handles.

  All types are parameterized by the same identifiers as the version-one layer.
  The version-one protocol-boundary files are not modified.
-/
import ProtocolDefs

variable {State Action Ctx Payload : Type}
variable {LabelId PeerId MessageId EndpointStateId EndpointTransitionId : Type}

/-! ### External receive event -/

/-- An external receive event identifies one protocol-visible inbound
    communication presented to the boundary from outside the local machine.

    The label carries the protocol identity needed for endpoint legality
    checking. The payload carries optional event data used only if the
    mapped local machine step requires it. -/
structure ExternalReceiveEvent (LabelId PeerId MessageId Payload : Type) where
  /-- Protocol label identifying the inbound action. -/
  label : ProtocolLabel LabelId PeerId MessageId
  /-- Optional event payload for the receive-to-machine mapping. -/
  payload : Option Payload

/-! ### Receive-capable event kind -/

/-- Receive-capable boundary event kind.

    Extends the version-one event kind family with `protocolReceive`.
    Defined as a separate inductive to preserve version-one files unchanged. -/
inductive ReceiveBoundaryEventKind where
  | localOnly
  | protocolSend
  | protocolReceive
  deriving DecidableEq, Repr

/-! ### Receive-capable boundary-selected step -/

/-- A receive-capable boundary-selected step records one successful boundary
    operation that may be a local-only step, a protocol send, or a protocol
    receive.

    Consistency conditions:
    - If `eventKind = localOnly`, then `endpointTransition = none`,
      `protocolLabel = none`, and `externalReceive = none`.
    - If `eventKind = protocolSend`, then `endpointTransition = some(u)`,
      `protocolLabel = some(ℓ)`, `externalReceive = none`, and `u.label = ℓ`.
    - If `eventKind = protocolReceive`, then `endpointTransition = some(u)`,
      `protocolLabel = some(ℓ)`, `externalReceive = some(ρ)`,
      `u.label = ℓ`, and `ρ.label = ℓ`. -/
structure ReceiveBoundarySelectedStep
    (State Action Ctx Payload : Type)
    (EndpointStateId EndpointTransitionId LabelId PeerId MessageId : Type) where
  /-- The underlying EFSM selected step. -/
  machineStep : SelectedStep State Action Ctx Payload
  /-- The boundary event kind. -/
  eventKind : ReceiveBoundaryEventKind
  /-- The endpoint transition used (present iff protocol-visible). -/
  endpointTransition : Option (EndpointTransition EndpointStateId EndpointTransitionId LabelId PeerId MessageId)
  /-- The protocol label (present iff protocol-visible). -/
  protocolLabel : Option (ProtocolLabel LabelId PeerId MessageId)
  /-- The external receive event (present iff protocolReceive). -/
  externalReceive : Option (ExternalReceiveEvent LabelId PeerId MessageId Payload)

/-! ### Receive-to-machine mapping result -/

/-- Result of the receive-to-machine mapping.

    This is the semantic interface for the opaque mapping from
    (machineSnapshot, receiveEvent) to a local machine step.
    On success, the returned rule and info determine the machine
    state change via `applySelected`. -/
inductive ReceiveMachineResult (State Action Ctx Payload : Type) where
  /-- Mapping succeeded: the rule and info determine the machine step. -/
  | success
      (rule : TransitionRule State Action Ctx Payload)
      (info : ActionInfo State Action Payload)
  /-- The local receive mapping failed after considering transitions. -/
  | machineFailure
  /-- No receive-side local action is defined for the current inputs. -/
  | unknownAction

/-! ### Boundary receive result -/

/-- Result of a receive-side boundary operation.
    Mirrors the version-one `BoundaryDispatchResult` shape. -/
inductive BoundaryReceiveResult
    (State Action Ctx Payload : Type)
    (EndpointStateId EndpointTransitionId LabelId PeerId MessageId : Type) where
  /-- Receive-side boundary operation succeeded. -/
  | success
      (newSnapshot : BoundarySnapshot State Ctx EndpointStateId)
      (step : ReceiveBoundarySelectedStep State Action Ctx Payload EndpointStateId EndpointTransitionId LabelId PeerId MessageId)
  /-- The receive-to-machine mapping reported failure. -/
  | machineFailure
  /-- No receive-side local action defined for the current inputs. -/
  | unknownAction
  /-- The receive label is not admitted by the current endpoint state. -/
  | protocolViolation

/-! ### Receive-aware boundary draft handle -/

/-- Receive-aware boundary draft handle.
    Stores base cursor, base boundary snapshot, and an append-only trace
    of receive-capable boundary-selected steps. Traces may contain
    localOnly, protocolSend, and protocolReceive steps. -/
structure ReceiveBoundaryDraftHandle
    (State Action Ctx Payload : Type)
    (EndpointStateId EndpointTransitionId LabelId PeerId MessageId : Type) where
  /-- Parent cursor captured at draft creation. -/
  baseCursor : Nat
  /-- Boundary snapshot captured at draft creation. -/
  baseSnapshot : BoundarySnapshot State Ctx EndpointStateId
  /-- Append-only trace of receive-capable boundary-selected steps. -/
  trace : List (ReceiveBoundarySelectedStep State Action Ctx Payload EndpointStateId EndpointTransitionId LabelId PeerId MessageId)
