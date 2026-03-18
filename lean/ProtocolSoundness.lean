/-
  Protocol-boundary soundness theorems.

  PB1 — Boundary determinism
  PB2 — Local-only preservation
  PB3 — Protocol-send soundness
  PB4 — Protocol-violation characterization

  PB5 is in ProtocolReplay.lean.
  PB6, PB7, PB7a, PB8 are in ProtocolDraft.lean.
-/
import ProtocolDraft

variable {State Action Ctx Payload : Type}
variable {LabelId PeerId MessageId EndpointStateId EndpointTransitionId : Type}
variable [DecidableEq State] [DecidableEq Action]
variable [DecidableEq EndpointStateId]
variable [DecidableEq LabelId] [DecidableEq PeerId] [DecidableEq MessageId]
variable [DecidableEq Direction]

/-! ### PB1 — Boundary determinism -/

/-- **PB1.** Boundary dispatch is deterministic: the same inputs always
    produce the same result. -/
theorem boundaryDispatch_deterministic
    (m : Machine State Action Ctx Payload)
    (e : EndpointAutomaton EndpointStateId EndpointTransitionId LabelId PeerId MessageId)
    (bsnap : BoundarySnapshot State Ctx EndpointStateId)
    (a : Action) (p : Payload)
    (deriveEffect : SelectedStep State Action Ctx Payload →
      ProtocolEffect LabelId PeerId MessageId) :
    boundaryDispatch m e bsnap a p deriveEffect =
    boundaryDispatch m e bsnap a p deriveEffect := rfl

/-! ### PB2 — Local-only preservation -/

/-- **PB2.** If boundary dispatch succeeds with `eventKind = localOnly`,
    the endpoint state is unchanged and the machine snapshot matches the
    post-local-dispatch result. -/
theorem boundaryDispatch_localOnly_preservation
    {m : Machine State Action Ctx Payload}
    {e : EndpointAutomaton EndpointStateId EndpointTransitionId LabelId PeerId MessageId}
    {bsnap : BoundarySnapshot State Ctx EndpointStateId}
    {a : Action} {p : Payload}
    {deriveEffect : SelectedStep State Action Ctx Payload →
      ProtocolEffect LabelId PeerId MessageId}
    {newSnap : BoundarySnapshot State Ctx EndpointStateId}
    {bstep : BoundarySelectedStep State Action Ctx Payload EndpointStateId EndpointTransitionId LabelId PeerId MessageId}
    (h : boundaryDispatch m e bsnap a p deriveEffect = .success newSnap bstep)
    (hlocal : bstep.eventKind = .localOnly) :
    newSnap.endpointState = bsnap.endpointState ∧
    (∃ s' ctx' rule info,
      dispatch m bsnap.machineSnapshot.state bsnap.machineSnapshot.context a p
        = .success s' ctx' rule info ∧
      newSnap.machineSnapshot = ⟨s', ctx'⟩) := by
  unfold boundaryDispatch at h
  split at h
  · -- unknownAction
    simp at h
  · -- failure
    simp at h
  · rename_i s' ctx' rule info heq
    unfold resolveBoundaryEffect at h
    split at h
    · -- deriveEffect = none → localOnly
      simp [BoundaryDispatchResult.success.injEq] at h
      obtain ⟨rfl, rfl⟩ := h
      exact ⟨rfl, s', ctx', rule, info, heq, rfl⟩
    · -- deriveEffect = send ℓ
      rename_i ℓ _
      split at h
      · -- protocolViolation
        simp at h
      · -- protocolSend success
        simp [BoundaryDispatchResult.success.injEq] at h
        obtain ⟨_, hstep_eq⟩ := h
        -- bstep.eventKind = protocolSend, contradicts hlocal
        have : bstep.eventKind = .protocolSend := by rw [← hstep_eq]
        simp [this] at hlocal

/-! ### PB3 — Protocol-send soundness -/

/-- **PB3.** If boundary dispatch succeeds with `eventKind = protocolSend`,
    the selected endpoint transition belongs to the endpoint candidates
    for the pre-dispatch endpoint state and the emitted label. -/
theorem boundaryDispatch_protocolSend_soundness
    {m : Machine State Action Ctx Payload}
    {e : EndpointAutomaton EndpointStateId EndpointTransitionId LabelId PeerId MessageId}
    {bsnap : BoundarySnapshot State Ctx EndpointStateId}
    {a : Action} {p : Payload}
    {deriveEffect : SelectedStep State Action Ctx Payload →
      ProtocolEffect LabelId PeerId MessageId}
    {newSnap : BoundarySnapshot State Ctx EndpointStateId}
    {bstep : BoundarySelectedStep State Action Ctx Payload EndpointStateId EndpointTransitionId LabelId PeerId MessageId}
    (h : boundaryDispatch m e bsnap a p deriveEffect = .success newSnap bstep)
    (hsend : bstep.eventKind = .protocolSend) :
    ∃ u ℓ,
      bstep.endpointTransition = some u ∧
      bstep.protocolLabel = some ℓ ∧
      u ∈ endpointCandidates e.transitions bsnap.endpointState ℓ ∧
      newSnap.endpointState = u.target := by
  unfold boundaryDispatch at h
  split at h
  · simp at h
  · simp at h
  · rename_i s' ctx' rule info heq
    unfold resolveBoundaryEffect at h
    split at h
    · -- deriveEffect = none → localOnly, contradicts hsend
      simp [BoundaryDispatchResult.success.injEq] at h
      obtain ⟨_, hstep_eq⟩ := h
      have : bstep.eventKind = .localOnly := by rw [← hstep_eq]
      simp [this] at hsend
    · -- deriveEffect = send ℓ
      rename_i ℓ _
      split at h
      · simp at h
      · -- endpoint candidates non-empty → first candidate selected
        rename_i u rest heq_cands
        simp [BoundaryDispatchResult.success.injEq] at h
        obtain ⟨hsnap_eq, hstep_eq⟩ := h
        refine ⟨u, ℓ, ?_, ?_, ?_, ?_⟩
        · rw [← hstep_eq]
        · rw [← hstep_eq]
        · rw [heq_cands]; exact .head rest
        · rw [← hsnap_eq]

