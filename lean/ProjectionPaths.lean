/-
  Path and trace infrastructure for projection proofs.

  Provides:
  - Graph and endpoint path datatypes
  - Role-local view (event extraction from graph edges)
  - Label/event conversion functions
  - Compositionality lemmas for traces
  - Step-event correspondence lemmas
  - Trace-set predicates (inRoleLocalTraceSet, inEndpointTraceLanguage)
  - graphInteractionsWF predicate
  - transitionFromInteraction predicate
  - Role-local silent/visible edge relations via Relation.ReflTransGen
-/
import ProjectionProject
import Mathlib.Logic.Relation

/-! ### Transition shape predicate -/

/-- A transition's label fields match a source interaction for a role. -/
def transitionFromInteraction (role : Nat) (i : MessageInteraction Nat Nat Nat)
    (trans : EndpointTransition Nat Nat Nat Nat Nat) : Prop :=
  trans.label.id = i.id ∧
  trans.label.message = i.message ∧
  ((i.sender = role ∧ trans.label.direction = .send ∧ trans.label.peer = i.receiver) ∨
   (i.receiver = role ∧ trans.label.direction = .receive ∧ trans.label.peer = i.sender))

/-! ### Graph and endpoint path types -/

/-- A connected path in the normalized graph from node `a` to node `b`. -/
inductive GraphPath (g : NormalizedGraph Nat Nat Nat Nat) : Nat → Nat → Type where
  | nil : GraphPath g n n
  | cons : GraphPath g a b → (e : GraphEdge Nat Nat Nat Nat) →
    e ∈ g.edges → e.source = b → GraphPath g a e.target

/-- Extract the edge list from a graph path. -/
def GraphPath.edges : GraphPath g a b → List (GraphEdge Nat Nat Nat Nat)
  | .nil => []
  | .cons p e _ _ => p.edges ++ [e]

/-- A connected path in an endpoint automaton from state `s₁` to state `s₂`. -/
inductive EndpointPath (ea : EndpointAutomaton Nat Nat Nat Nat Nat) :
    Nat → Nat → Type where
  | nil : EndpointPath ea s s
  | cons : EndpointPath ea s₁ s₂ →
    (t : EndpointTransition Nat Nat Nat Nat Nat) →
    t ∈ ea.transitions → t.source = s₂ → EndpointPath ea s₁ t.target

/-- Extract the transition list from an endpoint path. -/
def EndpointPath.transitions {ea : EndpointAutomaton Nat Nat Nat Nat Nat}
    {s₁ s₂ : Nat} : EndpointPath ea s₁ s₂ →
    List (EndpointTransition Nat Nat Nat Nat Nat)
  | .nil => []
  | .cons p t _ _ => p.transitions ++ [t]

/-! ### Role-local view and event conversion -/

/-- Role-local view: subsequence of interactions involving the role. -/
def roleLocalView (role : Nat)
    : List (GraphEdge Nat Nat Nat Nat) → List (LocalEvent Nat Nat)
  | [] => []
  | e :: rest =>
    match e.label with
    | .interaction i =>
      match interactionToLocalEvent role i with
      | some ev => ev :: roleLocalView role rest
      | none => roleLocalView role rest
    | _ => roleLocalView role rest

/-- Convert a transition label to a local event. -/
def labelToEvent (label : ProtocolLabel Nat Nat Nat) : LocalEvent Nat Nat :=
  match label.direction with
  | .send => .send label.peer label.message
  | .receive => .receive label.peer label.message

/-- Convert endpoint transitions to local events. -/
def endpointTraceToEvents
    : List (EndpointTransition Nat Nat Nat Nat Nat) → List (LocalEvent Nat Nat)
  | [] => []
  | u :: rest => labelToEvent u.label :: endpointTraceToEvents rest

/-! ### Basic trace lemmas -/

/-- **PJ4 (empty).** Empty paths produce empty local views. -/
theorem trace_correspondence_empty (role : Nat) :
    roleLocalView role [] = ([] : List (LocalEvent Nat Nat)) ∧
    endpointTraceToEvents ([] : List (EndpointTransition Nat Nat Nat Nat Nat)) = [] :=
  ⟨rfl, rfl⟩

