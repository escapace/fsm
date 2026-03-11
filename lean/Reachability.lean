/-
  Reachability safety.

  Every state reachable through dispatch belongs to the declared state set.
  This is an invariant of well-formed machine definitions: the initial state
  is declared, and every transition target is declared.
-/
import Dispatch
import Soundness

variable {State Action Ctx Payload : Type}
variable [DecidableEq State] [DecidableEq Action]

/-- A state is reachable if it is the initial state or the result of a
    successful dispatch from another reachable state. -/
inductive Reachable (m : Machine State Action Ctx Payload) : State → Prop where
  | init : Reachable m m.initial
  | step {s s' : State} {ctx ctx' : Ctx} {a : Action} {p : Payload}
      {rule : TransitionRule State Action Ctx Payload}
      {info : ActionInfo State Action Payload} :
      Reachable m s →
      dispatch m s ctx a p = .success s' ctx' rule info →
      Reachable m s'

/-- Dispatch success produces a new state that belongs to the declared state set. -/
theorem dispatch_success_target_mem_states
    {m : Machine State Action Ctx Payload}
    {s : State} {ctx : Ctx} {a : Action} {p : Payload}
    {s' : State} {ctx' : Ctx}
    {rule : TransitionRule State Action Ctx Payload}
    {info : ActionInfo State Action Payload}
    (h : dispatch m s ctx a p = .success s' ctx' rule info) :
    s' ∈ m.states := by
  have hrule := dispatch_success_rule_mem h
  have hs' := dispatch_success_new_state h
  rw [hs']
  exact (m.transitions_wf rule (candidates_sub hrule)).2.2

/-- Every reachable state belongs to the declared state set. -/
theorem reachable_mem_states
    (m : Machine State Action Ctx Payload)
    (s : State) (h : Reachable m s) :
    s ∈ m.states := by
  induction h with
  | init => exact m.initial_mem
  | step _ hdisp _ => exact dispatch_success_target_mem_states hdisp
