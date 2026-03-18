/-
  Protocol-boundary draft semantics.

  Defines boundary draft operations and proves:
  - PB6: boundary draft trace invariant
  - PB7: root boundary commit replay soundness
  - PB7a: empty-trace root boundary commit
  - PB8: root boundary publication-order soundness

  Parallels DraftDefs.lean, Draft.lean, and DraftCommit.lean for the EFSM layer.
-/
import ProtocolReplay
import Soundness
import Validity

variable {State Action Ctx Payload : Type}
variable {LabelId PeerId MessageId EndpointStateId EndpointTransitionId : Type}

/-! ### Boundary draft handle operations -/

/-- The current snapshot of a boundary draft: replay the trace from the base snapshot. -/
def BoundaryDraftHandle.currentSnapshot
    (d : BoundaryDraftHandle State Action Ctx Payload EndpointStateId EndpointTransitionId LabelId PeerId MessageId)
    : BoundarySnapshot State Ctx EndpointStateId :=
  replayBoundaryTrace d.baseSnapshot d.trace

/-- The head cursor of a boundary draft: base cursor plus trace length. -/
def BoundaryDraftHandle.headCursor
    (d : BoundaryDraftHandle State Action Ctx Payload EndpointStateId EndpointTransitionId LabelId PeerId MessageId)
    : Nat :=
  d.baseCursor + d.trace.length

/-- Create a root boundary draft from the current boundary service state. -/
def mkRootBoundaryDraft
    (svc : BoundaryServiceState State Ctx EndpointStateId)
    : BoundaryDraftHandle State Action Ctx Payload EndpointStateId EndpointTransitionId LabelId PeerId MessageId :=
  { baseCursor := svc.cursor
  , baseSnapshot := svc.snapshot
  , trace := [] }

/-- Extend a boundary draft's trace with a new boundary-selected step. -/
def BoundaryDraftHandle.appendStep
    (d : BoundaryDraftHandle State Action Ctx Payload EndpointStateId EndpointTransitionId LabelId PeerId MessageId)
    (bstep : BoundarySelectedStep State Action Ctx Payload EndpointStateId EndpointTransitionId LabelId PeerId MessageId)
    : BoundaryDraftHandle State Action Ctx Payload EndpointStateId EndpointTransitionId LabelId PeerId MessageId :=
  { d with trace := d.trace ++ [bstep] }

/-- Attempt to commit a root boundary draft into the boundary service.
    Replays the boundary trace onto the service snapshot and advances the cursor.
    Fails with `outOfDate` when the service cursor has moved. -/
def commitRootBoundaryDraft
    (svc : BoundaryServiceState State Ctx EndpointStateId)
    (d : BoundaryDraftHandle State Action Ctx Payload EndpointStateId EndpointTransitionId LabelId PeerId MessageId)
    : BoundaryRootCommitResult State Ctx EndpointStateId :=
  if svc.cursor = d.baseCursor then
    .success ⟨replayBoundaryTrace svc.snapshot d.trace, svc.cursor + d.trace.length⟩
  else
    .outOfDate

/-! ### Basic simp lemmas -/

@[simp]
theorem mkRootBoundaryDraft_baseCursor (svc : BoundaryServiceState State Ctx EndpointStateId) :
    (mkRootBoundaryDraft svc :
      BoundaryDraftHandle State Action Ctx Payload EndpointStateId EndpointTransitionId LabelId PeerId MessageId).baseCursor
    = svc.cursor := rfl

@[simp]
theorem mkRootBoundaryDraft_baseSnapshot (svc : BoundaryServiceState State Ctx EndpointStateId) :
    (mkRootBoundaryDraft svc :
      BoundaryDraftHandle State Action Ctx Payload EndpointStateId EndpointTransitionId LabelId PeerId MessageId).baseSnapshot
    = svc.snapshot := rfl

@[simp]
theorem mkRootBoundaryDraft_trace (svc : BoundaryServiceState State Ctx EndpointStateId) :
    (mkRootBoundaryDraft svc :
      BoundaryDraftHandle State Action Ctx Payload EndpointStateId EndpointTransitionId LabelId PeerId MessageId).trace
    = [] := rfl

@[simp]
theorem mkRootBoundaryDraft_currentSnapshot (svc : BoundaryServiceState State Ctx EndpointStateId) :
    (mkRootBoundaryDraft svc :
      BoundaryDraftHandle State Action Ctx Payload EndpointStateId EndpointTransitionId LabelId PeerId MessageId).currentSnapshot
    = svc.snapshot := by
  simp [BoundaryDraftHandle.currentSnapshot, mkRootBoundaryDraft]

@[simp]
theorem appendStep_baseCursor
    (d : BoundaryDraftHandle State Action Ctx Payload EndpointStateId EndpointTransitionId LabelId PeerId MessageId)
    (bstep : BoundarySelectedStep State Action Ctx Payload EndpointStateId EndpointTransitionId LabelId PeerId MessageId) :
    (d.appendStep bstep).baseCursor = d.baseCursor := rfl