/-- **PJ4 (send).** A send interaction produces a `send` local event. -/
theorem roleLocalView_send (role peer msg iid : Nat)
    (rest : List (GraphEdge Nat Nat Nat Nat))
    (e : GraphEdge Nat Nat Nat Nat)
    (he : e.label = .interaction ⟨iid, role, peer, msg⟩) :
    roleLocalView role (e :: rest) =
      LocalEvent.send peer msg :: roleLocalView role rest := by
  simp only [roleLocalView, he, interactionToLocalEvent, beq_self_eq_true, ite_true]

/-- **PJ4 (receive).** A receive interaction produces a `receive` local event. -/
theorem roleLocalView_receive (role peer msg iid : Nat)
    (rest : List (GraphEdge Nat Nat Nat Nat))
    (e : GraphEdge Nat Nat Nat Nat)
    (he : e.label = .interaction ⟨iid, peer, role, msg⟩)
    (hne : peer ≠ role) :
    roleLocalView role (e :: rest) =
      LocalEvent.receive peer msg :: roleLocalView role rest := by
  simp only [roleLocalView, he, interactionToLocalEvent,
    beq_false_of_ne hne, Bool.false_eq_true, ite_false,
    beq_self_eq_true, ite_true]

/-- **PJ4 (skip).** Uninvolved interactions are skipped. -/
theorem roleLocalView_skip (role : Nat)
    (rest : List (GraphEdge Nat Nat Nat Nat))
    (e : GraphEdge Nat Nat Nat Nat)
    (i : MessageInteraction Nat Nat Nat)
    (he : e.label = .interaction i)
    (hns : i.sender ≠ role) (hnr : i.receiver ≠ role) :
    roleLocalView role (e :: rest) = roleLocalView role rest := by
  simp only [roleLocalView, he, interactionToLocalEvent,
    beq_false_of_ne hns, Bool.false_eq_true, ite_false,
    beq_false_of_ne hnr]

/-- **PJ4 (branch skip).** Branch edges contribute no local events. -/
theorem roleLocalView_branch (role : Nat) (rest : List (GraphEdge Nat Nat Nat Nat))
    (e : GraphEdge Nat Nat Nat Nat) (c lbl : Nat)
    (he : e.label = .branch c lbl) :
    roleLocalView role (e :: rest) = roleLocalView role rest := by
  simp [roleLocalView, he]

/-! ### Compositionality -/

/-- `roleLocalView` is compositional over append. -/
theorem roleLocalView_append (role : Nat) (p1 p2 : List (GraphEdge Nat Nat Nat Nat)) :
    roleLocalView role (p1 ++ p2) = roleLocalView role p1 ++ roleLocalView role p2 := by
  induction p1 with
  | nil => simp [roleLocalView]
  | cons e rest ih =>
    simp only [List.cons_append, roleLocalView]
    split
    · rename_i i; split <;> simp [ih]
    · exact ih

/-- `endpointTraceToEvents` is compositional over append. -/
theorem endpointTraceToEvents_append (p1 p2 : List (EndpointTransition Nat Nat Nat Nat Nat)) :
    endpointTraceToEvents (p1 ++ p2) = endpointTraceToEvents p1 ++ endpointTraceToEvents p2 := by
  induction p1 with
  | nil => simp [endpointTraceToEvents]
  | cons u rest ih => simp [endpointTraceToEvents, ih]

/-! ### Step-event correspondence -/

/-- **PJ4 (step, send).** For a send interaction, the local event from the
    interaction equals the label event from any correctly-shaped transition. -/
theorem step_event_send (role : Nat) (i : MessageInteraction Nat Nat Nat)
    (hsend : i.sender = role)
    (t : EndpointTransition Nat Nat Nat Nat Nat)
    (hdir : t.label.direction = .send)
    (hpeer : t.label.peer = i.receiver)
    (hmsg : t.label.message = i.message) :
    interactionToLocalEvent role i = some (labelToEvent t.label) := by
  simp only [interactionToLocalEvent, show (i.sender == role) = true from beq_iff_eq.mpr hsend,
    ite_true, labelToEvent, hdir, hpeer, hmsg]

/-- **PJ4 (step, receive).** For a receive interaction where the role is not
    the sender, the local event matches the label event. -/
