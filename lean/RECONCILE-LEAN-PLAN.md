# Lean plan for `snapshot` / `reconcile`

## Core takeaway

The Lean work should formalize a **JS-free, fixed-alignment heap-graph core** of `snapshot` and `reconcile`, prove the soundness and topology properties that matter for reimplementation confidence, and stop there.

That means:

- formalize the supported surface from `lean/README-RECONCILE.md`,
- avoid proving ECMAScript semantics beyond what the spec already abstracts,
- separate a proof-friendly relational model from any later executable reference algorithm,
- and reuse existing mathlib structures only where they reduce proof burden rather than forcing the model into the wrong shape.

Integration into the existing Lean proof tree is explicitly out of scope.

## Task specification

### Goal

Produce a staged Lean plan that leads to:

1. a precise formal model of the default context runtime,
2. proofs of the semantic properties that give confidence in a future `reconcile` reimplementation,
3. and a later proof-friendly path to abstract work bounds relevant to performance work.

### Inputs

Primary local inputs:

- `lean/README-RECONCILE.md`
- `lean/RECONCILE-COMPLETE-RESEARCH-BRIEF.md`
- current Lean project layout in `lean/`
- installed mathlib `v4.28.0`
- Lean skill references and books

Primary local research inputs consulted for this plan:

- `Mathlib.Data.Finmap`
- `Mathlib.Data.List.AList`
- `Mathlib.Data.List.Sigma`
- `Mathlib.Data.List.Nodup`
- `Mathlib.Data.List.Pairwise`
- `Mathlib.Data.List.Permutation`
- `Mathlib.Logic.Relation`
- `Mathlib.Control.Basic`
- `Mathlib.Combinatorics.SimpleGraph.Basic`
- `Mathlib.Std.Data.HashMap`
- `Mathlib.Data.Array.Defs`

Lean skill book sections consulted:

- *An Introduction to Lean 4*
  - equality,
  - functions,
  - subtypes,
  - lists
- *Mathematics in Lean*
  - induction and recursion,
  - finite sums/products as a general pattern for structural recursion over finite objects

### Constraints

- Scope only the semantic boundary needed for `reconcile` confidence and later performance reasoning.
- Do not prove full JavaScript semantics.
- Do not integrate with existing Lean proofs.
- Prefer mathlib reuse over custom infrastructure when mathlib fits the problem.
- Prefer proof-friendly data structures in the semantic core.
- Keep any later executable algorithm subordinate to the semantic spec.

### Non-goals

- full ECMAScript modeling,
- descriptors, accessors, proxies, `SharedArrayBuffer`, and engine behavior,
- proving `Reflect.ownKeys` order from raw JS syntax categories,
- proving `Map`/`Set` insertion semantics from the ECMAScript spec,
- extracting or verifying an optimized production implementation,
- refactoring existing Lean modules.

## Research findings that drive the plan

## 1. The proof core should not use general graph libraries

`Mathlib.Combinatorics.SimpleGraph.Basic` defines `SimpleGraph` with a **symmetric** adjacency relation and a loopless invariant. That is the wrong abstraction for `reconcile`.

`reconcile` needs:

- directed edges,
- labeled edges by field/index/container position,
- self-cycles,
- multiple outgoing edge shapes depending on node kind,
- and alias-sensitive buffer/view relations.

So the right move is a **custom directed heap graph model**, while reusing mathlib’s generic relation infrastructure for reachability and closure proofs.

**Decision:** do not use `SimpleGraph`.

## 2. `Relation.ReflTransGen` is the right reusable notion for reachability/cycles

`Mathlib.Logic.Relation` provides exactly the generic closure tools needed:

- `Relation.ReflTransGen`
- `Relation.TransGen`
- `Relation.ReflTransGen.head_induction_on`
- `Relation.ReflTransGen.trans_induction_on`
- `Relation.ReflTransGen.mono`
- `Relation.ReflTransGen.lift`
- `Relation.TransGen.closed'`

This is enough to avoid building custom path infrastructure early.

**Decision:** define a node-to-node edge relation from heap payloads, then reuse `ReflTransGen` for reachability and cycle statements.

## 3. `Finmap` is the best heap and witness-map representation in the proof core

