/-
  Nested draft semantics: child commit and ancestor closure.

  P17: child commit append soundness — merging child trace into parent
       produces a parent draft whose current snapshot equals the child's.
  P20: ancestor closure safety — if any ancestor is closed, the chain
       is not operational.
-/
import DraftDefs

variable {State Action Ctx Payload : Type}

/-! ### Nested draft definitions -/

/-- Create a child draft from an open parent draft.
    The child's base snapshot is the parent's current snapshot,
    and its base cursor is the parent's head cursor. -/
def mkChildDraft (parent : DraftHandle State Action Ctx Payload)
    : DraftHandle State Action Ctx Payload :=
  { baseCursor := parent.headCursor
  , baseSnapshot := parent.currentSnapshot
  , trace := [] }

/-- Merge a child's trace into its parent draft.
    This is the core of child commit on success: append child trace
    to parent trace. -/
def mergeChildTrace (parent child : DraftHandle State Action Ctx Payload)
    : DraftHandle State Action Ctx Payload :=
  { parent with trace := parent.trace ++ child.trace }

/-- Result of committing a child draft into its parent. -/
inductive ChildCommitResult (State Action Ctx Payload : Type) where
  /-- Commit succeeded; carries the updated parent draft. -/
  | success (newParent : DraftHandle State Action Ctx Payload)
  /-- Parent head cursor has advanced since child creation. -/
  | outOfDate

/-- Attempt to commit a child draft into its parent draft.
    Succeeds only when the parent's head cursor matches the child's
    base cursor. On success, appends the child trace to the parent. -/
def commitChildDraft (parent child : DraftHandle State Action Ctx Payload)
    : ChildCommitResult State Action Ctx Payload :=
  if parent.headCursor = child.baseCursor then
    .success (mergeChildTrace parent child)
  else
    .outOfDate

/-! ### mkChildDraft lemmas -/

@[simp]
theorem mkChildDraft_baseCursor (parent : DraftHandle State Action Ctx Payload) :
    (mkChildDraft parent).baseCursor = parent.headCursor := rfl

@[simp]
theorem mkChildDraft_baseSnapshot (parent : DraftHandle State Action Ctx Payload) :
    (mkChildDraft parent).baseSnapshot = parent.currentSnapshot := rfl

@[simp]
theorem mkChildDraft_trace (parent : DraftHandle State Action Ctx Payload) :
    (mkChildDraft parent).trace = [] := rfl

@[simp]
theorem mkChildDraft_currentSnapshot (parent : DraftHandle State Action Ctx Payload) :
    (mkChildDraft parent).currentSnapshot = parent.currentSnapshot := by
  simp [DraftHandle.currentSnapshot, mkChildDraft]

/-! ### mergeChildTrace lemmas -/

@[simp]
theorem mergeChildTrace_baseSnapshot (parent child : DraftHandle State Action Ctx Payload) :
    (mergeChildTrace parent child).baseSnapshot = parent.baseSnapshot := rfl

@[simp]
theorem mergeChildTrace_trace (parent child : DraftHandle State Action Ctx Payload) :
    (mergeChildTrace parent child).trace = parent.trace ++ child.trace := rfl

/-! ### P17 — Child commit append soundness -/

/-- **P17a.** After merging a child's trace into the parent, the resulting
    parent's current snapshot equals the child's current snapshot —
    provided the parent's current snapshot was the child's base snapshot.

    This is the semantic core of child-into-parent commit: trace
    concatenation preserves the replay invariant across nesting. -/
theorem child_commit_snapshot_eq
    {parent child : DraftHandle State Action Ctx Payload}
    (hsnap : parent.currentSnapshot = child.baseSnapshot) :
    (mergeChildTrace parent child).currentSnapshot = child.currentSnapshot := by
  simp only [DraftHandle.currentSnapshot, mergeChildTrace] at hsnap ⊢
  rw [replayTrace_append, hsnap]

/-- Corollary: for a child whose base snapshot equals the parent's
    current snapshot (holds by construction for `mkChildDraft`). -/
theorem child_commit_from_mkChildDraft
    {parent : DraftHandle State Action Ctx Payload}
    {child : DraftHandle State Action Ctx Payload}
    (hcreated : child.baseSnapshot = parent.currentSnapshot) :
    (mergeChildTrace parent child).currentSnapshot = child.currentSnapshot :=
  child_commit_snapshot_eq hcreated.symm

/-- **P17b.** When cursor and snapshot preconditions hold, `commitChildDraft`
    succeeds and the resulting parent has the merged trace and the child's
    current snapshot. -/
theorem child_commit_success
    {parent child : DraftHandle State Action Ctx Payload}
    (hcursor : parent.headCursor = child.baseCursor)
    (hsnap : parent.currentSnapshot = child.baseSnapshot) :
    commitChildDraft parent child = .success (mergeChildTrace parent child)
    ∧ (mergeChildTrace parent child).currentSnapshot = child.currentSnapshot := by
  exact ⟨by simp [commitChildDraft, if_pos hcursor], child_commit_snapshot_eq hsnap⟩

/-- Merging an empty child trace is a no-op on the parent. -/
theorem merge_empty_child_trace
    {parent child : DraftHandle State Action Ctx Payload}
    (hempty : child.trace = []) :
    (mergeChildTrace parent child).currentSnapshot = parent.currentSnapshot := by
  simp [DraftHandle.currentSnapshot, mergeChildTrace, hempty]

/-! ### P18 (nested) — Stale child commit rejection -/

/-- **P18 (nested).** If the parent's head cursor differs from the child's
    base cursor, child commit rejects with `outOfDate`. -/
theorem stale_child_commit_rejection
    {parent child : DraftHandle State Action Ctx Payload}
    (h : parent.headCursor ≠ child.baseCursor) :
    commitChildDraft parent child = .outOfDate := by
  simp [commitChildDraft, if_neg h]

/-! ### P20 — Ancestor closure safety -/

/-- All drafts in an ancestor chain are open (not closed).
    The chain is a list of closed-flags from the current draft
    up through all ancestors. -/
def ancestorsAllOpen (chain : List Bool) : Prop :=
  ∀ b ∈ chain, b = false

/-- **P20.** If any ancestor in the chain is closed (`true`),
    the chain is not all-open — meaning the draft is not operational. -/
theorem ancestor_closure_safety
    {chain : List Bool}
    (hmem : true ∈ chain) :
    ¬ ancestorsAllOpen chain := by
  intro h
  exact absurd (h true hmem) (by decide)

/-- Contrapositive: if the chain is all-open, every entry is `false`. -/
theorem operational_implies_all_open
    {chain : List Bool}
    (h : ancestorsAllOpen chain) (b : Bool) (hmem : b ∈ chain) :
    b = false :=
  h b hmem

/-- Extending a chain: if the chain is all-open and the new entry is
    `false`, the extended chain is all-open. -/
theorem ancestors_extend_open
    {chain : List Bool}
    (h : ancestorsAllOpen chain) :
    ancestorsAllOpen (false :: chain) := by
  intro b hmem
  cases hmem with
  | head => rfl
  | tail _ htl => exact h b htl

/-- Extending a chain with a closed entry makes it not all-open. -/
theorem ancestors_extend_closed
    {chain : List Bool}  :
    ¬ ancestorsAllOpen (true :: chain) := by
  exact ancestor_closure_safety (List.Mem.head _)
