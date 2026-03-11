/-
  Transition-expansion correctness.

  Array-based transition authoring (multiple sources × multiple targets)
  is semantically equivalent to explicit enumerated flat transitions.
-/
import Dispatch

variable {State Action Ctx Payload : Type}
variable [DecidableEq State] [DecidableEq Action]

/-- Expand a transition with multiple sources and targets into individual
    transition rules via Cartesian product in row-major order.
    Each expanded rule shares the same action, guards, and reducer. -/
def expand
    (sources : List State)
    (a : Action)
    (targets : List State)
    (guards : List (Ctx → ActionInfo State Action Payload → Bool))
    (reducer : Option (Ctx → ActionInfo State Action Payload → Ctx))
    : List (TransitionRule State Action Ctx Payload) :=
  sources.flatMap fun s => targets.map fun t =>
    { source := s, action := a, target := t, guards := guards, reducer := reducer }

/-- Helper: the rules generated for a single source. -/
private def singleSource
    (src : State) (a : Action) (targets : List State)
    (guards : List (Ctx → ActionInfo State Action Payload → Bool))
    (reducer : Option (Ctx → ActionInfo State Action Payload → Ctx))
    : List (TransitionRule State Action Ctx Payload) :=
  targets.map fun t =>
    { source := src, action := a, target := t, guards := guards, reducer := reducer }

set_option linter.unusedSectionVars false in
/-- Expand cons unfolds to singleSource ++ expand rest. -/
private theorem expand_cons (src : State) (rest : List State) (a : Action)
    (targets : List State)
    (gs : List (Ctx → ActionInfo State Action Payload → Bool))
    (rs : Option (Ctx → ActionInfo State Action Payload → Ctx)) :
    expand (src :: rest) a targets gs rs =
    singleSource src a targets gs rs ++ expand rest a targets gs rs := by
  simp [expand, singleSource, List.flatMap_cons]

/-- All singleSource rules pass the candidate filter for the same source. -/
private theorem candidates_singleSource_same
    (s : State) (a : Action) (targets : List State)
    (gs : List (Ctx → ActionInfo State Action Payload → Bool))
    (rs : Option (Ctx → ActionInfo State Action Payload → Ctx)) :
    candidates (singleSource s a targets gs rs) s a = singleSource s a targets gs rs := by
  simp only [candidates, singleSource]
  induction targets with
  | nil => simp
  | cons t ts ih =>
    simp only [List.map_cons, List.filter_cons, decide_eq_true_iff]
    simp only [and_self, ↓reduceIte]
    exact congrArg _ ih

/-- No singleSource rules pass the candidate filter for a different source. -/
private theorem candidates_singleSource_diff
    (s s' : State) (a : Action) (targets : List State)
    (gs : List (Ctx → ActionInfo State Action Payload → Bool))
    (rs : Option (Ctx → ActionInfo State Action Payload → Ctx))
    (hne : s' ≠ s) :
    candidates (singleSource s' a targets gs rs) s a = [] := by
  simp only [candidates, singleSource]
  induction targets with
  | nil => simp
  | cons t ts ih =>
    simp only [List.map_cons, List.filter_cons, decide_eq_true_iff]
    simp only [hne, false_and, ↓reduceIte]
    exact ih

/-- The candidate list from expanded transitions is identical to
    explicitly declaring each (source, action, target) individually.

    When the queried state is among the sources, candidates are exactly
    the rules pairing that state with each target (in target-list order),
    sharing the original guards and reducer. When the queried state is not
    among the sources, the candidate list is empty.

    Requires Nodup on sources, which matches the machine well-formedness assumptions. -/
theorem expansion_correctness
    (sources : List State) (a : Action) (targets : List State)
    (guards : List (Ctx → ActionInfo State Action Payload → Bool))
    (reducer : Option (Ctx → ActionInfo State Action Payload → Ctx))
    (s : State)
    (hnodup : sources.Nodup) :
    candidates (expand sources a targets guards reducer) s a =
    if s ∈ sources then singleSource s a targets guards reducer
    else [] := by
  induction sources with
  | nil => simp [expand, candidates]
  | cons src rest ih =>
    rw [expand_cons, candidates_append]
    have hnd_rest : rest.Nodup := (List.nodup_cons.mp hnodup).2
    have hnotmem : src ∉ rest := (List.nodup_cons.mp hnodup).1
    have ih' := ih hnd_rest
    simp only [List.mem_cons]
    by_cases hsrc : src = s
    · subst hsrc
      rw [candidates_singleSource_same, ih']
      simp only [true_or, ↓reduceIte, hnotmem, ↓reduceIte, List.append_nil]
    · have hne : ¬(s = src) := fun h => hsrc h.symm
      rw [candidates_singleSource_diff s src a targets guards reducer hsrc, ih']
      simp only [hne, false_or, List.nil_append]