`Mathlib.Data.Finmap` gives a proof-friendly finite map with strong lookup/update lemmas:

- `Finmap.lookup`
- `Finmap.insert`
- `Finmap.erase`
- `Finmap.ext_lookup`
- `Finmap.lookup_insert`
- `Finmap.lookup_insert_of_ne`
- `Finmap.lookup_erase`
- `Finmap.lookup_erase_ne`

This is a better fit than:

- `AList`, which preserves order that the heap itself does not need,
- `Std.HashMap`, whose local mathlib wrapper is intentionally thin and not proof-oriented,
- or `Nat → Option Node`, which makes finiteness and domain lemmas more cumbersome.

**Decision:** use `Finmap (fun _ => Node)` for heaps and `Finmap`-based witness maps when order is irrelevant. In the relational layer, keep current and next node-id namespaces distinct, but do not make the result namespace fully disjoint from the current one. For `reconcile`, the result namespace should be modeled as `CurId ⊕ FreshId` or an equivalent extension of current ids, so literal current-node reuse remains expressible.

## 4. `AList` is a strong fit for ordered plain-object fields

`Mathlib.Data.List.AList` and `Mathlib.Data.List.Sigma` provide an ordered, duplicate-free association-list model with useful lookup/update lemmas:

- `AList.lookup`
- `AList.ext`
- `List.NodupKeys`
- `List.dlookup`
- `List.kerase`
- `List.kinsert`
- `List.dlookup_kinsert`
- `List.dlookup_kerase`

For plain objects, the semantics needs exactly:

- ordered own keys,
- exact-key lookup,
- duplicate-free fields,
- delete-and-rebuild in next-key order.

That matches `AList` much better than a quotient map like `Finmap`.

**Decision:** use `AList` or raw `List (Sigma ...)` plus `NodupKeys` for plain-object fields.

Practical preference:

- expose plain-object fields as `AList` in the main definitions,
- drop down to `entries : List (Sigma ...)` only when a proof needs direct list induction or `kerase`/`kinsert` lemmas.

## 5. For `Map` and `Set`, order matters more than lookup

The semantic spec is explicit:

- `Map` aligns by **ordinal entry position**, not by key lookup,
- `Set` aligns by **ordinal value position**, not by membership search.

So the key proof burden is not associative lookup. It is:

- stable sequence order,
- recursive pointwise reconciliation,
- and well-formedness of insertion-order uniqueness.

Mathlib’s strongest help here is from lists:

- `List.Nodup`
- `List.Pairwise`
- `List.Perm`
- append and disjointness lemmas from `Mathlib.Data.List.Nodup`

**Decision:** model `Map` entries as ordered lists with a well-formedness predicate, and `Set` contents as ordered lists with a well-formedness predicate.

Do **not** force `Map` and `Set` into lookup-first structures in the semantic core.

## 6. Arrays should be proof-first, not runtime-first

Core Lean provides `Array.ext`, `Array.getElem_set`, and `Array.getElem_push`. Those are useful later for executable models.

But the current proof target is semantic, not extracted runtime speed. The semantics of JS arrays here is:

- finite length,
- indexed entries,
- holes,
- fixed index alignment.

That is often easier to prove with a list-based representation such as:

- `List (Option (Value Atom ι))`
- or a record with `length` and a finite partial index map, if sparse proofs need it.

`ByteArray` has much thinner theorem support than `List` or `Array`.

**Decision:**

- use a proof-friendly list-based array representation in the semantic core,
- use `Array` or `ByteArray` only in a later executable-reference layer if needed.

## 7. Subtypes should be used sparingly

The Lean book material on subtypes is useful, but the lesson for this project is restraint.

Subtype-heavy designs often make every theorem carry coercions and proof fields. For this domain, that is likely too expensive unless the subtype buys a lot.

**Decision:**

- keep the main semantic objects as plain structures plus separate `WellFormed` predicates,
- use subtypes only at stable boundaries when a wrapped invariant significantly shortens later proofs.

Examples where subtypes may be worth it:

- a final `WFHeap` wrapper once the plain `HeapWellFormed` predicate stabilizes,
- finite roots with proof of membership in the heap,
- normalized map/set sequences only if coercion noise stays low.

