/-
  Protocol-boundary receive-aware draft semantics.

  Defines receive-aware boundary draft operations and proves:
  - PR6: receive-aware draft trace invariant
  - PR7: receive-aware root commit replay soundness
  - PR7a: empty-trace root commit remains a no-op

  Parallels ProtocolDraft.lean for the version-one layer.
-/
import ProtocolReceiveReplay

variable {State Action Ctx Payload : Type}
variable {LabelId PeerId MessageId EndpointStateId EndpointTransitionId : Type}

/-! ### Receive-aware boundary draft handle operations -/

/-- The current snapshot of a receive-aware boundary draft:
    replay the receive-capable trace from the base snapshot. -/
def ReceiveBoundaryDraftHandle.currentSnapshot
    (d : ReceiveBoundaryDraftHandle State Action Ctx Payload EndpointStateId EndpointTransitionId LabelId PeerId MessageId)
    : BoundarySnapshot State Ctx EndpointStateId :=
  replayReceiveBoundaryTrace d.baseSnapshot d.trace

/-- The head cursor of a receive-aware boundary draft:
    base cursor plus trace length. -/
def ReceiveBoundaryDraftHandle.headCursor
    (d : ReceiveBoundaryDraftHandle State Action Ctx Payload EndpointStateId EndpointTransitionId LabelId PeerId MessageId)
    : Nat :=
  d.baseCursor + d.trace.length

/-- Create a receive-aware root boundary draft from the current boundary
    service state. -/
def mkRootReceiveBoundaryDraft
    (svc : BoundaryServiceState State Ctx EndpointStateId)
    : ReceiveBoundaryDraftHandle State Action Ctx Payload EndpointStateId EndpointTransitionId LabelId PeerId MessageId :=
  { baseCursor := svc.cursor
  , baseSnapshot := svc.snapshot
  , trace := [] }

/-- Extend a receive-aware boundary draft's trace with a new
    receive-capable boundary-selected step. -/
def ReceiveBoundaryDraftHandle.appendStep
    (d : ReceiveBoundaryDraftHandle State Action Ctx Payload EndpointStateId EndpointTransitionId LabelId PeerId MessageId)
    (bstep : ReceiveBoundarySelectedStep State Action Ctx Payload EndpointStateId EndpointTransitionId LabelId PeerId MessageId)
    : ReceiveBoundaryDraftHandle State Action Ctx Payload EndpointStateId EndpointTransitionId LabelId PeerId MessageId :=
  { d with trace := d.trace ++ [bstep] }

/-- Attempt to commit a receive-aware root boundary draft into the
    boundary service. Replays the receive-capable boundary trace onto the
    service snapshot and advances the cursor. Fails with `outOfDate` when
    the service cursor has moved. -/
def commitRootReceiveBoundaryDraft
    (svc : BoundaryServiceState State Ctx EndpointStateId)
    (d : ReceiveBoundaryDraftHandle State Action Ctx Payload EndpointStateId EndpointTransitionId LabelId PeerId MessageId)
    : BoundaryRootCommitResult State Ctx EndpointStateId :=
  if svc.cursor = d.baseCursor then
    .success ⟨replayReceiveBoundaryTrace svc.snapshot d.trace, svc.cursor + d.trace.length⟩
  else
    .outOfDate

/-! ### Basic simp lemmas -/

@[simp]
theorem mkRootReceiveBoundaryDraft_baseCursor (svc : BoundaryServiceState State Ctx EndpointStateId) :
    (mkRootReceiveBoundaryDraft svc :
      ReceiveBoundaryDraftHandle State Action Ctx Payload EndpointStateId EndpointTransitionId LabelId PeerId MessageId).baseCursor
    = svc.cursor := rfl

@[simp]
theorem mkRootReceiveBoundaryDraft_baseSnapshot (svc : BoundaryServiceState State Ctx EndpointStateId) :
    (mkRootReceiveBoundaryDraft svc :
      ReceiveBoundaryDraftHandle State Action Ctx Payload EndpointStateId EndpointTransitionId LabelId PeerId MessageId).baseSnapshot
    = svc.snapshot := rfl

@[simp]
theorem mkRootReceiveBoundaryDraft_trace (svc : BoundaryServiceState State Ctx EndpointStateId) :
    (mkRootReceiveBoundaryDraft svc :
      ReceiveBoundaryDraftHandle State Action Ctx Payload EndpointStateId EndpointTransitionId LabelId PeerId MessageId).trace
    = [] := rfl

@[simp]
theorem mkRootReceiveBoundaryDraft_currentSnapshot (svc : BoundaryServiceState State Ctx EndpointStateId) :
    (mkRootReceiveBoundaryDraft svc :
      ReceiveBoundaryDraftHandle State Action Ctx Payload EndpointStateId EndpointTransitionId LabelId PeerId MessageId).currentSnapshot
    = svc.snapshot := by
  simp [ReceiveBoundaryDraftHandle.currentSnapshot, mkRootReceiveBoundaryDraft]

@[simp]
theorem receive_appendStep_baseCursor
    (d : ReceiveBoundaryDraftHandle State Action Ctx Payload EndpointStateId EndpointTransitionId LabelId PeerId MessageId)
    (bstep : ReceiveBoundarySelectedStep State Action Ctx Payload EndpointStateId EndpointTransitionId LabelId PeerId MessageId) :
    (d.appendStep bstep).baseCursor = d.baseCursor := rfl