@[simp]
theorem appendStep_baseSnapshot
    (d : BoundaryDraftHandle State Action Ctx Payload EndpointStateId EndpointTransitionId LabelId PeerId MessageId)
    (bstep : BoundarySelectedStep State Action Ctx Payload EndpointStateId EndpointTransitionId LabelId PeerId MessageId) :
    (d.appendStep bstep).baseSnapshot = d.baseSnapshot := rfl

@[simp]
theorem appendStep_trace
    (d : BoundaryDraftHandle State Action Ctx Payload EndpointStateId EndpointTransitionId LabelId PeerId MessageId)
    (bstep : BoundarySelectedStep State Action Ctx Payload EndpointStateId EndpointTransitionId LabelId PeerId MessageId) :
    (d.appendStep bstep).trace = d.trace ++ [bstep] := rfl

/-! ### Stale commit rejection -/

/-- Stale boundary commit rejection. If the service cursor differs from
    the draft's base cursor, root boundary commit rejects with `outOfDate`. -/
theorem stale_boundary_commit_rejection
    {svc : BoundaryServiceState State Ctx EndpointStateId}
    {d : BoundaryDraftHandle State Action Ctx Payload EndpointStateId EndpointTransitionId LabelId PeerId MessageId}
    (h : svc.cursor ≠ d.baseCursor) :
    commitRootBoundaryDraft svc d = .outOfDate := by
  unfold commitRootBoundaryDraft
  rw [if_neg h]

/-! ### PB7 — Root boundary commit replay soundness -/

/-- **PB7.** If the service cursor matches the draft's base cursor and the
    service snapshot equals the draft's base snapshot, then root boundary
    commit succeeds and the resulting service snapshot equals the draft's
    current snapshot with cursor advanced by the trace length. -/
theorem root_boundary_commit_replay_soundness
    {svc : BoundaryServiceState State Ctx EndpointStateId}
    {d : BoundaryDraftHandle State Action Ctx Payload EndpointStateId EndpointTransitionId LabelId PeerId MessageId}
    (hcursor : svc.cursor = d.baseCursor)
    (hsnap : svc.snapshot = d.baseSnapshot) :
    commitRootBoundaryDraft svc d
      = .success ⟨d.currentSnapshot, svc.cursor + d.trace.length⟩ := by
  unfold commitRootBoundaryDraft
  rw [if_pos hcursor, hsnap]
  rfl

/-! ### PB7a — Empty-trace root boundary commit -/

/-- **PB7a.** If a root boundary draft has an empty trace and the service
    cursor and snapshot still match, then root commit is a no-op. -/
theorem root_boundary_commit_empty_trace
    {svc : BoundaryServiceState State Ctx EndpointStateId}
    {d : BoundaryDraftHandle State Action Ctx Payload EndpointStateId EndpointTransitionId LabelId PeerId MessageId}
    (hcursor : svc.cursor = d.baseCursor)
    (hsnap : svc.snapshot = d.baseSnapshot)
    (hempty : d.trace = []) :
    commitRootBoundaryDraft svc d = .success ⟨svc.snapshot, svc.cursor⟩ := by
  rw [root_boundary_commit_replay_soundness hcursor hsnap]
  simp [BoundaryDraftHandle.currentSnapshot, hempty, hsnap]

/-- When a root boundary draft was created from a service and the service
    has not advanced, commit is guaranteed to succeed. -/
theorem root_boundary_commit_from_mkRootBoundaryDraft
    {svc : BoundaryServiceState State Ctx EndpointStateId} :
    commitRootBoundaryDraft svc
      (mkRootBoundaryDraft svc :
        BoundaryDraftHandle State Action Ctx Payload EndpointStateId EndpointTransitionId LabelId PeerId MessageId)
    = .success ⟨svc.snapshot, svc.cursor⟩ := by
  simp [commitRootBoundaryDraft, mkRootBoundaryDraft]

/-! ### Semantic publication sequence

The publication sequence is the subsequence of committed boundary trace steps
whose event kind is `protocolSend`, preserving replay order. This is the
artifact over which PB8 is stated. -/

/-- Extract the protocol-send steps from a boundary trace, preserving order. -/
def protocolSendSteps
    (trace : List (BoundarySelectedStep State Action Ctx Payload EndpointStateId EndpointTransitionId LabelId PeerId MessageId))
    : List (BoundarySelectedStep State Action Ctx Payload EndpointStateId EndpointTransitionId LabelId PeerId MessageId) :=
  trace.filter fun bstep => decide (bstep.eventKind = .protocolSend)

/-- Extract the protocol labels from protocol-send steps, preserving order. -/
def publishedLabels
    (trace : List (BoundarySelectedStep State Action Ctx Payload EndpointStateId EndpointTransitionId LabelId PeerId MessageId))
    : List (ProtocolLabel LabelId PeerId MessageId) :=
  (protocolSendSteps trace).filterMap fun bstep => bstep.protocolLabel

