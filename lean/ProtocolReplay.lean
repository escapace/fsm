/-
  Protocol-boundary replay primitives.

  Defines applyBoundarySelected and replayBoundaryTrace.
  Parallels Replay.lean for the EFSM layer.

  PB5 (boundary replay equivalence) is proved here.
-/
import ProtocolDispatch

variable {State Action Ctx Payload : Type}
variable {LabelId PeerId MessageId EndpointStateId EndpointTransitionId : Type}

/-! ### Boundary step application -/

/-- Apply a boundary-selected step to a boundary snapshot.

    - localOnly: apply the machine step, leave endpoint state unchanged.
    - protocolSend: apply the machine step, advance endpoint state to
      the recorded endpoint transition's target.

    Replay consumes the recorded step directly — no endpoint candidate
    selection or protocol legality checking. -/
def applyBoundarySelected
    (bsnap : BoundarySnapshot State Ctx EndpointStateId)
    (bstep : BoundarySelectedStep State Action Ctx Payload EndpointStateId EndpointTransitionId LabelId PeerId MessageId)
    : BoundarySnapshot State Ctx EndpointStateId :=
  let msnap' := applySelected bsnap.machineSnapshot bstep.machineStep
  match bstep.eventKind, bstep.endpointTransition with
  | .localOnly, _ => ⟨msnap', bsnap.endpointState⟩
  | .protocolSend, some u => ⟨msnap', u.target⟩
  | .protocolSend, none => ⟨msnap', bsnap.endpointState⟩  -- degenerate: should not occur for well-formed steps

/-! ### Boundary trace replay -/

/-- Replay a trace of boundary-selected steps from an initial boundary snapshot.
    Left fold of `applyBoundarySelected`. -/
def replayBoundaryTrace
    : BoundarySnapshot State Ctx EndpointStateId
    → List (BoundarySelectedStep State Action Ctx Payload EndpointStateId EndpointTransitionId LabelId PeerId MessageId)
    → BoundarySnapshot State Ctx EndpointStateId
  | bsnap, [] => bsnap
  | bsnap, bstep :: rest => replayBoundaryTrace (applyBoundarySelected bsnap bstep) rest

/-! ### Basic replayBoundaryTrace lemmas -/

@[simp]
theorem replayBoundaryTrace_nil (bsnap : BoundarySnapshot State Ctx EndpointStateId) :
    replayBoundaryTrace bsnap
      ([] : List (BoundarySelectedStep State Action Ctx Payload EndpointStateId EndpointTransitionId LabelId PeerId MessageId))
    = bsnap := rfl

@[simp]
theorem replayBoundaryTrace_cons
    (bsnap : BoundarySnapshot State Ctx EndpointStateId)
    (bstep : BoundarySelectedStep State Action Ctx Payload EndpointStateId EndpointTransitionId LabelId PeerId MessageId)
    (rest : List (BoundarySelectedStep State Action Ctx Payload EndpointStateId EndpointTransitionId LabelId PeerId MessageId)) :
    replayBoundaryTrace bsnap (bstep :: rest) =
    replayBoundaryTrace (applyBoundarySelected bsnap bstep) rest := rfl

/-- Replaying a concatenated trace equals replaying each part sequentially. -/
theorem replayBoundaryTrace_append
    (bsnap : BoundarySnapshot State Ctx EndpointStateId)
    (t₁ t₂ : List (BoundarySelectedStep State Action Ctx Payload EndpointStateId EndpointTransitionId LabelId PeerId MessageId)) :
    replayBoundaryTrace bsnap (t₁ ++ t₂) =
    replayBoundaryTrace (replayBoundaryTrace bsnap t₁) t₂ := by
  induction t₁ generalizing bsnap with
  | nil => simp
  | cons step rest ih => simp [ih]

/-! ### PB5 — Boundary replay equivalence

If boundary dispatch succeeds with post-boundary snapshot `newSnap` and
recorded step `bstep`, then `applyBoundarySelected(preSnap, bstep) = newSnap`. -/

variable [DecidableEq State] [DecidableEq Action]
variable [DecidableEq EndpointStateId]
variable [DecidableEq LabelId] [DecidableEq PeerId] [DecidableEq MessageId]
variable [DecidableEq Direction]

/-- **PB5.** Boundary replay equivalence: applying the recorded boundary-selected
    step to the pre-dispatch boundary snapshot yields the post-dispatch
    boundary snapshot. -/
theorem applyBoundarySelected_eq_boundaryDispatch_success
    {m : Machine State Action Ctx Payload}
    {e : EndpointAutomaton EndpointStateId EndpointTransitionId LabelId PeerId MessageId}
    {bsnap : BoundarySnapshot State Ctx EndpointStateId}
    {a : Action} {p : Payload}
    {deriveEffect : SelectedStep State Action Ctx Payload →
      ProtocolEffect LabelId PeerId MessageId}
    {newSnap : BoundarySnapshot State Ctx EndpointStateId}
    {bstep : BoundarySelectedStep State Action Ctx Payload EndpointStateId EndpointTransitionId LabelId PeerId MessageId}
    (h : boundaryDispatch m e bsnap a p deriveEffect = .success newSnap bstep) :
    applyBoundarySelected bsnap bstep = newSnap := by
  unfold boundaryDispatch at h
  split at h
  · exact absurd h (by simp)
  · exact absurd h (by simp)
  · rename_i s' ctx' rule info heq
    -- local dispatch succeeded, now match on resolveBoundaryEffect
    unfold resolveBoundaryEffect at h
    split at h
    · -- deriveEffect = none → localOnly
      simp [BoundaryDispatchResult.success.injEq] at h
      obtain ⟨rfl, rfl⟩ := h
      simp [applyBoundarySelected, applySelected_eq_dispatch_success heq]
    · -- deriveEffect = send ℓ
      rename_i ℓ _
      split at h
      · -- endpointCandidates empty → protocolViolation
        exact absurd h (by simp)
      · -- endpointCandidates non-empty → protocolSend success
        simp [BoundaryDispatchResult.success.injEq] at h
        obtain ⟨rfl, rfl⟩ := h
        simp [applyBoundarySelected, applySelected_eq_dispatch_success heq]
