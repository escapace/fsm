# Implementation gaps in the session-type semantic specification

## Purpose

This document identifies specific gaps in `lean/README-SESSION-TYPES.md` that prevent a developer from implementing the protocol-boundary and projection layers from the spec alone. Each gap includes the relevant spec section, what is missing, the Lean source that contains the algorithm, primary-source research findings, and a recommendation.

The gaps are ordered by severity: projection algorithm gaps first (blocking), then boundary operational gaps (non-blocking but incomplete).

## How to use this document

For each gap:

1. Read the **research findings** to understand what the literature says.
2. Read the **recommendation** for whether to transcribe the Lean algorithm, redesign, or defer.
3. Update `lean/README-SESSION-TYPES.md` accordingly.

---

## Gap 1 — Projection state construction algorithm

**Spec section:** §10.2

**What the spec says:** "Endpoint states are derived from canonical role-local control positions induced by the normalized graph. Multiple graph nodes may map to the same endpoint state when they differ only by role-silent control flow."

**What is missing:** The actual algorithm. The Lean code uses a `getOrCreateState` lookup-or-allocate pattern over a `ProjState` accumulator with fields `nextStateId`, `states`, `transitions`, `nextTransId`, and `nodeToState`. The projection fold (`projStepFn`) processes edges in declaration order, using `getOrCreateState` to lazily assign endpoint state IDs to graph nodes. The initial state ID is `0`, assigned to the graph's initial node; subsequent states get monotonically increasing IDs starting at `1`.

**Why it matters:** An implementer cannot reproduce the correct state assignment without this algorithm. The state ID scheme is load-bearing: PJ4 trace correspondence depends on the specific assignment.

**Lean source:** `lean/ProjectionProject.lean` — `ProjState`, `getOrCreateState`, `projInit`, `projStepFn`.

### Research findings

**Deniélou & Yoshida 2012 (§3.1, §3.3, Def. 3.4).** The canonical MPST projection is a two-step process: (1) project global type syntax to local type syntax via a per-transition rule (send/receive/indirection), then (2) translate local types to CFSMs via Def. 3.4, which defines CFSM states as compound state variables `X` modulo an equivalence relation `≡_T̃`. The equivalence relation collapses indirections, choice branches, fork/join, and merge points. The CFSM state space is the quotient `{X} / ≡_T̃`, which can be exponential in the presence of parallel composition but polynomial without it.

The Lean code's approach **bypasses the local-type intermediate representation entirely**, projecting directly from the normalized global graph to endpoint automata via a single fold. This is a valid simplification for the restricted fragment (no parallel composition, §8.3), because without parallel composition the compound state variables `X` degenerate to simple state variables `x`, and the equivalence relation reduces to exactly the silent-edge collapsing that `getOrCreateState` implements.

**Majumdar et al. 2021.** Their generalized projection operates on global types represented as message-sequence graphs, using causality tracking between messages. Their projection produces per-role CFSMs via a global-automaton construction followed by per-role erasure and determinization. The syntax-directed fold in the Lean code is a valid restriction: it avoids the global-automaton construction step by operating on a fragment where syntax-directed projection is complete.

**Tirore et al. 2023.** Their computable projection function is a two-step process: (1) check projectability by unfolding μ-operators, (2) generate local types by structural recursion under μ-operators. This addresses recursion handling that the Lean code handles differently (via normalization to a graph with back-edges). The Lean approach is sound for the restricted fragment because normalization makes recursion explicit as graph cycles, and the fold processes all edges (including back-edges) uniformly.

**Li et al. 2023.** Their complete projection separates synthesis from implementability checking. Synthesis uses a simple automata-theoretic construction (global automaton → per-role erasure → determinization). The Lean code's syntax-directed fold is strictly less general but sufficient for the supported fragment. Their completeness results confirm that the Lean fragment is a proper subset of what automata-based projection can handle.

### Recommendation

**Transcribe the Lean algorithm into the spec.** The `getOrCreateState` fold pattern is the correct algorithm for the restricted fragment. It is a valid specialization of the canonical CFSM projection (Deniélou & Yoshida 2012 Def. 3.4) that avoids the intermediate local-type representation and the equivalence-class quotient. The spec should present:

1. The `ProjState` accumulator shape.
2. The `getOrCreateState` lookup-or-allocate pattern.
3. The `projInit` initial state (state `0` assigned to the initial node).
4. The `projStepFn` fold, explicitly showing the three cases: relevant interaction, uninvolved interaction, and branch edge.
5. A note that this is sound for the restricted fragment (no parallel composition) and that extending to the full MPST class would require the automata-based approach from Li et al. 2023 or Majumdar et al. 2021.

---

## Gap 2 — Projection silent-edge handling algorithm

**Spec section:** §10.4

**What the spec says:** "Branch edges and uninvolved interaction edges are silent for role `r`. The projector ensures their source and target map to the same endpoint state. This is validated by a confluence check."

**What is missing:** The two distinct cases in `projStepFn`:

- **Branch edges:** `getOrCreateState` on the source node returns `(sid, ps')`. If the target has no mapping yet, assign it `sid` (the source's state ID). If it already has a mapping, leave it unchanged.
- **Uninvolved interaction edges:** `getOrCreateState` on the source node. If the target has no mapping yet, look up the source's state ID in `nodeToState` and copy it to the target. If the source also has no state ID (should not happen after `getOrCreateState`), leave unchanged.

These two cases have subtly different logic. An implementer following §10.4 alone would not know this distinction exists.

**Why it matters:** Incorrect silent-edge handling produces wrong state assignments, breaking the confluence check and PJ4.

**Lean source:** `lean/ProjectionProject.lean` — `projStepFn`, the `else` branch of the interaction case and the `.branch` case.

### Research findings

**Deniélou & Yoshida 2012 (§3.1).** The canonical projection erases uninvolved interactions by creating indirection links (`x = x'` when `p ∉ {sender, receiver}`). These indirections are then collapsed by the congruence relation `≡_T̃`. Branch points that are not the chooser produce external choice (`&`) in the local type — the branches are preserved, not collapsed. The Lean code's two-case distinction mirrors this: uninvolved-interaction edges produce state-identity merging (≡ indirection erasure), while branch edges propagate the source state to branch targets (≡ external choice for the chooser; state preservation for non-choosers).

The difference in the Lean code is subtle but structurally important:
- For branch edges, the returned state ID from `getOrCreateState` (`r1.1`) is copied to the target. This is correct because branch edges represent control flow from a choice point to a branch body — the role's position hasn't changed.
- For uninvolved-interaction edges, the lookup goes through `nodeToState.lookup e.source` to find the source's state ID, then copies that to the target. This extra lookup is needed because `getOrCreateState` might have created a *new* state for the source (if it wasn't seen yet), and the copy should use the node-to-state mapping, not the `getOrCreateState` return value. In practice the distinction matters when the fold encounters an uninvolved edge whose source was previously mapped by a silent-edge copy rather than by `getOrCreateState`.

**Tirore et al. 2025.** Their mechanized subject reduction restricts the theory to ensure correctness. Their silent-step treatment is at the process calculus level (τ-reductions), not at the projection algorithm level. Not directly applicable to the fold-based silent-edge handling.

### Recommendation

**Transcribe both cases into the spec with explicit pseudocode.** The two-case distinction is essential for correctness and non-obvious. Present them as:

1. **Branch edge `(source, branch(chooser, label), target)`:** Ensure source has a state via `getOrCreateState`. If target is unmapped, assign it the source's state ID. If already mapped, leave unchanged.
2. **Uninvolved interaction edge `(source, interaction(ι), target)` where `r ∉ {ι.sender, ι.receiver}`:** Ensure source has a state via `getOrCreateState`. If target is unmapped, look up source in `nodeToState` and copy that state ID to target. If source has no mapping (unreachable after `getOrCreateState`), leave unchanged.

Include a brief note explaining why the two cases differ: branch edges propagate from the `getOrCreateState` result; uninvolved-interaction edges propagate from the `nodeToState` lookup.

---

## Gap 3 — Projection transition and state ID schemes