theorem step_event_receive (role : Nat) (i : MessageInteraction Nat Nat Nat)
    (hrecv : i.receiver = role) (hne : i.sender ≠ role)
    (t : EndpointTransition Nat Nat Nat Nat Nat)
    (hdir : t.label.direction = .receive)
    (hpeer : t.label.peer = i.sender)
    (hmsg : t.label.message = i.message) :
    interactionToLocalEvent role i = some (labelToEvent t.label) := by
  simp only [interactionToLocalEvent,
    show (i.sender == role) = false from beq_false_of_ne hne, Bool.false_eq_true, ite_false,
    show (i.receiver == role) = true from beq_iff_eq.mpr hrecv, ite_true,
    labelToEvent, hdir, hpeer, hmsg]

/-- **PJ4 (step, unified).** For any interaction involving the role with a
    correctly-shaped transition, the local event matches. Uses PJ3's
    `transitionFromInteraction` as the transition shape predicate. -/
theorem step_event_unified (role : Nat) (i : MessageInteraction Nat Nat Nat)
    (hne : i.sender ≠ i.receiver)
    (t : EndpointTransition Nat Nat Nat Nat Nat)
    (hti : transitionFromInteraction role i t) :
    interactionToLocalEvent role i = some (labelToEvent t.label) := by
  obtain ⟨_, hmsg, hdir⟩ := hti
  rcases hdir with ⟨hsend, hd, hp⟩ | ⟨hrecv, hd, hp⟩
  · exact step_event_send role i hsend t hd hp hmsg
  · have hne_role : i.sender ≠ role := by
      intro h; rw [h] at hne; exact hne hrecv.symm
    exact step_event_receive role i hrecv hne_role t hd hp hmsg

/-! ### Well-formedness predicate -/

/-- All interactions in the graph have sender ≠ receiver. -/
def graphInteractionsWF (g : NormalizedGraph Nat Nat Nat Nat) : Prop :=
  ∀ e ∈ g.edges, ∀ i : MessageInteraction Nat Nat Nat,
    e.label = .interaction i → i.sender ≠ i.receiver

/-! ### Trace-set predicates -/

/-- An event sequence is in the role-local trace set: there exists a graph
    path from the initial node whose role-local view equals the sequence. -/
def inRoleLocalTraceSet (g : NormalizedGraph Nat Nat Nat Nat) (role : Nat)
    (evs : List (LocalEvent Nat Nat)) : Prop :=
  ∃ b : Nat, ∃ p : GraphPath g g.initial b,
    evs = roleLocalView role p.edges

/-- An event sequence is in the endpoint trace language: there exists a
    connected endpoint path from the initial state whose events equal
    the sequence. -/
def inEndpointTraceLanguage (ea : EndpointAutomaton Nat Nat Nat Nat Nat)
    (evs : List (LocalEvent Nat Nat)) : Prop :=
  ∃ s : Nat, ∃ ep : EndpointPath ea ea.initial s,
    evs = endpointTraceToEvents ep.transitions

/-! ### Role-local silent and visible edge relations -/

/-- A **silent edge** for role `r` in graph `g` is a graph edge that
    does not produce a local event for `r`: either a branch/control edge
    or an interaction edge where `r` is neither sender nor receiver. -/
def SilentEdge (g : NormalizedGraph Nat Nat Nat Nat) (role : Nat)
    (a b : Nat) : Prop :=
  ∃ e ∈ g.edges, e.source = a ∧ e.target = b ∧
    match e.label with
    | .interaction i => i.sender ≠ role ∧ i.receiver ≠ role
    | .branch _ _ => True

/-- Silent reachability: reflexive-transitive closure of `SilentEdge`. -/
def SilentReach (g : NormalizedGraph Nat Nat Nat Nat) (role : Nat) :
    Nat → Nat → Prop :=
  Relation.ReflTransGen (SilentEdge g role)

/-- A **visible step** for role `r`: one relevant interaction edge from
    `a` to `b` that produces a local event. -/
def VisibleEdge (g : NormalizedGraph Nat Nat Nat Nat) (role : Nat)
    (a b : Nat) (ev : LocalEvent Nat Nat) : Prop :=
  ∃ e ∈ g.edges, e.source = a ∧ e.target = b ∧
    ∃ i : MessageInteraction Nat Nat Nat,
      e.label = .interaction i ∧
      interactionToLocalEvent role i = some ev

/-- A **compressed visible step**: silent prefix, one visible step,
    silent suffix.  This is the role-local one-event step relation. -/