## 8. Early recursion should follow “spec first, executable later”

The books and current project style both favor structurally recursive definitions with short `simp`-friendly lemmas.

The existing project uses direct recursion and simple `termination_by` measures where needed. That is a good fit for tree-like syntax, but `reconcile` works over cyclic graphs with memo tables. Direct recursive implementation in Lean is therefore a termination trap.

**Decision:**

- first define `snapshot` and `reconcile` relationally or with explicit witness/state invariants,
- only later define an executable reference algorithm with an explicit worklist and decreasing measure.

That avoids spending the first proof tranche on `WellFounded.fix` and termination engineering.

## 9. `StateM` and `List.mapAccumLM` are useful later, not first

`Mathlib.Control.Basic` provides `List.mapAccumLM` / `mapAccumRM`, which match the single-pass shape of several `reconcile` subroutines.

But theorem support around monadic accumulator programs is much thinner than around direct recursive definitions over lists.

**Decision:**

- in the first proof tranche, prefer explicit recursive helper functions with named state records,
- keep `StateM` / `mapAccumLM` for a later executable or refinement layer if they reduce implementation noise.

## 10. The scope boundary should be semantic confidence, not JavaScript completeness

Both the brief and the spec point to the same stopping rule:

- prove the fixed-alignment heap-graph operator,
- prove soundness, sharing, no-collapse, locality, and canonical-alignment properties,
- optionally prove an abstract linear work bound,
- stop before descriptor semantics, full ECMAScript keyed-collection theory, or engine-level claims.

That is the right boundary for confidence in a future reimplementation and later optimization work.

## Recommended proof architecture

Use three layers, in order.

### Layer A — semantic core

A JS-free, proof-friendly model of:

- atoms,
- values and refs,
- heap nodes,
- ordered object fields,
- ordered map/set sequences,
- buffers and views,
- well-formedness predicates.

### Layer B — relational semantics

A non-executable or lightly executable specification of:

- snapshot image relation,
- reconcile witness relations,
- surface equivalence,
- topology preservation,
- kind-specific publication rules.

This is where the main semantic theorems live.

### Layer C — executable reference and cost

Only after Layer B stabilizes:

- define an executable reference algorithm as a readable, testable artifact,
- add abstract work accounting and upper bounds.

The executable reference serves as documentation and a test oracle, not as a formal refinement target. The relational specs from Layer B are the proof-stable contract; proving that one particular reference algorithm matches them adds no confidence beyond what the specs themselves provide.

This is the layer relevant to future performance-oriented reimplementation work.

## Data-structure decisions

| Need | Best choice | Why | Avoid in phase 1 |
| --- | --- | --- | --- |
| Heap of nodes | `Finmap (fun _ => Node)` | finite-domain lookup/update theorems, order irrelevant | `Std.HashMap`, `RBMap`, raw function maps |
| Plain-object fields | `AList (fun _ : PropertyKey => Value Atom ι)` | ordered keys + duplicate-free + lookup/update theorems | `Finmap`, unordered maps |
| Map entries | `List (Value Atom ι × Value Atom ι)` + `MapWF` | semantics is ordinal, not lookup-based | forcing into `AList` too early |
| Set entries | `List (Value Atom ι)` + `SetWF` | order matters, membership matching does not | `Finset`, unordered sets |
| Arrays with holes | `List (Option (Value Atom ι))` | direct induction, holes explicit | `ByteArray`, sparse function maps in phase 1 |
| Buffer bytes | `List UInt8` in proof core | proof-friendly extensional equality | `ByteArray` in phase 1 |
| Reachability | edge relation + `Relation.ReflTransGen` | reusable mathlib closure theory | custom path calculus too early |
| Witness maps | `Finmap` | finite and extensional | `Std.HashMap` in proof core |

## Suggested abstraction boundary for JavaScript-specific behavior

To avoid proving JavaScript semantics unnecessarily, encode only what `reconcile` actually observes.

### Atoms

Use an abstract atom type with decidable equality, or a small explicit atom datatype that already bakes in the distinctions needed by `SameValue`.

Examples of acceptable abstraction choices:

- opaque `Atom` with `[DecidableEq Atom]`, assuming it already reflects the right observables,
- or a concrete atom datatype with constructors that distinguish `NaN`, `+0`, and `-0` if desired.

Do **not** prove ECMAScript `SameValue` itself.

### Property keys

Use an abstract `PropertyKey` type with decidable equality and assume plain-object field order is already canonical.

Do **not** prove `OrdinaryOwnPropertyKeys` from lower-level JS notions.

### Map / Set uniqueness

Use a well-formedness predicate parameterized by an abstract canonicalization or key-equivalence notion.

Do **not** prove ECMAScript `SameValueZero` and insertion behavior inside Lean.

### Typed arrays

Model only the observables needed by the spec:

- constructor tag,
- buffer ref,
- offsets and lengths,
- visible element content or equivalent observable byte content.

Do **not** prove JS constructor range-check semantics.

## Suggested file/module split

Keep this work completely separate from the current proof tree.

Suggested new Lean modules:

- `lean/ReconcileDefs.lean`
- `lean/ReconcileWF.lean`
- `lean/ReconcileReachability.lean`
- `lean/ReconcileSurfaceEq.lean`
- `lean/ReconcileSnapshotSpec.lean`
- `lean/ReconcileSnapshotSoundness.lean`
- `lean/ReconcileSpec.lean`
- `lean/ReconcileSoundness.lean`
- `lean/ReconcileAlgorithm.lean`
- `lean/ReconcileCost.lean`

If a subdirectory is preferred, use `lean/Reconcile/` with one file per topic. The important point is namespace and import separation, not naming.

## Iterative plan

Each iteration is intentionally small and ordered by dependency.

## Iteration 0 — freeze the formal scope

### Objective

Turn `lean/README-RECONCILE.md` into a minimal Lean-facing checklist of supported features, excluded features, and theorem targets.

### Deliverables

- a short comments-only scoping note at the top of the new reconcile modules,
- a stable list of supported node kinds,
- a stable list of explicit exclusions.

### Required decisions

Freeze these before any Lean definitions:

1. arrays are index-only with holes,
2. plain objects are ordered exact-key records,
3. maps and sets are ordinal sequences,
4. buffers and views are separate node kinds,
5. no descriptors/proxies/`SharedArrayBuffer`.

### Acceptance criterion

No theorem or definition in later iterations has to reopen the JS semantic boundary.

## Iteration 1 — define the proof-friendly semantic core

### Objective

Define the heap graph and node payloads in the smallest form that can express the spec.

### Recommended definitions

- distinct id types `CurId`, `NextId`, and `FreshId` with decidable equality, implemented as `Nat`-based types if convenient
- for generic definitions, an inductive value type such as `Value (Atom : Type) (ι : Type)` with constructors `atom : Atom → Value Atom ι` and `ref : ι → Value Atom ι`
- generic heaps `Heap Atom ι := Finmap (fun _ : ι => Node Atom ι)`
- for `reconcile`, use `ResId := CurId ⊕ FreshId` or an equivalent extension of current ids
- `NodeKind` as an inductive enum
- `Node` as a structure or inductive with per-kind payloads
- `ObjFields Atom ι := AList (fun _ : PropertyKey => Value Atom ι)`
- arrays as `List (Option (Value Atom ι))`
- map entries as `List (Value Atom ι × Value Atom ι)`
- sets as `List (Value Atom ι)`
- buffers as `List UInt8`

### Well-formedness predicates

Define separately:

- `HeapWF`
- `NodeWF`
- `MapWF`
- `SetWF`
- `RootWF`

### mathlib reuse

- `Finmap`
- `AList`
- `List.Nodup`
- `List.NodupKeys`
- `List.Pairwise`

### Acceptance criterion

There is a precise, JS-free Lean datatype for every supported semantic object from the spec.

## Iteration 2 — define reachability and observational surface

### Objective

Define the notions needed for correctness statements before defining `snapshot` or `reconcile`.

### Definitions

- `edge : Heap Atom ι → ι → ι → Prop`
- `Reachable := Relation.ReflTransGen (edge h)` from a root
- `SurfaceEq : Heap Atom ι₁ → Value Atom ι₁ → Heap Atom ι₂ → Value Atom ι₂ → Prop`
- `SameShape` or equivalent helper predicates for kind compatibility
- `ImagesPreserveTopology` helper definitions

