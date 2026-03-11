/-
  Success soundness and failure characterization.

  These two properties are the exhaustive characterization of dispatch outcomes
  other than the undeclared-action case handled in Validity.

  Success means the chosen transition is a valid candidate with passing guards
  and is the first such candidate in declaration order.

  Failure means either no candidates exist or every candidate has at least one
  failing guard.
-/
import Dispatch

variable {State Action Ctx Payload : Type}
variable [DecidableEq State] [DecidableEq Action]

/-- Extract the selectCandidate result from a successful dispatch. -/
private theorem dispatch_success_select
    {m : Machine State Action Ctx Payload}
    {s : State} {ctx : Ctx} {a : Action} {p : Payload}
    {s' : State} {ctx' : Ctx}
    {rule : TransitionRule State Action Ctx Payload}
    {info : ActionInfo State Action Payload}
    (h : dispatch m s ctx a p = .success s' ctx' rule info) :
    selectCandidate (candidates m.transitions s a) ctx a p = some (rule, info) ∧
    s' = rule.target ∧
    ctx' = applyReducer rule ctx info := by
  unfold dispatch at h
  split at h
  · -- a ∈ m.actions
    split at h
    · -- none → failure, contradiction
      exact absurd h (by simp)
    · -- some (r, i) → success
      rename_i r i heq
      simp only [DispatchResult.success.injEq] at h
      obtain ⟨h1, h2, h3, h4⟩ := h
      subst h1 h2 h3 h4
      exact ⟨heq, rfl, rfl⟩
  · -- a ∉ m.actions → unknownAction, contradiction
    exact absurd h (by simp)

/-! ### Success soundness -/

/-- If dispatch succeeds, the selected rule belongs to the machine's
    transition candidates for the current state and action. -/
theorem dispatch_success_rule_mem
    {m : Machine State Action Ctx Payload}
    {s : State} {ctx : Ctx} {a : Action} {p : Payload}
    {s' : State} {ctx' : Ctx}
    {rule : TransitionRule State Action Ctx Payload}
    {info : ActionInfo State Action Payload}
    (h : dispatch m s ctx a p = .success s' ctx' rule info) :
    rule ∈ candidates m.transitions s a :=
  selectCandidate_mem (dispatch_success_select h).1

/-- If dispatch succeeds, all guards of the selected rule pass. -/
theorem dispatch_success_guards_pass
    {m : Machine State Action Ctx Payload}
    {s : State} {ctx : Ctx} {a : Action} {p : Payload}
    {s' : State} {ctx' : Ctx}
    {rule : TransitionRule State Action Ctx Payload}
    {info : ActionInfo State Action Payload}
    (h : dispatch m s ctx a p = .success s' ctx' rule info) :
    allGuardsPass rule.guards ctx (mkActionInfo a p rule) = true :=
  selectCandidate_guards (dispatch_success_select h).1

/-- If dispatch succeeds, the selected rule's source matches the current state
    and its action matches the dispatched action. -/
theorem dispatch_success_source_action
    {m : Machine State Action Ctx Payload}
    {s : State} {ctx : Ctx} {a : Action} {p : Payload}
    {s' : State} {ctx' : Ctx}
    {rule : TransitionRule State Action Ctx Payload}
    {info : ActionInfo State Action Payload}
    (h : dispatch m s ctx a p = .success s' ctx' rule info) :
    rule.source = s ∧ rule.action = a :=
  (mem_candidates.mp (dispatch_success_rule_mem h)).2

/-- If dispatch succeeds, the new state is the selected rule's target. -/
theorem dispatch_success_new_state
    {m : Machine State Action Ctx Payload}
    {s : State} {ctx : Ctx} {a : Action} {p : Payload}
    {s' : State} {ctx' : Ctx}
    {rule : TransitionRule State Action Ctx Payload}
    {info : ActionInfo State Action Payload}
    (h : dispatch m s ctx a p = .success s' ctx' rule info) :
    s' = rule.target :=
  (dispatch_success_select h).2.1

/-- If dispatch succeeds, the info record matches mkActionInfo. -/
theorem dispatch_success_info
    {m : Machine State Action Ctx Payload}
    {s : State} {ctx : Ctx} {a : Action} {p : Payload}
    {s' : State} {ctx' : Ctx}
    {rule : TransitionRule State Action Ctx Payload}
    {info : ActionInfo State Action Payload}
    (h : dispatch m s ctx a p = .success s' ctx' rule info) :
    info = mkActionInfo a p rule :=
  selectCandidate_info (dispatch_success_select h).1

/-- If dispatch succeeds, the selected rule is the first guard-passing
    candidate in declaration order among the state/action candidates. -/
theorem dispatch_success_first_passing
    {m : Machine State Action Ctx Payload}
    {s : State} {ctx : Ctx} {a : Action} {p : Payload}
    {s' : State} {ctx' : Ctx}
    {rule : TransitionRule State Action Ctx Payload}
    {info : ActionInfo State Action Payload}
    (h : dispatch m s ctx a p = .success s' ctx' rule info) :
    ∃ before after,
      candidates m.transitions s a = before ++ rule :: after ∧
      (∀ t ∈ before, allGuardsPass t.guards ctx (mkActionInfo a p t) = false) :=
  selectCandidate_first (dispatch_success_select h).1

/-! ### Failure characterization -/

/-- If dispatch returns failure, either no candidates exist or every
    candidate has at least one failing guard. -/
theorem dispatch_failure_characterization
    {m : Machine State Action Ctx Payload}
    {s : State} {ctx : Ctx} {a : Action} {p : Payload}
    (h : dispatch m s ctx a p = .failure) :
    candidates m.transitions s a = []
    ∨ ∀ t ∈ candidates m.transitions s a,
        allGuardsPass t.guards ctx (mkActionInfo a p t) = false := by
  unfold dispatch at h
  split at h
  · -- a ∈ m.actions
    split at h
    · -- selectCandidate returned none
      rename_i heq
      right; exact selectCandidate_none heq
    · exact absurd h (by simp)
  · exact absurd h (by simp)
