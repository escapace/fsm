/-
  Protocol-boundary receive-side dispatch function and helper lemmas.

  Defines: boundaryReceive, the receive-side boundary operation.
  Parallels ProtocolDispatch.lean for the send side.

  The receive-side boundary operation checks endpoint legality before
  accepting the corresponding local machine step, following the
  endpoint-check-first design from the Phase 2 semantic spec.
-/
import ProtocolReceiveDefs
import ProtocolDispatch

variable {State Action Ctx Payload : Type}
variable {LabelId PeerId MessageId EndpointStateId EndpointTransitionId : Type}
variable [DecidableEq EndpointStateId]
variable [DecidableEq LabelId] [DecidableEq PeerId] [DecidableEq MessageId]
variable [DecidableEq Direction]

/-! ### Receive-side boundary operation -/

/-- Receive-side boundary operation.

    Checks endpoint legality for the receive label before accepting the
    corresponding local machine step. The `deriveReceiveStep` parameter
    is an opaque mapping from (machineSnapshot, receiveEvent) to a local
    machine step result.

    On success, the returned rule and info determine the post-machine
    state via `applySelected`, and the endpoint state advances to the
    selected endpoint transition's target. -/
def boundaryReceive
    (e : EndpointAutomaton EndpointStateId EndpointTransitionId LabelId PeerId MessageId)
    (bsnap : BoundarySnapshot State Ctx EndpointStateId)
    (recv : ExternalReceiveEvent LabelId PeerId MessageId Payload)
    (deriveReceiveStep : Snapshot State Ctx →
      ExternalReceiveEvent LabelId PeerId MessageId Payload →
      ReceiveMachineResult State Action Ctx Payload)
    : BoundaryReceiveResult State Action Ctx Payload EndpointStateId EndpointTransitionId LabelId PeerId MessageId :=
  match endpointCandidates e.transitions bsnap.endpointState recv.label with
  | [] => .protocolViolation
  | u :: _ =>
    match deriveReceiveStep bsnap.machineSnapshot recv with
    | .success rule info =>
      let s' := rule.target
      let ctx' := applyReducer rule bsnap.machineSnapshot.context info
      .success
        ⟨⟨s', ctx'⟩, u.target⟩
        ⟨⟨rule, info⟩, .protocolReceive, .some u, .some recv.label, .some recv⟩
    | .machineFailure => .machineFailure
    | .unknownAction => .unknownAction

/-! ### Helper lemmas for boundaryReceive -/

/-- If boundaryReceive returns protocolViolation, the endpoint candidates
    for the receive label are empty. -/
theorem boundaryReceive_protocolViolation_fwd
    {e : EndpointAutomaton EndpointStateId EndpointTransitionId LabelId PeerId MessageId}
    {bsnap : BoundarySnapshot State Ctx EndpointStateId}
    {recv : ExternalReceiveEvent LabelId PeerId MessageId Payload}
    {deriveReceiveStep : Snapshot State Ctx →
      ExternalReceiveEvent LabelId PeerId MessageId Payload →
      ReceiveMachineResult State Action Ctx Payload}
    (h : boundaryReceive e bsnap recv deriveReceiveStep = .protocolViolation) :
    endpointCandidates e.transitions bsnap.endpointState recv.label = [] := by
  unfold boundaryReceive at h
  split at h
  · assumption
  · split at h <;> simp at h

/-- If the endpoint candidates for the receive label are empty,
    boundaryReceive returns protocolViolation. -/
theorem boundaryReceive_protocolViolation_rev
    {e : EndpointAutomaton EndpointStateId EndpointTransitionId LabelId PeerId MessageId}
    {bsnap : BoundarySnapshot State Ctx EndpointStateId}
    {recv : ExternalReceiveEvent LabelId PeerId MessageId Payload}
    {deriveReceiveStep : Snapshot State Ctx →
      ExternalReceiveEvent LabelId PeerId MessageId Payload →
      ReceiveMachineResult State Action Ctx Payload}
    (hempty : endpointCandidates e.transitions bsnap.endpointState recv.label = []) :
    boundaryReceive e bsnap recv deriveReceiveStep = .protocolViolation := by
  simp only [boundaryReceive, hempty]

