/-
  Projection soundness summary layer.

  Collects the public theorem surface for the projection proof stack
  with all hypotheses discharged from the executable pipeline:

  - §6.4: Stable endpoint-state identity (silent-closure characterization)
  - §6.5: Stable endpoint-transition identity (graph-edge provenance)
  - End-to-end trace equality from `normalizeProtocol` + `projectRole` success
  - Re-exports of PJ3, PJ5 for convenience
-/
import ProjectionInvariants

/-! ### §6.4: Endpoint state identity via silent closure -/

/-- §6.4 forward: If two graph nodes are silently reachable, they map to the
    same endpoint state. Follows directly from `nodeToState_silent_reach`
    using the confluence check that `projectRole` guarantees. -/
theorem endpointState_silentClosure_forward
    (g : NormalizedGraph Nat Nat Nat Nat) (role : Nat)
    (ea : EndpointAutomaton Nat Nat Nat Nat Nat)
    (hproj : projectRole g role = some ea)
    (a b : Nat) (sa sb : Nat)
    (ha : (finalProjState g role).nodeToState.lookup a = some sa)
    (hb : (finalProjState g role).nodeToState.lookup b = some sb)
    (hreach : SilentReach g role a b) :
    sa = sb := by
  have hconf := (projectRole_success_spec g role ea hproj).2.2
  have := nodeToState_silent_reach g role (finalProjState g role) hconf a b hreach
  rw [ha, hb] at this
  exact Option.some.inj this

/-- §6.4 backward: If two graph nodes map to the same endpoint state, they
    share a common silent ancestor. Uses `stateOrigin_withFreshTargets`:
    both nodes are silently reachable from `origin s`. -/
theorem endpointState_silentClosure_backward
    (g : NormalizedGraph Nat Nat Nat Nat) (role : Nat)
    (ea : EndpointAutomaton Nat Nat Nat Nat Nat)
    (_hproj : projectRole g role = some ea)
    (hfresh : InteractionTargetsFresh g)
    (a b : Nat) (s : Nat)
    (ha : (finalProjState g role).nodeToState.lookup a = some s)
    (hb : (finalProjState g role).nodeToState.lookup b = some s) :
    ∃ c, SilentReach g role c a ∧ SilentReach g role c b := by
  obtain ⟨origin, horigin, _, _⟩ := stateOrigin_withFreshTargets g role hfresh
  exact ⟨origin s, horigin a s ha, horigin b s hb⟩

/-! ### §6.5: Endpoint transition identity via graph-edge provenance -/

/-- §6.5: Each endpoint transition is uniquely determined by its source
    graph interaction edge. The transition's label fields (id, message)
    match the source interaction. -/
theorem endpointTransition_determined_by_edge
    (g : NormalizedGraph Nat Nat Nat Nat) (role : Nat)
    (ea : EndpointAutomaton Nat Nat Nat Nat Nat)
    (hproj : projectRole g role = some ea)
    (t : EndpointTransition Nat Nat Nat Nat Nat) (ht : t ∈ ea.transitions) :
    ∃ e ∈ g.edges, ∃ i : MessageInteraction Nat Nat Nat,
      e.label = .interaction i ∧
      (i.sender = role ∨ i.receiver = role) ∧
      t.label.id = i.id ∧
      t.label.message = i.message := by
  obtain ⟨e, he, i, hlbl, hrole, hti, _, _⟩ := transition_to_graphEdge g role ea hproj t ht
  exact ⟨e, he, i, hlbl, hrole, hti.1, hti.2.1⟩

/-! ### Re-exports for convenience -/

-- PJ3 and PJ5 are available transitively via `import ProjectionInvariants`.
-- The aliases below make the summary layer self-documenting as the
-- single import for downstream consumers.

/-- **PJ3.** Every endpoint transition has label fields matching a source
    interaction. Re-exported from `ProjectionInvariants`. -/
theorem pj3_label_shape
    (g : NormalizedGraph Nat Nat Nat Nat) (role : Nat)
    (ea : EndpointAutomaton Nat Nat Nat Nat Nat)
    (hproj : projectRole g role = some ea)
    (u : EndpointTransition Nat Nat Nat Nat Nat) (hu : u ∈ ea.transitions) :
    ∃ e ∈ g.edges, ∃ i : MessageInteraction Nat Nat Nat,
      e.label = .interaction i ∧
      (i.sender = role ∨ i.receiver = role) ∧
      transitionFromInteraction role i u :=
  projectRole_label_shape g role ea hproj u hu

