/-
  Projection normalization: source protocol syntax → normalized global graph.

  This file now contains only the executable normalization core needed by the
  retained projection pipeline.
-/
import ProjectionDefs

/-! ### Normalization state -/

/-- Normalization accumulator: next fresh node id, accumulated nodes,
    edges, and terminals. -/
structure NormState where
  nextId : Nat
  nodes : List Nat
  edges : List (GraphEdge Nat Nat Nat Nat)
  terminals : List Nat

/-- Allocate a fresh node, returning the allocated node id and updated state. -/
def freshNode (st : NormState) : Nat × NormState :=
  (st.nextId, { st with nextId := st.nextId + 1, nodes := st.nodes ++ [st.nextId] })

/-! ### Source validation -/

/-- Check that all interactions reference declared roles and satisfy
    `sender ≠ receiver`. -/
def syntaxWellFormed (roles : List Nat) : ProtocolSyntax Nat Nat Nat → Bool
  | .done => true
  | .interact i next =>
      decide (i.sender ∈ roles) &&
      decide (i.receiver ∈ roles) &&
      decide (i.sender ≠ i.receiver) &&
      syntaxWellFormed roles next
  | .choice _ [] => true
  | .choice chooser ((_lbl, body) :: rest) =>
      syntaxWellFormed roles body && syntaxWellFormed roles (.choice chooser rest)
  | .loop _ body => syntaxWellFormed roles body
  | .continueLoop _ => true

/-- Collect all interaction ids from a protocol syntax tree. -/
def collectInteractionIds : ProtocolSyntax Nat Nat Nat → List Nat
  | .done => []
  | .interact i next => i.id :: collectInteractionIds next
  | .choice _ [] => []
  | .choice chooser ((_lbl, body) :: rest) =>
      collectInteractionIds body ++ collectInteractionIds (.choice chooser rest)
  | .loop _ body => collectInteractionIds body
  | .continueLoop _ => []

/-- Check that interaction ids are distinct. -/
def interactionIdsDistinct (syn : ProtocolSyntax Nat Nat Nat) : Bool :=
  (collectInteractionIds syn).Nodup

/-! ### Core normalization -/