### mathlib reuse

- `Relation.ReflTransGen`
- `Relation.ReflTransGen.lift`
- `Relation.ReflTransGen.mono`
- `Relation.TransGen.closed'`

### Notes

Keep `SurfaceEq` custom. There is no existing mathlib notion that captures this heap-graph observational equivalence directly.

### Acceptance criterion

All later theorem statements can be written without mentioning JavaScript source code or runtime objects.

## Iteration 3 — define `snapshot` at the semantic level

### Objective

Define `snapshot` as a semantic construction with explicit memoization, but choose a proof-first formulation.

### Strategy

Start relationally or with an explicit finite memo/result state, not with a directly recursive executable function over cyclic graphs.

Recommended structure:

- `SnapshotState` containing image map plus result heap,
- a relation or function that processes one source node at a time,
- a top-level `SnapshotSpec` relating source root to result root.

### Why this order

`snapshot` is simpler than `reconcile` but already exercises:

- graph copying,
- cycles,
- sharing,
- object-field order,
- view/buffer alias preservation.

### mathlib reuse

- `Finmap` for memo state,
- `AList` for object fields,
- list induction for arrays, maps, sets,
- `List.Perm` only where order-insensitive heap facts are needed.

### Acceptance criterion

There is a stable `SnapshotSpec` strong enough to state R1 and R2 from `lean/README-RECONCILE.md`.

## Iteration 4 — prove the `snapshot` theorems

### Objective

Finish the snapshot proof tranche before touching `reconcile`.

### Target theorems

- surface preservation,
- fresh-node detachment,
- sharing preservation,
- distinctness preservation,
- cycle preservation,
- buffer/view alias preservation.

### Proof pattern

- list induction for ordered substructures,
- `Finmap.ext_lookup` for memo/result maps,
- `AList.ext` and lookup lemmas for object fields,
- `Relation.ReflTransGen` lemmas for reachability claims.

### Acceptance criterion

`snapshot` has a complete proof story on the supported surface and can be used as a trusted component inside later `reconcile` proofs.

## Iteration 5 — define `reconcile` relationally with witness maps

### Objective

Define the semantic heart of `reconcile` exactly as in the spec, using witness maps analogous to `reuse` and `image`.

### Recommended definitions

- `Reuse : Finmap (fun _ : CurId => NextId)` or equivalent current-to-next witness map
- `Image : Finmap (fun _ : NextId => ResId)` with `ResId := CurId ⊕ FreshId`, or an equivalent next-to-result witness map
- root rule
- recursive rule
- shared-object fast path
- kind-specific relations for arrays, objects, maps, sets, buffers, and views

### Important modeling choice

Treat `reuse` as **current-node consumption/alignment reservation**, not necessarily final image identity. This matches the corrected semantic spec and avoids the earlier contradiction around incompatible buffer/view replacement.

### mathlib reuse

- `Finmap.lookup` / `insert` / `erase`
- `List.Nodup` and `AList` lookups for ordered collections

### Acceptance criterion

There is a precise relational spec of `reconcile` that matches `lean/README-RECONCILE.md` without yet solving termination for an executable function.

## Iteration 6 — prove the core `reconcile` theorems

### Objective

Prove exactly the theorems that give reimplementation confidence.

### First theorem tranche

Prove these first:

1. root fast-path correctness,
2. root replacement asymmetry,
3. reconcile soundness (`SurfaceEq result next`),
4. sharing theorem,
5. no-collapse theorem,
6. current-node injectivity,
7. locality theorem,
8. canonical-alignment theorem,
9. ordered-key publication theorem,
10. ordinal map/set publication theorem,
11. buffer/view alias theorem.

### Why these first

These theorems correspond directly to:

- the semantic spec,
- the most valuable runtime tests,
- and the properties future optimizations must preserve.

### What to defer

Defer any cost or executable-equivalence theorem until the semantic proofs above stabilize.

### Acceptance criterion

The relational spec is strong enough that a future reimplementation can be judged by refinement against it.

## Iteration 7 — add a small executable reference algorithm

### Objective

