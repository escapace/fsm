/-
  Dispatch functions and helper lemmas for the flat EFSM semantic model.

  Defines: mkActionInfo, allGuardsPass, selectCandidate, candidates, dispatch.
  Includes helper lemmas used across theorem files.
-/
import Defs

variable {State Action Ctx Payload : Type}

/-- Build the action information record for a candidate transition. -/
def mkActionInfo (a : Action) (p : Payload) (t : TransitionRule State Action Ctx Payload)
    : ActionInfo State Action Payload :=
  ⟨a, p, t.source, t.target⟩

/-- Check whether all guards pass for a given context and action info.
    Guards are evaluated in order with short-circuit conjunction. -/
def allGuardsPass (guards : List (Ctx → ActionInfo State Action Payload → Bool))
    (ctx : Ctx) (info : ActionInfo State Action Payload) : Bool :=
  match guards with
  | [] => true
  | g :: gs => g ctx info && allGuardsPass gs ctx info

/-- Select the first candidate whose guards all pass.
    Returns the selected rule paired with its action info, or none. -/
def selectCandidate (cands : List (TransitionRule State Action Ctx Payload))
    (ctx : Ctx) (a : Action) (p : Payload)
    : Option (TransitionRule State Action Ctx Payload × ActionInfo State Action Payload) :=
  match cands with
  | [] => none
  | t :: rest =>
    match allGuardsPass t.guards ctx (mkActionInfo a p t) with
    | true => some (t, mkActionInfo a p t)
    | false => selectCandidate rest ctx a p

/-- Candidate list: transitions matching current state and action,
    preserving declaration order. -/
def candidates [DecidableEq State] [DecidableEq Action]
    (transitions : List (TransitionRule State Action Ctx Payload))
    (s : State) (a : Action)
    : List (TransitionRule State Action Ctx Payload) :=
  transitions.filter fun t => decide (t.source = s ∧ t.action = a)

/-- Apply a transition's optional reducer to compute the new context. -/
def applyReducer (rule : TransitionRule State Action Ctx Payload)
    (ctx : Ctx) (info : ActionInfo State Action Payload) : Ctx :=
  match rule.reducer with
  | none => ctx
  | some r => r ctx info

/-- Full dispatch operation. -/
def dispatch [DecidableEq State] [DecidableEq Action]
    (m : Machine State Action Ctx Payload)
    (s : State) (ctx : Ctx) (a : Action) (p : Payload)
    : DispatchResult State Action Ctx Payload :=
  if a ∈ m.actions then
    match selectCandidate (candidates m.transitions s a) ctx a p with
    | none => .failure
    | some (rule, info) =>
      .success rule.target (applyReducer rule ctx info) rule info
  else
    .unknownAction

/-! ### Helper lemmas -/

/-- `allGuardsPass` on an empty guard list is true. -/
@[simp]
theorem allGuardsPass_nil (ctx : Ctx) (info : ActionInfo State Action Payload) :
    allGuardsPass ([] : List (Ctx → ActionInfo State Action Payload → Bool)) ctx info = true :=
  rfl

/-- `allGuardsPass` on a cons unfolds to conjunction. -/
@[simp]
theorem allGuardsPass_cons
    (g : Ctx → ActionInfo State Action Payload → Bool)
    (gs : List (Ctx → ActionInfo State Action Payload → Bool))
    (ctx : Ctx) (info : ActionInfo State Action Payload) :
    allGuardsPass (g :: gs) ctx info = (g ctx info && allGuardsPass gs ctx info) :=
  rfl

/-- `selectCandidate` on an empty list is none. -/
@[simp]
theorem selectCandidate_nil (ctx : Ctx) (a : Action) (p : Payload) :
    selectCandidate ([] : List (TransitionRule State Action Ctx Payload)) ctx a p = none :=
  rfl

/-- Membership in candidates implies membership in transitions and matching state/action. -/
theorem mem_candidates [DecidableEq State] [DecidableEq Action]
    {ts : List (TransitionRule State Action Ctx Payload)}
    {s : State} {a : Action} {t : TransitionRule State Action Ctx Payload} :
    t ∈ candidates ts s a ↔ t ∈ ts ∧ t.source = s ∧ t.action = a := by
  simp [candidates, List.mem_filter]

/-- Every candidate belongs to the original transition list. -/
theorem candidates_sub [DecidableEq State] [DecidableEq Action]
    {ts : List (TransitionRule State Action Ctx Payload)}
    {s : State} {a : Action} {t : TransitionRule State Action Ctx Payload}
    (h : t ∈ candidates ts s a) : t ∈ ts :=
  (mem_candidates.mp h).1