**Spec section:** §10.3, §10.5

**What the spec says:** §10.3 says "a deterministic transition identifier." §10.5 says "endpoint state `0`, corresponding to the normalized graph's initial node."

**What is missing:** The specific schemes:

- **State IDs:** Monotonic `Nat` counter. Initial state is `0`, assigned to the graph's initial node in `projInit`. New states get `nextStateId` (starting at `1`), incremented on each `getOrCreateState` miss.
- **Transition IDs:** Monotonic `Nat` counter. Starts at `0` (`nextTransId` in `projInit`). Each new transition gets `nextTransId`, then `nextTransId` increments.
- **Label IDs:** `label.id := interaction.id`. Stated in §11 (label traceability) but not in the construction section §10.3.

**Why it matters:** The ID schemes must be deterministic for PJ1 and reproducible across implementations. A spec that says only "deterministic" permits incompatible schemes.

**Lean source:** `lean/ProjectionProject.lean` — `projInit`, `projStepFn`, `getOrCreateState`.

### Research findings

**Deniélou & Yoshida 2012.** The formalism treats CFSM states as abstract sets (Def. 3.1: "Q is a finite set of states"). No numeric ID scheme is defined. State identity comes from the equivalence-class quotient, not from numbering.

**Kouzapas et al. 2016 (StMungo).** StMungo generates Java typestate specifications from Scribble protocols. Typestate states are named with user-chosen identifiers (e.g., `Empty`, `NonEmpty`, `Unknown` in their stack example), not with numeric IDs. The generated state names come from Scribble protocol state names. No numeric ID scheme is specified or needed at the typestate level.

### Recommendation

**Transcribe the monotonic counter scheme into the spec, but frame it as the reference implementation choice, not as a required scheme.** The key semantic requirement is determinism (PJ1): same input → same output. The monotonic counter satisfies this. Alternative implementations could use different ID schemes (e.g., content-based hashing, positional encoding) as long as they are deterministic and the identity invariants from §12 hold. The spec should:

1. Present the monotonic counter scheme as the reference algorithm.
2. State the invariant: state IDs are assigned in first-encounter order during the edge fold, starting from `0` for the initial node.
3. State the transition ID invariant: transition IDs are assigned in edge-fold encounter order, starting from `0`.
4. Move `label.id := interaction.id` from §11 into §10.3 as an explicit construction rule.
5. Note that an alternative implementation may use a different ID scheme if it preserves PJ1 and the identity commitments in §12.

---

## Gap 4 — Normalization accumulator and node ID scheme

**Spec section:** §9.2, §9.3, §9.5

**What the spec says:** §9.2 gives the normalization rules in algorithmic prose. §9.3 says "allocated with an ID strictly above all previously used IDs." §9.5 says "`buildGraph` validates well-formedness."

**What is missing:** The `NormState` accumulator shape (`nextId : Nat`, `nodes : List Nat`, `edges : List GraphEdge`, `terminals : List Nat`), the `freshNode` function (`allocates nextId, increments, appends to nodes`), and the initial state (`nextId = 0, nodes = [], edges = [], terminals = []` before `freshNode` creates the initial node). Also, the `buildGraph` validation order: `nodes ≠ [] → initNode ∈ nodes → nodes.Nodup → terminalsValid → edgesValid`.

**Why it matters:** The normalization rules in §9.2 are precise enough that a careful implementer could derive a working normalizer. But without the accumulator shape, they'd have to invent one, and a different shape might produce different node IDs, which would break determinism (PJ1) and the interaction-target-freshness invariant (§9.3).

**Lean source:** `lean/ProjectionNormalize.lean` — `NormState`, `freshNode`, `normalizeSyntax`, `buildGraph`, `terminalsValid`, `edgesValid`.

### Research findings

**Deniélou & Yoshida 2012.** Their global type syntax is already a graph (`def G̃ in x₀` where `G̃` is a set of transitions between state variables). No normalization step is needed because their source format IS the graph. The Lean code's normalization exists because the source protocol syntax (§7.4) uses a tree structure (interact/choice/loop/continueLoop), not a graph.

