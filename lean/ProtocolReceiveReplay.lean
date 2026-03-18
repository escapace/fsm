/-
  Protocol-boundary receive-aware replay primitives.

  Defines applyReceiveBoundarySelected and replayReceiveBoundaryTrace.
  Parallels ProtocolReplay.lean for the version-one layer.

  PR4 (receive replay equivalence) and PR5 (replay append law) are proved here.
-/
import ProtocolReceiveDispatch

variable {State Action Ctx Payload : Type}
variable {LabelId PeerId MessageId EndpointStateId EndpointTransitionId : Type}

/-! ### Receive-aware boundary step application -/

/-- Apply a receive-capable boundary-selected step to a boundary snapshot.

    - localOnly: apply the machine step, leave endpoint state unchanged.
    - protocolSend: apply the machine step, advance endpoint state to
      the recorded endpoint transition's target.
    - protocolReceive: apply the machine step, advance endpoint state to
      the recorded endpoint transition's target.

    Replay consumes the recorded step directly — no endpoint candidate
    selection, legality checking, or receive-to-machine mapping re-execution.
    The externalReceive field is ignored during replay. -/
def applyReceiveBoundarySelected
    (bsnap : BoundarySnapshot State Ctx EndpointStateId)
    (bstep : ReceiveBoundarySelectedStep State Action Ctx Payload EndpointStateId EndpointTransitionId LabelId PeerId MessageId)
    : BoundarySnapshot State Ctx EndpointStateId :=
  let msnap' := applySelected bsnap.machineSnapshot bstep.machineStep
  match bstep.eventKind, bstep.endpointTransition with
  | .localOnly, _ => ⟨msnap', bsnap.endpointState⟩
  | .protocolSend, some u => ⟨msnap', u.target⟩
  | .protocolSend, none => ⟨msnap', bsnap.endpointState⟩    -- degenerate: should not occur for well-formed steps
  | .protocolReceive, some u => ⟨msnap', u.target⟩
  | .protocolReceive, none => ⟨msnap', bsnap.endpointState⟩  -- degenerate: should not occur for well-formed steps

/-! ### Receive-aware boundary trace replay -/

/-- Replay a trace of receive-capable boundary-selected steps from an
    initial boundary snapshot. Left fold of `applyReceiveBoundarySelected`. -/
def replayReceiveBoundaryTrace
    : BoundarySnapshot State Ctx EndpointStateId
    → List (ReceiveBoundarySelectedStep State Action Ctx Payload EndpointStateId EndpointTransitionId LabelId PeerId MessageId)
    → BoundarySnapshot State Ctx EndpointStateId
  | bsnap, [] => bsnap
  | bsnap, bstep :: rest => replayReceiveBoundaryTrace (applyReceiveBoundarySelected bsnap bstep) rest

/-! ### Basic replayReceiveBoundaryTrace lemmas -/

@[simp]
theorem replayReceiveBoundaryTrace_nil (bsnap : BoundarySnapshot State Ctx EndpointStateId) :
    replayReceiveBoundaryTrace bsnap
      ([] : List (ReceiveBoundarySelectedStep State Action Ctx Payload EndpointStateId EndpointTransitionId LabelId PeerId MessageId))
    = bsnap := rfl

@[simp]
theorem replayReceiveBoundaryTrace_cons
    (bsnap : BoundarySnapshot State Ctx EndpointStateId)
    (bstep : ReceiveBoundarySelectedStep State Action Ctx Payload EndpointStateId EndpointTransitionId LabelId PeerId MessageId)
    (rest : List (ReceiveBoundarySelectedStep State Action Ctx Payload EndpointStateId EndpointTransitionId LabelId PeerId MessageId)) :
    replayReceiveBoundaryTrace bsnap (bstep :: rest) =
    replayReceiveBoundaryTrace (applyReceiveBoundarySelected bsnap bstep) rest := rfl

/-! ### PR5 — Replay append law remains valid -/

/-- **PR5.** Replaying a concatenated trace of receive-capable steps equals
    replaying each part sequentially. -/
theorem replayReceiveBoundaryTrace_append
    (bsnap : BoundarySnapshot State Ctx EndpointStateId)
    (t₁ t₂ : List (ReceiveBoundarySelectedStep State Action Ctx Payload EndpointStateId EndpointTransitionId LabelId PeerId MessageId)) :
    replayReceiveBoundaryTrace bsnap (t₁ ++ t₂) =
    replayReceiveBoundaryTrace (replayReceiveBoundaryTrace bsnap t₁) t₂ := by
  induction t₁ generalizing bsnap with
  | nil => simp
  | cons step rest ih => simp [ih]

/-! ### PR4 — Receive replay equivalence

If the receive-side boundary operation succeeds with post-boundary snapshot
`newSnap` and recorded step `bstep`, then
`applyReceiveBoundarySelected(preSnap, bstep) = newSnap`. -/

variable [DecidableEq EndpointStateId]
variable [DecidableEq LabelId] [DecidableEq PeerId] [DecidableEq MessageId]
variable [DecidableEq Direction]

/-- **PR4.** Receive replay equivalence: applying the recorded receive-capable
    boundary-selected step to the pre-operation boundary snapshot yields the
    post-operation boundary snapshot. -/
theorem applyReceiveBoundarySelected_eq_boundaryReceive_success
    {e : EndpointAutomaton EndpointStateId EndpointTransitionId LabelId PeerId MessageId}
    {bsnap : BoundarySnapshot State Ctx EndpointStateId}
    {recv : ExternalReceiveEvent LabelId PeerId MessageId Payload}
    {deriveReceiveStep : Snapshot State Ctx →
      ExternalReceiveEvent LabelId PeerId MessageId Payload →
      ReceiveMachineResult State Action Ctx Payload}
    {newSnap : BoundarySnapshot State Ctx EndpointStateId}
    {bstep : ReceiveBoundarySelectedStep State Action Ctx Payload EndpointStateId EndpointTransitionId LabelId PeerId MessageId}
    (h : boundaryReceive e bsnap recv deriveReceiveStep = .success newSnap bstep) :
    applyReceiveBoundarySelected bsnap bstep = newSnap := by
  unfold boundaryReceive at h
  split at h
  · simp at h
  · rename_i u rest heq_cands
    split at h
    · simp [BoundaryReceiveResult.success.injEq] at h
      obtain ⟨rfl, rfl⟩ := h
      simp [applyReceiveBoundarySelected, applySelected, applyReducer]
    · simp at h
    · simp at h
