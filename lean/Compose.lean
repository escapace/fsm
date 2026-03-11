/-
  Composition definitions and core lemmas for the flat EFSM semantic model.

  Defines context lenses, guard/reducer/transition lifting, and transition
  merging. Composition is a checked merge: child states, actions, and
  transitions are concatenated into the parent, with child guards and
  reducers lifted through a context lens to operate on their scoped slice
  of the compound context.
-/
import Dispatch

variable {State Action Payload : Type}
variable {Compound Child : Type}

/-- A lens for projecting and injecting a child context slice within
    a compound context. The round-trip laws ensure consistency. -/
structure CtxLens (Compound Child : Type) where
  /-- Project the child context from the compound. -/
  get : Compound → Child
  /-- Inject an updated child context into the compound. -/
  set : Compound → Child → Compound
  /-- Reading after writing yields the written value. -/
  get_set : ∀ c x, get (set c x) = x
  /-- Writing back the current value is a no-op. -/
  set_get : ∀ c, set c (get c) = c

/-- Lift a single guard from child context to compound context. -/
def liftGuard (lens : CtxLens Compound Child)
    (g : Child → ActionInfo State Action Payload → Bool)
    : Compound → ActionInfo State Action Payload → Bool :=
  fun ctx info => g (lens.get ctx) info

/-- Lift a list of guards from child context to compound context. -/
def liftGuards (lens : CtxLens Compound Child)
    (gs : List (Child → ActionInfo State Action Payload → Bool))
    : List (Compound → ActionInfo State Action Payload → Bool) :=
  gs.map (liftGuard lens)

/-- Lift a reducer from child context to compound context.
    Projects to the child slice, applies the original reducer,
    and injects the result back. -/
def liftReducer (lens : CtxLens Compound Child)
    (r : Child → ActionInfo State Action Payload → Child)
    : Compound → ActionInfo State Action Payload → Compound :=
  fun ctx info => lens.set ctx (r (lens.get ctx) info)

/-- Lift an optional reducer from child context to compound context. -/
def liftOptReducer (lens : CtxLens Compound Child)
    (r : Option (Child → ActionInfo State Action Payload → Child))
    : Option (Compound → ActionInfo State Action Payload → Compound) :=
  r.map (liftReducer lens)

/-- Lift a transition rule from child context to compound context.
    Source, action, and target are unchanged. Guards and reducer are lifted. -/
def liftTransition (lens : CtxLens Compound Child)
    (t : TransitionRule State Action Child Payload)
    : TransitionRule State Action Compound Payload where
  source := t.source
  action := t.action
  target := t.target
  guards := liftGuards lens t.guards
  reducer := liftOptReducer lens t.reducer

/-- Lift all child transitions to compound context. -/
def liftTransitions (lens : CtxLens Compound Child)
    (ts : List (TransitionRule State Action Child Payload))
    : List (TransitionRule State Action Compound Payload) :=
  ts.map (liftTransition lens)

/-- Merge parent and child transition lists. Child transitions are lifted
    and appended after parent transitions. -/
def mergeTransitions (lens : CtxLens Compound Child)
    (parentTs : List (TransitionRule State Action Compound Payload))
    (childTs : List (TransitionRule State Action Child Payload))
    : List (TransitionRule State Action Compound Payload) :=
  parentTs ++ liftTransitions lens childTs

/-! ### Lifting preserves transition fields -/

@[simp]
theorem liftTransition_source (lens : CtxLens Compound Child)
    (t : TransitionRule State Action Child Payload) :
    (liftTransition lens t).source = t.source := rfl

@[simp]
theorem liftTransition_action (lens : CtxLens Compound Child)
    (t : TransitionRule State Action Child Payload) :
    (liftTransition lens t).action = t.action := rfl

@[simp]
theorem liftTransition_target (lens : CtxLens Compound Child)
    (t : TransitionRule State Action Child Payload) :
    (liftTransition lens t).target = t.target := rfl

/-! ### Guard evaluation commutes with lifting -/

/-- allGuardsPass on lifted guards with compound context equals
    allGuardsPass on original guards with projected child context. -/
theorem allGuardsPass_liftGuards (lens : CtxLens Compound Child)
    (gs : List (Child → ActionInfo State Action Payload → Bool))
    (ctx : Compound) (info : ActionInfo State Action Payload) :
    allGuardsPass (liftGuards lens gs) ctx info =
    allGuardsPass gs (lens.get ctx) info := by
  induction gs with
  | nil => rfl
  | cons g rest ih =>
    unfold liftGuards at ih ⊢
    rw [List.map_cons, allGuardsPass_cons, allGuardsPass_cons, ih]
    rfl

