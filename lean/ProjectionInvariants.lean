/-
  Restated projection invariants for the executable projection pipeline.

  This file restates `ProjectionInvariants.lean` with the same proof
  commitments and less LOC by merging parallel fold invariants and
  compressing the origin construction layer.

  Public theorem surface (unchanged statements):
  - PJ3: `projectRole_label_shape`
  - PJ4: `pj4_forward`, `pj4_backward`, `pj4_traceEquality`
  - PJ5: `pj5_undeclaredRole`, `pj5_duplicateInteractionId`,
          `pj5_nonFiniteStateProtocol`, `pj5_nonProjectableChoice`
  - §6.3: `label_id_traces_to_interaction`
-/
import ProjectionPaths

/-! ### Merged fold invariant -/

/-- Combined fold invariant over processed edges.  Carries:
    (1) mapped completeness — for every processed relevant edge there is
        a transition with matching nodeToState lookups;
    (2) transition provenance — every transition came from a processed edge;
    (3) values bound — all state IDs in nodeToState are below nextStateId;
    (4) nextStateId positive. -/
def projFoldInv (role : Nat)
    (processed : List (GraphEdge Nat Nat Nat Nat)) (ps : ProjState) : Prop :=
  (∀ e ∈ processed, ∀ i : MessageInteraction Nat Nat Nat,
    e.label = .interaction i → (i.sender = role ∨ i.receiver = role) →
    ∃ t ∈ ps.transitions,
      transitionFromInteraction role i t ∧
      ps.nodeToState.lookup e.source = some t.source ∧
      ps.nodeToState.lookup e.target = some t.target) ∧
  (∀ t ∈ ps.transitions,
    ∃ e ∈ processed, ∃ i : MessageInteraction Nat Nat Nat,
      e.label = .interaction i ∧
      (i.sender = role ∨ i.receiver = role) ∧
      transitionFromInteraction role i t ∧
      ps.nodeToState.lookup e.source = some t.source ∧
      ps.nodeToState.lookup e.target = some t.target) ∧
  (∀ n v, ps.nodeToState.lookup n = some v → v < ps.nextStateId) ∧
  (0 < ps.nextStateId)

/-! ### Lookup and fold preservation -/

theorem projStepFn_preserves_lookup (role : Nat) (ps : ProjState)
    (e : GraphEdge Nat Nat Nat Nat) (node v : Nat)
    (h : ps.nodeToState.lookup node = some v) :
    (projStepFn role ps e).nodeToState.lookup node = some v := by
  simp only [projStepFn]
  split
  · split
    · exact getOrCreateState_preserves_lookup _ _ _ _
        (getOrCreateState_preserves_lookup _ _ _ _ h)
    · split
      · exact getOrCreateState_preserves_lookup _ _ _ _ h
      · split
        · exact List.lookup_append_of_some (getOrCreateState_preserves_lookup _ _ _ _ h)
        · exact getOrCreateState_preserves_lookup _ _ _ _ h
  · split
    · exact getOrCreateState_preserves_lookup _ _ _ _ h
    · exact List.lookup_append_of_some (getOrCreateState_preserves_lookup _ _ _ _ h)

theorem foldl_preserves_lookup (role : Nat) (ps : ProjState)
    (edges : List (GraphEdge Nat Nat Nat Nat)) (node v : Nat)
    (h : ps.nodeToState.lookup node = some v) :
    (edges.foldl (projStepFn role) ps).nodeToState.lookup node = some v := by
  induction edges generalizing ps with
  | nil => exact h
  | cons e es ih =>
      simp only [List.foldl_cons]
      exact ih (projStepFn role ps e) (projStepFn_preserves_lookup role ps e node v h)

theorem projStepFn_creates_mapped (role : Nat) (ps : ProjState)
    (e : GraphEdge Nat Nat Nat Nat) (i : MessageInteraction Nat Nat Nat)
    (he : e.label = .interaction i) (hrole : i.sender = role ∨ i.receiver = role) :
    ∃ t srcSt tgtSt,
      (projStepFn role ps e).transitions = ps.transitions ++ [t] ∧
      (projStepFn role ps e).nodeToState.lookup e.source = some srcSt ∧
      (projStepFn role ps e).nodeToState.lookup e.target = some tgtSt ∧
      t.source = srcSt ∧ t.target = tgtSt ∧
      transitionFromInteraction role i t := by
  simp only [projStepFn, he]
  have hb : (i.sender == role || i.receiver == role) = true := by
    rcases hrole with h | h <;> simp [h]
  simp only [hb, ite_true, getOrCreateState_transitions]
  refine ⟨_, _, _, rfl, ?_, ?_, rfl, rfl, ?_⟩
  · exact getOrCreateState_preserves_lookup _ _ _ _
      (getOrCreateState_maps_self ps e.source)
  · exact getOrCreateState_maps_self _ _
  · refine ⟨rfl, rfl, ?_⟩
    by_cases hs : i.sender == role
    · left
      simp only [hs, ite_true]
      exact ⟨beq_iff_eq.mp hs, trivial, trivial⟩
    · right
      simp only [show (i.sender == role) = false from Bool.eq_false_iff.mpr hs,
        Bool.false_eq_true, ite_false]
      rcases hrole with h | h
      · exact absurd (beq_iff_eq.mpr h) hs
      · exact ⟨h, trivial, trivial⟩

/-- `projStepFn` is monotone on transitions. -/
theorem projStepFn_mono (role : Nat) (ps : ProjState) (e : GraphEdge Nat Nat Nat Nat)
    (u : EndpointTransition Nat Nat Nat Nat Nat) (hu : u ∈ ps.transitions) :
    u ∈ (projStepFn role ps e).transitions := by
  simp only [projStepFn]
  split
  · split
    · simp only [getOrCreateState_transitions]
      exact List.mem_append_left _ hu
    · have : u ∈ (getOrCreateState ps e.source).2.transitions := by
        rw [getOrCreateState_transitions]; exact hu
      split <;> (try exact this) <;> split <;> exact this
  · have : u ∈ (getOrCreateState ps e.source).2.transitions := by
      rw [getOrCreateState_transitions]; exact hu
    split <;> exact this

/-- `projStepFn` either preserves a transition or produces a new one. -/
theorem projStepFn_transitions_sub (role : Nat) (ps : ProjState) (e : GraphEdge Nat Nat Nat Nat)
    (u : EndpointTransition Nat Nat Nat Nat Nat)
    (hu : u ∈ (projStepFn role ps e).transitions) :
    u ∈ ps.transitions ∨
    (∃ i : MessageInteraction Nat Nat Nat,
      e.label = .interaction i ∧
      (i.sender = role ∨ i.receiver = role) ∧
      transitionFromInteraction role i u) := by
  simp only [projStepFn] at hu
  split at hu
  · rename_i interaction heq_label
    split at hu
    · rename_i hrole
      simp only [getOrCreateState_transitions] at hu
      rcases List.mem_append.mp hu with hold | hnew
      · exact Or.inl hold
      · right
        rw [List.mem_singleton] at hnew
        subst hnew
        have hsend := Bool.or_eq_true_iff.mp hrole
        refine ⟨interaction, heq_label, ?_, rfl, rfl, ?_⟩
        · rcases hsend with h | h
          · exact Or.inl (beq_iff_eq.mp h)
          · exact Or.inr (beq_iff_eq.mp h)
        · by_cases hs : interaction.sender == role
          · left
            simp only [hs, ite_true]
            exact ⟨beq_iff_eq.mp hs, trivial, trivial⟩
          · right
            simp only [show (interaction.sender == role) = false from Bool.eq_false_iff.mpr hs,
              Bool.false_eq_true, ite_false]
            rcases hsend with h | h
            · exact absurd h hs
            · exact ⟨beq_iff_eq.mp h, trivial, trivial⟩
    · left
      split at hu
      · simp only [getOrCreateState_transitions] at hu; exact hu
      · split at hu
        · simp only [getOrCreateState_transitions] at hu; exact hu
        · simp only [getOrCreateState_transitions] at hu; exact hu
  · left
    split at hu
    · simp only [getOrCreateState_transitions] at hu; exact hu
    · simp only [getOrCreateState_transitions] at hu; exact hu