/-- Normalize a protocol syntax tree into graph components. -/
def normalizeSyntax (st : NormState) (entryNode : Nat)
    (loopMap : List (Nat × Nat)) : ProtocolSyntax Nat Nat Nat → NormState
  | .done =>
      { st with terminals := st.terminals ++ [entryNode] }
  | .interact interaction next =>
      let (nextNode, st') := freshNode st
      let edge : GraphEdge Nat Nat Nat Nat :=
        { source := entryNode, label := .interaction interaction, target := nextNode }
      let st'' := { st' with edges := st'.edges ++ [edge] }
      normalizeSyntax st'' nextNode loopMap next
  | .choice _ [] =>
      { st with terminals := st.terminals ++ [entryNode] }
  | .choice chooser ((branchLabel, body) :: rest) =>
      let (branchNode, st') := freshNode st
      let edge : GraphEdge Nat Nat Nat Nat :=
        { source := entryNode, label := .branch chooser branchLabel, target := branchNode }
      let st'' := { st' with edges := st'.edges ++ [edge] }
      let st''' := normalizeSyntax st'' branchNode loopMap body
      normalizeSyntax st''' entryNode loopMap (.choice chooser rest)
  | .loop loopId body =>
      let loopMap' := (loopId, entryNode) :: loopMap
      normalizeSyntax st entryNode loopMap' body
  | .continueLoop loopId =>
      match loopMap.lookup loopId with
      | some targetNode =>
          let backEdge : GraphEdge Nat Nat Nat Nat :=
            { source := entryNode, label := .branch 0 loopId, target := targetNode }
          { st with edges := st.edges ++ [backEdge] }
      | none =>
          { st with terminals := st.terminals ++ [entryNode] }

/-! ### Graph construction -/

/-- Check that all terminals are declared nodes. -/
def terminalsValid (terminals nodes : List Nat) : Bool :=
  terminals.all (fun t => decide (t ∈ nodes))

/-- Check that all edge sources and targets are declared nodes. -/
def edgesValid (edges : List (GraphEdge Nat Nat Nat Nat)) (nodes : List Nat) : Bool :=
  edges.all (fun e => decide (e.source ∈ nodes) && decide (e.target ∈ nodes))

/-- Build a normalized graph from a normalization state, if well formed. -/
def buildGraph (st : NormState) (initNode : Nat) :
    Option (NormalizedGraph Nat Nat Nat Nat) :=
  if h_ne : st.nodes = [] then none
  else if h_init : initNode ∈ st.nodes then
    if h_nd : st.nodes.Nodup then
      if h_term : terminalsValid st.terminals st.nodes then
        if h_edge : edgesValid st.edges st.nodes then
          have h_terminals : ∀ t ∈ st.terminals, t ∈ st.nodes := by
            intro t ht
            simp [terminalsValid, List.all_eq_true] at h_term
            exact h_term t ht
          have h_edges : ∀ e ∈ st.edges, e.source ∈ st.nodes ∧ e.target ∈ st.nodes := by
            intro e he
            simp [edgesValid, List.all_eq_true, Bool.and_eq_true, decide_eq_true_eq] at h_edge
            exact h_edge e he
          some {
            nodes := st.nodes
            initial := initNode
            terminals := st.terminals
            edges := st.edges
            nodes_nonempty := h_ne
            nodes_nodup := h_nd
            initial_mem := h_init
            terminals_sub := h_terminals
            edges_wf := h_edges
          }
        else none
      else none
    else none
  else none

/-- Normalize a source protocol into a normalized global graph. -/
def normalizeProtocol (p : SourceProtocol Nat Nat Nat) :
    Option (NormalizedGraph Nat Nat Nat Nat) :=
  if ¬ syntaxWellFormed p.roles p.body then none
  else if ¬ interactionIdsDistinct p.body then none
  else
    let (initNode, st₀) := freshNode { nextId := 0, nodes := [], edges := [], terminals := [] }
    let st := normalizeSyntax st₀ initNode [] p.body
    buildGraph st initNode

/-! ### Normalization shape predicate -/

/-- For each interaction edge at position `k` in `g.edges`, its target node
    does not appear as source or target of any edge at position `j < k`,
    and does not equal `g.initial`.

    This holds for graphs produced by `normalizeSyntax` because interaction-edge
    targets are allocated by `freshNode` with IDs strictly above all previously
    used IDs. The predicate is decidable and can be checked computationally on
    any concrete normalized graph. -/
def InteractionTargetsFresh (g : NormalizedGraph Nat Nat Nat Nat) : Prop :=
  ∀ (k : Nat) (hk : k < g.edges.length),
    let e := g.edges[k]
    ∀ (i : MessageInteraction Nat Nat Nat), e.label = .interaction i →
    e.target ≠ g.initial ∧
    ∀ (j : Nat) (hj : j < k),
      let e' := g.edges[j]'(by omega)
      e.target ≠ e'.source ∧ e.target ≠ e'.target

/-! ### Normalization-state invariant and InteractionTargetsFresh proof -/

/-- Edge-list freshness invariant used to prove `InteractionTargetsFresh`.
    Parameterized by `lb`, a lower bound on interaction-edge targets (instantiated
    with the initial `nextId` value from the pipeline). -/
def EdgesInv (edges : List (GraphEdge Nat Nat Nat Nat)) (nextId lb : Nat) : Prop :=
  lb ≤ nextId ∧
  (∀ e ∈ edges, e.source < nextId ∧ e.target < nextId) ∧
  (∀ (k : Nat) (hk : k < edges.length),
    ∀ (i : MessageInteraction Nat Nat Nat), edges[k].label = .interaction i →
    edges[k].target ≥ lb ∧
    (∀ (j : Nat) (hj : j < k),
      edges[k].target > (edges[j]'(by omega)).source ∧
      edges[k].target > (edges[j]'(by omega)).target))

/-- Syntax tree size for well-founded recursion on `ProtocolSyntax`. -/
def ProtocolSyntax.size : ProtocolSyntax Nat Nat Nat → Nat
  | .done => 1
  | .interact _ next => 1 + next.size
  | .choice _ [] => 1
  | .choice chooser ((_lbl, body) :: rest) => 1 + body.size + (ProtocolSyntax.choice chooser rest).size
  | .loop _ body => 1 + body.size
  | .continueLoop _ => 1

/-- `normalizeSyntax` never decreases `nextId`. -/
theorem normalizeSyntax_nextId_mono (st : NormState) (entryNode : Nat)
    (loopMap : List (Nat × Nat)) (syn : ProtocolSyntax Nat Nat Nat) :
    st.nextId ≤ (normalizeSyntax st entryNode loopMap syn).nextId := by
  match syn with
  | .done => simp [normalizeSyntax]
  | .interact interaction next =>
    simp only [normalizeSyntax, freshNode]
    have := normalizeSyntax_nextId_mono
      ⟨st.nextId + 1, st.nodes ++ [st.nextId],
       st.edges ++ [⟨entryNode, .interaction interaction, st.nextId⟩], st.terminals⟩
      st.nextId loopMap next
    dsimp at this; omega
  | .choice _ [] => simp [normalizeSyntax]
  | .choice chooser ((branchLabel, body) :: rest) =>
    simp only [normalizeSyntax, freshNode]
    have h1 := normalizeSyntax_nextId_mono
      ⟨st.nextId + 1, st.nodes ++ [st.nextId],
       st.edges ++ [⟨entryNode, .branch chooser branchLabel, st.nextId⟩], st.terminals⟩
      st.nextId loopMap body
    dsimp at h1
    have h2 := normalizeSyntax_nextId_mono
      (normalizeSyntax
        ⟨st.nextId + 1, st.nodes ++ [st.nextId],
         st.edges ++ [⟨entryNode, .branch chooser branchLabel, st.nextId⟩], st.terminals⟩
        st.nextId loopMap body)
      entryNode loopMap (.choice chooser rest)
    omega
  | .loop loopId body =>
    simp only [normalizeSyntax]; exact normalizeSyntax_nextId_mono st entryNode _ body
  | .continueLoop loopId =>
    simp only [normalizeSyntax]; split <;> simp
  termination_by syn.size
  decreasing_by all_goals (simp_all [ProtocolSyntax.size]; try omega)

/-- The invariant is preserved when `nextId` grows (edges unchanged). -/
theorem EdgesInv_weaken (edges : List (GraphEdge Nat Nat Nat Nat)) {n1 n2 lb : Nat}
    (h : n1 ≤ n2) (hinv : EdgesInv edges n1 lb) : EdgesInv edges n2 lb := by
  obtain ⟨hlb, hbounds, hfresh⟩ := hinv
  exact ⟨by omega, fun e he => ⟨by have := (hbounds e he).1; omega,
    by have := (hbounds e he).2; omega⟩, hfresh⟩

/-- Appending a branch (non-interaction) edge preserves the invariant. -/
theorem EdgesInv_append_branch (edges : List (GraphEdge Nat Nat Nat Nat)) {nextId lb : Nat}
    (e : GraphEdge Nat Nat Nat Nat)
    (hinv : EdgesInv edges nextId lb)
    (he_s : e.source < nextId) (he_t : e.target < nextId)
    (he_notint : ∀ (i : MessageInteraction Nat Nat Nat), e.label ≠ .interaction i) :
    EdgesInv (edges ++ [e]) nextId lb := by
  obtain ⟨hlb, hbounds, hfresh⟩ := hinv
  have hlen : (edges ++ [e]).length = edges.length + 1 := by simp
  refine ⟨hlb, ?_, ?_⟩
  · intro x hx
    rcases List.mem_append.mp hx with hx | hx
    · exact hbounds x hx
    · cases List.mem_singleton.mp hx; exact ⟨he_s, he_t⟩
  · intro k hk i hi
    rw [hlen] at hk
    by_cases hk_old : k < edges.length
    · have hgk : (edges ++ [e])[k]'(by rw [hlen]; omega) = edges[k] :=
        List.getElem_append_left ..
      rw [hgk] at hi ⊢
      obtain ⟨hge, hprev⟩ := hfresh k hk_old i hi
      refine ⟨hge, fun j hj => ?_⟩
      have hgj : (edges ++ [e])[j]'(by rw [hlen]; omega) = edges[j]'(by omega) :=
        List.getElem_append_left ..
      rw [hgj]; exact hprev j hj
    · have hkeq : k = edges.length := by omega
      subst hkeq
      have hgk : (edges ++ [e])[edges.length]'(by rw [hlen]; omega) = e := by
        rw [List.getElem_append_right (by omega)]; simp
      rw [hgk] at hi; exact absurd hi (he_notint i)

/-- Appending an interaction edge with target = nextId, then bumping nextId. -/
theorem EdgesInv_append_interaction (edges : List (GraphEdge Nat Nat Nat Nat)) {nextId lb : Nat}
    (e : GraphEdge Nat Nat Nat Nat)
    (hinv : EdgesInv edges nextId lb)
    (he_s : e.source < nextId) (he_t : e.target = nextId) :
    EdgesInv (edges ++ [e]) (nextId + 1) lb := by
  obtain ⟨hlb, hbounds, hfresh⟩ := hinv
  have hlen : (edges ++ [e]).length = edges.length + 1 := by simp
  refine ⟨by omega, ?_, ?_⟩
  · intro x hx
    rcases List.mem_append.mp hx with hx | hx
    · have := hbounds x hx; exact ⟨by omega, by omega⟩
    · cases List.mem_singleton.mp hx; exact ⟨by omega, by rw [he_t]; omega⟩
  · intro k hk i hi
    rw [hlen] at hk
    by_cases hk_old : k < edges.length
    · have hgk : (edges ++ [e])[k]'(by rw [hlen]; omega) = edges[k] :=
        List.getElem_append_left ..
      rw [hgk] at hi ⊢
      obtain ⟨hge, hprev⟩ := hfresh k hk_old i hi
      refine ⟨hge, fun j hj => ?_⟩
      have hgj : (edges ++ [e])[j]'(by rw [hlen]; omega) = edges[j]'(by omega) :=
        List.getElem_append_left ..
      rw [hgj]; exact hprev j hj
    · have hkeq : k = edges.length := by omega
      subst hkeq
      have hgk : (edges ++ [e])[edges.length]'(by rw [hlen]; omega) = e := by
        rw [List.getElem_append_right (by omega)]; simp
      rw [hgk] at hi ⊢
      refine ⟨by omega, fun j hj => ?_⟩
      have hj_lt : j < edges.length := by omega
      have hgj : (edges ++ [e])[j]'(by rw [hlen]; omega) = edges[j]'(by omega) :=
        List.getElem_append_left ..
      rw [hgj]
      have := hbounds _ (List.getElem_mem hj_lt)
      rw [he_t]; exact ⟨by omega, by omega⟩

/-- Lookup in a list of pairs yields a value from the list. -/
private theorem lookup_mem_value (loopMap : List (Nat × Nat)) (k v : Nat)
    (h : loopMap.lookup k = some v) : ∃ p ∈ loopMap, p.2 = v := by
  induction loopMap with
  | nil => simp [List.lookup] at h
  | cons hd tl ih =>
    simp [List.lookup] at h; split at h
    · exact ⟨hd, .head _, by injection h⟩
    · obtain ⟨p, hp, hpv⟩ := ih h; exact ⟨p, .tail _ hp, hpv⟩

/-- Intermediate state after processing an interaction edge. -/
private def mkInteractState (st : NormState) (entryNode : Nat)
    (interaction : MessageInteraction Nat Nat Nat) : NormState :=
  ⟨st.nextId + 1, st.nodes ++ [st.nextId],
   st.edges ++ [⟨entryNode, .interaction interaction, st.nextId⟩], st.terminals⟩

/-- Intermediate state after processing a branch edge. -/
private def mkBranchState (st : NormState) (entryNode chooser branchLabel : Nat) : NormState :=
  ⟨st.nextId + 1, st.nodes ++ [st.nextId],
   st.edges ++ [⟨entryNode, .branch chooser branchLabel, st.nextId⟩], st.terminals⟩

@[simp] private theorem mkInteractState_nextId (st : NormState) (e : Nat)
    (i : MessageInteraction Nat Nat Nat) :
    (mkInteractState st e i).nextId = st.nextId + 1 := rfl
@[simp] private theorem mkInteractState_edges (st : NormState) (e : Nat)
    (i : MessageInteraction Nat Nat Nat) :
    (mkInteractState st e i).edges = st.edges ++ [⟨e, .interaction i, st.nextId⟩] := rfl
@[simp] private theorem mkBranchState_nextId (st : NormState) (e c bl : Nat) :
    (mkBranchState st e c bl).nextId = st.nextId + 1 := rfl
@[simp] private theorem mkBranchState_edges (st : NormState) (e c bl : Nat) :
    (mkBranchState st e c bl).edges = st.edges ++ [⟨e, .branch c bl, st.nextId⟩] := rfl

private theorem normalizeSyntax_interact (st : NormState) (entryNode : Nat)
    (loopMap : List (Nat × Nat))
    (interaction : MessageInteraction Nat Nat Nat) (next : ProtocolSyntax Nat Nat Nat) :
    normalizeSyntax st entryNode loopMap (.interact interaction next) =
    normalizeSyntax (mkInteractState st entryNode interaction) st.nextId loopMap next := by
  simp [normalizeSyntax, freshNode, mkInteractState]

private theorem normalizeSyntax_choice_cons (st : NormState) (entryNode : Nat)
    (loopMap : List (Nat × Nat))
    (chooser branchLabel : Nat) (body : ProtocolSyntax Nat Nat Nat)
    (rest : List (Nat × ProtocolSyntax Nat Nat Nat)) :
    normalizeSyntax st entryNode loopMap (.choice chooser ((branchLabel, body) :: rest)) =
    normalizeSyntax
      (normalizeSyntax (mkBranchState st entryNode chooser branchLabel) st.nextId loopMap body)
      entryNode loopMap (.choice chooser rest) := by
  simp [normalizeSyntax, freshNode, mkBranchState]

/-- `normalizeSyntax` preserves the edge freshness invariant. -/
theorem normalizeSyntax_inv (lb : Nat) (st : NormState) (entryNode : Nat)
    (loopMap : List (Nat × Nat)) (syn : ProtocolSyntax Nat Nat Nat)
    (hinv : EdgesInv st.edges st.nextId lb)
    (hentry : entryNode < st.nextId)
    (hloop : ∀ p ∈ loopMap, p.2 < st.nextId) :
    EdgesInv (normalizeSyntax st entryNode loopMap syn).edges
             (normalizeSyntax st entryNode loopMap syn).nextId lb := by
  match syn with
  | .done => simp only [normalizeSyntax]; exact hinv
  | .interact interaction next =>
    rw [normalizeSyntax_interact]
    have hinv' : EdgesInv (mkInteractState st entryNode interaction).edges
                          (mkInteractState st entryNode interaction).nextId lb := by
      simp only [mkInteractState_edges, mkInteractState_nextId]
      exact EdgesInv_append_interaction st.edges _ hinv hentry rfl
    exact normalizeSyntax_inv lb (mkInteractState st entryNode interaction) st.nextId loopMap next
      hinv' (by simp) (fun p hp => by simp; have := hloop p hp; omega)
  | .choice _ [] => simp only [normalizeSyntax]; exact hinv
  | .choice chooser ((branchLabel, body) :: rest) =>
    rw [normalizeSyntax_choice_cons]
    have hinv' : EdgesInv (mkBranchState st entryNode chooser branchLabel).edges
                          (mkBranchState st entryNode chooser branchLabel).nextId lb := by
      simp only [mkBranchState_edges, mkBranchState_nextId]
      have h1 : EdgesInv st.edges (st.nextId + 1) lb :=
        EdgesInv_weaken st.edges (by omega : st.nextId ≤ st.nextId + 1) hinv
      exact EdgesInv_append_branch st.edges
        ⟨entryNode, .branch chooser branchLabel, st.nextId⟩
        h1 (show entryNode < st.nextId + 1 by omega)
           (show st.nextId < st.nextId + 1 by omega)
           (fun i => by simp)
    have hinv_body := normalizeSyntax_inv lb
      (mkBranchState st entryNode chooser branchLabel) st.nextId loopMap body
      hinv' (by simp) (fun p hp => by simp; have := hloop p hp; omega)
    have hmono := normalizeSyntax_nextId_mono
      (mkBranchState st entryNode chooser branchLabel) st.nextId loopMap body
    exact normalizeSyntax_inv lb _ entryNode loopMap (.choice chooser rest)
      hinv_body (by simp at hmono; omega)
      (fun p hp => by have := hloop p hp; simp at hmono; omega)
  | .loop loopId body =>
    simp only [normalizeSyntax]
    exact normalizeSyntax_inv lb st entryNode ((loopId, entryNode) :: loopMap) body hinv hentry
      (fun p hp => by
        cases hp with
        | head => exact hentry
        | tail _ h => exact hloop p h)
  | .continueLoop loopId =>
    simp only [normalizeSyntax]
    split
    · rename_i targetNode hlook
      have htarget : targetNode < st.nextId := by
        obtain ⟨p, hp, rfl⟩ := lookup_mem_value _ _ _ hlook; exact hloop p hp
      exact EdgesInv_append_branch st.edges _ hinv hentry htarget (fun i => by simp)
    · exact hinv
  termination_by syn.size
  decreasing_by all_goals (simp_all [ProtocolSyntax.size]; try omega)

/-- `buildGraph` preserves edges and initial node. -/
private theorem buildGraph_edges_initial (st : NormState) (initNode : Nat)
    (g : NormalizedGraph Nat Nat Nat Nat)
    (h : buildGraph st initNode = some g) :
    g.edges = st.edges ∧ g.initial = initNode := by
  unfold buildGraph at h
  split at h; · exact absurd h nofun
  split at h
  · split at h
    · split at h
      · split at h
        · cases h; exact ⟨rfl, rfl⟩
        · exact absurd h nofun
      · exact absurd h nofun
    · exact absurd h nofun
  · exact absurd h nofun

/-- When `normalizeProtocol p = some g`, the graph satisfies `InteractionTargetsFresh`.

    Interaction-edge targets are allocated by `freshNode` with IDs strictly above
    all previously used IDs. The proof threads an `EdgesInv` invariant through
    `normalizeSyntax` by structural induction, then extracts the freshness
    property from the final state. -/
theorem normalizeProtocol_interactionTargetsFresh
    (p : SourceProtocol Nat Nat Nat)
    (g : NormalizedGraph Nat Nat Nat Nat)
    (h : normalizeProtocol p = some g) :
    InteractionTargetsFresh g := by
  simp only [normalizeProtocol] at h
  split at h; · exact absurd h nofun
  split at h; · exact absurd h nofun
  simp only [freshNode, Nat.zero_add, List.nil_append] at h
  -- Establish the invariant on the initial empty-edge state with lb = 1.
  -- After freshNode, nextId = 1 and initNode = 0, so all interaction targets ≥ 1 > 0.
  have hinit : EdgesInv ([] : List (GraphEdge Nat Nat Nat Nat)) 1 1 :=
    ⟨Nat.le_refl _, nofun, fun _ hk => absurd hk (by simp)⟩
  have hinv := normalizeSyntax_inv 1 ⟨1, [0], [], []⟩ 0 [] p.body
    hinit (show (0 : Nat) < 1 by omega) (fun _ hp => absurd hp nofun)
  have ⟨hedges, hinit_eq⟩ := buildGraph_edges_initial _ 0 g h
  obtain ⟨_, _, hfresh⟩ := hinv
  -- Prove InteractionTargetsFresh by transferring through hedges
  intro k hk e_val mi h_label
  have hk' : k < (normalizeSyntax ⟨1, [0], [], []⟩ 0 [] p.body).edges.length := by
    rwa [← hedges]
  have h_eq : g.edges[k] =
      (normalizeSyntax ⟨1, [0], [], []⟩ 0 [] p.body).edges[k]'hk' := by congr 1
  have hf := hfresh k hk' mi (h_eq ▸ h_label)
  constructor
  · intro heq
    have : ((normalizeSyntax ⟨1, [0], [], []⟩ 0 [] p.body).edges[k]'hk').target = g.initial := by
      rw [← h_eq]; exact heq
    rw [hinit_eq] at this; omega
  · intro j hj e'_val
    have hj_lt : j < g.edges.length := by omega
    have h_eq_j : g.edges[j]'hj_lt =
        (normalizeSyntax ⟨1, [0], [], []⟩ 0 [] p.body).edges[j]'(by rwa [← hedges]) := by
      congr 1
    have ⟨h1, h2⟩ := hf.2 j hj
    constructor
    · intro heq
      have hk_t : e_val.target =
          ((normalizeSyntax ⟨1, [0], [], []⟩ 0 [] p.body).edges[k]'hk').target := by
        show g.edges[k].target = _; rw [h_eq]
      have hj_s : e'_val.source =
          ((normalizeSyntax ⟨1, [0], [], []⟩ 0 [] p.body).edges[j]'(by rwa [← hedges])).source := by
        show g.edges[j].source = _; rw [h_eq_j]
      rw [hk_t, hj_s] at heq; omega
    · intro heq
      have hk_t : e_val.target =
          ((normalizeSyntax ⟨1, [0], [], []⟩ 0 [] p.body).edges[k]'hk').target := by
        show g.edges[k].target = _; rw [h_eq]
      have hj_t : e'_val.target =
          ((normalizeSyntax ⟨1, [0], [], []⟩ 0 [] p.body).edges[j]'(by rwa [← hedges])).target := by
        show g.edges[j].target = _; rw [h_eq_j]
      rw [hk_t, hj_t] at heq; omega

/-! ### G2: `graphInteractionsWF` from `syntaxWellFormed` -/

/-- Edge-level well-formedness invariant: all interaction edges have sender ≠ receiver. -/
def EdgesWF (edges : List (GraphEdge Nat Nat Nat Nat)) : Prop :=
  ∀ e ∈ edges, ∀ i : MessageInteraction Nat Nat Nat,
    e.label = .interaction i → i.sender ≠ i.receiver

/-- Empty edge list is trivially well-formed. -/
theorem EdgesWF_nil : EdgesWF [] := fun _ h => absurd h (by simp)

/-- Appending a non-interaction edge preserves `EdgesWF`. -/
theorem EdgesWF_append_noninteraction (edges : List (GraphEdge Nat Nat Nat Nat))
    (e : GraphEdge Nat Nat Nat Nat)
    (hwf : EdgesWF edges)
    (he : ∀ i : MessageInteraction Nat Nat Nat, e.label ≠ .interaction i) :
    EdgesWF (edges ++ [e]) := by
  intro x hx i hi
  rcases List.mem_append.mp hx with hx | hx
  · exact hwf x hx i hi
  · cases List.mem_singleton.mp hx; exact absurd hi (he i)

/-- Appending an interaction edge with sender ≠ receiver preserves `EdgesWF`. -/
theorem EdgesWF_append_interaction (edges : List (GraphEdge Nat Nat Nat Nat))
    (e : GraphEdge Nat Nat Nat Nat)
    (hwf : EdgesWF edges)
    (i : MessageInteraction Nat Nat Nat)
    (he : e.label = .interaction i)
    (hne : i.sender ≠ i.receiver) :
    EdgesWF (edges ++ [e]) := by
  intro x hx i' hi'
  rcases List.mem_append.mp hx with hx | hx
  · exact hwf x hx i' hi'
  · cases List.mem_singleton.mp hx
    rw [he] at hi'; cases hi'; exact hne

/-- `normalizeSyntax` preserves `EdgesWF` when `syntaxWellFormed` holds. -/
theorem normalizeSyntax_wf (roles : List Nat) (st : NormState) (entryNode : Nat)
    (loopMap : List (Nat × Nat)) (syn : ProtocolSyntax Nat Nat Nat)
    (hwf_edges : EdgesWF st.edges)
    (hwf_syn : syntaxWellFormed roles syn = true) :
    EdgesWF (normalizeSyntax st entryNode loopMap syn).edges := by
  match syn with
  | .done => simp only [normalizeSyntax]; exact hwf_edges
  | .interact interaction next =>
    rw [normalizeSyntax_interact]
    simp only [syntaxWellFormed, Bool.and_eq_true, decide_eq_true_eq] at hwf_syn
    have hwf_edges' : EdgesWF (mkInteractState st entryNode interaction).edges := by
      simp only [mkInteractState_edges]
      exact EdgesWF_append_interaction st.edges _ hwf_edges interaction rfl hwf_syn.1.2
    exact normalizeSyntax_wf roles _ _ _ next hwf_edges' hwf_syn.2
  | .choice _ [] => simp only [normalizeSyntax]; exact hwf_edges
  | .choice chooser ((branchLabel, body) :: rest) =>
    rw [normalizeSyntax_choice_cons]
    simp only [syntaxWellFormed, Bool.and_eq_true] at hwf_syn
    have hwf_edges' : EdgesWF (mkBranchState st entryNode chooser branchLabel).edges := by
      simp only [mkBranchState_edges]
      exact EdgesWF_append_noninteraction st.edges _ hwf_edges (fun i => by simp)
    have hwf_body := normalizeSyntax_wf roles _ st.nextId loopMap body hwf_edges' hwf_syn.1
    exact normalizeSyntax_wf roles _ entryNode loopMap (.choice chooser rest) hwf_body hwf_syn.2
  | .loop _loopId body =>
    simp only [normalizeSyntax]
    simp only [syntaxWellFormed] at hwf_syn
    exact normalizeSyntax_wf roles st entryNode _ body hwf_edges hwf_syn
  | .continueLoop loopId =>
    simp only [normalizeSyntax]
    split
    · exact EdgesWF_append_noninteraction st.edges _ hwf_edges (fun i => by simp)
    · exact hwf_edges
  termination_by syn.size
  decreasing_by all_goals (simp_all [ProtocolSyntax.size]; try omega)

/-- When `normalizeProtocol p = some g`, every interaction edge in the graph
    has sender ≠ receiver. This is the `EdgesWF` form; it is definitionally
    equal to `graphInteractionsWF g` (defined in `ProjectionPaths`). -/
theorem normalizeProtocol_edgesWF
    (p : SourceProtocol Nat Nat Nat)
    (g : NormalizedGraph Nat Nat Nat Nat)
    (h : normalizeProtocol p = some g) :
    EdgesWF g.edges := by
  simp only [normalizeProtocol] at h
  -- First split: ¬ syntaxWellFormed → none, contradicts some g
  split at h
  · exact absurd h nofun
  -- Extract syntaxWellFormed from double negation
  rename_i hwf_not
  have hwf_syn : syntaxWellFormed p.roles p.body = true := by
    cases hsw : syntaxWellFormed p.roles p.body with
    | true => rfl
    | false => exact False.elim (hwf_not (by simp [hsw]))
  -- Second split: ¬ interactionIdsDistinct → none, contradicts some g
  split at h; · exact absurd h nofun
  simp only [freshNode, Nat.zero_add, List.nil_append] at h
  have hwf_edges := normalizeSyntax_wf p.roles ⟨1, [0], [], []⟩ 0 [] p.body EdgesWF_nil hwf_syn
  have ⟨hedges, _⟩ := buildGraph_edges_initial _ 0 g h
  rw [hedges]; exact hwf_edges

/-! ### Purity wrappers retained for compatibility -/

/-- `normalizeSyntax` is deterministic because it is a pure function. -/
theorem normalizeSyntax_deterministic
    (st : NormState) (entryNode : Nat) (loopMap : List (Nat × Nat))
    (syn : ProtocolSyntax Nat Nat Nat) :
    normalizeSyntax st entryNode loopMap syn = normalizeSyntax st entryNode loopMap syn := rfl

/-- `normalizeProtocol` is deterministic because it is a pure function. -/
theorem normalizeProtocol_deterministic (p : SourceProtocol Nat Nat Nat) :
    normalizeProtocol p = normalizeProtocol p := rfl