/-- **PJ5.** `undeclaredRole` rejection implies `syntaxWellFormed` is false.
    Re-exported from `ProjectionInvariants`. -/
theorem pj5_undeclaredRole'
    (p : SourceProtocol Nat Nat Nat)
    (h : projectProtocol p = .rejection .undeclaredRole) :
    syntaxWellFormed p.roles p.body = false :=
  pj5_undeclaredRole p h

/-- **PJ5.** `duplicateInteractionId` rejection implies `interactionIdsDistinct`
    is false. Re-exported from `ProjectionInvariants`. -/
theorem pj5_duplicateInteractionId'
    (p : SourceProtocol Nat Nat Nat)
    (h : projectProtocol p = .rejection .duplicateInteractionId) :
    interactionIdsDistinct p.body = false :=
  pj5_duplicateInteractionId p h

/-- **PJ5.** `nonFiniteStateProtocol` rejection implies both pre-checks passed
    and `buildGraph` returned `none`. Re-exported from `ProjectionInvariants`. -/
theorem pj5_nonFiniteStateProtocol'
    (p : SourceProtocol Nat Nat Nat)
    (h : projectProtocol p = .rejection .nonFiniteStateProtocol) :
    syntaxWellFormed p.roles p.body = true ∧
    interactionIdsDistinct p.body = true ∧
    buildGraph
      (normalizeSyntax (freshNode { nextId := 0, nodes := [], edges := [], terminals := [] }).2
        (freshNode { nextId := 0, nodes := [], edges := [], terminals := [] }).1 [] p.body)
      (freshNode { nextId := 0, nodes := [], edges := [], terminals := [] }).1 = none :=
  pj5_nonFiniteStateProtocol p h

/-- **PJ5.** `nonProjectableChoice` rejection implies both pre-checks passed,
    `allSingleChooser` succeeded, but `projectAllRoles` returned `none`.
    Re-exported from `ProjectionInvariants`. -/
theorem pj5_nonProjectableChoice'
    (p : SourceProtocol Nat Nat Nat)
    (h : projectProtocol p = .rejection .nonProjectableChoice) :
    syntaxWellFormed p.roles p.body = true ∧
    interactionIdsDistinct p.body = true ∧
    ∃ g, buildGraph
      (normalizeSyntax (freshNode { nextId := 0, nodes := [], edges := [], terminals := [] }).2
        (freshNode { nextId := 0, nodes := [], edges := [], terminals := [] }).1 [] p.body)
      (freshNode { nextId := 0, nodes := [], edges := [], terminals := [] }).1 = some g ∧
    allSingleChooser g = true ∧
    projectAllRoles g p.roles = none :=
  pj5_nonProjectableChoice p h

/-- **PJ5.** `nonSingleChooser` rejection implies both pre-checks passed,
    normalization succeeded, but `allSingleChooser` returned false.
    Re-exported from `ProjectionInvariants`. -/
theorem pj5_nonSingleChooser'
    (p : SourceProtocol Nat Nat Nat)
    (h : projectProtocol p = .rejection .nonSingleChooser) :
    syntaxWellFormed p.roles p.body = true ∧
    interactionIdsDistinct p.body = true ∧
    ∃ g, buildGraph
      (normalizeSyntax (freshNode { nextId := 0, nodes := [], edges := [], terminals := [] }).2
        (freshNode { nextId := 0, nodes := [], edges := [], terminals := [] }).1 [] p.body)
      (freshNode { nextId := 0, nodes := [], edges := [], terminals := [] }).1 = some g ∧
    allSingleChooser g = false :=
  pj5_nonSingleChooser p h

/-! ### End-to-end trace equality -/

/-- End-to-end trace equality: if `normalizeProtocol` and `projectRole`
    both succeed, the endpoint trace language equals the role-local trace
    set unconditionally. All hypotheses (`InteractionTargetsFresh`,
    `graphInteractionsWF`) are discharged from `normalizeProtocol`. -/
theorem projection_trace_equality_e2e
    (p : SourceProtocol Nat Nat Nat)
    (g : NormalizedGraph Nat Nat Nat Nat)
    (hnorm : normalizeProtocol p = some g)
    (role : Nat)
    (ea : EndpointAutomaton Nat Nat Nat Nat Nat)
    (hproj : projectRole g role = some ea)
    (evs : List (LocalEvent Nat Nat)) :
    inRoleLocalTraceSet g role evs ↔ inEndpointTraceLanguage ea evs :=
  pj4_traceEquality g role ea hproj
    (normalizeProtocol_edgesWF p g hnorm)
    (normalizeProtocol_interactionTargetsFresh p g hnorm) evs