/-- `projStepFn` does not decrease `nextStateId`. -/
theorem projStepFn_nextStateId_mono (role : Nat) (ps : ProjState)
    (e : GraphEdge Nat Nat Nat Nat) :
    ps.nextStateId ≤ (projStepFn role ps e).nextStateId := by
  simp only [projStepFn]
  split
  · split
    · exact Nat.le_trans (getOrCreateState_nextStateId_mono ps e.source)
        (Nat.le_trans (getOrCreateState_nextStateId_mono _ e.target) (Nat.le_refl _))
    · split
      · exact getOrCreateState_nextStateId_mono ps e.source
      · split
        · exact getOrCreateState_nextStateId_mono ps e.source
        · exact getOrCreateState_nextStateId_mono ps e.source
  · split
    · exact getOrCreateState_nextStateId_mono ps e.source
    · exact getOrCreateState_nextStateId_mono ps e.source

/-- `projStepFn` keeps all nodeToState values below `nextStateId`. -/
theorem projStepFn_values_bound (role : Nat) (ps : ProjState)
    (e : GraphEdge Nat Nat Nat Nat)
    (hbound : ∀ n v, ps.nodeToState.lookup n = some v → v < ps.nextStateId) :
    ∀ n v, (projStepFn role ps e).nodeToState.lookup n = some v →
      v < (projStepFn role ps e).nextStateId := by
  simp only [projStepFn]
  split
  · split
    · intro n v hn
      have hb1 := getOrCreateState_values_bound ps e.source hbound
      have hb2 := getOrCreateState_values_bound (getOrCreateState ps e.source).2 e.target hb1
      exact Nat.lt_of_lt_of_le (hb2 n v hn) (Nat.le_refl _)
    · split
      · exact getOrCreateState_values_bound ps e.source hbound
      · split
        · intro n v hn
          have hb1 := getOrCreateState_values_bound ps e.source hbound
          rcases List.lookup_append_singleton_cases hn with hold | ⟨_, hval⟩
          · exact hb1 n v hold
          · subst hval
            rename_i hsid
            exact hb1 e.source _ hsid
        · exact getOrCreateState_values_bound ps e.source hbound
  · split
    · exact getOrCreateState_values_bound ps e.source hbound
    · intro n v hn
      have hb1 := getOrCreateState_values_bound ps e.source hbound
      rcases List.lookup_append_singleton_cases hn with hold | ⟨_, hval⟩
      · exact hb1 n v hold
      · subst hval
        exact getOrCreateState_result_bound ps e.source hbound

/-! ### projFoldInv step and fold -/