/-- If boundaryReceive returns unknownAction, the endpoint candidates
    are non-empty and the machine mapping returned unknownAction. -/
theorem boundaryReceive_unknownAction
    {e : EndpointAutomaton EndpointStateId EndpointTransitionId LabelId PeerId MessageId}
    {bsnap : BoundarySnapshot State Ctx EndpointStateId}
    {recv : ExternalReceiveEvent LabelId PeerId MessageId Payload}
    {deriveReceiveStep : Snapshot State Ctx →
      ExternalReceiveEvent LabelId PeerId MessageId Payload →
      ReceiveMachineResult State Action Ctx Payload}
    (h : boundaryReceive e bsnap recv deriveReceiveStep = .unknownAction) :
    ∃ u rest,
      endpointCandidates e.transitions bsnap.endpointState recv.label = u :: rest ∧
      deriveReceiveStep bsnap.machineSnapshot recv = .unknownAction := by
  unfold boundaryReceive at h
  split at h
  · simp at h
  · rename_i u rest heq
    split at h
    · simp at h
    · simp at h
    · rename_i hmach
      exact ⟨u, rest, heq, hmach⟩

/-- If boundaryReceive returns machineFailure, the endpoint candidates
    are non-empty and the machine mapping returned machineFailure. -/
theorem boundaryReceive_machineFailure
    {e : EndpointAutomaton EndpointStateId EndpointTransitionId LabelId PeerId MessageId}
    {bsnap : BoundarySnapshot State Ctx EndpointStateId}
    {recv : ExternalReceiveEvent LabelId PeerId MessageId Payload}
    {deriveReceiveStep : Snapshot State Ctx →
      ExternalReceiveEvent LabelId PeerId MessageId Payload →
      ReceiveMachineResult State Action Ctx Payload}
    (h : boundaryReceive e bsnap recv deriveReceiveStep = .machineFailure) :
    ∃ u rest,
      endpointCandidates e.transitions bsnap.endpointState recv.label = u :: rest ∧
      deriveReceiveStep bsnap.machineSnapshot recv = .machineFailure := by
  unfold boundaryReceive at h
  split at h
  · simp at h
  · rename_i u rest heq
    split at h
    · simp at h
    · rename_i hmach
      exact ⟨u, rest, heq, hmach⟩
    · simp at h

/-- Extract success components from a boundaryReceive success. -/
theorem boundaryReceive_success_components
    {e : EndpointAutomaton EndpointStateId EndpointTransitionId LabelId PeerId MessageId}
    {bsnap : BoundarySnapshot State Ctx EndpointStateId}
    {recv : ExternalReceiveEvent LabelId PeerId MessageId Payload}
    {deriveReceiveStep : Snapshot State Ctx →
      ExternalReceiveEvent LabelId PeerId MessageId Payload →
      ReceiveMachineResult State Action Ctx Payload}
    {newSnap : BoundarySnapshot State Ctx EndpointStateId}
    {bstep : ReceiveBoundarySelectedStep State Action Ctx Payload EndpointStateId EndpointTransitionId LabelId PeerId MessageId}
    (h : boundaryReceive e bsnap recv deriveReceiveStep = .success newSnap bstep) :
    ∃ u rest rule info,
      endpointCandidates e.transitions bsnap.endpointState recv.label = u :: rest ∧
      deriveReceiveStep bsnap.machineSnapshot recv = .success rule info ∧
      bstep.eventKind = .protocolReceive ∧
      bstep.endpointTransition = .some u ∧
      bstep.protocolLabel = .some recv.label ∧
      bstep.externalReceive = .some recv ∧
      newSnap.endpointState = u.target := by
  unfold boundaryReceive at h
  split at h
  · simp at h
  · rename_i u rest heq
    split at h
    · rename_i rule info hmach
      simp [BoundaryReceiveResult.success.injEq] at h
      obtain ⟨rfl, rfl⟩ := h
      exact ⟨u, rest, rule, info, heq, hmach, rfl, rfl, rfl, rfl, rfl⟩
    · simp at h
    · simp at h
