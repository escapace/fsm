/-
  Root commit replay soundness.

  P16: if a root draft is open and the service cursor still equals
  baseCursor, then commit produces a live service snapshot equal to
  the draft's currentSnapshot.
-/
import Draft

variable {State Action Ctx Payload : Type}

/-! ### P16 — Root commit replay soundness -/

/-- **P16.** If the service cursor matches the draft's base cursor and the
    service snapshot equals the draft's base snapshot, then root commit
    succeeds and the resulting service snapshot equals the draft's
    current snapshot with cursor advanced by the trace length. -/
theorem root_commit_replay_soundness
    {svc : ServiceState State Ctx}
    {d : DraftHandle State Action Ctx Payload}
    (hcursor : svc.cursor = d.baseCursor)
    (hsnap : svc.snapshot = d.baseSnapshot) :
    commitRootDraft svc d
      = .success ⟨d.currentSnapshot, svc.cursor + d.trace.length⟩ := by
  unfold commitRootDraft
  rw [if_pos hcursor, hsnap]
  rfl

/-- Corollary: when commit succeeds under the P16 conditions, the
    resulting service snapshot is exactly the draft's current snapshot. -/
theorem root_commit_snapshot_eq
    {svc : ServiceState State Ctx}
    {d : DraftHandle State Action Ctx Payload}
    (hcursor : svc.cursor = d.baseCursor)
    (hsnap : svc.snapshot = d.baseSnapshot) :
    (commitRootDraft svc d) =
      .success ⟨replayTrace d.baseSnapshot d.trace, svc.cursor + d.trace.length⟩ := by
  rw [root_commit_replay_soundness hcursor hsnap]
  rfl

/-- When a root draft was created from a service and the service has not
    advanced, commit is guaranteed to succeed. -/
theorem root_commit_from_mkRootDraft
    {svc : ServiceState State Ctx} :
    commitRootDraft svc (mkRootDraft svc : DraftHandle State Action Ctx Payload)
      = .success ⟨svc.snapshot, svc.cursor⟩ := by
  simp [commitRootDraft, mkRootDraft]

/-- Empty-trace commit is a no-op: the resulting snapshot equals the
    original service snapshot. -/
theorem root_commit_empty_trace
    {svc : ServiceState State Ctx}
    {d : DraftHandle State Action Ctx Payload}
    (hcursor : svc.cursor = d.baseCursor)
    (hsnap : svc.snapshot = d.baseSnapshot)
    (hempty : d.trace = []) :
    commitRootDraft svc d = .success ⟨svc.snapshot, svc.cursor⟩ := by
  rw [root_commit_replay_soundness hcursor hsnap]
  simp [DraftHandle.currentSnapshot, hempty, hsnap]
