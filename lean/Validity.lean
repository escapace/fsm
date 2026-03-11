/-
  Action validity.

  Unknown actions are rejected before any transition lookup or guard
  evaluation occurs.
-/
import Dispatch

variable {State Action Ctx Payload : Type}
variable [DecidableEq State] [DecidableEq Action]

/-- If the action is not declared, dispatch returns unknownAction. -/
theorem unknown_action_rejected
    (m : Machine State Action Ctx Payload)
    (s : State) (ctx : Ctx) (a : Action) (p : Payload)
    (h : a ∉ m.actions) :
    dispatch m s ctx a p = .unknownAction := by
  simp [dispatch, h]

/-- Converse form: if dispatch returns unknownAction, the action is undeclared. -/
theorem dispatch_unknownAction_iff
    (m : Machine State Action Ctx Payload)
    (s : State) (ctx : Ctx) (a : Action) (p : Payload) :
    dispatch m s ctx a p = .unknownAction ↔ a ∉ m.actions := by
  constructor
  · intro h
    unfold dispatch at h
    split at h
    · -- a ∈ m.actions: dispatch cannot return unknownAction
      split at h <;> simp at h
    · -- a ∉ m.actions
      rename_i hna
      exact hna
  · exact unknown_action_rejected m s ctx a p
