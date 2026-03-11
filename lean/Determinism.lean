/-
  Determinism of transition selection.

  In Lean, all functions are pure and total. Dispatch determinism is therefore
  a structural property of the definitions rather than a deep theorem.
  We state it explicitly because determinism is part of the semantic model.
-/
import Dispatch

variable {State Action Ctx Payload : Type}
variable [DecidableEq State] [DecidableEq Action]

/-- Dispatch is deterministic — identical inputs produce identical results.
    This is inherent in pure functional definitions but stated explicitly
    because deterministic selection is part of the semantic model. -/
theorem dispatch_deterministic
    (m : Machine State Action Ctx Payload)
    (s : State) (ctx : Ctx) (a : Action) (p : Payload)
    (r₁ r₂ : DispatchResult State Action Ctx Payload)
    (h₁ : dispatch m s ctx a p = r₁)
    (h₂ : dispatch m s ctx a p = r₂) :
    r₁ = r₂ := by
  rw [← h₁, ← h₂]

set_option linter.unusedSectionVars false in
/-- Strengthened form: selectCandidate is deterministic — same candidate list,
    context, action, and payload always yield the same selection. -/
theorem selectCandidate_deterministic
    (cands : List (TransitionRule State Action Ctx Payload))
    (ctx : Ctx) (a : Action) (p : Payload)
    (r₁ r₂ : Option (TransitionRule State Action Ctx Payload × ActionInfo State Action Payload))
    (h₁ : selectCandidate cands ctx a p = r₁)
    (h₂ : selectCandidate cands ctx a p = r₂) :
    r₁ = r₂ := by
  rw [← h₁, ← h₂]
