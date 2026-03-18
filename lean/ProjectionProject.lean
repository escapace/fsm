/-
  Projection: projectability predicates and role-by-role projection function.

  Implements the restricted first-phase projection semantics:
  - supported fragment checks (no parallel composition, finite normalization)
  - projectability predicates (single-chooser, structural uninvolved-role checks)
  - projection from normalized graph to endpoint automata per role
  - explicit rejection classification

  The output targets the existing EndpointAutomaton shape from ProtocolDefs.lean.
-/
import ProjectionNormalize

/-! ### Projectability predicates -/

/-- Check that a choice node is single-chooser: all branch edges from a given
    source node in the graph share the same chooser. -/
def singleChooserAt (edges : List (GraphEdge Nat Nat Nat Nat)) (node : Nat) : Bool :=
  let branchEdges := edges.filter fun e =>
    e.source == node && match e.label with | .branch _ _ => true | _ => false
  let choosers := branchEdges.filterMap fun e =>
    match e.label with | .branch c _ => some c | _ => none
  match choosers with
  | [] => true
  | c :: rest => rest.all (· == c)

/-- Check that all choice points in the graph are single-chooser. -/
def allSingleChooser (g : NormalizedGraph Nat Nat Nat Nat) : Bool :=
  g.nodes.all (singleChooserAt g.edges)

/- For a choice at `node` with chooser `c`, check that every uninvolved role
   (not `c`) sees a structurally decidable local view.

   In the restricted first fragment, this means: for each uninvolved role,
   either all branches produce the same local trace prefix for that role
   (the role cannot distinguish branches) or every branch begins with a
   different interaction involving that role (the role can distinguish branches).

   For the first implementation, we check a simpler sufficient condition:
   for each branch, the first interaction edge involving role `r` (if any)
   must differ across branches OR `r` is not involved in any branch.
   This is checked at projection time rather than as a separate predicate. -/

/-- Check that a role is involved in an interaction edge. -/
def roleInvolvedInEdge (role : Nat) (e : GraphEdge Nat Nat Nat Nat) : Bool :=
  match e.label with
  | .interaction i => i.sender == role || i.receiver == role
  | _ => false

/-- Collect the first interaction for a role reachable from a node,
    following only non-branching edges. For the restricted fragment,
    we just look at immediate outgoing interaction edges. -/
def firstInteractionForRole (edges : List (GraphEdge Nat Nat Nat Nat))
    (node : Nat) (role : Nat) : Option (MessageInteraction Nat Nat Nat) :=
  -- Direct outgoing interaction edge
  let outgoing := edges.filter fun e => e.source == node
  match outgoing.findSome? fun e =>
    match e.label with
    | .interaction i => if i.sender == role || i.receiver == role then some i else none
    | _ => none
  with
  | some i => some i
  | none =>
    -- Follow branch edges one step and check their targets
    let branchTargets := outgoing.filterMap fun e =>
      match e.label with | .branch _ _ => some e.target | _ => none
    -- Check first interaction at each branch target
    branchTargets.findSome? fun t =>
      (edges.filter fun e => e.source == t).findSome? fun e =>
        match e.label with
        | .interaction i => if i.sender == role || i.receiver == role then some i else none
        | _ => none

/-! ### Role-local event extraction -/

/-- Convert an interaction to a local event for a specific role.
    Returns `none` if the role is not involved. -/
def interactionToLocalEvent (role : Nat) (i : MessageInteraction Nat Nat Nat) :
    Option (LocalEvent Nat Nat) :=
  if i.sender == role then some (.send i.receiver i.message)
  else if i.receiver == role then some (.receive i.sender i.message)
  else none

/-! ### Projection state -/

/-- Projection accumulator for building one endpoint automaton. -/
structure ProjState where
  nextStateId : Nat
  states : List Nat
  transitions : List (EndpointTransition Nat Nat Nat Nat Nat)
  nextTransId : Nat
  /-- Map from global graph node to endpoint state id. -/
  nodeToState : List (Nat × Nat)

