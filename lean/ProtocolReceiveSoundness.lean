/-
  Protocol-boundary receive-side soundness theorems.

  PR1 — Receive-boundary determinism
  PR2 — Receive legality soundness
  PR3 — Receive-violation characterization

  PR4 is in ProtocolReceiveReplay.lean.
  PR5 is in ProtocolReceiveReplay.lean.
  PR6, PR7, PR7a are in ProtocolReceiveDraft.lean.
-/
import ProtocolReceiveDraft

variable {State Action Ctx Payload : Type}
variable {LabelId PeerId MessageId EndpointStateId EndpointTransitionId : Type}
variable [DecidableEq EndpointStateId]
variable [DecidableEq LabelId] [DecidableEq PeerId] [DecidableEq MessageId]
variable [DecidableEq Direction]

/-! ### PR1 — Receive-boundary determinism -/

/-- **PR1.** Receive-side boundary dispatch is deterministic: the same inputs
    always produce the same result. -/
theorem boundaryReceive_deterministic
    (e : EndpointAutomaton EndpointStateId EndpointTransitionId LabelId PeerId MessageId)
    (bsnap : BoundarySnapshot State Ctx EndpointStateId)
    (recv : ExternalReceiveEvent LabelId PeerId MessageId Payload)
    (deriveReceiveStep : Snapshot State Ctx →
      ExternalReceiveEvent LabelId PeerId MessageId Payload →
      ReceiveMachineResult State Action Ctx Payload) :
    boundaryReceive e bsnap recv deriveReceiveStep =
    boundaryReceive e bsnap recv deriveReceiveStep := rfl

/-! ### PR2 — Receive legality soundness -/

/-- **PR2.** If the receive-side boundary operation succeeds with
    `eventKind = protocolReceive` and emitted label `ℓ`, then the selected
    endpoint transition belongs to `endpointCandidates` for the pre-operation
    endpoint state and label, and the post-operation endpoint state equals
    the transition's target. -/
theorem boundaryReceive_protocolReceive_soundness
    {e : EndpointAutomaton EndpointStateId EndpointTransitionId LabelId PeerId MessageId}
    {bsnap : BoundarySnapshot State Ctx EndpointStateId}
    {recv : ExternalReceiveEvent LabelId PeerId MessageId Payload}
    {deriveReceiveStep : Snapshot State Ctx →
      ExternalReceiveEvent LabelId PeerId MessageId Payload →
      ReceiveMachineResult State Action Ctx Payload}
    {newSnap : BoundarySnapshot State Ctx EndpointStateId}
    {bstep : ReceiveBoundarySelectedStep State Action Ctx Payload EndpointStateId EndpointTransitionId LabelId PeerId MessageId}
    (h : boundaryReceive e bsnap recv deriveReceiveStep = .success newSnap bstep)
    (_hrecv : bstep.eventKind = .protocolReceive) :
    ∃ u ℓ,
      bstep.endpointTransition = some u ∧
      bstep.protocolLabel = some ℓ ∧
      u ∈ endpointCandidates e.transitions bsnap.endpointState ℓ ∧
      newSnap.endpointState = u.target := by
  unfold boundaryReceive at h
  split at h
  · simp at h
  · rename_i u rest heq_cands
    split at h
    · rename_i rule info hmach
      simp [BoundaryReceiveResult.success.injEq] at h
      obtain ⟨hsnap_eq, hstep_eq⟩ := h
      refine ⟨u, recv.label, ?_, ?_, ?_, ?_⟩
      · rw [← hstep_eq]
      · rw [← hstep_eq]
      · rw [heq_cands]; exact .head rest
      · rw [← hsnap_eq]
    · simp at h
    · simp at h

/-! ### PR3 — Receive-violation characterization -/

/-- **PR3 forward.** If the receive-side boundary operation returns
    `protocolViolation`, then the endpoint candidates for the receive
    label are empty. -/
theorem boundaryReceive_protocolViolation_fwd'
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

/-- **PR3 reverse.** If the endpoint candidates for the receive label
    are empty, the receive-side boundary operation returns `protocolViolation`. -/
theorem boundaryReceive_protocolViolation_rev'
    {e : EndpointAutomaton EndpointStateId EndpointTransitionId LabelId PeerId MessageId}
    {bsnap : BoundarySnapshot State Ctx EndpointStateId}
    {recv : ExternalReceiveEvent LabelId PeerId MessageId Payload}
    {deriveReceiveStep : Snapshot State Ctx →
      ExternalReceiveEvent LabelId PeerId MessageId Payload →
      ReceiveMachineResult State Action Ctx Payload}
    (hempty : endpointCandidates e.transitions bsnap.endpointState recv.label = []) :
    boundaryReceive e bsnap recv deriveReceiveStep = .protocolViolation := by
  simp only [boundaryReceive, hempty]

/-- **PR3 iff.** The receive-side boundary operation returns
    `protocolViolation` if and only if the endpoint candidates for the
    receive label are empty. -/
theorem boundaryReceive_protocolViolation_iff
    {e : EndpointAutomaton EndpointStateId EndpointTransitionId LabelId PeerId MessageId}
    {bsnap : BoundarySnapshot State Ctx EndpointStateId}
    {recv : ExternalReceiveEvent LabelId PeerId MessageId Payload}
    {deriveReceiveStep : Snapshot State Ctx →
      ExternalReceiveEvent LabelId PeerId MessageId Payload →
      ReceiveMachineResult State Action Ctx Payload} :
    boundaryReceive e bsnap recv deriveReceiveStep = .protocolViolation ↔
    endpointCandidates e.transitions bsnap.endpointState recv.label = [] :=
  ⟨boundaryReceive_protocolViolation_fwd', boundaryReceive_protocolViolation_rev'⟩