def CompressedStep (g : NormalizedGraph Nat Nat Nat Nat) (role : Nat)
    (a b : Nat) (ev : LocalEvent Nat Nat) : Prop :=
  ∃ a' b', SilentReach g role a a' ∧
            VisibleEdge g role a' b' ev ∧
            SilentReach g role b' b

/-- Role-local compressed trace: a sequence of compressed visible steps,
    with silent segments connecting them. -/
inductive CompressedTrace (g : NormalizedGraph Nat Nat Nat Nat) (role : Nat)
    : Nat → Nat → List (LocalEvent Nat Nat) → Prop where
  | nil {a b : Nat} : SilentReach g role a b → CompressedTrace g role a b []
  | cons {a mid b : Nat} {ev : LocalEvent Nat Nat} {evs : List (LocalEvent Nat Nat)} :
           CompressedStep g role a mid ev →
           CompressedTrace g role mid b evs →
           CompressedTrace g role a b (ev :: evs)

/-- A compressed trace from the initial node gives a role-local trace. -/
def inCompressedTraceSet (g : NormalizedGraph Nat Nat Nat Nat) (role : Nat)
    (evs : List (LocalEvent Nat Nat)) : Prop :=
  ∃ b, CompressedTrace g role g.initial b evs

/-! ### CompressedTrace append helpers -/

/-- Appending a silent step to the end of a compressed trace. -/
theorem CompressedTrace.append_silent
    {g : NormalizedGraph Nat Nat Nat Nat} {role : Nat}
    {a b c : Nat} {evs : List (LocalEvent Nat Nat)}
    (ct : CompressedTrace g role a b evs)
    (h : SilentEdge g role b c) :
    CompressedTrace g role a c evs := by
  induction ct with
  | nil hreach => exact .nil (hreach.tail h)
  | cons hstep _ ih => exact .cons hstep (ih h)

/-- Prepend silent reachability to a compressed trace. -/
theorem CompressedTrace.prepend_silent
    {g : NormalizedGraph Nat Nat Nat Nat} {role : Nat}
    {a b c : Nat} {evs : List (LocalEvent Nat Nat)}
    (h : SilentReach g role a b)
    (ct : CompressedTrace g role b c evs) :
    CompressedTrace g role a c evs := by
  match ct with
  | .nil hreach => exact .nil (h.trans hreach)
  | .cons hstep ct_tail =>
    obtain ⟨a', b', hsa, hvis, hsb⟩ := hstep
    exact .cons ⟨a', b', h.trans hsa, hvis, hsb⟩ ct_tail

/-- Concatenating two compressed traces. -/
theorem CompressedTrace.append
    {g : NormalizedGraph Nat Nat Nat Nat} {role : Nat}
    {a b c : Nat} {evs1 evs2 : List (LocalEvent Nat Nat)}
    (ct1 : CompressedTrace g role a b evs1)
    (ct2 : CompressedTrace g role b c evs2) :
    CompressedTrace g role a c (evs1 ++ evs2) := by
  induction ct1 with
  | nil hreach =>
    simp only [List.nil_append]
    exact ct2.prepend_silent hreach
  | cons hstep _ ih =>
    simp only [List.cons_append]
    exact .cons hstep (ih ct2)

/-! ### GraphPath → CompressedTrace bridge -/

/-- Classify a graph edge as silent or visible for a role. -/
def edgeClassify (role : Nat) (e : GraphEdge Nat Nat Nat Nat)
    : Option (LocalEvent Nat Nat) :=
  match e.label with
  | .interaction i => interactionToLocalEvent role i
  | .branch _ _ => none

/-- Helper: edgeClassify unfold for interaction edges. -/
private theorem edgeClassify_interaction (role : Nat) (e : GraphEdge Nat Nat Nat Nat)
    (i : MessageInteraction Nat Nat Nat) (h : e.label = .interaction i) :
    edgeClassify role e = interactionToLocalEvent role i := by
  simp [edgeClassify, h]

/-- Helper: edgeClassify unfold for branch edges. -/
private theorem edgeClassify_branch (role : Nat) (e : GraphEdge Nat Nat Nat Nat)
    (c lbl : Nat) (h : e.label = .branch c lbl) :
    edgeClassify role e = none := by
  simp [edgeClassify, h]