Only after semantic stability, define an executable reference algorithm close to the current implementation.

### Strategy

Use an explicit worklist/state record with a clear decreasing measure.

Good candidates:

- remaining next nodes or tasks,
- plus remaining unprocessed sequence lengths,
- plus a measure for fresh work spawned by snapshot replacement.

### Important caution

Do not start with `WellFounded.fix` unless simpler structural recursion fails. Prefer explicit worklist recursion with:

- a named state structure,
- a theorem-friendly invariant,
- and `termination_by` on a transparent size measure.

This matches the style already used in `ProjectionNormalize.lean`.

### Data-structure guidance

For this layer only, reassess whether arrays should remain lists or become core `Array`s. If `Array` is used, rely on:

- `Array.ext`
- `Array.getElem_set`
- `Array.getElem_push`

Still avoid `Std.HashMap` in the first executable reference unless there is a compelling reason.

### Acceptance criterion

There is an executable reference model with a believable termination argument and no semantic drift from the relational spec.

## Iteration 8 — add abstract work accounting

### Objective

Formalize only the work model needed for later performance confidence.

### Scope

Count only abstract semantic work such as:

- visited next nodes,
- traversed ordered entries,
- deleted/reinserted fields or entries,
- copied bytes.

### Explicit non-goals

Do not attempt to model:

- JS hidden classes,
- GC,
- `delete` engine behavior,
- proxy traps,
- V8 or SpiderMonkey constant factors.

### Theorems

- an upper bound matching the spec’s linear-work intuition,
- optionally a simple lower-bound lemma showing every algorithm must inspect the next reachable surface and pay required byte-copy work.

### Acceptance criterion

The Lean model supports later optimization claims at the abstract algorithmic level without pretending to model the JS engine.

## Iteration 9 — stop line

Stop after:

- semantic core,
- snapshot proofs,
- reconcile relational proofs,
- executable reference algorithm,
- abstract work accounting.

Do not continue into:

- full JS semantics,
- category-theoretic generalization,
- arbitrary graph matching,
- exact edit-distance comparison proofs,
- integration with the current Lean EFSM proof tree.

## Proof-style guidance

Follow the patterns already used successfully in this repository.

### Preferred style

- small structures and inductives,
- short `@[simp]` lemmas early,
- direct recursive defs where possible,
- explicit helper lemmas per node kind,
- `ext`-style proofs for structures and maps,
- list induction for ordered containers,
- relation induction for reachability and path properties.

### Avoid early

- overly dependent encodings,
- quotient-heavy APIs beyond mathlib’s own `Finmap`,
- tactic-heavy proofs before the simp normal forms are stabilized,
- monadic executable code before the semantic layer is settled.

## Minimal import strategy

Recommended import baseline for the new reconcile files:

```lean
import Mathlib.Data.Finmap
import Mathlib.Data.List.AList
import Mathlib.Data.List.Nodup
import Mathlib.Data.List.Pairwise
import Mathlib.Data.List.Permutation
import Mathlib.Logic.Relation
```

Add only as needed:

```lean
import Mathlib.Control.Basic      -- only if using List.mapAccumLM / mapAccumRM
import Mathlib.Data.Array.Defs    -- only if adding an Array-based executable layer
```

Do not pull in broad tactic imports at the foundation layer unless they materially shorten proofs.

## What success looks like

The Lean work is successful if, at the end of the planned scope, it provides:

1. a stable formal contract for `snapshot` and `reconcile`,
2. proofs of the properties future implementations must preserve,
3. a readable executable reference algorithm as documentation and test oracle,
4. and an abstract work model tight enough to guide performance work.

It is not necessary for success to prove JavaScript semantics beyond the abstractions already frozen in `lean/README-RECONCILE.md`.

## Bottom line

The optimal Lean strategy is:

- custom directed heap graph,
- `Finmap` for heaps and witness maps,
- `AList` for ordered plain-object fields,
- list-based ordered sequences for arrays/maps/sets in the proof core,
- `Relation.ReflTransGen` for reachability,
- relational semantics first,
- executable reference algorithm as documentation second,
- work accounting last.

That is the smallest plan that still gives high confidence for a future `reconcile` reimplementation and for later performance optimization work.
