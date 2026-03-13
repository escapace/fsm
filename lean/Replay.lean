/-
  Replay primitives for draft semantics.

  Defines Snapshot, SelectedStep, applySelected, and replayTrace.

  Proves P14: selected-step replay equivalence — applying a selected step
  to the pre-dispatch snapshot produces the same result as dispatch success.
-/
import Dispatch

variable {State Action Ctx Payload : Type}

/-- A machine configuration snapshot: current state and context. -/
structure Snapshot (State Ctx : Type) where
  state : State
  context : Ctx

/-- A selected step records the transition that fired and the
    action information record used during that dispatch. -/
structure SelectedStep (State Action Ctx Payload : Type) where
  transition : TransitionRule State Action Ctx Payload
  action : ActionInfo State Action Payload

/-- Apply a selected step to a snapshot, producing the post-transition snapshot.
    Performs state update and optional reducer application only —
    no candidate lookup or guard evaluation. -/
def applySelected (snap : Snapshot State Ctx) (step : SelectedStep State Action Ctx Payload)
    : Snapshot State Ctx :=
  ⟨step.transition.target, applyReducer step.transition snap.context step.action⟩

/-- Replay a trace of selected steps from an initial snapshot.
    Left fold of `applySelected`. -/
def replayTrace : Snapshot State Ctx → List (SelectedStep State Action Ctx Payload)
    → Snapshot State Ctx
  | snap, [] => snap
  | snap, step :: rest => replayTrace (applySelected snap step) rest

/-! ### Basic replayTrace lemmas -/

@[simp]
theorem replayTrace_nil (snap : Snapshot State Ctx) :
    replayTrace snap ([] : List (SelectedStep State Action Ctx Payload)) = snap := rfl

@[simp]
theorem replayTrace_cons (snap : Snapshot State Ctx) (step : SelectedStep State Action Ctx Payload)
    (rest : List (SelectedStep State Action Ctx Payload)) :
    replayTrace snap (step :: rest) = replayTrace (applySelected snap step) rest := rfl

/-- Replaying a concatenated trace equals replaying each part sequentially. -/
theorem replayTrace_append (snap : Snapshot State Ctx)
    (t₁ t₂ : List (SelectedStep State Action Ctx Payload)) :
    replayTrace snap (t₁ ++ t₂) = replayTrace (replayTrace snap t₁) t₂ := by
  induction t₁ generalizing snap with
  | nil => simp
  | cons step rest ih => simp [ih]

/-! ### P14 — Selected-step replay equivalence -/

/-- **P14.** If dispatch succeeds with selected transition `rule`, action record
    `info`, new state `s'` and new context `ctx'`, then applying the selected step
    `⟨rule, info⟩` to the pre-dispatch snapshot `⟨s, ctx⟩` yields `⟨s', ctx'⟩`. -/
theorem applySelected_eq_dispatch_success [DecidableEq State] [DecidableEq Action]
    {m : Machine State Action Ctx Payload}
    {s : State} {ctx : Ctx} {a : Action} {p : Payload}
    {s' : State} {ctx' : Ctx}
    {rule : TransitionRule State Action Ctx Payload}
    {info : ActionInfo State Action Payload}
    (h : dispatch m s ctx a p = .success s' ctx' rule info) :
    applySelected ⟨s, ctx⟩ ⟨rule, info⟩ = ⟨s', ctx'⟩ := by
  unfold dispatch at h
  split at h
  · -- a ∈ m.actions
    split at h
    · -- selectCandidate returned none → failure, contradicts success
      exact absurd h (by simp)
    · -- selectCandidate returned some (r, i) → success
      simp only [DispatchResult.success.injEq] at h
      obtain ⟨rfl, rfl, rfl, rfl⟩ := h
      rfl
  · -- a ∉ m.actions → unknownAction, contradicts success
    exact absurd h (by simp)