@[simp]
theorem receive_appendStep_baseSnapshot
    (d : ReceiveBoundaryDraftHandle State Action Ctx Payload EndpointStateId EndpointTransitionId LabelId PeerId MessageId)
    (bstep : ReceiveBoundarySelectedStep State Action Ctx Payload EndpointStateId EndpointTransitionId LabelId PeerId MessageId) :
    (d.appendStep bstep).baseSnapshot = d.baseSnapshot := rfl

@[simp]
theorem receive_appendStep_trace
    (d : ReceiveBoundaryDraftHandle State Action Ctx Payload EndpointStateId EndpointTransitionId LabelId PeerId MessageId)
    (bstep : ReceiveBoundarySelectedStep State Action Ctx Payload EndpointStateId EndpointTransitionId LabelId PeerId MessageId) :
    (d.appendStep bstep).trace = d.trace ++ [bstep] := rfl

/-! ### Stale commit rejection -/

/-- Stale receive-aware boundary commit rejection. If the service cursor
    differs from the draft's base cursor, root commit rejects with `outOfDate`. -/
theorem stale_receive_boundary_commit_rejection
    {svc : BoundaryServiceState State Ctx EndpointStateId}
    {d : ReceiveBoundaryDraftHandle State Action Ctx Payload EndpointStateId EndpointTransitionId LabelId PeerId MessageId}
    (h : svc.cursor ≠ d.baseCursor) :
    commitRootReceiveBoundaryDraft svc d = .outOfDate := by
  unfold commitRootReceiveBoundaryDraft
  rw [if_neg h]

/-! ### PR7 — Receive-aware root commit replay soundness -/

/-- **PR7.** If the service cursor matches the draft's base cursor and the
    service snapshot equals the draft's base snapshot, then receive-aware
    root boundary commit succeeds and the resulting service snapshot equals
    the draft's current snapshot with cursor advanced by the trace length. -/
theorem receive_root_commit_replay_soundness
    {svc : BoundaryServiceState State Ctx EndpointStateId}
    {d : ReceiveBoundaryDraftHandle State Action Ctx Payload EndpointStateId EndpointTransitionId LabelId PeerId MessageId}
    (hcursor : svc.cursor = d.baseCursor)
    (hsnap : svc.snapshot = d.baseSnapshot) :
    commitRootReceiveBoundaryDraft svc d
      = .success ⟨d.currentSnapshot, svc.cursor + d.trace.length⟩ := by
  unfold commitRootReceiveBoundaryDraft
  rw [if_pos hcursor, hsnap]
  rfl

/-! ### PR7a — Empty-trace root commit remains a no-op -/

/-- **PR7a.** If a receive-aware root boundary draft has an empty trace and
    the service cursor and snapshot still match, then root commit is a no-op. -/
theorem receive_root_commit_empty_trace
    {svc : BoundaryServiceState State Ctx EndpointStateId}
    {d : ReceiveBoundaryDraftHandle State Action Ctx Payload EndpointStateId EndpointTransitionId LabelId PeerId MessageId}
    (hcursor : svc.cursor = d.baseCursor)
    (hsnap : svc.snapshot = d.baseSnapshot)
    (hempty : d.trace = []) :
    commitRootReceiveBoundaryDraft svc d = .success ⟨svc.snapshot, svc.cursor⟩ := by
  rw [receive_root_commit_replay_soundness hcursor hsnap]
  simp [ReceiveBoundaryDraftHandle.currentSnapshot, hempty, hsnap]

/-- When a receive-aware root boundary draft was created from a service and
    the service has not advanced, commit is guaranteed to succeed. -/
theorem receive_root_commit_from_mkRootReceiveBoundaryDraft
    {svc : BoundaryServiceState State Ctx EndpointStateId} :
    commitRootReceiveBoundaryDraft svc
      (mkRootReceiveBoundaryDraft svc :
        ReceiveBoundaryDraftHandle State Action Ctx Payload EndpointStateId EndpointTransitionId LabelId PeerId MessageId)
    = .success ⟨svc.snapshot, svc.cursor⟩ := by
  simp [commitRootReceiveBoundaryDraft, mkRootReceiveBoundaryDraft]

/-! ### PR6 — Receive-aware draft trace invariant -/

section PR6

variable [DecidableEq EndpointStateId]
variable [DecidableEq LabelId] [DecidableEq PeerId] [DecidableEq MessageId]
variable [DecidableEq Direction]

/-- **PR6.** If receive-side boundary operation against the draft's current
    snapshot succeeds, appending the boundary-selected step to the trace yields
    a draft whose current snapshot equals the post-operation boundary snapshot. -/
theorem receive_draft_trace_invariant
    {e : EndpointAutomaton EndpointStateId EndpointTransitionId LabelId PeerId MessageId}
    {d : ReceiveBoundaryDraftHandle State Action Ctx Payload EndpointStateId EndpointTransitionId LabelId PeerId MessageId}
    {recv : ExternalReceiveEvent LabelId PeerId MessageId Payload}
    {deriveReceiveStep : Snapshot State Ctx →
      ExternalReceiveEvent LabelId PeerId MessageId Payload →
      ReceiveMachineResult State Action Ctx Payload}
    {newSnap : BoundarySnapshot State Ctx EndpointStateId}
    {bstep : ReceiveBoundarySelectedStep State Action Ctx Payload EndpointStateId EndpointTransitionId LabelId PeerId MessageId}
    (h : boundaryReceive e d.currentSnapshot recv deriveReceiveStep
          = .success newSnap bstep) :
    (d.appendStep bstep).currentSnapshot = newSnap := by
  simp [ReceiveBoundaryDraftHandle.currentSnapshot, ReceiveBoundaryDraftHandle.appendStep,
        replayReceiveBoundaryTrace_append]
  exact applyReceiveBoundarySelected_eq_boundaryReceive_success h

end PR6
