/-
  Draft trace invariant, failure preservation, and stale commit rejection.

  P15: after successful dispatch on the draft's current snapshot,
       appending the step preserves the replay invariant.
  P18: stale commit rejection — cursor mismatch means outOfDate.
  P19: draft dispatch inherits all failure cases from ordinary dispatch.
-/
import DraftDefs
import Soundness
import Validity

/-! ### P18 — Stale commit rejection -/

/-- **P18.** If the service cursor differs from the draft's base cursor,
    root commit rejects with `outOfDate` and leaves the service unchanged. -/
theorem stale_commit_rejection
    {State Action Ctx Payload : Type}
    {svc : ServiceState State Ctx}
    {d : DraftHandle State Action Ctx Payload}
    (h : svc.cursor ≠ d.baseCursor) :
    commitRootDraft svc d = .outOfDate := by
  unfold commitRootDraft
  rw [if_neg h]

/-! ### P15 and P19 require DecidableEq -/

variable {State Action Ctx Payload : Type}
variable [DecidableEq State] [DecidableEq Action]

/-! ### P15 — Draft trace invariant -/

/-- **P15.** If dispatch against the draft's current snapshot succeeds,
    appending the selected step to the trace yields a draft whose
    current snapshot equals the post-dispatch snapshot. -/
theorem draft_trace_invariant
    {m : Machine State Action Ctx Payload}
    {d : DraftHandle State Action Ctx Payload}
    {a : Action} {p : Payload}
    {s' : State} {ctx' : Ctx}
    {rule : TransitionRule State Action Ctx Payload}
    {info : ActionInfo State Action Payload}
    (h : dispatch m d.currentSnapshot.state d.currentSnapshot.context a p
          = .success s' ctx' rule info) :
    (d.appendStep ⟨rule, info⟩).currentSnapshot = ⟨s', ctx'⟩ := by
  simp [DraftHandle.currentSnapshot, DraftHandle.appendStep, replayTrace_append]
  exact applySelected_eq_dispatch_success h

/-! ### P19 — Draft failure preservation -/

/-- **P19a.** Draft dispatch failure has the same characterization as
    ordinary dispatch failure (P3): either no candidates exist or all
    candidate guards fail. -/
theorem draft_failure_characterization
    {m : Machine State Action Ctx Payload}
    {d : DraftHandle State Action Ctx Payload}
    {a : Action} {p : Payload}
    (h : dispatch m d.currentSnapshot.state d.currentSnapshot.context a p = .failure) :
    candidates m.transitions d.currentSnapshot.state a = []
    ∨ ∀ t ∈ candidates m.transitions d.currentSnapshot.state a,
        allGuardsPass t.guards d.currentSnapshot.context (mkActionInfo a p t) = false :=
  dispatch_failure_characterization h

/-- **P19b.** Draft dispatch rejects unknown actions identically to
    ordinary dispatch (P5). -/
theorem draft_unknownAction_rejected
    (m : Machine State Action Ctx Payload)
    (d : DraftHandle State Action Ctx Payload)
    (a : Action) (p : Payload)
    (h : a ∉ m.actions) :
    dispatch m d.currentSnapshot.state d.currentSnapshot.context a p = .unknownAction :=
  unknown_action_rejected m d.currentSnapshot.state d.currentSnapshot.context a p h
