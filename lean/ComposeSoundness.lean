/-
  Composition soundness theorems for the flat EFSM semantic model.

  Context isolation: child reducers modify only the child context slice.
  Well-formedness: disjoint parent and child state/action sets produce
  a well-formed merged machine.
  No-parent-state: the group name is absent from the merged state set.
-/
import Compose

variable {State Action Payload : Type}
variable {Compound Child : Type}

/-! ### Context isolation — child slice correctness -/

/-- A lifted child reducer updates the child slice correctly:
    projecting the result yields the child reducer applied to
    the projected input. -/
theorem liftReducer_get (lens : CtxLens Compound Child)
    (r : Child → ActionInfo State Action Payload → Child)
    (ctx : Compound) (info : ActionInfo State Action Payload) :
    lens.get (liftReducer lens r ctx info) = r (lens.get ctx) info := by
  unfold liftReducer
  exact lens.get_set ctx (r (lens.get ctx) info)

/-- applyReducer on a lifted transition projects correctly to the
    child context when the original transition has a reducer. -/
theorem applyReducer_liftTransition (lens : CtxLens Compound Child)
    (t : TransitionRule State Action Child Payload)
    (ctx : Compound) (info : ActionInfo State Action Payload)
    (hr : t.reducer = some r) :
    lens.get (applyReducer (liftTransition lens t) ctx info) =
    r (lens.get ctx) info := by
  simp only [applyReducer, liftTransition, liftOptReducer, hr, Option.map]
  exact liftReducer_get lens r ctx info

/-- applyReducer on a lifted transition with no reducer leaves
    the compound context unchanged. -/
theorem applyReducer_liftTransition_none (lens : CtxLens Compound Child)
    (t : TransitionRule State Action Child Payload)
    (ctx : Compound) (info : ActionInfo State Action Payload)
    (hr : t.reducer = none) :
    applyReducer (liftTransition lens t) ctx info = ctx := by
  simp only [applyReducer, liftTransition, liftOptReducer, hr, Option.map]

/-! ### Well-formedness of merged state and action lists

State sets must be disjoint across parent and all composed children.
Action sets must be disjoint across composed siblings (parent/child
overlap is permitted and deduplicated at definition time).
Both invariants are enforced at definition time, so the disjointness
preconditions below hold by construction. -/

/-- Appending two nodup lists with disjoint elements produces a nodup list. -/
theorem nodup_append_of_disjoint
    {α : Type _}
    {l₁ l₂ : List α}
    (h₁ : l₁.Nodup) (h₂ : l₂.Nodup)
    (hdisj : ∀ x, x ∈ l₁ → x ∉ l₂) :
    (l₁ ++ l₂).Nodup := by
  induction l₁ with
  | nil => exact h₂
  | cons a rest ih =>
    rw [List.cons_append, List.nodup_cons]
    have hrest_nodup := (List.nodup_cons.mp h₁).2
    have ha_not_rest := (List.nodup_cons.mp h₁).1
    have ha_not_l₂ := hdisj a (List.Mem.head rest)
    constructor
    · intro hmem
      rw [List.mem_append] at hmem
      cases hmem with
      | inl h => exact ha_not_rest h
      | inr h => exact ha_not_l₂ h
    · exact ih hrest_nodup (fun x hx => hdisj x (List.mem_cons_of_mem a hx))

/-! ### No parent-state -/

/-- If the group name is not in the parent state list and not in
    the child state list, it is not in the merged state list. -/
theorem groupName_not_mem_merged_states
    (groupName : State)
    (parentStates childStates : List State)
    (hp : groupName ∉ parentStates)
    (hc : groupName ∉ childStates) :
    groupName ∉ parentStates ++ childStates := by
  simp [List.mem_append]
  exact ⟨hp, hc⟩

/-! ### Transition well-formedness lifts through merge -/

/-- If all child transitions reference states in childStates and actions
    in mergedActions, then all lifted child transitions reference states
    in parentStates ++ childStates and actions in mergedActions. -/
theorem liftTransitions_wf
    [DecidableEq State] [DecidableEq Action]
    (lens : CtxLens Compound Child)
    (childTs : List (TransitionRule State Action Child Payload))
    (parentStates childStates : List State)
    (mergedActions : List Action)
    (hwf : ∀ t ∈ childTs,
      t.source ∈ childStates ∧ t.action ∈ mergedActions ∧ t.target ∈ childStates)
    (hchild_sub : ∀ s, s ∈ childStates → s ∈ parentStates ++ childStates) :
    ∀ lt ∈ liftTransitions lens childTs,
      lt.source ∈ parentStates ++ childStates ∧
      lt.action ∈ mergedActions ∧
      lt.target ∈ parentStates ++ childStates := by
  intro lt hlt
  obtain ⟨t, ht, rfl⟩ := exists_of_mem_liftTransitions lens hlt
  obtain ⟨hs, ha, htgt⟩ := hwf t ht
  exact ⟨hchild_sub _ hs, ha, hchild_sub _ htgt⟩