/-- Helper: roleLocalView of a single edge when edgeClassify is none. -/
private theorem roleLocalView_singleton_none (role : Nat) (e : GraphEdge Nat Nat Nat Nat)
    (h : edgeClassify role e = none) :
    roleLocalView role [e] = [] := by
  cases hlbl : e.label with
  | interaction i =>
    rw [edgeClassify_interaction role e i hlbl] at h
    simp only [roleLocalView, hlbl, h, roleLocalView]
  | branch c lbl =>
    simp only [roleLocalView, hlbl, roleLocalView]

/-- Helper: roleLocalView of a single edge when edgeClassify is some. -/
private theorem roleLocalView_singleton_some (role : Nat) (e : GraphEdge Nat Nat Nat Nat)
    (ev : LocalEvent Nat Nat) (h : edgeClassify role e = some ev) :
    roleLocalView role [e] = [ev] := by
  cases hlbl : e.label with
  | interaction i =>
    rw [edgeClassify_interaction role e i hlbl] at h
    simp only [roleLocalView, hlbl, h, roleLocalView]
  | branch c lbl =>
    rw [edgeClassify_branch role e c lbl hlbl] at h
    exact absurd h (by simp)

/-- A graph path produces a compressed trace with the same role-local view. -/
theorem graphPath_to_compressedTrace
    (g : NormalizedGraph Nat Nat Nat Nat) (role : Nat) (a b : Nat)
    (p : GraphPath g a b) :
    CompressedTrace g role a b (roleLocalView role p.edges) := by
  induction p with
  | nil =>
    exact .nil .refl
  | cons p e he hsrc ih =>
    subst hsrc
    rw [GraphPath.edges, roleLocalView_append]
    cases hc : edgeClassify role e with
    | none =>
      rw [roleLocalView_singleton_none _ _ hc, List.append_nil]
      have hsilent : SilentEdge g role e.source e.target := by
        refine ⟨e, he, rfl, rfl, ?_⟩
        match hlbl : e.label with
        | .interaction int =>
          simp [edgeClassify, hlbl, interactionToLocalEvent] at hc
          constructor
          · intro h; simp [h] at hc
          · intro h; by_cases hs : int.sender == role <;> simp_all
        | .branch _ _ => trivial
      exact ih.append_silent hsilent
    | some ev =>
      show CompressedTrace g role a e.target (roleLocalView role p.edges ++ roleLocalView role [e])
      rw [roleLocalView_singleton_some _ _ _ hc]
      have hvisible : VisibleEdge g role e.source e.target ev := by
        simp only [edgeClassify] at hc
        split at hc
        · rename_i int hlbl; exact ⟨e, he, rfl, rfl, int, hlbl, hc⟩
        · simp at hc
      exact ih.append (.cons ⟨_, _, .refl, hvisible, .refl⟩ (.nil .refl))

/-! ### GraphPath append -/

/-- Append two graph paths. -/
def GraphPath.append {g : NormalizedGraph Nat Nat Nat Nat} {a b c : Nat}
    (p1 : GraphPath g a b) (p2 : GraphPath g b c) : GraphPath g a c :=
  match p2 with
  | .nil => p1
  | .cons p2_init e he hsrc => .cons (p1.append p2_init) e he hsrc

/-- Edges of appended graph paths. -/
theorem GraphPath.edges_append {g : NormalizedGraph Nat Nat Nat Nat} {a b c : Nat}
    (p1 : GraphPath g a b) (p2 : GraphPath g b c) :
    (p1.append p2).edges = p1.edges ++ p2.edges := by
  induction p2 with
  | nil => simp [GraphPath.append, GraphPath.edges]
  | cons p2_init e he hsrc ih =>
    simp only [GraphPath.append, GraphPath.edges, ih, List.append_assoc]

/-! ### SilentReach → GraphPath -/