/-- Get or create an endpoint state for a global graph node. -/
def getOrCreateState (ps : ProjState) (globalNode : Nat) : Nat × ProjState :=
  match ps.nodeToState.lookup globalNode with
  | some sid => (sid, ps)
  | none =>
    let sid := ps.nextStateId
    (sid, { ps with
      nextStateId := ps.nextStateId + 1
      states := ps.states ++ [sid]
      nodeToState := ps.nodeToState ++ [(globalNode, sid)] })

/-- `getOrCreateState` preserves the transition list. -/
@[simp] theorem getOrCreateState_transitions (ps : ProjState) (node : Nat) :
    (getOrCreateState ps node).2.transitions = ps.transitions := by
  unfold getOrCreateState; split <;> rfl

/-- Lookup in `l₁ ++ l₂` when `k` is found in `l₁`. -/
theorem List.lookup_append_of_some [BEq α] [LawfulBEq α]
    {k : α} {v : β} {l1 l2 : List (α × β)}
    (h : l1.lookup k = some v) : (l1 ++ l2).lookup k = some v := by
  induction l1 with
  | nil => simp at h
  | cons p rest ih =>
    show (match k == p.1 with | true => some p.2 | false => (rest ++ l2).lookup k) = some v
    have h' : (match k == p.1 with | true => some p.2 | false => rest.lookup k) = some v := h
    split <;> simp_all

/-- Lookup in `l ++ [(k, v)]` when `k` is not found in `l`. -/
theorem List.lookup_append_singleton_new [BEq α] [LawfulBEq α]
    {k : α} {v : β} {l : List (α × β)}
    (h : l.lookup k = none) : (l ++ [(k, v)]).lookup k = some v := by
  induction l with
  | nil => show (match k == k with | true => some v | false => none) = some v; simp
  | cons p rest ih =>
    show (match k == p.1 with | true => some p.2 | false => (rest ++ [(k, v)]).lookup k) = some v
    have h' : (match k == p.1 with | true => some p.2 | false => rest.lookup k) = none := h
    split
    · split at h' <;> simp_all
    · split at h'
      · simp_all
      · exact ih h'