**Li et al. 2023.** Their projection operates on global types represented as grammars or automata. They construct a global automaton directly from the global type syntax. No separate normalization step analogous to the Lean code's `normalizeSyntax` exists — the global-automaton construction IS their normalization.

### Recommendation

**Transcribe the accumulator shape and `freshNode` into the spec.** The normalization rules in §9.2 are correct but need the accumulator shape to be implementable:

1. Add the `NormState` type: `{ nextId: Nat, nodes: List<Nat>, edges: List<GraphEdge>, terminals: List<Nat> }`.
2. Add the `freshNode` operation: allocate `nextId`, increment `nextId`, append to `nodes`.
3. Add the initial state: `freshNode({ nextId: 0, nodes: [], edges: [], terminals: [] })` produces node `0` with `nextId = 1`.
4. Add the `buildGraph` validation sequence: non-empty nodes → initial membership → nodup → terminals valid → edges valid.
5. Note that the tree-to-graph normalization is specific to the source syntax chosen in §7.4. Alternative source formats (e.g., Deniélou & Yoshida's graph syntax) would not need this step.

---

## Gap 5 — Projection label construction

**Spec section:** §10.1, §10.3

**What the spec says:** §10.1 gives the direction/peer rules. §10.3 says projection creates one endpoint transition per relevant edge.

**What is missing:** The explicit `ProtocolLabel` assembly rule:

```
label = {
  id := interaction.id,
  direction := if interaction.sender == role then send else receive,
  peer := if interaction.sender == role then interaction.receiver else interaction.sender,
  message := interaction.message
}
```

This is derivable from §10.1 + §11 (label traceability) but not written as a construction rule.

**Why it matters:** Minor — derivable from existing spec text. But for consistency with `lean/README.md` style (e.g., §2.3 step 1 gives an explicit `actionInfo` construction), the construction should be explicit.

**Lean source:** `lean/ProjectionProject.lean` — `projStepFn`, relevant-interaction branch.

### Research findings

No primary-source research needed. This is a spec-writing completeness issue.

### Recommendation

**Add the explicit construction rule to §10.3.** One sentence with the record literal, matching the style of `lean/README.md` §2.3.

---

## Gap 6 — Boundary subscription model

**Spec sections:** §2 (boundary dispatch), §3 (receive-side dispatch), §4.5 (draft dispatch/receive), §4.6 (root commit)

**What the spec says:** The spec defines dispatch, receive, replay, and commit semantics. It is entirely silent on subscription/notification behavior.

**What is missing:** The EFSM layer (`lean/README.md`) specifies a complete subscription model (§3.1–3.5, §4.13). The session-type spec does not address:

1. Does `boundary.do()` fire subscriber callbacks on success?
2. Does `boundary.receive()` fire subscriber callbacks?
3. Does boundary commit replay fire subscribers? If so, with what change record?
4. Does the boundary expose its own `subscribe()` or delegate to the underlying service?
5. If the boundary wraps notifications, does the change record include endpoint-state or protocol-label fields?

### Research findings

**Hypothetical API sketch (`docs/protocol-boundaries-hypothetical-api.md`).** The sketch states the boundary "exposes the same interface shape as a regular service — `state`, `context`, `do(...)`, `draft()`, `subscribe(...)`." This implies delegation to the underlying service subscription mechanism, with the boundary wrapping or extending it.

**Bocchi et al. 2015 (Monitoring networks).** Their monitoring framework defines monitors that observe protocol events at boundaries. Monitors intercept messages and check them against local types. This is architecturally similar to subscribers that observe boundary events, but at a different abstraction level (network monitors vs. in-process callbacks). Not directly applicable to the subscription API shape.

**Design analysis:** The boundary layer wraps the EFSM service. Three coherent subscription strategies exist:

- **Delegation:** The boundary forwards all subscription operations to the underlying service. Subscribers see EFSM-level change records (state, context, action) without protocol-layer information. Simple but incomplete — subscribers cannot observe endpoint state changes or protocol labels.
- **Wrapping:** The boundary intercepts subscription notifications and enriches change records with `endpointState`, `eventKind`, and `protocolLabel`. Subscribers see protocol-aware change records. More useful but requires defining the extended change record shape.
- **Dual-layer:** The boundary exposes two subscription mechanisms: one delegated (EFSM-level) and one protocol-aware. This is complex and probably unnecessary for version one.

### Recommendation

**Record the design decision in the spec.** The simplest correct approach for version one:

1. The boundary service delegates `subscribe(...)` to the underlying EFSM service.
2. During root commit replay, the underlying service fires subscriber callbacks with the standard EFSM change record (§3.5 of `lean/README.md`).
3. Subscribers do NOT receive endpoint-state or protocol-label information in version one.
4. The boundary service exposes `endpointState` as a read-only property, which subscribers can query synchronously within their callback.
5. Future versions may introduce a protocol-aware change record with `endpointState`, `eventKind`, and `protocolLabel`. This is explicitly deferred.

Add a new §2.7 or §4.9 to the session-type spec recording this decision.

---

## Gap 7 — Confluence check algorithm

**Spec section:** §10.4, §10.6

**What the spec says:** §10.4 says "validated by a confluence check." §10.6 says "if the confluence check fails, projection returns `rejection(reason)`."

**What is missing:** The exact check: iterate over all edges and verify that each edge is either a relevant interaction (sender or receiver is role) OR `nodeToState.lookup(source) == nodeToState.lookup(target)`. This runs after the fold completes, over the final `ProjState`. The check is part of `projectRole`, not `projectProtocol`.

**Why it matters:** An implementer might place the check at the wrong point in the pipeline (per-edge during the fold instead of post-fold), producing different failure behavior.

**Lean source:** `lean/ProjectionProject.lean` — `confluenceCheck`, its position within `projectRole`.

### Research findings

No primary-source research needed. This is a spec-writing gap about check placement.

### Recommendation

**Add the check to §10.4 with explicit placement:**

1. The confluence check runs **after** the projection fold completes, on the final `ProjState`.
2. For each edge in `g.edges`: the edge is either a relevant interaction for role `r` (sender or receiver equals `r`), or `nodeToState[e.source] == nodeToState[e.target]`.
3. The check is per-role, within `projectRole`, not per-protocol.
4. If the check fails, `projectRole` returns `none`, and the pipeline emits `rejection(nonProjectableChoice)`.

---

## Gap 8 — graphology evaluation for normalization and projection

**Spec sections:** §7.5, §9, §10, and broader implementation.

**What the spec says:** The normalized global graph is a tuple `(N, n₀, F, E)`. Normalization builds it; projection folds over it.

**What is missing:** An implementation-level decision about whether to use [graphology](https://graphology.github.io/) as the graph data structure.

### Research findings

**graphology design choices (`.firecrawl/graphology-design.md`).** The critical finding:

> "The user should not expect the Graph to retain insertion order. It might be a side effect of the used implementation to retain an order but it is not guaranteed by the specification."

This is a **disqualifying constraint** for the projection fold. The `projStepFn` fold processes edges in normalization order. The Lean code processes `g.edges` as an ordered list, and the projection result depends on this order (which node gets assigned state ID `1` vs. `2` depends on which edge is processed first). graphology explicitly does not guarantee iteration order for nodes or edges.

**graphology keys.** All keys are coerced to strings. The Lean code uses `Nat` throughout. This requires `Nat ↔ string` conversion at every operation boundary — trivial but adds noise.

**graphology mutation.** `addNode` throws on duplicate; `mergeNode` silently succeeds. The Lean `freshNode` always allocates new IDs (never duplicates), so `addNode` is the correct method. `addDirectedEdgeWithKey` maps to edge construction with explicit keys.

**graphology error handling.** graphology enforces node existence for edge endpoints (throws on reference to non-existent node). This provides some validation that the Lean code's `buildGraph` does manually.

### Assessment by component

| Component | graphology fit | Verdict |
| --- | --- | --- |
| Normalization (`NormState`) | Good for node/edge storage. Provides runtime validation (node existence for edges). | **Marginally useful.** Replaces manual `edgesValid` check but requires maintaining a separate ordered edge list for the projection fold. |
| Projection fold (`projStepFn`) | **Poor.** Requires ordered edge iteration that graphology does not guarantee. | **Not suitable.** Must use an ordered list regardless. |
| Projection state (`ProjState.nodeToState`) | Marginal. Could use node attributes instead of a separate map. | **No advantage.** A `Map<number, number>` is simpler. |
| Confluence check | Marginal. Just iterates over edges. | **No advantage.** |
| Testing/debugging | Good. Serialization, traversal, and component detection are useful. | **Useful for tooling** but not for the core algorithm. |

### graphology standard library value

| Module | Use case | Assessment |
| --- | --- | --- |
| `graphology-traversal` (BFS/DFS) | Reachability analysis, dead-state detection | Useful for validation and debugging, not for core projection. |
| `graphology-dag` (cycle detection, topological sort) | Validating normalized graph structure | Useful for validation. But the normalized graph has cycles (back-edges from `continueLoop`), so `hasCycle` would always return true — topological sort of the acyclic subgraph would need pre-filtering. |
| `graphology-components` (SCCs) | Identifying loop structures, detecting disconnected fragments | Useful for debugging. |
| `graphology-simple-path` (all simple paths) | Testing PJ4 trace correspondence | Useful for testing. |
| `graphology-serialization` (export/import) | Snapshot testing, debugging | Useful for testing. |

### Recommendation

**Do not use graphology for the core normalization and projection algorithms.** The edge-ordering non-guarantee is disqualifying for the projection fold. The normalization and projection algorithms should use plain data structures:

- **Normalization:** A `NormState` object with `nextId: number`, `nodes: number[]`, `edges: GraphEdge[]`, `terminals: number[]`. The `freshNode` pattern maps to a function that returns `nextId` and increments it.
- **Projection:** A `ProjState` object with `nextStateId: number`, `states: number[]`, `transitions: EndpointTransition[]`, `nextTransId: number`, `nodeToState: Map<number, number>`. The `getOrCreateState` pattern maps to a function on `Map.get`/`Map.set`.

**Consider graphology for testing and debugging tooling only.** After normalization produces a `NormalizedGraph`, it could be converted to a graphology `DirectedGraph` for visualization, traversal, component analysis, and snapshot testing. This keeps graphology as a dev/test dependency, not a runtime dependency.

---

## Gap 9 — Protocol effect and receive mapping attachment

**Spec sections:** §1.8 (protocol effect), §1.10 (receive-to-machine mapping)

**What the spec says:** §1.8 says `deriveEffect` is "supplied as a boundary configuration parameter" with type `SelectedStep → ProtocolEffect`. §1.10 says `deriveReceiveStep` is "a deterministic partial function" with type `(machineSnapshot, ρ) → success(rule, info) | machineFailure | unknownAction`.

**What is missing:** How these functions are **structurally supplied** to the boundary. The spec gives type signatures but not the attachment surface:

- Is `deriveEffect` a per-action map, a global function, or an annotation on transition rules?
- Is `deriveReceiveStep` a per-label map, a global function, or something else?
- Are these supplied at boundary construction time or per-dispatch?

**Lean source:** `lean/ProtocolDispatch.lean` — `boundaryDispatch` takes `deriveEffect` as a function parameter. `lean/ProtocolReceiveDispatch.lean` — `boundaryReceive` takes `deriveReceiveStep` as a function parameter. Both are opaque function parameters — correct for proofs but insufficient for implementation.

### Research findings

**Hypothetical API sketch (`docs/protocol-boundaries-hypothetical-api.md`).** Shows per-action and per-label maps supplied at construction time:

```ts
const effects = deriveProtocolEffect<typeof machine>({
  [A.SendOffer]: () => ({ send: Offer }),
  [A.SendChunk]: () => ({ send: Chunk }),
})

const receiveMapping = deriveReceiveMapping<typeof machine>({
  [Accept.id]: () => ({ action: A.ReceiveAccept }),
  [Reject.id]: () => ({ action: A.ReceiveReject }),
})
```

**Kouzapas et al. 2016 (StMungo).** StMungo generates per-message method stubs for each endpoint. The attachment model is: one Java method per protocol message, with the method body implementing the send/receive. This is structurally analogous to a per-action map — each protocol-visible action has an explicit implementation entry point.

**Design analysis:** Three attachment models are viable:

1. **Per-action map (send side) / per-label map (receive side).** Supplied at boundary construction time. This is what the hypothetical API shows. Simple, explicit, statically checkable.
2. **Global function.** A single function `(SelectedStep) → ProtocolEffect` that dispatches internally. More flexible but harder to type-check statically.
3. **Annotation on transition rules.** Protocol effects are declared as part of the transition definition. Tighter coupling between machine definition and protocol, but requires extending the machine definition API.

Option 1 is the most consistent with the existing `@escapace/fsm` API style (builder pattern with per-action declarations) and provides the best type-level checking surface.

### Recommendation

**Adopt the per-action/per-label map pattern from the hypothetical API, and record it in the spec as the authoring surface.** Specifically:

1. `deriveEffect` is realized as a `Record<ActionId, () => ProtocolEffect>` supplied at boundary construction time. Actions not in the map produce `ProtocolEffect.none`.
2. `deriveReceiveStep` is realized as a `Record<LabelId, (payload?) => { action, payload? }>` supplied at boundary construction time. Labels not in the map produce `unknownAction`.
3. Both are supplied alongside the machine definition and endpoint automaton to `interpretBoundary(...)`.
4. The spec should state this as the structural attachment surface while noting that the semantic model requires only the function signature — the per-action/per-label map is the implementation surface that satisfies it.

---

## Gap 10 — Boundary error behavior

**Spec sections:** §2.2 (boundary dispatch result), §3.2 (receive result)

**What the spec says:** Both results are algebraic types with four constructors: `success`, `machineFailure`, `unknownAction`, `protocolViolation`.

**What is missing:** Whether each result case throws or returns, and what error classes are used.

### Research findings

**EFSM layer (`lean/README.md`).** The existing error model is:
- Unknown action → **throws** (§2.1, §7).
- No candidates / all guards fail → **returns `false`** (§2.2–2.4, §7).
- Draft lifecycle errors → **throws** specific error classes: `DraftClosed`, `DraftCommitConflict`, `DraftSnapshotFailed` (§8).

**Hypothetical API sketch.** Shows `protocolViolation` as a commented-out return-value example. Does not explicitly state throw vs. return.

**Design analysis:** The boundary layer wraps the EFSM layer. Consistency requires matching the existing throw/return convention where possible:

| Result | EFSM precedent | Boundary recommendation | Rationale |
| --- | --- | --- | --- |
| `unknownAction` | Throws | **Throw** | The EFSM layer throws for unknown actions (§2.1). The boundary should preserve this behavior — an unknown action is a programming error, not a runtime condition. |
| `machineFailure` | Returns `false` | **Return `false`** | The EFSM layer returns `false` for no-candidate and guard failures. The boundary should preserve this — the caller's existing `if (service.do(...))` pattern should work unchanged. |
| `protocolViolation` | No precedent | **Return a distinct value** | This is new to the boundary layer. Throwing would be inconsistent with the "return `false` on dispatch failure" pattern. Returning `false` would be indistinguishable from `machineFailure`. A distinct return value (e.g., a result object with a `violation` field, or a three-valued return) is needed. |
| `success` | Returns `true` | **Return `true`** or a result object | Depends on whether the caller needs the boundary-selected step. |

The key design tension: the EFSM `service.do(...)` returns `boolean`. The boundary layer adds a third outcome (`protocolViolation`) that doesn't fit the boolean return. Two approaches:

1. **Change the return type to a discriminated union** (`{ ok: true, step } | { ok: false } | { violation: true }`). This breaks the existing `if (service.do(...))` pattern.
2. **Throw on protocol violation** and return boolean for success/failure. This preserves the existing pattern but makes `protocolViolation` an exceptional condition. Given that protocol violations indicate a programming error (the machine and endpoint are out of sync), throwing is defensible.

### Recommendation

**Adopt the "throw on protocolViolation, preserve existing return convention" approach.** Specifically:

1. `unknownAction` → throw (consistent with EFSM layer §2.1).
2. `machineFailure` → return `false` (consistent with EFSM layer §2.4).
3. `protocolViolation` → throw a `ProtocolViolation` error. Rationale: a protocol violation means the `deriveEffect` configuration is inconsistent with the endpoint automaton — this is a configuration error, not a runtime condition.
4. `success` → return `true` (consistent with EFSM layer §2.5).
5. For receive-side: same pattern. `protocolViolation` → throw. `machineFailure` → return `false`. `unknownAction` → throw.
6. Boundary drafts follow the same convention.

Add a new error table to the session-type spec (paralleling `lean/README.md` §7–§8) recording these decisions.

---

## Summary

| Gap | Section | Severity | Nature | Recommendation |
| --- | --- | --- | --- | --- |
| 1. State construction algorithm | §10.2 | **Blocking** | Missing algorithm | Transcribe Lean algorithm |
| 2. Silent-edge handling algorithm | §10.4 | **Blocking** | Missing algorithm | Transcribe both cases with pseudocode |
| 3. Transition and state ID schemes | §10.3, §10.5 | **Blocking** | Under-specified | Transcribe as reference scheme |
| 4. Normalization accumulator | §9.2, §9.3, §9.5 | **Blocking** | Missing data structure | Transcribe accumulator shape |
| 5. Label construction | §10.1, §10.3 | Minor | Derivable but implicit | Add explicit construction rule |
| 6. Boundary subscription model | §2, §3, §4.6 | **Design decision needed** | Missing operational detail | Delegate to EFSM; defer protocol-aware records |
| 7. Confluence check placement | §10.4, §10.6 | Minor | Missing algorithm placement | Add check with explicit placement |
| 8. graphology evaluation | §7.5, §9, §10 | **Design decision needed** | Library vs. hand-rolled | Do not use for core; consider for testing |
| 9. Effect/receive mapping attachment | §1.8, §1.10 | **Blocking** | Missing authoring structure | Per-action/per-label maps at construction time |
| 10. Boundary error behavior | §2.2, §3.2 | **Design decision needed** | Throw vs. return unspecified | Throw on violation; preserve boolean return |

Gaps 1–4 and 9 are blocking: an implementer cannot build the system from the spec alone without them. Gaps 6, 8, and 10 require design decisions that the spec should record. Gaps 5 and 7 are minor and can be fixed by transcribing the Lean algorithm.

## Primary sources — research summary

| Source | Relevance to gaps | Key finding |
| --- | --- | --- |
| Deniélou & Yoshida 2012 | 1, 2, 3, 4 | Canonical CFSM projection uses a two-step process (global → local type → CFSM) with equivalence-class state quotient. The Lean code's direct fold is a valid specialization for the restricted fragment (no parallel composition). |
| Majumdar et al. 2021 | 1 | Generalized projection via causality tracking. The syntax-directed fold is a valid restriction of their framework. |
| Li et al. 2023 | 1, 4 | Complete automata-based projection separates synthesis from implementability. Confirms the Lean fragment is a proper subset. |
| Tirore et al. 2023 | 1 | Computable sound-and-complete projection via two-step μ-type unfolding. Different approach to recursion than the Lean code's graph-based normalization. |
| Tirore et al. 2025 | 2 | Mechanized subject reduction in Coq. Silent-step treatment is at process-calculus level, not directly applicable to projection fold. |
| Kouzapas et al. 2016 | 3, 9 | StMungo generates per-message method stubs from Scribble. Confirms per-action/per-label map pattern for effect attachment. No numeric ID scheme defined. |
| graphology design docs | 8 | **Edge iteration order is not guaranteed.** Disqualifying for the projection fold. String key coercion adds conversion overhead. |
| Hypothetical API sketch | 6, 9, 10 | Per-action/per-label map pattern for effects and receive mapping. Boundary exposes `subscribe(...)`. `protocolViolation` shown as return value. |