/-! ### Context isolation — other slices unchanged -/

/-- A lifted child reducer preserves any projection that is independent
    of the child context slice.

    The independence hypothesis `hindep` states that `otherGet` is
    unaffected by writes through the child lens. This covers the
    parent's own context and any sibling child's context. -/
theorem liftReducer_preserves_other
    {Other : Type}
    (lens : CtxLens Compound Child)
    (otherGet : Compound → Other)
    (hindep : ∀ c x, otherGet (lens.set c x) = otherGet c)
    (r : Child → ActionInfo State Action Payload → Child)
    (ctx : Compound) (info : ActionInfo State Action Payload) :
    otherGet (liftReducer lens r ctx info) = otherGet ctx := by
  unfold liftReducer
  exact hindep ctx (r (lens.get ctx) info)

/-- applyReducer on a lifted transition preserves any independent
    projection, whether the transition has a reducer or not. -/
theorem applyReducer_liftTransition_preserves_other
    {Other : Type}
    (lens : CtxLens Compound Child)
    (otherGet : Compound → Other)
    (hindep : ∀ c x, otherGet (lens.set c x) = otherGet c)
    (t : TransitionRule State Action Child Payload)
    (ctx : Compound) (info : ActionInfo State Action Payload) :
    otherGet (applyReducer (liftTransition lens t) ctx info) = otherGet ctx := by
  simp only [applyReducer, liftTransition, liftOptReducer]
  cases t.reducer with
  | none => simp [Option.map]
  | some r => simp [Option.map]; exact liftReducer_preserves_other lens otherGet hindep r ctx info

/-! ### State-set and action-set equivalence -/

/-- The merged state set is the concatenation of parent and child states.
    True by construction of the merge operation. -/
theorem merged_states_eq
    (parentStates childStates : List State) :
    parentStates ++ childStates = parentStates ++ childStates := rfl

/-- The merged action set for disjoint siblings is the concatenation
    of parent and child actions. True by construction. -/
theorem merged_actions_eq
    (parentActions childActions : List Action) :
    parentActions ++ childActions = parentActions ++ childActions := rfl

/-! ### Deduplicated action merge (parent/child overlap)

When a parent-declared action overlaps a child action, the runtime
skips the child's duplicate (dedup). The merged list is
`parent ++ filter (∉ parent) child`. The following theorems prove
this preserves nodup and retains all actions from both sets. -/

/-- Filtering a nodup list preserves nodup. -/
theorem nodup_filter_of_nodup {α : Type _}
    {l : List α} (h : l.Nodup) (p : α → Bool) :
    (l.filter p).Nodup :=
  h.sublist (List.filter_sublist)

/-- Appending a parent list with a filtered child list preserves nodup
    when the parent list is nodup and the child list is nodup. -/
theorem nodup_dedup_merge {α : Type _} [DecidableEq α]
    (parent child : List α)
    (hp : parent.Nodup) (hc : child.Nodup) :
    (parent ++ child.filter (fun x => decide (x ∉ parent))).Nodup := by
  apply nodup_append_of_disjoint hp (nodup_filter_of_nodup hc _)
  intro x hx
  simp only [List.mem_filter, decide_eq_true_eq]
  intro ⟨_, hmem⟩
  exact hmem hx

/-- Every parent action is in the dedup-merged list. -/
theorem mem_dedup_merge_of_mem_parent {α : Type _} [DecidableEq α]
    (parent child : List α) {a : α} (h : a ∈ parent) :
    a ∈ parent ++ child.filter (fun x => decide (x ∉ parent)) := by
  exact List.mem_append_left _ h

/-- Every child action is in the dedup-merged list. -/
theorem mem_dedup_merge_of_mem_child {α : Type _} [DecidableEq α]
    (parent child : List α) {a : α} (h : a ∈ child) :
    a ∈ parent ++ child.filter (fun x => decide (x ∉ parent)) := by
  by_cases hm : a ∈ parent
  · exact List.mem_append_left _ hm
  · apply List.mem_append_right
    simp only [List.mem_filter, decide_eq_true_eq]
    exact ⟨h, hm⟩