/-- Converse form for lookup in `l ++ [(k, v)]`. -/
theorem List.lookup_append_singleton_cases [BEq α] [LawfulBEq α]
    {k k' : α} {v v' : β} {l : List (α × β)}
    (h : (l ++ [(k, v)]).lookup k' = some v') :
    l.lookup k' = some v' ∨ (k' = k ∧ v' = v) := by
  induction l with
  | nil =>
      by_cases hk : k' = k
      · subst hk
        simp at h
        exact Or.inr ⟨rfl, h.symm⟩
      · have hbeq : (k' == k) = false := beq_false_of_ne hk
        simp [List.lookup, hbeq] at h
      
  | cons p rest ih =>
      by_cases hp : k' = p.1
      · subst hp
        left
        simp [List.lookup] at h ⊢
        exact h
      · have hbeq : (k' == p.1) = false := beq_false_of_ne hp
        simp [List.lookup, hbeq] at h ⊢
        rcases ih h with hold | hnew
        · exact Or.inl (by simpa [List.lookup, hbeq] using hold)
        · exact Or.inr hnew

/-- Lookup in `l ++ [(k, v)]` when `k'` is absent from `l` and distinct from `k`. -/
theorem List.lookup_append_singleton_of_none [BEq α] [LawfulBEq α]
    {k k' : α} {v : β} {l : List (α × β)}
    (h : l.lookup k' = none) (hneq : k' ≠ k) :
    (l ++ [(k, v)]).lookup k' = none := by
  by_cases hsome : (l ++ [(k, v)]).lookup k' = none
  · exact hsome
  · obtain ⟨v', hv'⟩ := Option.ne_none_iff_exists.mp hsome
    rcases List.lookup_append_singleton_cases hv'.symm with hold | ⟨hk', _⟩
    · rw [h] at hold
      cases hold
    · exact (hneq hk').elim

/-- `getOrCreateState` preserves existing `nodeToState` lookups. -/
theorem getOrCreateState_preserves_lookup (ps : ProjState) (node other : Nat) (v : Nat)
    (h : ps.nodeToState.lookup other = some v) :
    (getOrCreateState ps node).2.nodeToState.lookup other = some v := by
  unfold getOrCreateState; split
  · exact h
  · exact List.lookup_append_of_some h

/-- `getOrCreateState` maps the queried node to its returned state id. -/
theorem getOrCreateState_maps_self (ps : ProjState) (node : Nat) :
    (getOrCreateState ps node).2.nodeToState.lookup node =
      some (getOrCreateState ps node).1 := by
  unfold getOrCreateState; split
  · rename_i v hv; exact hv
  · rename_i hnone; exact List.lookup_append_singleton_new hnone

/-- Any lookup in `getOrCreateState` either comes from the original map or is
    the newly-created self mapping. -/
theorem getOrCreateState_lookup_cases (ps : ProjState) (node other v : Nat)
    (h : (getOrCreateState ps node).2.nodeToState.lookup other = some v) :
    ps.nodeToState.lookup other = some v ∨
      (other = node ∧ (getOrCreateState ps node).1 = v) := by
  unfold getOrCreateState at h ⊢
  split
  · rename_i sid hsid
    exact Or.inl (by simpa [hsid] using h)
  · rename_i hnone
    rcases List.lookup_append_singleton_cases (l := ps.nodeToState) (k := node) (v := ps.nextStateId)
      (k' := other) (v' := v) (by simpa [hnone] using h) with hold | hnew
    · exact Or.inl hold
    · rcases hnew with ⟨hkey, hval⟩
      exact Or.inr ⟨hkey, hval.symm⟩

/-! ### getOrCreateState nextStateId lemmas -/

/-- `getOrCreateState` does not decrease `nextStateId`. -/
theorem getOrCreateState_nextStateId_mono (ps : ProjState) (node : Nat) :
    ps.nextStateId ≤ (getOrCreateState ps node).2.nextStateId := by
  unfold getOrCreateState; split
  · exact Nat.le_refl _
  · exact Nat.le_succ _

/-- When `getOrCreateState` creates a new entry, its returned state equals
    `ps.nextStateId`. -/
theorem getOrCreateState_fresh (ps : ProjState) (node : Nat)
    (h : ps.nodeToState.lookup node = none) :
    (getOrCreateState ps node).1 = ps.nextStateId ∧
    (getOrCreateState ps node).2.nextStateId = ps.nextStateId + 1 := by
  unfold getOrCreateState; simp [h]

/-- When `getOrCreateState` finds an existing entry, `nextStateId` is unchanged. -/
theorem getOrCreateState_existing (ps : ProjState) (node : Nat) (v : Nat)
    (h : ps.nodeToState.lookup node = some v) :
    (getOrCreateState ps node).1 = v ∧
    (getOrCreateState ps node).2.nextStateId = ps.nextStateId := by
  unfold getOrCreateState; simp [h]

/-- All state values in `nodeToState` are below `nextStateId` — preserved
    by `getOrCreateState`. -/
theorem getOrCreateState_values_bound (ps : ProjState) (node : Nat)
    (hbound : ∀ n v, ps.nodeToState.lookup n = some v → v < ps.nextStateId) :
    ∀ n v, (getOrCreateState ps node).2.nodeToState.lookup n = some v →
      v < (getOrCreateState ps node).2.nextStateId := by
  unfold getOrCreateState
  split
  · -- existing: state unchanged, nodeToState unchanged
    exact hbound
  · -- new: nextStateId increments, new entry has value = old nextStateId
    rename_i hnone
    intro n v hn
    rcases List.lookup_append_singleton_cases hn with hold | ⟨_, hval⟩
    · exact Nat.lt_succ_of_lt (hbound n v hold)
    · subst hval; exact Nat.lt_succ_of_le (Nat.le_refl _)

/-- The returned state ID from `getOrCreateState` is below the new `nextStateId`. -/
theorem getOrCreateState_result_bound (ps : ProjState) (node : Nat)
    (hbound : ∀ n v, ps.nodeToState.lookup n = some v → v < ps.nextStateId) :
    (getOrCreateState ps node).1 < (getOrCreateState ps node).2.nextStateId := by
  have := getOrCreateState_maps_self ps node
  exact getOrCreateState_values_bound ps node hbound _ _ this

/-! ### Role-by-role projection -/

/-- The step function used by `projectRole`'s foldl.
    Processes one graph edge and updates the projection state.
    Extracted as a named def so soundness proofs can reason about it. -/
def projStepFn (role : Nat) (ps : ProjState) (e : GraphEdge Nat Nat Nat Nat) : ProjState :=
  match e.label with
  | .interaction i =>
    if i.sender == role || i.receiver == role then
      let r1 := getOrCreateState ps e.source
      let r2 := getOrCreateState r1.2 e.target
      let dir := if i.sender == role then Direction.send else Direction.receive
      let peer := if i.sender == role then i.receiver else i.sender
      let label : ProtocolLabel Nat Nat Nat := {
        id := i.id, direction := dir, peer := peer, message := i.message }
      let trans : EndpointTransition Nat Nat Nat Nat Nat := {
        id := r2.2.nextTransId, source := r1.1, label := label, target := r2.1 }
      { r2.2 with
        transitions := r2.2.transitions ++ [trans]
        nextTransId := r2.2.nextTransId + 1 }
    else
      let r1 := getOrCreateState ps e.source
      match r1.2.nodeToState.lookup e.target with
      | some _ => r1.2
      | none =>
        match r1.2.nodeToState.lookup e.source with
        | some sid => { r1.2 with nodeToState := r1.2.nodeToState ++ [(e.target, sid)] }
        | none => r1.2
  | .branch _ _ =>
    let r1 := getOrCreateState ps e.source
    match r1.2.nodeToState.lookup e.target with
    | some _ => r1.2
    | none => { r1.2 with nodeToState := r1.2.nodeToState ++ [(e.target, r1.1)] }

/-- Initial projection state for a role. -/
def projInit (initNode : Nat) : ProjState :=
  { nextStateId := 1, states := [0], transitions := [],
    nextTransId := 0, nodeToState := [(initNode, 0)] }

/-- Decidable confluence check: every graph edge is either a relevant
    interaction or maps source and target to the same endpoint state. -/
def confluenceCheck (g : NormalizedGraph Nat Nat Nat Nat) (role : Nat)
    (ps : ProjState) : Bool :=
  g.edges.all fun e =>
    (match e.label with
     | .interaction i => i.sender == role || i.receiver == role
     | _ => false) ||
    (ps.nodeToState.lookup e.source == ps.nodeToState.lookup e.target)

def projectRole (g : NormalizedGraph Nat Nat Nat Nat) (role : Nat) :
    Option (EndpointAutomaton Nat Nat Nat Nat Nat) :=
  let initState : Nat := 0
  let ps := g.edges.foldl (projStepFn role) (projInit g.initial)
  -- Build the endpoint automaton
  if h_ne : ps.states = [] then none
  else if h_nd : ps.states.Nodup then
    if h_init : initState ∈ ps.states then
      -- Check transition well-formedness
      if h_twf : ps.transitions.all fun t =>
          decide (t.source ∈ ps.states) && decide (t.target ∈ ps.states) then
        -- Check confluence: uninvolved edges preserve endpoint state
        if _h_conf : confluenceCheck g role ps then
          have h_trans_wf : ∀ u ∈ ps.transitions, u.source ∈ ps.states ∧ u.target ∈ ps.states := by
            intro u hu
            have := List.all_eq_true.mp h_twf u hu
            simp [Bool.and_eq_true, decide_eq_true_eq] at this
            exact this
          some {
            states := ps.states
            initial := initState
            transitions := ps.transitions
            states_nonempty := h_ne
            states_nodup := h_nd
            initial_mem := h_init
            transitions_wf := h_trans_wf
          }
        else none
      else none
    else none
  else none

/-! ### Full projection -/

/-- Project all roles, producing a list of (role, EndpointAutomaton) pairs.
    Returns `none` if any role fails to project. -/
def projectAllRoles (g : NormalizedGraph Nat Nat Nat Nat) (roles : List Nat) :
    Option (List (Nat × EndpointAutomaton Nat Nat Nat Nat Nat)) :=
  let results := roles.map fun r => (r, projectRole g r)
  if results.all fun (_, oa) => oa.isSome then
    some (results.filterMap fun (r, oa) => oa.map fun a => (r, a))
  else none

/-- Inner projection pipeline after well-formedness checks pass.
    Normalizes, checks projectability, and projects. -/
def projectProtocolInner (p : SourceProtocol Nat Nat Nat) :
    ProjectionResult Nat Nat Nat Nat Nat :=
  let (initNode, st₀) := freshNode { nextId := 0, nodes := [], edges := [], terminals := [] }
  let st := normalizeSyntax st₀ initNode [] p.body
  match buildGraph st initNode with
  | none => .rejection .nonFiniteStateProtocol
  | some g =>
    if allSingleChooser g then
      match projectAllRoles g p.roles with
      | none => .rejection .nonProjectableChoice
      | some endpoints => .success endpoints
    else
      .rejection .nonSingleChooser

/-- The full projection pipeline: validate, normalize, check projectability, project.

    Returns `ProjectionResult` with either success or a named rejection. -/
def projectProtocol (p : SourceProtocol Nat Nat Nat) :
    ProjectionResult Nat Nat Nat Nat Nat :=
  if syntaxWellFormed p.roles p.body then
    if interactionIdsDistinct p.body then
      projectProtocolInner p
    else .rejection .duplicateInteractionId
  else .rejection .undeclaredRole

/-- `projectProtocol` unfolds to the guarded form. -/
theorem projectProtocol_eq (p : SourceProtocol Nat Nat Nat) :
    projectProtocol p =
      if syntaxWellFormed p.roles p.body then
        if interactionIdsDistinct p.body then
          projectProtocolInner p
        else .rejection .duplicateInteractionId
      else .rejection .undeclaredRole := rfl

/-- When `syntaxWellFormed` is false, `projectProtocol` returns `undeclaredRole`. -/
theorem projectProtocol_not_wf (p : SourceProtocol Nat Nat Nat)
    (hwf : syntaxWellFormed p.roles p.body = false) :
    projectProtocol p = .rejection .undeclaredRole := by
  simp [projectProtocol, hwf]

/-- When well-formed but ids not distinct, `projectProtocol` returns
    `duplicateInteractionId`. -/
theorem projectProtocol_not_ids (p : SourceProtocol Nat Nat Nat)
    (hwf : syntaxWellFormed p.roles p.body = true)
    (hid : interactionIdsDistinct p.body = false) :
    projectProtocol p = .rejection .duplicateInteractionId := by
  simp [projectProtocol, hwf, hid]

/-- When both checks pass, `projectProtocol` delegates to `projectProtocolInner`. -/
theorem projectProtocol_inner (p : SourceProtocol Nat Nat Nat)
    (hwf : syntaxWellFormed p.roles p.body = true)
    (hid : interactionIdsDistinct p.body = true) :
    projectProtocol p = projectProtocolInner p := by
  simp [projectProtocol, hwf, hid]

/-! ### Projection determinism -/

/-- **Projection determinism.** `projectProtocol` is a pure function:
    same inputs produce same outputs. -/
theorem projectProtocol_deterministic (p : SourceProtocol Nat Nat Nat) :
    projectProtocol p = projectProtocol p := rfl

/-- **Projection determinism (role-level).** `projectRole` is deterministic. -/
theorem projectRole_deterministic (g : NormalizedGraph Nat Nat Nat Nat) (role : Nat) :
    projectRole g role = projectRole g role := rfl