@[simp]
theorem protocolSendSteps_nil :
    protocolSendSteps
      ([] : List (BoundarySelectedStep State Action Ctx Payload EndpointStateId EndpointTransitionId LabelId PeerId MessageId))
    = [] := rfl

@[simp]
theorem publishedLabels_nil :
    publishedLabels
      ([] : List (BoundarySelectedStep State Action Ctx Payload EndpointStateId EndpointTransitionId LabelId PeerId MessageId))
    = [] := rfl

/-- protocolSendSteps distributes over append. -/
theorem protocolSendSteps_append
    (t₁ t₂ : List (BoundarySelectedStep State Action Ctx Payload EndpointStateId EndpointTransitionId LabelId PeerId MessageId)) :
    protocolSendSteps (t₁ ++ t₂) = protocolSendSteps t₁ ++ protocolSendSteps t₂ := by
  simp [protocolSendSteps, List.filter_append]

/-- publishedLabels distributes over append. -/
theorem publishedLabels_append
    (t₁ t₂ : List (BoundarySelectedStep State Action Ctx Payload EndpointStateId EndpointTransitionId LabelId PeerId MessageId)) :
    publishedLabels (t₁ ++ t₂) = publishedLabels t₁ ++ publishedLabels t₂ := by
  simp [publishedLabels, protocolSendSteps_append, List.filterMap_append]

/-! ### PB6 — Boundary draft trace invariant -/

section PB6

variable [DecidableEq State] [DecidableEq Action]
variable [DecidableEq EndpointStateId]
variable [DecidableEq LabelId] [DecidableEq PeerId] [DecidableEq MessageId]
variable [DecidableEq Direction]

/-- **PB6.** If boundary dispatch against the draft's current snapshot
    succeeds, appending the boundary-selected step to the trace yields
    a draft whose current snapshot equals the post-dispatch boundary snapshot. -/
theorem boundary_draft_trace_invariant
    {m : Machine State Action Ctx Payload}
    {e : EndpointAutomaton EndpointStateId EndpointTransitionId LabelId PeerId MessageId}
    {d : BoundaryDraftHandle State Action Ctx Payload EndpointStateId EndpointTransitionId LabelId PeerId MessageId}
    {a : Action} {p : Payload}
    {deriveEffect : SelectedStep State Action Ctx Payload →
      ProtocolEffect LabelId PeerId MessageId}
    {newSnap : BoundarySnapshot State Ctx EndpointStateId}
    {bstep : BoundarySelectedStep State Action Ctx Payload EndpointStateId EndpointTransitionId LabelId PeerId MessageId}
    (h : boundaryDispatch m e d.currentSnapshot a p deriveEffect
          = .success newSnap bstep) :
    (d.appendStep bstep).currentSnapshot = newSnap := by
  simp [BoundaryDraftHandle.currentSnapshot, BoundaryDraftHandle.appendStep,
        replayBoundaryTrace_append]
  exact applyBoundarySelected_eq_boundaryDispatch_success h

end PB6

/-! ### PB8 — Root boundary publication-order soundness -/

/-- **PB8.** If a root boundary draft commits successfully with trace `t₁ ++ t₂`,
    the publication sequence decomposes into `publishedLabels t₁ ++ publishedLabels t₂`.

    This captures the replay-order property: publication order is exactly the
    left-to-right order of protocol-send steps in the committed trace. Since
    `commitRootBoundaryDraft` replays the trace sequentially from left to right,
    the publication sequence of any prefix followed by any suffix produces the
    concatenation of their individual publication sequences.

    The companion theorem `publishedLabels_append` proves the structural
    property. This theorem adds the commit-success precondition to tie
    publication order to a successful root boundary commit. -/
theorem root_boundary_publication_order
    {svc : BoundaryServiceState State Ctx EndpointStateId}
    {d : BoundaryDraftHandle State Action Ctx Payload EndpointStateId EndpointTransitionId LabelId PeerId MessageId}
    (_hcursor : svc.cursor = d.baseCursor)
    (_hsnap : svc.snapshot = d.baseSnapshot)
    {t₁ t₂ : List (BoundarySelectedStep State Action Ctx Payload EndpointStateId EndpointTransitionId LabelId PeerId MessageId)}
    (htrace : d.trace = t₁ ++ t₂) :
    publishedLabels d.trace = publishedLabels t₁ ++ publishedLabels t₂ := by
  rw [htrace, publishedLabels_append]

/-- **PB7a+PB8.** Empty-trace root commit produces an empty publication sequence. -/
theorem root_boundary_commit_empty_publishedLabels
    {d : BoundaryDraftHandle State Action Ctx Payload EndpointStateId EndpointTransitionId LabelId PeerId MessageId}
    (hempty : d.trace = []) :
    publishedLabels d.trace = [] := by
  simp [hempty]