/-! ### PB4 — Protocol-violation characterization -/

/-- **PB4 forward.** If boundary dispatch returns `protocolViolation`, then
    local dispatch succeeded, `deriveEffect` returned a send label, and the
    endpoint candidates for that label are empty. -/
theorem boundaryDispatch_protocolViolation_fwd
    {m : Machine State Action Ctx Payload}
    {e : EndpointAutomaton EndpointStateId EndpointTransitionId LabelId PeerId MessageId}
    {bsnap : BoundarySnapshot State Ctx EndpointStateId}
    {a : Action} {p : Payload}
    {deriveEffect : SelectedStep State Action Ctx Payload →
      ProtocolEffect LabelId PeerId MessageId}
    (h : boundaryDispatch m e bsnap a p deriveEffect = .protocolViolation) :
    ∃ s' ctx' rule info ℓ,
      dispatch m bsnap.machineSnapshot.state bsnap.machineSnapshot.context a p
        = .success s' ctx' rule info ∧
      deriveEffect ⟨rule, info⟩ = .send ℓ ∧
      endpointCandidates e.transitions bsnap.endpointState ℓ = [] := by
  unfold boundaryDispatch at h
  split at h
  · simp at h
  · simp at h
  · rename_i s' ctx' rule info heq
    unfold resolveBoundaryEffect at h
    split at h
    · simp at h
    · rename_i ℓ heff
      split at h
      · rename_i hempty
        exact ⟨s', ctx', rule, info, ℓ, heq, heff, hempty⟩
      · simp at h

/-- **PB4 reverse.** If local dispatch succeeds, `deriveEffect` returns
    `send(ℓ)`, and endpoint candidates are empty, then boundary dispatch
    returns `protocolViolation`. -/
theorem boundaryDispatch_protocolViolation_rev
    {m : Machine State Action Ctx Payload}
    {e : EndpointAutomaton EndpointStateId EndpointTransitionId LabelId PeerId MessageId}
    {bsnap : BoundarySnapshot State Ctx EndpointStateId}
    {a : Action} {p : Payload}
    {deriveEffect : SelectedStep State Action Ctx Payload →
      ProtocolEffect LabelId PeerId MessageId}
    {s' : State} {ctx' : Ctx}
    {rule : TransitionRule State Action Ctx Payload}
    {info : ActionInfo State Action Payload}
    {ℓ : ProtocolLabel LabelId PeerId MessageId}
    (hdisp : dispatch m bsnap.machineSnapshot.state bsnap.machineSnapshot.context a p
              = .success s' ctx' rule info)
    (heff : deriveEffect ⟨rule, info⟩ = .send ℓ)
    (hempty : endpointCandidates e.transitions bsnap.endpointState ℓ = []) :
    boundaryDispatch m e bsnap a p deriveEffect = .protocolViolation := by
  simp only [boundaryDispatch, hdisp, resolveBoundaryEffect, heff, hempty]

/-- **PB4 iff.** Boundary dispatch returns `protocolViolation` if and only if
    local dispatch succeeded with a send effect whose endpoint candidates
    are empty. -/
theorem boundaryDispatch_protocolViolation_iff
    {m : Machine State Action Ctx Payload}
    {e : EndpointAutomaton EndpointStateId EndpointTransitionId LabelId PeerId MessageId}
    {bsnap : BoundarySnapshot State Ctx EndpointStateId}
    {a : Action} {p : Payload}
    {deriveEffect : SelectedStep State Action Ctx Payload →
      ProtocolEffect LabelId PeerId MessageId} :
    boundaryDispatch m e bsnap a p deriveEffect = .protocolViolation ↔
    ∃ s' ctx' rule info ℓ,
      dispatch m bsnap.machineSnapshot.state bsnap.machineSnapshot.context a p
        = .success s' ctx' rule info ∧
      deriveEffect ⟨rule, info⟩ = .send ℓ ∧
      endpointCandidates e.transitions bsnap.endpointState ℓ = [] := by
  constructor
  · exact boundaryDispatch_protocolViolation_fwd
  · intro ⟨s', ctx', rule, info, ℓ, hdisp, heff, hempty⟩
    exact boundaryDispatch_protocolViolation_rev hdisp heff hempty