/-- allGuardsPass on a lifted transition equals allGuardsPass on
    the original transition with projected child context. -/
theorem allGuardsPass_liftTransition (lens : CtxLens Compound Child)
    (t : TransitionRule State Action Child Payload)
    (ctx : Compound) (info : ActionInfo State Action Payload) :
    allGuardsPass (liftTransition lens t).guards ctx info =
    allGuardsPass t.guards (lens.get ctx) info :=
  allGuardsPass_liftGuards lens t.guards ctx info

/-! ### Candidates commute with lifting -/

/-- Candidates of lifted transitions equals lifting of candidates.
    Filtering by (source, action) commutes with lifting because
    liftTransition preserves source and action. -/
theorem candidates_liftTransitions [DecidableEq State] [DecidableEq Action]
    (lens : CtxLens Compound Child)
    (ts : List (TransitionRule State Action Child Payload))
    (s : State) (a : Action) :
    candidates (liftTransitions lens ts) s a =
    liftTransitions lens (candidates ts s a) := by
  induction ts with
  | nil => rfl
  | cons t rest ih =>
    simp only [liftTransitions, candidates] at ih ⊢
    rw [List.map_cons, List.filter_cons, List.filter_cons]
    simp only [liftTransition_source, liftTransition_action]
    split <;> simp_all [List.map_cons]

/-- Candidates of merged transitions decompose into parent candidates
    followed by lifted child candidates. -/
theorem candidates_mergeTransitions [DecidableEq State] [DecidableEq Action]
    (lens : CtxLens Compound Child)
    (parentTs : List (TransitionRule State Action Compound Payload))
    (childTs : List (TransitionRule State Action Child Payload))
    (s : State) (a : Action) :
    candidates (mergeTransitions lens parentTs childTs) s a =
    candidates parentTs s a ++ liftTransitions lens (candidates childTs s a) := by
  simp only [mergeTransitions]
  rw [candidates_append, candidates_liftTransitions]

/-! ### mkActionInfo commutes with lifting -/

/-- mkActionInfo on a lifted transition equals mkActionInfo on the original,
    because mkActionInfo only reads source and target. -/
@[simp]
theorem mkActionInfo_liftTransition (lens : CtxLens Compound Child)
    (a : Action) (p : Payload) (t : TransitionRule State Action Child Payload) :
    mkActionInfo a p (liftTransition lens t) = mkActionInfo a p t := rfl

/-! ### selectCandidate commutes with lifting -/

/-- selectCandidate on lifted transitions with compound context produces
    the same selection as selectCandidate on original transitions with
    projected child context, with the result lifted.

    This is the central dispatch-preservation theorem for composition:
    candidate selection through a context lens is equivalent to candidate
    selection on the projected context. -/
theorem selectCandidate_liftTransitions
    (lens : CtxLens Compound Child)
    (cands : List (TransitionRule State Action Child Payload))
    (ctx : Compound) (a : Action) (p : Payload) :
    selectCandidate (liftTransitions lens cands) ctx a p =
    (selectCandidate cands (lens.get ctx) a p).map
      (fun pair => (liftTransition lens pair.1, pair.2)) := by
  induction cands with
  | nil => rfl
  | cons t rest ih =>
    unfold liftTransitions
    rw [List.map_cons]
    unfold selectCandidate
    rw [mkActionInfo_liftTransition, allGuardsPass_liftTransition]
    split
    · -- guards pass: both select the head
      simp
    · -- guards fail: recurse
      unfold liftTransitions at ih
      exact ih

/-! ### Membership lemmas -/

/-- If a transition belongs to the original list, its lifted form
    belongs to the lifted list. -/
theorem mem_liftTransitions_of_mem (lens : CtxLens Compound Child)
    {ts : List (TransitionRule State Action Child Payload)}
    {t : TransitionRule State Action Child Payload}
    (h : t ∈ ts) :
    liftTransition lens t ∈ liftTransitions lens ts := by
  simp only [liftTransitions, List.mem_map]
  exact ⟨t, h, rfl⟩

/-- Every element of a lifted transition list is the lift of some
    element of the original list. -/
theorem exists_of_mem_liftTransitions (lens : CtxLens Compound Child)
    {ts : List (TransitionRule State Action Child Payload)}
    {lt : TransitionRule State Action Compound Payload}
    (h : lt ∈ liftTransitions lens ts) :
    ∃ t ∈ ts, lt = liftTransition lens t := by
  simp only [liftTransitions, List.mem_map] at h
  obtain ⟨t, ht, rfl⟩ := h
  exact ⟨t, ht, rfl⟩