/-- If `selectCandidate` returns `some`, the rule is in the candidate list. -/
theorem selectCandidate_mem
    {cands : List (TransitionRule State Action Ctx Payload)}
    {ctx : Ctx} {a : Action} {p : Payload}
    {t : TransitionRule State Action Ctx Payload}
    {info : ActionInfo State Action Payload}
    (h : selectCandidate cands ctx a p = some (t, info)) :
    t ∈ cands := by
  induction cands with
  | nil => simp at h
  | cons hd tl ih =>
    unfold selectCandidate at h
    split at h
    · -- allGuardsPass hd = true → some (hd, _) = some (t, info)
      obtain ⟨rfl, _⟩ := Prod.mk.inj (Option.some.inj h)
      exact List.Mem.head _
    · -- allGuardsPass hd = false → recurse into tl
      exact List.Mem.tail _ (ih h)

/-- If `selectCandidate` returns `some`, the info matches `mkActionInfo`. -/
theorem selectCandidate_info
    {cands : List (TransitionRule State Action Ctx Payload)}
    {ctx : Ctx} {a : Action} {p : Payload}
    {t : TransitionRule State Action Ctx Payload}
    {info : ActionInfo State Action Payload}
    (h : selectCandidate cands ctx a p = some (t, info)) :
    info = mkActionInfo a p t := by
  induction cands with
  | nil => simp at h
  | cons hd tl ih =>
    unfold selectCandidate at h
    split at h
    · obtain ⟨rfl, rfl⟩ := Prod.mk.inj (Option.some.inj h)
      rfl
    · exact ih h

/-- If `selectCandidate` returns `some`, all guards of the selected rule pass. -/
theorem selectCandidate_guards
    {cands : List (TransitionRule State Action Ctx Payload)}
    {ctx : Ctx} {a : Action} {p : Payload}
    {t : TransitionRule State Action Ctx Payload}
    {info : ActionInfo State Action Payload}
    (h : selectCandidate cands ctx a p = some (t, info)) :
    allGuardsPass t.guards ctx (mkActionInfo a p t) = true := by
  induction cands with
  | nil => simp at h
  | cons hd tl ih =>
    unfold selectCandidate at h
    split at h
    · -- true branch: hd is selected
      rename_i hg
      obtain ⟨rfl, _⟩ := Prod.mk.inj (Option.some.inj h)
      exact hg
    · exact ih h

/-- If `selectCandidate` returns `some`, the selected rule occurs at some position
    in the candidate list and every earlier candidate has a failing guard. -/
theorem selectCandidate_first
    {cands : List (TransitionRule State Action Ctx Payload)}
    {ctx : Ctx} {a : Action} {p : Payload}
    {t : TransitionRule State Action Ctx Payload}
    {info : ActionInfo State Action Payload}
    (h : selectCandidate cands ctx a p = some (t, info)) :
    ∃ before after,
      cands = before ++ t :: after ∧
      (∀ t' ∈ before, allGuardsPass t'.guards ctx (mkActionInfo a p t') = false) := by
  induction cands with
  | nil => simp at h
  | cons hd tl ih =>
    unfold selectCandidate at h
    split at h
    · -- true branch: hd is selected immediately
      obtain ⟨rfl, _⟩ := Prod.mk.inj (Option.some.inj h)
      refine ⟨[], tl, ?_, ?_⟩
      · simp
      · intro t' ht
        nomatch ht
    · -- false branch: recurse into tail
      rename_i hg
      obtain ⟨before, after, hsplit, hbefore⟩ := ih h
      refine ⟨hd :: before, after, ?_, ?_⟩
      · simp [hsplit]
      · intro t' ht
        cases ht with
        | head => exact hg
        | tail _ hmem => exact hbefore t' hmem

/-- If `selectCandidate` returns `none`, every candidate has a failing guard. -/
theorem selectCandidate_none
    {cands : List (TransitionRule State Action Ctx Payload)}
    {ctx : Ctx} {a : Action} {p : Payload}
    (h : selectCandidate cands ctx a p = none) :
    ∀ t ∈ cands, allGuardsPass t.guards ctx (mkActionInfo a p t) = false := by
  induction cands with
  | nil => intro t ht; nomatch ht
  | cons hd tl ih =>
    intro t ht
    unfold selectCandidate at h
    split at h
    · -- true branch: some ≠ none, contradiction
      exact absurd h (by simp)
    · -- false branch: hd guards failed
      rename_i hg
      cases ht with
      | head => exact hg
      | tail _ htl => exact ih h t htl