/-- A single silent edge gives a one-step graph path with empty local view. -/
theorem silentEdge_to_graphPath
    (g : NormalizedGraph Nat Nat Nat Nat) (role : Nat) (a b : Nat)
    (h : SilentEdge g role a b) :
    ∃ p : GraphPath g a b, roleLocalView role p.edges = [] := by
  obtain ⟨e, he, hsrc, htgt, hlabel⟩ := h
  subst hsrc; subst htgt
  refine ⟨.cons .nil e he rfl, ?_⟩
  simp only [GraphPath.edges, roleLocalView_append]
  cases hlbl : e.label with
  | interaction i =>
    rw [hlbl] at hlabel
    obtain ⟨hns, hnr⟩ := hlabel
    simp only [roleLocalView, hlbl, interactionToLocalEvent,
      show (i.sender == role) = false from beq_false_of_ne hns, Bool.false_eq_true, ite_false,
      show (i.receiver == role) = false from beq_false_of_ne hnr, roleLocalView,
      List.nil_append]
  | branch c lbl =>
    simp [roleLocalView, hlbl]

/-- Silent reachability gives a graph path with empty role-local view. -/
theorem silentReach_to_graphPath
    (g : NormalizedGraph Nat Nat Nat Nat) (role : Nat) (a b : Nat)
    (h : SilentReach g role a b) :
    ∃ p : GraphPath g a b, roleLocalView role p.edges = [] := by
  induction h with
  | refl => exact ⟨.nil, rfl⟩
  | tail _ hstep ih =>
    obtain ⟨p1, hp1⟩ := ih
    obtain ⟨p2, hp2⟩ := silentEdge_to_graphPath g role _ _ hstep
    exact ⟨p1.append p2, by rw [GraphPath.edges_append, roleLocalView_append, hp1, hp2]; rfl⟩

/-- A visible edge gives a one-step graph path producing [ev]. -/
theorem visibleEdge_to_graphPath
    (g : NormalizedGraph Nat Nat Nat Nat) (role : Nat) (a b : Nat)
    (ev : LocalEvent Nat Nat) (h : VisibleEdge g role a b ev) :
    ∃ p : GraphPath g a b, roleLocalView role p.edges = [ev] := by
  obtain ⟨e, he, hsrc, htgt, i, hlbl, hev⟩ := h
  subst hsrc; subst htgt
  refine ⟨.cons .nil e he rfl, ?_⟩
  simp only [GraphPath.edges, roleLocalView_append]
  rw [roleLocalView_singleton_some role e ev (by simp [edgeClassify, hlbl, hev])]
  simp [roleLocalView]

/-- A compressed trace converts back to a graph path with the same local view. -/
theorem compressedTrace_to_graphPath
    (g : NormalizedGraph Nat Nat Nat Nat) (role : Nat) (a b : Nat)
    (evs : List (LocalEvent Nat Nat))
    (ct : CompressedTrace g role a b evs) :
    ∃ p : GraphPath g a b, roleLocalView role p.edges = evs := by
  induction ct with
  | nil hreach => exact silentReach_to_graphPath g role _ _ hreach
  | cons hstep _ ih =>
    obtain ⟨a', b', hsa, hvisible, hsb⟩ := hstep
    obtain ⟨p_pre, hp_pre⟩ := silentReach_to_graphPath g role _ a' hsa
    obtain ⟨p_vis, hp_vis⟩ := visibleEdge_to_graphPath g role a' b' _ hvisible
    obtain ⟨p_suf, hp_suf⟩ := silentReach_to_graphPath g role b' _ hsb
    obtain ⟨p_tail, hp_tail⟩ := ih
    refine ⟨(p_pre.append p_vis).append (p_suf.append p_tail), ?_⟩
    rw [GraphPath.edges_append, GraphPath.edges_append, GraphPath.edges_append,
        roleLocalView_append, roleLocalView_append, roleLocalView_append,
        hp_pre, hp_vis, hp_suf, hp_tail]
    simp

/-- Trace-set equivalence via CompressedTrace.
    `inRoleLocalTraceSet` and `inCompressedTraceSet` are equivalent. -/
theorem roleLocalTraceSet_iff_compressedTraceSet
    (g : NormalizedGraph Nat Nat Nat Nat) (role : Nat)
    (evs : List (LocalEvent Nat Nat)) :
    inRoleLocalTraceSet g role evs ↔ inCompressedTraceSet g role evs := by
  constructor
  · intro ⟨b, p, hevs⟩
    exact ⟨b, hevs ▸ graphPath_to_compressedTrace g role g.initial b p⟩
  · intro ⟨b, ct⟩
    obtain ⟨p, hp⟩ := compressedTrace_to_graphPath g role g.initial b evs ct
    exact ⟨b, p, hp.symm⟩