theorem projFoldInv_step (role : Nat) (ps : ProjState)
    (e : GraphEdge Nat Nat Nat Nat)
    (processed : List (GraphEdge Nat Nat Nat Nat))
    (hinv : projFoldInv role processed ps) :
    projFoldInv role (processed ++ [e]) (projStepFn role ps e) := by
  obtain ⟨hfwd, hbwd, hbnd, hpos⟩ := hinv
  refine ⟨?_, ?_, ?_, ?_⟩
  · -- (1) mapped completeness
    intro e' he' i hlbl hrole
    rcases List.mem_append.mp he' with hold | hnew
    · obtain ⟨t, ht_mem, hti, hsrc, htgt⟩ := hfwd e' hold i hlbl hrole
      exact ⟨t, projStepFn_mono role ps e t ht_mem, hti,
        projStepFn_preserves_lookup role ps e e'.source t.source hsrc,
        projStepFn_preserves_lookup role ps e e'.target t.target htgt⟩
    · have he' : e' = e := List.mem_singleton.mp hnew
      rw [he'] at hlbl ⊢
      obtain ⟨t, srcSt, tgtSt, htrans, hsrc, htgt, hsrc_eq, htgt_eq, hti⟩ :=
        projStepFn_creates_mapped role ps e i hlbl hrole
      refine ⟨t, ?_, hti, ?_, ?_⟩
      · rw [htrans]; exact List.mem_append_right _ (List.mem_singleton.mpr rfl)
      · rw [hsrc_eq]; exact hsrc
      · rw [htgt_eq]; exact htgt
  · -- (2) transition provenance
    intro t ht
    rcases projStepFn_transitions_sub role ps e t ht with hold | hnew
    · obtain ⟨e', he', i', hlbl', hrole', hti', hsrc', htgt'⟩ := hbwd t hold
      exact ⟨e', List.mem_append_left _ he', i', hlbl', hrole', hti',
        projStepFn_preserves_lookup role ps e e'.source t.source hsrc',
        projStepFn_preserves_lookup role ps e e'.target t.target htgt'⟩
    · obtain ⟨i, hlbl, hrole, hti⟩ := hnew
      obtain ⟨t', srcSt, tgtSt, htrans_eq, hsrc_map, htgt_map, ht'_src, ht'_tgt, hti'⟩ :=
        projStepFn_creates_mapped role ps e i hlbl hrole
      rw [htrans_eq] at ht
      rcases List.mem_append.mp ht with ht_old | ht_new
      · obtain ⟨e', he', i', hlbl', hrole', hti'', hsrc', htgt'⟩ := hbwd t ht_old
        exact ⟨e', List.mem_append_left _ he', i', hlbl', hrole', hti'',
          projStepFn_preserves_lookup role ps e e'.source t.source hsrc',
          projStepFn_preserves_lookup role ps e e'.target t.target htgt'⟩
      · rw [List.mem_singleton] at ht_new; subst ht_new
        exact ⟨e, List.mem_append_right _ List.mem_cons_self, i, hlbl, hrole, hti,
          ht'_src ▸ hsrc_map, ht'_tgt ▸ htgt_map⟩
  · -- (3) values bound
    exact projStepFn_values_bound role ps e hbnd
  · -- (4) nextStateId positive
    exact Nat.lt_of_lt_of_le hpos (projStepFn_nextStateId_mono role ps e)

theorem projFoldInv_foldl (role : Nat) (ps₀ : ProjState)
    (prefix_ : List (GraphEdge Nat Nat Nat Nat))
    (edges : List (GraphEdge Nat Nat Nat Nat))
    (h₀ : projFoldInv role prefix_ ps₀) :
    projFoldInv role (prefix_ ++ edges)
      (edges.foldl (projStepFn role) ps₀) := by
  induction edges generalizing ps₀ prefix_ with
  | nil => simp only [List.append_nil, List.foldl_nil]; exact h₀
  | cons e es ih =>
      simp only [List.foldl_cons]
      rw [show prefix_ ++ e :: es = (prefix_ ++ [e]) ++ es from by simp [List.append_assoc]]
      exact ih _ _ (projFoldInv_step role ps₀ e prefix_ h₀)

/-- The initial projection state satisfies the fold invariant. -/
theorem projFoldInv_init (initNode : Nat) (role : Nat) :
    projFoldInv role [] (projInit initNode) :=
  ⟨fun _ h => absurd h List.not_mem_nil,
   fun _ h => absurd h List.not_mem_nil,
   fun n v hn => by
     simp only [projInit, List.lookup] at hn
     split at hn
     · cases hn; exact Nat.lt_succ_of_le (Nat.le_refl _)
     · simp at hn,
   by simp [projInit]⟩

/-! ### Abbreviation and corollaries -/

abbrev finalProjState (g : NormalizedGraph Nat Nat Nat Nat) (role : Nat) : ProjState :=
  g.edges.foldl (projStepFn role) (projInit g.initial)

/-- Facts extracted from a successful `projectRole`. -/
theorem projectRole_success_spec (g : NormalizedGraph Nat Nat Nat Nat) (role : Nat)
    (ea : EndpointAutomaton Nat Nat Nat Nat Nat) (h : projectRole g role = some ea) :
    ea.initial = 0 ∧
    ea.transitions = (g.edges.foldl (projStepFn role) (projInit g.initial)).transitions ∧
    confluenceCheck g role (g.edges.foldl (projStepFn role) (projInit g.initial)) = true := by
  unfold projectRole at h
  simp only at h
  split at h
  · cases h
  · split at h
    · split at h
      · split at h
        · split at h
          · constructor
            · exact (Option.some.inj h) ▸ rfl
            · constructor
              · exact (Option.some.inj h) ▸ rfl
              · assumption
          · cases h
        · cases h
      · cases h
    · cases h

/-- The merged fold invariant holds after processing all edges. -/
theorem projFoldInv_final (role : Nat) (g : NormalizedGraph Nat Nat Nat Nat) :
    projFoldInv role g.edges (g.edges.foldl (projStepFn role) (projInit g.initial)) := by
  have h := projFoldInv_foldl role (projInit g.initial) [] g.edges (projFoldInv_init g.initial role)
  simp only [List.nil_append] at h; exact h

/-- After the fold, the initial node maps to endpoint state `0`. -/
theorem foldl_initial_mapped (role : Nat) (g : NormalizedGraph Nat Nat Nat Nat) :
    (g.edges.foldl (projStepFn role) (projInit g.initial)).nodeToState.lookup g.initial =
      some 0 :=
  foldl_preserves_lookup role (projInit g.initial) g.edges g.initial 0
    (by simp [projInit])

/-- **PJ3c.** For each relevant interaction edge, the projected transition's
    source and target match the nodeToState map. -/
theorem projectRole_completeness_mapped
    (g : NormalizedGraph Nat Nat Nat Nat) (role : Nat)
    (ea : EndpointAutomaton Nat Nat Nat Nat Nat)
    (hproj : projectRole g role = some ea)
    (e : GraphEdge Nat Nat Nat Nat) (he : e ∈ g.edges)
    (i : MessageInteraction Nat Nat Nat) (hlbl : e.label = .interaction i)
    (hrole : i.sender = role ∨ i.receiver = role) :
    let ps := g.edges.foldl (projStepFn role) (projInit g.initial)
    ∃ t ∈ ea.transitions,
      transitionFromInteraction role i t ∧
      ps.nodeToState.lookup e.source = some t.source ∧
      ps.nodeToState.lookup e.target = some t.target := by
  obtain ⟨hfwd, _, _, _⟩ := projFoldInv_final role g
  obtain ⟨t, ht_mem, hti, hsrc, htgt⟩ := hfwd e he i hlbl hrole
  exact ⟨t, (projectRole_success_spec g role ea hproj).2.1 ▸ ht_mem, hti, hsrc, htgt⟩

/-- Each endpoint transition comes from a graph edge. -/
theorem transition_to_graphEdge
    (g : NormalizedGraph Nat Nat Nat Nat) (role : Nat)
    (ea : EndpointAutomaton Nat Nat Nat Nat Nat)
    (hproj : projectRole g role = some ea)
    (t : EndpointTransition Nat Nat Nat Nat Nat)
    (ht : t ∈ ea.transitions) :
    ∃ e ∈ g.edges, ∃ i : MessageInteraction Nat Nat Nat,
      e.label = .interaction i ∧
      (i.sender = role ∨ i.receiver = role) ∧
      transitionFromInteraction role i t ∧
      (finalProjState g role).nodeToState.lookup e.source = some t.source ∧
      (finalProjState g role).nodeToState.lookup e.target = some t.target := by
  obtain ⟨_, hbwd, _, _⟩ := projFoldInv_final role g
  have htrans := (projectRole_success_spec g role ea hproj).2.1
  rw [htrans] at ht
  exact hbwd t ht

/-- **PJ3.** Every transition has label fields matching a source interaction. -/
theorem projectRole_label_shape
    (g : NormalizedGraph Nat Nat Nat Nat) (role : Nat)
    (ea : EndpointAutomaton Nat Nat Nat Nat Nat)
    (hproj : projectRole g role = some ea)
    (u : EndpointTransition Nat Nat Nat Nat Nat)
    (hu : u ∈ ea.transitions) :
    ∃ e ∈ g.edges, ∃ i : MessageInteraction Nat Nat Nat,
      e.label = .interaction i ∧
      (i.sender = role ∨ i.receiver = role) ∧
      transitionFromInteraction role i u := by
  obtain ⟨e, he, i, hlbl, hrole, hti, _, _⟩ :=
    transition_to_graphEdge g role ea hproj u hu
  exact ⟨e, he, i, hlbl, hrole, hti⟩

/-- **§6.3 label traceability.** -/
theorem label_id_traces_to_interaction
    (g : NormalizedGraph Nat Nat Nat Nat) (role : Nat)
    (ea : EndpointAutomaton Nat Nat Nat Nat Nat)
    (hproj : projectRole g role = some ea)
    (u : EndpointTransition Nat Nat Nat Nat Nat) (hu : u ∈ ea.transitions) :
    ∃ e ∈ g.edges, ∃ i : MessageInteraction Nat Nat Nat,
      e.label = .interaction i ∧ u.label.id = i.id := by
  obtain ⟨e, he, i, hlbl, _, hti⟩ := projectRole_label_shape g role ea hproj u hu
  exact ⟨e, he, i, hlbl, hti.1⟩

/-! ### Confluence and nodeToState constancy for silent edges -/

theorem nodeToState_silent_step
    (g : NormalizedGraph Nat Nat Nat Nat) (role : Nat) (ps : ProjState)
    (hconf : confluenceCheck g role ps = true)
    (a b : Nat) (hsilent : SilentEdge g role a b) :
    ps.nodeToState.lookup a = ps.nodeToState.lookup b := by
  obtain ⟨e, he, hsrc, htgt, hlabel⟩ := hsilent
  rw [← hsrc, ← htgt]
  simp only [confluenceCheck, List.all_eq_true, Bool.or_eq_true] at hconf
  have hconf_e := hconf e he
  rcases hconf_e with hrole | hsame
  · exfalso
    match hlbl : e.label with
    | .interaction i =>
      rw [hlbl] at hrole hlabel
      simp only [Bool.or_eq_true] at hrole
      rcases hrole with hs | hr
      · exact hlabel.1 (beq_iff_eq.mp hs)
      · exact hlabel.2 (beq_iff_eq.mp hr)
    | .branch _ _ =>
      rw [hlbl] at hrole
      simp at hrole
  · exact beq_iff_eq.mp hsame

theorem nodeToState_silent_reach
    (g : NormalizedGraph Nat Nat Nat Nat) (role : Nat) (ps : ProjState)
    (hconf : confluenceCheck g role ps = true)
    (a b : Nat) (hreach : SilentReach g role a b) :
    ps.nodeToState.lookup a = ps.nodeToState.lookup b := by
  induction hreach with
  | refl => rfl
  | tail _ hstep ih => exact ih.trans (nodeToState_silent_step g role ps hconf _ _ hstep)

/-! ### PJ4 forward -/

theorem visibleEdge_to_transition
    (g : NormalizedGraph Nat Nat Nat Nat) (role : Nat)
    (ea : EndpointAutomaton Nat Nat Nat Nat Nat)
    (hproj : projectRole g role = some ea)
    (hwf : graphInteractionsWF g)
    (a b : Nat) (ev : LocalEvent Nat Nat)
    (hvisible : VisibleEdge g role a b ev) :
    ∃ t ∈ ea.transitions,
      labelToEvent t.label = ev ∧
      (finalProjState g role).nodeToState.lookup a = some t.source ∧
      (finalProjState g role).nodeToState.lookup b = some t.target := by
  obtain ⟨e, he, hsrc, htgt, i, hlbl, hev⟩ := hvisible
  have hrole : i.sender = role ∨ i.receiver = role := by
    simp only [interactionToLocalEvent] at hev
    by_cases hs : i.sender == role
    · left; exact beq_iff_eq.mp hs
    · right
      simp only [show (i.sender == role) = false from Bool.eq_false_iff.mpr hs,
        Bool.false_eq_true, ite_false] at hev
      by_cases hr : i.receiver == role
      · exact beq_iff_eq.mp hr
      · simp [show (i.receiver == role) = false from Bool.eq_false_iff.mpr hr] at hev
  obtain ⟨t, ht_mem, hti, hmapsrc, hmaptgt⟩ :=
    projectRole_completeness_mapped g role ea hproj e he i hlbl hrole
  rw [hsrc] at hmapsrc; rw [htgt] at hmaptgt
  refine ⟨t, ht_mem, ?_, hmapsrc, hmaptgt⟩
  obtain ⟨_, hmsg, hdir⟩ := hti
  rcases hdir with ⟨hsend, hd, hp⟩ | ⟨hrecv, hd, hp⟩
  · simp only [interactionToLocalEvent,
      show (i.sender == role) = true from beq_iff_eq.mpr hsend, ite_true,
      Option.some.injEq] at hev
    simp [labelToEvent, hd, hp, hmsg, ← hev]
  · have hns : (i.sender == role) = false := by
      apply beq_false_of_ne; intro heq
      simp only [interactionToLocalEvent, show (i.sender == role) = true from beq_iff_eq.mpr heq,
        ite_true, Option.some.injEq] at hev
      exact absurd (heq ▸ hrecv ▸ rfl) (hwf e he i hlbl)
    simp only [interactionToLocalEvent, hns, Bool.false_eq_true, ite_false,
      show (i.receiver == role) = true from beq_iff_eq.mpr hrecv, ite_true,
      Option.some.injEq] at hev
    simp [labelToEvent, hd, hp, hmsg, ← hev]

def EndpointPath.append {ea : EndpointAutomaton Nat Nat Nat Nat Nat}
    {s1 s2 s3 : Nat} (p1 : EndpointPath ea s1 s2) (p2 : EndpointPath ea s2 s3) :
    EndpointPath ea s1 s3 :=
  match p2 with
  | .nil => p1
  | .cons p2_init t ht hsrc => .cons (p1.append p2_init) t ht hsrc

theorem EndpointPath.transitions_append {ea : EndpointAutomaton Nat Nat Nat Nat Nat}
    {s1 s2 s3 : Nat} (p1 : EndpointPath ea s1 s2) (p2 : EndpointPath ea s2 s3) :
    (p1.append p2).transitions = p1.transitions ++ p2.transitions := by
  induction p2 with
  | nil => simp [EndpointPath.append, EndpointPath.transitions]
  | cons p2_init t ht hsrc ih =>
    simp only [EndpointPath.append, EndpointPath.transitions, ih, List.append_assoc]

theorem compressedTrace_to_endpointPath
    (g : NormalizedGraph Nat Nat Nat Nat) (role : Nat)
    (ea : EndpointAutomaton Nat Nat Nat Nat Nat)
    (hproj : projectRole g role = some ea)
    (hwf : graphInteractionsWF g)
    {a b : Nat} {evs : List (LocalEvent Nat Nat)}
    (ct : CompressedTrace g role a b evs)
    (s : Nat) (hs : (finalProjState g role).nodeToState.lookup a = some s) :
    ∃ (s' : Nat) (ep : EndpointPath ea s s'),
      endpointTraceToEvents ep.transitions = evs := by
  have hconf := (projectRole_success_spec g role ea hproj).2.2
  induction ct generalizing s with
  | nil _ => exact ⟨s, .nil, rfl⟩
  | cons hstep _ ih =>
    obtain ⟨a', b', hsa, hvisible, hsb⟩ := hstep
    have ha' : (finalProjState g role).nodeToState.lookup a' = some s := by
      rw [← nodeToState_silent_reach g role _ hconf _ a' hsa]; exact hs
    obtain ⟨t, ht_mem, hev, hmapsrc, hmaptgt⟩ :=
      visibleEdge_to_transition g role ea hproj hwf a' b' _ hvisible
    have hsrc_eq : t.source = s := by
      rw [ha'] at hmapsrc; cases hmapsrc; rfl
    have hmid := hmaptgt
    rw [nodeToState_silent_reach g role _ hconf b' _ hsb] at hmid
    obtain ⟨s', ep_tail, hep_tail⟩ := ih t.target hmid
    let step : EndpointPath ea s t.target :=
      .cons .nil t ht_mem (by rw [hsrc_eq])
    refine ⟨s', step.append ep_tail, ?_⟩
    show endpointTraceToEvents (step.append ep_tail).transitions = _
    rw [EndpointPath.transitions_append]
    show endpointTraceToEvents (step.transitions ++ ep_tail.transitions) = _
    rw [endpointTraceToEvents_append]
    show endpointTraceToEvents step.transitions ++ endpointTraceToEvents ep_tail.transitions = _
    simp only [step, EndpointPath.transitions, List.nil_append,
               endpointTraceToEvents, hev, hep_tail, List.cons_append, List.nil_append]

theorem pj4_forward
    (g : NormalizedGraph Nat Nat Nat Nat) (role : Nat)
    (ea : EndpointAutomaton Nat Nat Nat Nat Nat)
    (hproj : projectRole g role = some ea)
    (hwf : graphInteractionsWF g)
    (evs : List (LocalEvent Nat Nat))
    (h : inRoleLocalTraceSet g role evs) :
    inEndpointTraceLanguage ea evs := by
  obtain ⟨b, p, hevs⟩ := h
  rw [hevs]
  have ct := graphPath_to_compressedTrace g role g.initial b p
  have hinit := foldl_initial_mapped role g
  obtain ⟨s', ep, hep⟩ := compressedTrace_to_endpointPath g role ea hproj hwf ct 0 hinit
  unfold inEndpointTraceLanguage
  rw [(projectRole_success_spec g role ea hproj).1]
  exact ⟨s', ep, hep.symm⟩

/-! ### PJ5 — Rejection soundness

The four PJ5 theorems share a common front-end routing structure:
`projectProtocol` checks `syntaxWellFormed` then `interactionIdsDistinct`
before delegating to `projectProtocolInner`.  The private helpers below
factor that routing so each public theorem focuses on its rejection class. -/

/-- Front-end routing: a rejection from `projectProtocol` came from exactly
    one of three sources. -/
private theorem pj5_route (p : SourceProtocol Nat Nat Nat)
    {reason : ProjectionRejection}
    (h : projectProtocol p = .rejection reason) :
    (syntaxWellFormed p.roles p.body = false ∧ reason = .undeclaredRole) ∨
    (syntaxWellFormed p.roles p.body = true ∧
     interactionIdsDistinct p.body = false ∧ reason = .duplicateInteractionId) ∨
    (syntaxWellFormed p.roles p.body = true ∧
     interactionIdsDistinct p.body = true ∧
     projectProtocolInner p = .rejection reason) := by
  by_cases hwf : syntaxWellFormed p.roles p.body = true
  · by_cases hid : interactionIdsDistinct p.body = true
    · right; right; rw [projectProtocol_inner p hwf hid] at h; exact ⟨hwf, hid, h⟩
    · simp only [Bool.not_eq_true] at hid; right; left
      rw [projectProtocol_not_ids p hwf hid] at h; exact ⟨hwf, hid, by cases h; rfl⟩
  · simp only [Bool.not_eq_true] at hwf; left
    rw [projectProtocol_not_wf p hwf] at h; exact ⟨hwf, by cases h; rfl⟩

/-- `projectProtocolInner` only ever rejects with `nonFiniteStateProtocol`,
    `nonProjectableChoice`, or `nonSingleChooser`. -/
private theorem pj5_inner_only (p : SourceProtocol Nat Nat Nat) {reason : ProjectionRejection}
    (h : projectProtocolInner p = .rejection reason) :
    reason = .nonFiniteStateProtocol ∨ reason = .nonProjectableChoice ∨
    reason = .nonSingleChooser := by
  simp only [projectProtocolInner] at h
  split at h
  · left; cases h; rfl
  · split at h
    · -- allSingleChooser = true
      split at h
      · -- projectAllRoles = none → nonProjectableChoice
        right; left; cases h; rfl
      · -- projectAllRoles = some → success, contradiction
        cases h
    · -- allSingleChooser = false → nonSingleChooser
      right; right; cases h; rfl

theorem pj5_undeclaredRole (p : SourceProtocol Nat Nat Nat)
    (h : projectProtocol p = .rejection .undeclaredRole) :
    syntaxWellFormed p.roles p.body = false := by
  rcases pj5_route p h with ⟨hwf, _⟩ | ⟨_, _, h'⟩ | ⟨_, _, h'⟩
  · exact hwf
  · cases h'
  · rcases pj5_inner_only p h' with h'' | h'' | h'' <;> cases h''

theorem pj5_duplicateInteractionId (p : SourceProtocol Nat Nat Nat)
    (h : projectProtocol p = .rejection .duplicateInteractionId) :
    interactionIdsDistinct p.body = false := by
  rcases pj5_route p h with ⟨_, h'⟩ | ⟨_, hid, _⟩ | ⟨_, _, h'⟩
  · cases h'
  · exact hid
  · rcases pj5_inner_only p h' with h'' | h'' | h'' <;> cases h''

theorem pj5_nonFiniteStateProtocol (p : SourceProtocol Nat Nat Nat)
    (h : projectProtocol p = .rejection .nonFiniteStateProtocol) :
    syntaxWellFormed p.roles p.body = true ∧
    interactionIdsDistinct p.body = true ∧
    buildGraph
      (normalizeSyntax (freshNode { nextId := 0, nodes := [], edges := [], terminals := [] }).2
        (freshNode { nextId := 0, nodes := [], edges := [], terminals := [] }).1 [] p.body)
      (freshNode { nextId := 0, nodes := [], edges := [], terminals := [] }).1 = none := by
  rcases pj5_route p h with ⟨_, h'⟩ | ⟨_, _, h'⟩ | ⟨hwf, hid, h'⟩
  · cases h'
  · cases h'
  · simp only [projectProtocolInner] at h'; simp only [freshNode] at h' ⊢
    split at h'
    · exact ⟨hwf, hid, by assumption⟩
    · rename_i g _; split at h' <;> (try split at h') <;> cases h'

theorem pj5_nonProjectableChoice (p : SourceProtocol Nat Nat Nat)
    (h : projectProtocol p = .rejection .nonProjectableChoice) :
    syntaxWellFormed p.roles p.body = true ∧
    interactionIdsDistinct p.body = true ∧
    ∃ g, buildGraph
      (normalizeSyntax (freshNode { nextId := 0, nodes := [], edges := [], terminals := [] }).2
        (freshNode { nextId := 0, nodes := [], edges := [], terminals := [] }).1 [] p.body)
      (freshNode { nextId := 0, nodes := [], edges := [], terminals := [] }).1 = some g ∧
    allSingleChooser g = true ∧
    projectAllRoles g p.roles = none := by
  rcases pj5_route p h with ⟨_, h'⟩ | ⟨_, _, h'⟩ | ⟨hwf, hid, h'⟩
  · cases h'
  · cases h'
  · refine ⟨hwf, hid, ?_⟩
    simp only [projectProtocolInner] at h'; simp only [freshNode] at h' ⊢
    split at h'
    · cases h'
    · rename_i g hg
      split at h'
      · rename_i hasc
        split at h'
        · rename_i hpar; exact ⟨g, hg, hasc, hpar⟩
        · cases h'
      · cases h'

theorem pj5_nonSingleChooser (p : SourceProtocol Nat Nat Nat)
    (h : projectProtocol p = .rejection .nonSingleChooser) :
    syntaxWellFormed p.roles p.body = true ∧
    interactionIdsDistinct p.body = true ∧
    ∃ g, buildGraph
      (normalizeSyntax (freshNode { nextId := 0, nodes := [], edges := [], terminals := [] }).2
        (freshNode { nextId := 0, nodes := [], edges := [], terminals := [] }).1 [] p.body)
      (freshNode { nextId := 0, nodes := [], edges := [], terminals := [] }).1 = some g ∧
    allSingleChooser g = false := by
  rcases pj5_route p h with ⟨_, h'⟩ | ⟨_, _, h'⟩ | ⟨hwf, hid, h'⟩
  · cases h'
  · cases h'
  · refine ⟨hwf, hid, ?_⟩
    simp only [projectProtocolInner] at h'; simp only [freshNode] at h' ⊢
    split at h'
    · cases h'
    · rename_i g hg
      split at h'
      · split at h'
        · cases h'
        · cases h'
      · rename_i hasc; exact ⟨g, hg, by simpa using hasc⟩

/-! ### PJ4 backward infrastructure -/

/-- `projStepFn` only adds nodeToState entries for the edge's source or target. -/
theorem projStepFn_nodeToState_new (role : Nat) (ps : ProjState)
    (e : GraphEdge Nat Nat Nat Nat) (n s : Nat)
    (hnew : (projStepFn role ps e).nodeToState.lookup n = some s)
    (hold : ps.nodeToState.lookup n = none) :
    n = e.source ∨ n = e.target := by
  simp only [projStepFn] at hnew
  split at hnew
  · split at hnew
    · rcases getOrCreateState_lookup_cases _ e.target n s hnew with h1 | ⟨h1, _⟩
      · rcases getOrCreateState_lookup_cases _ e.source n s h1 with h2 | ⟨h2, _⟩
        · exact absurd h2 (by rw [hold]; exact fun h => by cases h)
        · exact Or.inl h2
      · exact Or.inr h1
    · split at hnew
      · rcases getOrCreateState_lookup_cases ps e.source n s hnew with h | ⟨h, _⟩
        · exact absurd h (by rw [hold]; exact fun h => by cases h)
        · exact Or.inl h
      · split at hnew
        · rcases List.lookup_append_singleton_cases hnew with h | ⟨h, _⟩
          · rcases getOrCreateState_lookup_cases ps e.source n s h with h2 | ⟨h2, _⟩
            · exact absurd h2 (by rw [hold]; exact fun h => by cases h)
            · exact Or.inl h2
          · exact Or.inr h
        · rcases getOrCreateState_lookup_cases ps e.source n s hnew with h | ⟨h, _⟩
          · exact absurd h (by rw [hold]; exact fun h => by cases h)
          · exact Or.inl h
  · split at hnew
    · rcases getOrCreateState_lookup_cases ps e.source n s hnew with h | ⟨h, _⟩
      · exact absurd h (by rw [hold]; exact fun h => by cases h)
      · exact Or.inl h
    · rcases List.lookup_append_singleton_cases hnew with h | ⟨h, _⟩
      · rcases getOrCreateState_lookup_cases ps e.source n s h with h2 | ⟨h2, _⟩
        · exact absurd h2 (by rw [hold]; exact fun h => by cases h)
        · exact Or.inl h2
      · exact Or.inr h

/-- Values bound extracted from projFoldInv for backward infrastructure. -/
theorem projInit_values_bound (initNode : Nat) :
    ∀ n v, (projInit initNode).nodeToState.lookup n = some v →
      v < (projInit initNode).nextStateId := by
  intro n v hn
  simp only [projInit, List.lookup] at hn
  split at hn
  · cases hn; exact Nat.lt_succ_of_le (Nat.le_refl _)
  · simp at hn

theorem foldl_values_bound_from (role : Nat) :
    ∀ (edges : List (GraphEdge Nat Nat Nat Nat)) (ps : ProjState),
      (∀ n v, ps.nodeToState.lookup n = some v → v < ps.nextStateId) →
      ∀ n v, (edges.foldl (projStepFn role) ps).nodeToState.lookup n = some v →
        v < (edges.foldl (projStepFn role) ps).nextStateId := by
  intro edges
  induction edges with
  | nil => intro ps h; exact h
  | cons e es ih =>
    intro ps hps
    simp only [List.foldl_cons]
    exact ih _ (projStepFn_values_bound role ps e hps)

/-! ### Origin construction -/

def originAfterGetOrCreate (ps : ProjState) (node : Nat) (org : Nat → Nat) : Nat → Nat :=
  match ps.nodeToState.lookup node with
  | some _ => org
  | none => fun s => if s = ps.nextStateId then node else org s

@[simp] theorem originAfterGetOrCreate_stable
    (ps : ProjState) (node s : Nat) (org : Nat → Nat)
    (hs : s < ps.nextStateId) :
    originAfterGetOrCreate ps node org s = org s := by
  unfold originAfterGetOrCreate
  cases h : ps.nodeToState.lookup node with
  | some v => rfl
  | none => simp [show s ≠ ps.nextStateId by omega]

theorem originAfterGetOrCreate_fresh
    (ps : ProjState) (node : Nat) (org : Nat → Nat)
    (hnone : ps.nodeToState.lookup node = none) :
    originAfterGetOrCreate ps node org (getOrCreateState ps node).1 = node := by
  unfold originAfterGetOrCreate
  rw [hnone]
  have hfresh := (getOrCreateState_fresh ps node hnone).1
  simp [hfresh]

theorem originAfterGetOrCreate_reach
    (g : NormalizedGraph Nat Nat Nat Nat) (role : Nat)
    (ps : ProjState) (node : Nat) (org : Nat → Nat)
    (hr : ∀ n s, ps.nodeToState.lookup n = some s → SilentReach g role (org s) n)
    (hb : ∀ n v, ps.nodeToState.lookup n = some v → v < ps.nextStateId) :
    ∀ n s, (getOrCreateState ps node).2.nodeToState.lookup n = some s →
      SilentReach g role (originAfterGetOrCreate ps node org s) n := by
  intro n s hn
  unfold originAfterGetOrCreate
  cases hnode : ps.nodeToState.lookup node with
  | some v =>
      rcases getOrCreateState_lookup_cases ps node n s hn with hold | ⟨heq, hval⟩
      · exact hr n s hold
      · have ⟨h1, _⟩ := getOrCreateState_existing ps node v hnode
        rw [h1] at hval; rw [← hval, heq]; exact hr _ _ hnode
  | none =>
      rcases getOrCreateState_lookup_cases ps node n s hn with hold | ⟨heq, hval⟩
      · have hlt := hb n s hold
        dsimp [originAfterGetOrCreate]
        rw [if_neg (show s ≠ ps.nextStateId by omega)]
        exact hr n s hold
      · have hfresh := (getOrCreateState_fresh ps node hnode).1
        subst heq; rw [hfresh] at hval; subst hval
        simpa [originAfterGetOrCreate, hnode] using (Relation.ReflTransGen.refl : SilentReach g role n n)

def originStep (role : Nat) (ps : ProjState) (org : Nat → Nat)
    (e : GraphEdge Nat Nat Nat Nat) : Nat → Nat :=
  match e.label with
  | .interaction i =>
      let org1 := originAfterGetOrCreate ps e.source org
      if i.sender == role || i.receiver == role then
        originAfterGetOrCreate (getOrCreateState ps e.source).2 e.target org1
      else org1
  | .branch _ _ => originAfterGetOrCreate ps e.source org

theorem originStep_reach
    (g : NormalizedGraph Nat Nat Nat Nat) (role : Nat)
    (ps : ProjState) (org : Nat → Nat) (e : GraphEdge Nat Nat Nat Nat)
    (he : e ∈ g.edges)
    (hr : ∀ n s, ps.nodeToState.lookup n = some s → SilentReach g role (org s) n)
    (hb : ∀ n v, ps.nodeToState.lookup n = some v → v < ps.nextStateId)
    (_hpos : 0 < ps.nextStateId) :
    ∀ n s, (projStepFn role ps e).nodeToState.lookup n = some s →
      SilentReach g role (originStep role ps org e s) n := by
  intro n s hn
  simp only [projStepFn] at hn ⊢
  cases hlbl : e.label with
  | interaction i =>
      simp only [hlbl] at hn ⊢
      by_cases hrel : i.sender == role || i.receiver == role
      · simp only [hrel] at hn ⊢
        have htmp := originAfterGetOrCreate_reach g role (getOrCreateState ps e.source).2 e.target
          (originAfterGetOrCreate ps e.source org)
          (originAfterGetOrCreate_reach g role ps e.source org hr hb)
          (getOrCreateState_values_bound ps e.source hb) n s hn
        simpa [originStep, hlbl, hrel] using htmp
      · simp only [hrel] at hn ⊢
        have hsilent : SilentEdge g role e.source e.target := by
          refine ⟨e, he, rfl, rfl, ?_⟩; rw [hlbl]
          simp only [Bool.or_eq_true, not_or] at hrel
          exact ⟨fun h => hrel.1 (beq_iff_eq.mpr h), fun h => hrel.2 (beq_iff_eq.mpr h)⟩
        cases htgt : (getOrCreateState ps e.source).2.nodeToState.lookup e.target with
        | some val =>
            simp only [htgt] at hn ⊢
            simpa [originStep, hlbl, hrel, htgt] using
              originAfterGetOrCreate_reach g role ps e.source org hr hb n s hn
        | none =>
            cases hsrc' : (getOrCreateState ps e.source).2.nodeToState.lookup e.source with
            | none => exact absurd (getOrCreateState_maps_self ps e.source) (by rw [hsrc']; simp)
            | some sid =>
                simp only [htgt, hsrc'] at hn
                rcases List.lookup_append_singleton_cases hn with hold | ⟨heq, hval⟩
                · simpa [originStep, hlbl, hrel] using
                    originAfterGetOrCreate_reach g role ps e.source org hr hb n s hold
                · subst heq; rw [hval]
                  simpa [originStep, hlbl, hrel] using
                    (originAfterGetOrCreate_reach g role ps e.source org hr hb e.source sid hsrc').tail hsilent
  | branch chooser label =>
      simp only [hlbl] at hn ⊢
      have hsilent : SilentEdge g role e.source e.target :=
        ⟨e, he, rfl, rfl, by rw [hlbl]; trivial⟩
      cases htgt : (getOrCreateState ps e.source).2.nodeToState.lookup e.target with
      | some val =>
          simp only [htgt] at hn ⊢
          simpa [originStep, hlbl, htgt] using
            originAfterGetOrCreate_reach g role ps e.source org hr hb n s hn
      | none =>
          have hsrc := getOrCreateState_maps_self ps e.source
          simp only [htgt] at hn
          rcases List.lookup_append_singleton_cases hn with hold | ⟨heq, hval⟩
          · simpa [originStep, hlbl] using
              originAfterGetOrCreate_reach g role ps e.source org hr hb n s hold
          · subst heq; rw [hval]
            simpa [originStep, hlbl] using
              (originAfterGetOrCreate_reach g role ps e.source org hr hb e.source _ hsrc).tail hsilent

theorem originStep_relevant_target_from_targetFresh
    (role : Nat) (ps : ProjState) (org : Nat → Nat)
    (e : GraphEdge Nat Nat Nat Nat)
    (i : MessageInteraction Nat Nat Nat) (sid : Nat)
    (hlbl : e.label = .interaction i)
    (hrole : i.sender = role ∨ i.receiver = role)
    (htgt0 : ps.nodeToState.lookup e.target = none)
    (hs : (projStepFn role ps e).nodeToState.lookup e.target = some sid) :
    originStep role ps org e sid = e.target := by
  have hrole' : (i.sender == role || i.receiver == role) = true := by
    rcases hrole with h | h <;> simp [h]
  unfold projStepFn at hs; rw [hlbl] at hs; simp only [hrole'] at hs
  unfold originStep; rw [hlbl]; simp only [hrole']
  cases hsrc : ps.nodeToState.lookup e.source with
  | none =>
      by_cases hst : e.source = e.target
      · have hs1 := by simpa [hsrc, hst] using hs
        have hmap_outer := getOrCreateState_maps_self (getOrCreateState ps e.target).2 e.target
        have hsid_outer : sid = (getOrCreateState (getOrCreateState ps e.target).2 e.target).1 := by
          rw [hmap_outer] at hs1; injection hs1 with h; exact h.symm
        have hlookup_tgt := getOrCreateState_maps_self ps e.target
        have hexisting := (getOrCreateState_existing (getOrCreateState ps e.target).2 e.target _ hlookup_tgt).1
        have hsid : sid = (getOrCreateState ps e.target).1 := by rw [hsid_outer, hexisting]
        subst hsid
        have houter_id :
            originAfterGetOrCreate (getOrCreateState ps e.target).2 e.target
              (originAfterGetOrCreate ps e.target org) ((getOrCreateState ps e.target).1) =
            originAfterGetOrCreate ps e.target org ((getOrCreateState ps e.target).1) := by
          unfold originAfterGetOrCreate; rw [hlookup_tgt]
        simpa [hst] using houter_id.trans (originAfterGetOrCreate_fresh ps e.target org htgt0)
      · have hpostnone : (getOrCreateState ps e.source).2.nodeToState.lookup e.target = none := by
          unfold getOrCreateState; rw [hsrc]
          exact List.lookup_append_singleton_of_none htgt0 (fun h => hst h.symm)
        have hs1 := by simpa [hsrc, hpostnone] using hs
        have hmap_outer := getOrCreateState_maps_self (getOrCreateState ps e.source).2 e.target
        have hsid : sid = (getOrCreateState (getOrCreateState ps e.source).2 e.target).1 := by
          rw [hmap_outer] at hs1; injection hs1 with h; exact h.symm
        subst hsid
        simpa [originStep, hlbl, hrole'] using
          originAfterGetOrCreate_fresh (getOrCreateState ps e.source).2 e.target
            (originAfterGetOrCreate ps e.source org) hpostnone
  | some srcSid =>
      have hpostnone : (getOrCreateState ps e.source).2.nodeToState.lookup e.target = none := by
        simpa [getOrCreateState, hsrc] using htgt0
      have hs1 := by simpa [hsrc, hpostnone] using hs
      have hmap_outer := getOrCreateState_maps_self (getOrCreateState ps e.source).2 e.target
      have hsid : sid = (getOrCreateState (getOrCreateState ps e.source).2 e.target).1 := by
        rw [hmap_outer] at hs1; injection hs1 with h; exact h.symm
      subst hsid
      simpa [originStep, hlbl, hrole'] using
        originAfterGetOrCreate_fresh (getOrCreateState ps e.source).2 e.target
          (originAfterGetOrCreate ps e.source org) hpostnone

def originFoldStep (role : Nat) (acc : ProjState × (Nat → Nat))
    (e : GraphEdge Nat Nat Nat Nat) : ProjState × (Nat → Nat) :=
  let (ps, org) := acc
  (projStepFn role ps e, originStep role ps org e)

def buildOrigin (role : Nat) (edges : List (GraphEdge Nat Nat Nat Nat))
    (ps : ProjState) (org : Nat → Nat) : Nat → Nat :=
  (edges.foldl (originFoldStep role) (ps, org)).2

@[simp] theorem buildOrigin_cons (role : Nat) (e : GraphEdge Nat Nat Nat Nat)
    (es : List (GraphEdge Nat Nat Nat Nat)) (ps : ProjState) (org : Nat → Nat) :
    buildOrigin role (e :: es) ps org =
      buildOrigin role es (projStepFn role ps e) (originStep role ps org e) := rfl

theorem buildOrigin_append (role : Nat) (xs ys : List (GraphEdge Nat Nat Nat Nat))
    (ps : ProjState) (org : Nat → Nat) :
    buildOrigin role (xs ++ ys) ps org =
      buildOrigin role ys (xs.foldl (projStepFn role) ps) (buildOrigin role xs ps org) := by
  unfold buildOrigin; rw [List.foldl_append]
  induction xs generalizing ps org with
  | nil => rfl
  | cons e es ih => simp [originFoldStep, ih]

theorem originStep_stable_old (role : Nat) (ps : ProjState) (org : Nat → Nat)
    (e : GraphEdge Nat Nat Nat Nat) (s : Nat) (hs : s < ps.nextStateId) :
    originStep role ps org e s = org s := by
  cases hlabel : e.label with
  | interaction i =>
      have horg1 := originAfterGetOrCreate_stable ps e.source s org hs
      by_cases hrel : (i.sender == role || i.receiver == role) = true
      · simp only [originStep, hlabel, hrel]
        have hmono := getOrCreateState_nextStateId_mono ps e.source
        have hstable2 := originAfterGetOrCreate_stable
          (ps := (getOrCreateState ps e.source).2) (node := e.target) (s := s)
          (org := originAfterGetOrCreate ps e.source org) (by omega)
        dsimp; rw [hstable2, horg1]
      · have hrel' : (i.sender == role || i.receiver == role) = false := by
          cases hbool : (i.sender == role || i.receiver == role) <;> simp_all
        simp only [originStep, hlabel]; rw [hrel']; exact horg1
  | branch chooser label =>
      simpa [originStep, hlabel] using originAfterGetOrCreate_stable ps e.source s org hs

theorem buildOrigin_stable (role : Nat) (edges : List (GraphEdge Nat Nat Nat Nat))
    (ps : ProjState) (org : Nat → Nat) :
    ∀ s, s < ps.nextStateId → buildOrigin role edges ps org s = org s := by
  induction edges generalizing ps org with
  | nil => intro s hs; rfl
  | cons e es ih =>
      intro s hs; rw [buildOrigin_cons]
      rw [ih (projStepFn role ps e) (originStep role ps org e) s]
      · exact originStep_stable_old role ps org e s hs
      · exact Nat.lt_of_lt_of_le hs (projStepFn_nextStateId_mono role ps e)

theorem buildOrigin_reach (g : NormalizedGraph Nat Nat Nat Nat) (role : Nat)
    (edges : List (GraphEdge Nat Nat Nat Nat))
    (hedge : ∀ e ∈ edges, e ∈ g.edges)
    (ps : ProjState) (org : Nat → Nat)
    (hr : ∀ n s, ps.nodeToState.lookup n = some s → SilentReach g role (org s) n)
    (hb : ∀ n v, ps.nodeToState.lookup n = some v → v < ps.nextStateId)
    (hpos : 0 < ps.nextStateId) :
    ∀ n s, (edges.foldl (projStepFn role) ps).nodeToState.lookup n = some s →
      SilentReach g role (buildOrigin role edges ps org s) n := by
  induction edges generalizing ps org with
  | nil => intro n s hn; simpa using hr n s hn
  | cons e es ih =>
      intro n s hn; rw [buildOrigin_cons]
      apply ih (fun e' he' => hedge e' (List.mem_cons_of_mem _ he'))
        (projStepFn role ps e) (originStep role ps org e)
      · exact originStep_reach g role ps org e (hedge e List.mem_cons_self) hr hb hpos
      · exact projStepFn_values_bound role ps e hb
      · exact Nat.lt_of_lt_of_le hpos (projStepFn_nextStateId_mono role ps e)
      · simpa [List.foldl_cons] using hn

theorem stateOrigin_withFreshTargets
    (g : NormalizedGraph Nat Nat Nat Nat) (role : Nat)
    (hfresh : InteractionTargetsFresh g) :
    ∃ origin : Nat → Nat,
      (∀ n s, (finalProjState g role).nodeToState.lookup n = some s →
        SilentReach g role (origin s) n) ∧
      origin 0 = g.initial ∧
      (∀ (k : Nat) (hk : k < g.edges.length),
        let e := g.edges[k]
        ∀ i : MessageInteraction Nat Nat Nat, e.label = .interaction i →
          (i.sender = role ∨ i.receiver = role) →
          ∀ s, (finalProjState g role).nodeToState.lookup e.target = some s →
            origin s = e.target) := by
  unfold finalProjState
  have node_provenance : ∀ (edges : List (GraphEdge Nat Nat Nat Nat)) (ps : ProjState)
      (allowed : Nat → Prop),
      (∀ n, ps.nodeToState.lookup n ≠ none → allowed n) →
      ∀ n, (edges.foldl (projStepFn role) ps).nodeToState.lookup n ≠ none →
        allowed n ∨ ∃ e ∈ edges, (n = e.source ∨ n = e.target) := by
    intro edges
    induction edges with
    | nil => intro ps allowed hinit n hn; exact Or.inl (hinit n hn)
    | cons e es ih =>
      intro ps allowed hinit n hn
      simp only [List.foldl_cons] at hn
      rcases ih (projStepFn role ps e)
        (fun m => allowed m ∨ m = e.source ∨ m = e.target)
        (fun m hm => by
          cases hm_old : ps.nodeToState.lookup m with
          | some _ => exact Or.inl (hinit m (by simp [hm_old]))
          | none =>
            have hsome := Option.ne_none_iff_exists.mp hm
            obtain ⟨v, hv⟩ := hsome
            rcases projStepFn_nodeToState_new role ps e m v hv.symm hm_old with h | h
            · exact Or.inr (Or.inl h)
            · exact Or.inr (Or.inr h))
        n hn with
      h | ⟨e', he', hne'⟩
      · rcases h with hallowed | hsrc | htgt
        · exact Or.inl hallowed
        · exact Or.inr ⟨e, List.mem_cons_self, Or.inl hsrc⟩
        · exact Or.inr ⟨e, List.mem_cons_self, Or.inr htgt⟩
      · exact Or.inr ⟨e', List.mem_cons_of_mem _ he', hne'⟩
  have target_fresh_at_k : ∀ (k : Nat) (hk : k < g.edges.length)
      (i : MessageInteraction Nat Nat Nat), (g.edges[k]'hk).label = .interaction i →
        ((g.edges.take k).foldl (projStepFn role) (projInit g.initial)).nodeToState.lookup
          (g.edges[k]'hk).target = none := by
    intro k hk i hlbl_i
    cases heq : ((g.edges.take k).foldl (projStepFn role) (projInit g.initial)).nodeToState.lookup
          (g.edges[k]'hk).target with
    | none => rfl
    | some v =>
      exfalso
      have hne : ((g.edges.take k).foldl (projStepFn role) (projInit g.initial)).nodeToState.lookup
            (g.edges[k]'hk).target ≠ none := by simp [heq]
      have hprov := node_provenance (g.edges.take k) (projInit g.initial) (· = g.initial)
        (by
          intro n hn; unfold projInit at hn
          simp only [List.lookup_cons, List.lookup_nil] at hn
          cases hab : (n == g.initial)
          · simp [hab] at hn
          · exact (beq_iff_eq (α := Nat)).mp hab)
        _ hne
      rcases hprov with h_init | ⟨e', he', hne'⟩
      · exact (hfresh k hk i hlbl_i).1 h_init
      · obtain ⟨⟨j, hj_len⟩, hj_eq⟩ := List.mem_iff_get.mp he'
        have hj_lt : j < k := by have := @List.length_take _ k g.edges; omega
        have hj_edge : e' = g.edges[j]'(by omega) := by rw [← hj_eq]; simp
        have hfk := (hfresh k hk i hlbl_i).2 j hj_lt
        rcases hne' with hsrc | htgt
        · exact hfk.1 (hsrc ▸ hj_edge ▸ rfl)
        · exact hfk.2 (htgt ▸ hj_edge ▸ rfl)
  have hinit_reach : ∀ n s, (projInit g.initial).nodeToState.lookup n = some s →
      SilentReach g role ((fun _ => g.initial) s) n := by
    intro n s hn; unfold projInit at hn
    simp only [List.lookup_cons, List.lookup_nil] at hn
    cases hab : (n == g.initial)
    · simp only [hab] at hn; cases hn
    · simp only [hab] at hn; injection hn with hs; subst hs
      exact (beq_iff_eq (α := Nat)).mp hab ▸ .refl
  let origin := buildOrigin role g.edges (projInit g.initial) (fun _ => g.initial)
  refine ⟨origin, ?_, ?_, ?_⟩
  · exact buildOrigin_reach g role g.edges (fun _ h => h) (projInit g.initial) (fun _ => g.initial)
      hinit_reach (projInit_values_bound g.initial) (by simp [projInit])
  · exact buildOrigin_stable role g.edges (projInit g.initial) (fun _ => g.initial) 0
      (by simp [projInit])
  · intro k hk; dsimp; intro i hlbl hrole s hs
    let xs := g.edges.take k
    let e : GraphEdge Nat Nat Nat Nat := g.edges[k]'hk
    let ys := g.edges.drop (k + 1)
    have hsplit : xs ++ e :: ys = g.edges := by
      dsimp [xs, e, ys]
      rw [← List.drop_eq_getElem_cons hk, ← List.take_append_drop k g.edges]
      exact List.take_append_drop k (List.take k g.edges ++ List.drop k g.edges)
    have htgt0 := target_fresh_at_k k hk i hlbl
    have hs_pref : ((xs ++ e :: ys).foldl (projStepFn role) (projInit g.initial)).nodeToState.lookup e.target = some s := by
      rw [hsplit]; dsimp [e]; exact hs
    have hs_final : (ys.foldl (projStepFn role)
        (projStepFn role (xs.foldl (projStepFn role) (projInit g.initial)) e)).nodeToState.lookup
          e.target = some s := by
      simpa [List.foldl_append, List.foldl_cons] using hs_pref
    have hfull : buildOrigin role g.edges (projInit g.initial) (fun _ => g.initial) s = e.target := by
      rw [← hsplit, buildOrigin_append, buildOrigin_cons]
      obtain ⟨_, _, sid, _, _, hs_after, _, _, _⟩ :=
        projStepFn_creates_mapped role (xs.foldl (projStepFn role) (projInit g.initial)) e i hlbl hrole
      have hsid_eq : sid = s := by
        have hsid_final : (ys.foldl (projStepFn role)
            (projStepFn role (xs.foldl (projStepFn role) (projInit g.initial)) e)).nodeToState.lookup e.target = some sid :=
          foldl_preserves_lookup role
            (projStepFn role (xs.foldl (projStepFn role) (projInit g.initial)) e) ys e.target sid hs_after
        have : some sid = some s := by rw [← hsid_final, hs_final]
        simpa using this
      have hstep := originStep_relevant_target_from_targetFresh role
        (xs.foldl (projStepFn role) (projInit g.initial))
        (buildOrigin role xs (projInit g.initial) (fun _ => g.initial))
        e i sid hlbl hrole htgt0 hs_after
      have hlt := projStepFn_values_bound role (xs.foldl (projStepFn role) (projInit g.initial)) e
        (foldl_values_bound_from role xs (projInit g.initial) (projInit_values_bound g.initial)) _ _ hs_after
      rw [← hsid_eq]
      rw [buildOrigin_stable role ys _ _ sid hlt]
      exact hstep
    dsimp [origin, e] at hfull ⊢; simpa using hfull

/-! ### PJ4 backward -/

theorem pj4_backward
    (g : NormalizedGraph Nat Nat Nat Nat) (role : Nat)
    (ea : EndpointAutomaton Nat Nat Nat Nat Nat)
    (hproj : projectRole g role = some ea)
    (hwf : graphInteractionsWF g)
    (hfresh : InteractionTargetsFresh g)
    (evs : List (LocalEvent Nat Nat))
    (h : inEndpointTraceLanguage ea evs) :
    inRoleLocalTraceSet g role evs := by
  obtain ⟨origin, horigin_reach, horigin0, horigin_tgt⟩ :=
    stateOrigin_withFreshTargets g role hfresh
  have hinit := (projectRole_success_spec g role ea hproj).1
  obtain ⟨s_final, ep0, hevs⟩ := h; subst hevs
  rw [roleLocalTraceSet_iff_compressedTraceSet]
  suffices hsuff : ∀ s1 s2 (ep : EndpointPath ea s1 s2),
      CompressedTrace g role (origin s1) (origin s2)
        (endpointTraceToEvents ep.transitions) by
    have ct := hsuff ea.initial s_final ep0
    have : origin ea.initial = g.initial := by rw [hinit]; exact horigin0
    rw [this] at ct; exact ⟨origin s_final, ct⟩
  intro s1 s2 ep
  induction ep with
  | nil => exact .nil .refl
  | cons ih_path t ht_mem ht_src ih =>
    simp only [EndpointPath.transitions]
    rw [endpointTraceToEvents_append]; simp only [endpointTraceToEvents]
    apply CompressedTrace.append ih
    apply CompressedTrace.cons _ (.nil .refl)
    obtain ⟨e, he, i, hlbl, hrole, hti, hsrc_map, htgt_map⟩ :=
      transition_to_graphEdge g role ea hproj t ht_mem
    refine ⟨e.source, e.target, ?_, ?_, ?_⟩
    · rw [ht_src] at hsrc_map; exact horigin_reach e.source _ hsrc_map
    · exact ⟨e, he, rfl, rfl, i, hlbl, step_event_unified role i (hwf e he i hlbl) t hti⟩
    · obtain ⟨⟨k, hk⟩, hek⟩ := List.mem_iff_get.mp he
      have hek' : g.edges[k] = e := hek
      have horig_eq := horigin_tgt k hk i (hek' ▸ hlbl) hrole t.target (hek' ▸ htgt_map)
      rw [hek'] at horig_eq; rw [horig_eq]; exact .refl

/-! ### PJ4 full -/

theorem pj4_traceEquality
    (g : NormalizedGraph Nat Nat Nat Nat) (role : Nat)
    (ea : EndpointAutomaton Nat Nat Nat Nat Nat)
    (hproj : projectRole g role = some ea)
    (hwf : graphInteractionsWF g)
    (hfresh : InteractionTargetsFresh g)
    (evs : List (LocalEvent Nat Nat)) :
    inRoleLocalTraceSet g role evs ↔ inEndpointTraceLanguage ea evs :=
  ⟨pj4_forward g role ea hproj hwf evs,
   pj4_backward g role ea hproj hwf hfresh evs⟩
