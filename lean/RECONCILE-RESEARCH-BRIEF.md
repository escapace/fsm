# Reconcile research brief

## Core thesis

`reconcile` is not a general-purpose tree diff or minimum-edit algorithm. It is a fixed-alignment, topology-preserving publication operator for a restricted JavaScript heap surface, and that framing changes both the semantic-spec problem and the performance problem.

Why this matters here: a semantic specification aimed at Lean and later optimization work should encode the current operator's canonical walk and observable JavaScript surface first; otherwise the work can drift into much harder tree-edit or graph-matching problems that the implementation does not solve.

## Task reframing

### Goal

Produce a research brief that can support:

- a language-independent semantic specification for `reconcile`,
- a Lean formalization of that specification,
- later algorithm-design work focused on best possible performance,
- and, if the semantic choices remain fixed, a possible optimality argument.

### Inputs examined

- `src/context-runtime.ts`
- `src/__tests__/context-runtime-direct.spec.ts`
- `src/__tests__/context-runtime.spec.ts`
- `src/interpret.ts`
- `src/state-machine.ts`
- `src/types.ts`
- `lean/README.md`, especially §4.15 on context treatment

### Constraints

- The target semantics should be language-independent, but should model JavaScript behavior where the operator depends on it.
- The brief should help separate semantic commitments from engine-specific performance tuning.
- The brief should identify nearby academic problem classes and explain where they do and do not fit.
- Primary web sources should be stored under `.firecrawl/reconcile/`.

### Non-goals

- Rewriting `reconcile`.
- Proving anything in Lean in this document.
- Treating arbitrary ECMAScript objects, descriptors, proxies, or host objects as fully in scope.
- Claiming engine-level optimality without measurement.

## Preliminary research completed

### Local code and tests

The implementation and its contracts were reviewed in the files listed above. Two targeted test files were run directly:

```text
pnpm vitest run src/__tests__/context-runtime-direct.spec.ts src/__tests__/context-runtime.spec.ts --reporter=dot
```

Result:

- 2 test files passed
- 103 tests passed

This matters because the brief below is grounded in the tested contract, not just the implementation comments.

### Primary-source collection

Primary-source search results and scrapes were stored under:

- `.firecrawl/reconcile/search/`
- `.firecrawl/reconcile/sources/`

Key source files include:

- `.firecrawl/reconcile/sources/demaine-2009-tree-edit-distance.md`
- `.firecrawl/reconcile/sources/pawlik-2011-rted.md`
- `.firecrawl/reconcile/sources/chawathe-1996-change-detection.md`
- `.firecrawl/reconcile/sources/acar-2009-self-adjusting-computation.md`
- `.firecrawl/reconcile/sources/filinski-2013-hash-consed-structures.md`
- `.firecrawl/reconcile/sources/mcs-review.md`
- `.firecrawl/reconcile/sources/react-reconciliation.md`
- `.firecrawl/reconcile/sources/ecma262-samevalue.md`
- `.firecrawl/reconcile/sources/ecma262-ordinary-own-property-keys.md`
- `.firecrawl/reconcile/sources/mdn-map.md`
- `.firecrawl/reconcile/sources/mdn-set.md`
- `.firecrawl/reconcile/sources/mdn-structured-clone.md`
- `.firecrawl/reconcile/sources/mdn-typed-arrays.md`

## Where `reconcile` sits in the runtime

`reconcile` is not the default update path for every reducer result.

- In `src/interpret.ts`, `reconcile` is the default `reconcileContext` hook used during commit replay (`DEFAULT_RECONCILE_CONTEXT` and `applyCommitStep`; see `src/interpret.ts:62`, `src/interpret.ts:211-215`).
- In `src/state-machine.ts`, it is also used when a child machine publishes its slice back into the parent context (`src/state-machine.ts:227-230`).
- Ordinary live root reducers can still replace the root context directly without going through `reconcile`; the integration tests in `src/__tests__/context-runtime.spec.ts` make that distinction explicit.

This matters because the semantic object under study is best described as a publication operator at composition and draft-commit boundaries, not as the universal semantics of reducer execution.

## What `reconcile` does

## Working characterization

Given a current context graph and a next context graph, `reconcile` tries to mutate the current graph in place so that the result is observably equivalent to the next graph on a supported JavaScript surface, while preserving as much existing identity as is compatible with the next graph's topology and kind constraints.

The operator is graph-aware, not tree-only:

- it preserves cycles,
- it preserves shared references from the next graph,
- it splits previously shared current subgraphs when the next graph requires distinct nodes,
- and it avoids collapsing distinct next nodes into one reused current node.

The implementation achieves that with two witness tables:

- `currentToNext : WeakMap<object, object>`
- `nextToResult : WeakMap<object, object>`

Those tables are the core of both the algorithm and the future proof story.

## Supported surface

The supported value kinds are:

- primitives,
- functions as opaque atoms,
- plain objects,
- arrays,
- `Date`,
- `Map`,
- `Set`,
- `ArrayBuffer`,
- `DataView`,
- typed arrays.

Functions matter because `isObject` is defined as `typeof value === 'object' && value !== null`, so functions are not traversed. They are preserved by reference, which the direct tests cover.

## Canonical alignment by kind

The key semantic fact is that matching is fixed by kind-specific traversal rules. The algorithm does not search for a globally best correspondence.

| Kind | Canonical alignment rule | Reuse strategy | Replacement trigger |
| --- | --- | --- | --- |
| Primitive / function atom | direct value position | return current if `Object.is(current, next)`; otherwise return next | value change |
| Array | same index, preserving holes | mutate length and entries in place | nested replacement only; root array retained when kinds match |
| Plain object | `Reflect.ownKeys(next)` order, keyed by exact property key | update changed entries in place when key order stays aligned | full object rebuild when key order diverges |
| `Date` | same node position | `setTime` in place | never, if both are `Date` |
| `Map` | iteration position of entries | keep current map only if every reconciled key and value stays `Object.is`-equal at the same ordinal position | otherwise clear and rebuild in next iteration order |
| `Set` | iteration position of entries | keep current set only if every reconciled entry stays `Object.is`-equal at the same ordinal position | otherwise clear and rebuild in next iteration order |
| `ArrayBuffer` | same node position | copy bytes in place when byte length matches | replace with cloned next buffer when byte length differs |
| `DataView` / typed array | first reconcile backing buffer, then compare constructor, offset, and length | keep current view if buffer/result and metadata match | replace view when constructor, offset, or byte length differs |

That table is the single most important semantic observation for later optimization work.

## Observable guarantees distilled from tests

### Preserved when in scope

The tests show that the intended contract includes:

- root identity preservation when object-like root kinds match and in-place publication is possible,
- subtree identity preservation when compatible,
- own-key order preservation for plain objects,
- sparse-array-hole preservation,
- preservation of next sharing and cycles,
- splitting of previously shared current nodes when next requires distinct nodes,
- preservation of aliasing among `ArrayBuffer`, `DataView`, and typed-array views,
- prototype preservation for snapshot clones,
- prototype preservation for plain-object replacement subtrees created from `snapshot`,
- function values preserved by reference,
- compatibility with reactive surfaces such as Vue reactive objects and alien-deepsignals objects at publication boundaries.

### Deliberately not guaranteed, or only partially guaranteed

The implementation comments and tests also mark limits:

- arbitrary property-descriptor semantics are out of scope,
- deletion of absent-next non-configurable properties is known to fail and is covered by an `it.fails(...)` test,
- accessors are not modeled,
- plain-object prototype equality is not preserved on in-place reconciliation when current and next are both treated as plain objects,
- only the documented ordinary mutable object surface is intended to be semantic.

That last point matters for formalization. `snapshot` preserves prototypes, but `reconcilePlainObjectValue` does not compare or update prototypes when reusing a current plain object. A future specification should either exclude prototype observability for retained plain objects, or explicitly model the current asymmetry.

## The equal-fast-path insight

`reconcileEntryValue` uses `Object.is(currentEntry, nextEntry)` as a fast path. For object values, that does not simply mean “reuse without thinking.” It means:

- if the next node was already mapped, reuse the already-mapped result,
- if the current node was already consumed by another next node, clone from next instead of reusing it again,
- otherwise map current to next and reuse the current node without descending.

This is the mechanism that preserves next sharing through equal references while also preventing accidental topology collapse.

## The root-boundary asymmetry

There is one important asymmetry between top-level and nested publication.

- At the top level, if either side is non-object-like or the root kinds differ, `reconcile` returns `nextContext` directly.
- Inside a larger object graph, replacement paths use `snapshot(nextSubtree, nextToResult)` so that fresh subtrees remain detached and topology-preserving.

A semantic specification should model this explicitly. Treating “reconcile” as one uniform recursive rule will miss this boundary condition.

## Best current problem statement

A useful specification target is the following.

Given:

- a current rooted finite heap graph `C`,
- a next rooted finite heap graph `N`,
- a supported JavaScript surface,

compute a result graph `R` such that:

1. `R` is observably equivalent to `N` on the supported surface.
2. If the top-level call sees object-like roots of the same supported kind, `root(R) = root(C)`.
3. If two reachable next nodes are identical by reference, their images in `R` are identical by reference.
4. If two reachable next nodes are distinct by reference, their images in `R` remain distinct by reference.
5. Reused current nodes never violate kind, view-metadata, or topology constraints.
6. Subject to the fixed canonical alignment rules above, reuse as much of `C` as possible.

The phrase “subject to the fixed canonical alignment rules” is the critical qualifier. Without it, the problem changes class.

## Why this is not generic tree edit distance

The nearest standard literature is tree edit distance, but `reconcile` differs in three structural ways.

### It operates on graphs, not only trees

Shared references and cycles are first-class. Much of the classical tree-diff literature assumes rooted ordered trees without aliasing.

### It uses fixed matching, not search

Arrays match by index. Plain objects match by exact property key in `Reflect.ownKeys` order. Maps and sets match by iteration position. There is no global search for a lower-cost alignment.

### It optimizes publication and reuse, not edit-script minimality

The current implementation does not try to emit or minimize an abstract edit script. It tries to publish `next` into `current` while preserving compatible identity.

This distinction is the main bridge to the literature: tree-edit papers show how expensive the problem becomes once matching itself is part of the optimization problem.

## Research literature that matters

## 1. Ordered tree edit distance

### Demaine, Mozes, Rossman, Weimann (2009)

Source: ACM journal article, scraped at `.firecrawl/reconcile/sources/demaine-2009-tree-edit-distance.md`.

Why it matters: this is a primary reference for exact ordered tree edit distance. Its abstract states an `O(n^3)` algorithm and proves optimality within decomposition-strategy algorithms. That result is useful here as a contrast class: once correspondence search is part of the semantics, costs rise sharply.

Transfer value:

- helps justify keeping semantic matching fixed if linear-time publication is the goal,
- provides language for “ordered” versus “unordered” versus “guided” matching,
- suggests how lower-bound arguments can depend on the allowed family of algorithms.

Limit: it is about ordered rooted trees with edit scripts, not JavaScript heap graphs with aliasing and in-place identity reuse.

### Pawlik and Augsten, RTED (2011)

Source: PVLDB paper via arXiv abstract, scraped at `.firecrawl/reconcile/sources/pawlik-2011-rted.md`.

Why it matters: RTED focuses on robustness across tree shapes and emphasizes that exact tree-edit algorithms can have unpredictable behavior depending on instance shape. That is directly relevant if a future design considers moving from fixed alignment to search-based matching.

Transfer value:

- reinforces that “best matching” algorithms often need adaptive dynamic programming,
- gives a benchmark class for any alternative semantics that attempts reordering-aware matching.

Limit: still tree-based, not graph-based, and still solving a different optimization target.

## 2. Hierarchical change detection

### Chawathe, Rajaraman, Garcia-Molina, Widom (1996)

Source: ACM SIGMOD paper, scraped at `.firecrawl/reconcile/sources/chawathe-1996-change-detection.md`.

Why it matters: this paper treats change detection for hierarchically structured data and looks for efficient edit scripts by exploiting domain constraints. That is closer in spirit to the present problem than pure tree-edit distance because it emphasizes that domain restrictions can change both semantics and complexity.

Transfer value:

- supports the idea that the right question is not “the most general diff problem,” but “the constrained publication problem that the runtime actually needs,”
- suggests that semantic restrictions can unlock simpler and faster algorithms.

Limit: it still treats trees and change scripts, not in-place reuse on aliasing heaps.

## 3. Self-adjusting computation and change propagation

### Acar (2009)

Source: ACM invited-talk article, scraped at `.firecrawl/reconcile/sources/acar-2009-self-adjusting-computation.md`.

Why it matters: this work is not about tree diff specifically. It is about incremental response to changed inputs by tracking dependencies and updating outputs faster than recomputation. That is a valuable conceptual frame for `reconcile`, especially when thinking about publication as a locality-preserving update operator.

Transfer value:

- motivates cost models based on changed regions rather than full reconstruction,
- gives vocabulary for change propagation, incremental update, and dependency-sensitive cost,
- may help structure proofs about reuse and unaffected subgraphs.

Limit: the implementation here does not maintain dynamic dependency traces inside `reconcile` itself, so the connection is conceptual rather than direct.

## 4. Hash-consing and maximal sharing

### Braibant, Jourdan, Monniaux (2014)

Source: Journal of Automated Reasoning paper via arXiv abstract, scraped at `.firecrawl/reconcile/sources/filinski-2013-hash-consed-structures.md`.

Why it matters: hash-consing literature studies ways to maximize structural sharing through canonicalization. That is relevant because one natural alternative objective for `reconcile` is “maximize sharing globally.”

Transfer value:

- gives a contrasting design point: global canonical sharing instead of local in-place reuse,
- highlights proof/performance trade-offs around maintaining canonical tables,
- is especially relevant because the downstream plan includes Lean.

Limit: hash-consing changes the identity model. `reconcile` preserves existing live identity when possible; hash-consing typically canonicalizes by structure. Those are not the same semantics.

## 5. Maximum common subgraph literature

### Ehrlich and Rarey (2011)

Source: Wiley review article, scraped at `.firecrawl/reconcile/sources/mcs-review.md`.

Why it matters: if the semantic goal were changed from fixed alignment to “find the largest reusable common structure,” the problem starts to resemble maximum common subgraph matching.

Transfer value:

- useful as a warning sign for semantic drift,
- gives a nearby body of work for any future design that wants correspondence search across graphs.

Limit: the review is application-oriented and not a direct fit for JavaScript heaps, but it is enough to mark the adjacent problem class.

## 6. Industrial heuristic analogue

### React reconciliation docs

Source: React documentation page, scraped at `.firecrawl/reconcile/sources/react-reconciliation.md`.

Why it matters: React explicitly contrasts exact tree-edit algorithms with an `O(n)` heuristic based on fixed assumptions. The documented design trade-off is close to the strategic choice visible in `reconcile`: choose a deterministic, constrained matching rule to stay in linear-time territory.

Transfer value:

- provides a practical analogue for fixed-assumption reconciliation,
- supports the claim that restricting matching semantics is an intentional performance move, not a compromise made by accident.

Limit: React works on element trees and keyed children, not general object graphs.

## JavaScript semantic sources that should constrain the specification

## ECMAScript SameValue / `Object.is`

Source: ECMA-262, scraped at `.firecrawl/reconcile/sources/ecma262-samevalue.md` and `.firecrawl/reconcile/sources/ecma262-object-is.md`.

Why it matters: `reconcile` uses `Object.is` for its equal fast path and for many “can retain current object” checks. ECMA-262 states that `SameValue` treats `NaN` values as equal and distinguishes `+0` from `-0`.

This should be encoded directly in the semantic model because it affects both fast-path reuse and rebuild decisions.

## Own-property order

Source: ECMA-262, scraped at `.firecrawl/reconcile/sources/ecma262-ordinary-own-property-keys.md`.

Why it matters: ECMA-262 specifies own-key order for ordinary objects as:

- array indices in ascending numeric order,
- then string keys in creation order,
- then symbol keys in creation order.

`reconcilePlainObjectValue` and the object-order tests depend on this rule. Any language-independent specification should still model this ordering discipline.

## `Map` and `Set`

Source: MDN reference pages, scraped at `.firecrawl/reconcile/sources/mdn-map.md` and `.firecrawl/reconcile/sources/mdn-set.md`.

Why they matter:

- iteration order is insertion order,
- keys and set membership use `SameValueZero`,
- uniqueness is container-defined, not based on structural equality.

This is important because `reconcile` aligns map and set entries by iteration position, but the rebuilt result is then subject to JavaScript container semantics.

## Structured clone and typed-array sources

Sources:

- `.firecrawl/reconcile/sources/mdn-structured-clone.md`
- `.firecrawl/reconcile/sources/mdn-typed-arrays.md`

Why they matter:

- structured cloning is the closest standard analogue to `snapshot`,
- typed-array guidance documents the buffer/view split, offsets, lengths, and shared-buffer aliasing that the tests exercise.

Limit: the runtime's `snapshot` differs from browser `structuredClone()` because functions are preserved by reference and the supported surface is different.

## Most important research conclusion

The current implementation already commits to a semantic decision that likely determines the asymptotic answer.

If the semantic specification preserves the current canonical alignment rules, then the right target is not an exact diff algorithm from the tree-edit literature. The right target is a linear-time publication algorithm over a finite rooted graph with a restricted set of observable JavaScript kinds.

That suggests the following:

- asymptotic optimality may be provable for the current semantics,
- most remaining work is in formalization and constant-factor engineering,
- and any attempt to get “more reuse” by adding search or reordering awareness should be treated as a semantic change, not an optimization.

## A plausible optimality story

## Candidate cost model

For formal work, two cost layers should be separated.

### Layer 1: semantic work cost

A language-independent cost model can count:

- reachable next nodes visited,
- current-only entries inspected for deletion,
- property writes,
- property deletions,
- collection-entry writes,
- fresh node allocations,
- copied bytes.

At that level, a candidate aggregate cost is:

```text
cost_sem = a·node_visits + b·writes + c·deletes + d·fresh_nodes + e·entry_rebuilds + f·bytes_copied
```

### Layer 2: engine cost

A JavaScript-engine cost model adds effects that the proof should not try to predict directly:

- hidden-class transitions,
- `delete` de-optimization effects,
- `Map.clear()` and `Set.clear()` implementation details,
- typed-array and buffer allocation behavior,
- garbage-collector interaction,
- proxy/reactivity wrappers.

That layer belongs to benchmarking, not to the core semantic proof.

## Why linear-time optimality is plausible

Under the current semantics, any correct algorithm appears to need at least:

- one inspection per reachable next node or entry to distinguish changed from unchanged structure,
- one inspection of relevant current-only tails or deleted entries,
- and byte-wise work proportional to copied buffer payload when bytes change.

That yields a natural lower bound of the form:

```text
Ω(|next_reachable_surface| + |required_current_deletions| + bytes_copied)
```

The current implementation is already in that regime up to constant factors:

- arrays are processed in one pass,
- plain objects are processed in one pass over next keys plus any required deletion/rebuild work,
- maps and sets are processed in one pass over next iteration order,
- buffers are copied once,
- shared next nodes are memoized through `nextToResult`,
- split-required cases snapshot the next subtree once.

That is the best reason to believe an asymptotic optimality proof is realistic for the fixed semantics.

## Where optimality becomes harder

A stronger claim such as “minimum possible allocations among all algorithms that produce a result observationally equivalent to next” is more delicate.

The obstacles are:

- plain-object prototype asymmetry,
- descriptor exclusions,
- engine-dependent costs for delete versus rebuild,
- possible multiple valid reuse choices when the spec does not yet say which one is preferred.

The recommendation is to prove optimality first for a clean semantic objective such as:

- maximal node reuse under canonical alignment, or
- minimal fresh-node count under canonical alignment,
- with buffer-copy cost counted separately.

After that, benchmark-guided engineering can target engine constants.

## Recommendations for the semantic specification

## 1. Make the object of semantics a finite rooted graph, not a tree or plain value

The current Lean semantic specification (`lean/README.md`, §4.15) treats context as a value and explicitly excludes cloning and identity preservation. That abstraction is too coarse for `reconcile`.

A new layer should model:

- node identity,
- edge structure,
- sharing,
- cycles,
- and kind-specific observables.

## 2. Separate supported observables from excluded ECMAScript features

The specification should explicitly include:

- primitive values and function atoms,
- arrays with holes and length,
- ordinary-object ordered own-key surface,
- `Date` time values,
- `Map` and `Set` iteration order and uniqueness semantics,
- `ArrayBuffer` bytes,
- view metadata for `DataView` and typed arrays,
- sharing and cycle topology.

The specification should explicitly exclude or restrict:

- accessors,
- proxies,
- arbitrary descriptor preservation,
- non-configurable deletion guarantees,
- prototype equality for retained plain objects unless the implementation is changed.

## 3. Model the top-level and recursive cases separately

The specification should distinguish:

- top-level `reconcile(parentContext, nextContext)`,
- internal subtree publication used during recursion.

Otherwise the root asymmetry around direct `nextContext` return will be lost.

## 4. Treat the witness maps as semantic proof devices

Even if the final specification is denotational, the proof will likely be much easier if it introduces witness relations analogous to:

- `currentToNext`,
- `nextToResult`.

Those witness structures make the following theorems natural:

- next-sharing preservation,
- no-collapse of distinct next nodes,
- split-on-conflict for reused current nodes,
- uniqueness of the result image for each next node.

## 5. State the canonical alignment rules as part of the semantics, not as an implementation note

This is the largest point of possible ambiguity. The spec should say directly:

- arrays align by index,
- plain objects align by `Reflect.ownKeys` order and exact property keys,
- maps and sets align by iteration position,
- binary views align through backing-buffer publication plus view metadata.

Without that, later optimization work may mistakenly optimize for a different problem.

## Recommendations for Lean modeling

A workable Lean design would likely use:

- a finite node identifier type,
- a heap map from node id to node payload,
- an inductive `Kind` for supported node kinds,
- arrays represented by `length` plus a finite partial map for present indices,
- ordinary objects represented by an ordered list of keys plus a finite key-to-value map,
- maps represented by an ordered list of key/value references with a normalization invariant for JavaScript uniqueness,
- sets represented by an ordered list of references with the analogous uniqueness invariant,
- buffers as byte vectors,
- views as metadata records referencing a buffer node.

Values can then be:

```text
Value := Atom | Ref NodeId
```

Function values can be modeled as opaque atoms, not executable functions.

Theorems worth targeting first:

1. Soundness: result is observably equivalent to next on the supported surface.
2. Root preservation: compatible object-like roots preserve the parent root identity.
3. Alias preservation: equal next references map to equal result references.
4. No-collapse: distinct next references map to distinct result references.
5. Split correctness: if one current node would otherwise serve two distinct next nodes, at least one branch is fresh.
6. Reuse maximality under canonical alignment.
7. Work bound: `O(surface_size + bytes_copied)` in the abstract cost model.

## Performance research directions that still matter after formalization

If the semantics remain fixed, the remaining performance space is mostly constant-factor work. The most plausible directions are these.

## 1. Plain-object fast paths

The object path is the densest piece of logic.

Questions worth testing:

- whether current-key enumeration can be delayed or reduced without changing deletion semantics,
- whether rebuild versus in-place update heuristics can be improved for common shapes,
- whether different representations of changed entries help monomorphism or reduce allocations.

The semantic spec should keep these open as implementation choices, as long as observable behavior remains fixed.

## 2. `Map` and `Set` rebuild strategy

The current algorithm retains the container only when every ordinal entry remains `Object.is`-equal after reconciliation; otherwise it clears and rebuilds.

That may already be near-optimal for the fixed semantics because JavaScript does not expose a stable ordinal-mutation API for `Map` or `Set`. A more incremental strategy would still need to preserve iteration order and uniqueness semantics, and may end up paying comparable or worse costs.

This is a benchmark question more than a semantic one.

## 3. Binary fast paths

Buffer copying has a natural byte lower bound. The main questions are:

- whether byte-length mismatch replacement is the right constant-factor choice,
- whether particular typed-array constructors benefit from specialized paths,
- whether alias-preserving view reconstruction can be streamlined.

The asymptotic ceiling here is already tight.

## 4. Reactive-wrapper interaction

Because the integration tests cover Vue and alien-deepsignals, stable identity is a semantic-performance concern, not only a micro-optimization. Any algorithm change should be evaluated against:

- identity retention of live reactive objects,
- publication into child slices,
- draft commit behavior.

## Risks and open semantic questions

1. Prototype treatment for retained plain objects is underspecified if the goal is full JavaScript observability.
2. Descriptor semantics should stay out of scope unless the implementation is changed substantially.
3. `Map` and `Set` semantics depend on JavaScript's `SameValueZero`, while fast-path reuse uses `Object.is`; the spec should state both levels separately.
4. The current semantic model in `lean/README.md` intentionally abstracts contexts as pure values, so this work should likely live in a separate context-runtime semantic layer rather than be forced into the existing abstraction unchanged.
5. There may be no named literature result that matches this operator exactly. The closest references are adjacent problem classes, not direct templates.

## Recommended next steps

1. Write a dedicated context-runtime semantic specification as a separate document next to the existing Lean semantic specification.
2. Freeze the supported surface explicitly before attempting optimality claims.
3. Define a graph-based observational equivalence for that surface.
4. Define canonical alignment rules as semantic rules.
5. Prove soundness and topology preservation first.
6. Prove maximal reuse or minimal fresh-node count under canonical alignment second.
7. Only after that, resume engine-level optimization with benchmarks, because the likely remaining gains are constant-factor.

## Bottom line

The strongest current hypothesis is that `reconcile` already occupies the right asymptotic class for its present semantics, and that the main remaining work is to formalize those semantics precisely enough to prove soundness, reuse properties, and a fixed-alignment optimality result.

Why this matters: if that hypothesis is right, the best path forward is not to search the tree-edit literature for a faster exact matcher, but to formalize the current constrained publication problem and only widen the semantics if there is a deliberate product reason to do so.

## Source appendix

### Local sources

- `src/context-runtime.ts`
- `src/__tests__/context-runtime-direct.spec.ts`
- `src/__tests__/context-runtime.spec.ts`
- `src/interpret.ts`
- `src/state-machine.ts`
- `src/types.ts`
- `lean/README.md`

### Web sources saved locally

- `.firecrawl/reconcile/sources/demaine-2009-tree-edit-distance.md`
- `.firecrawl/reconcile/sources/pawlik-2011-rted.md`
- `.firecrawl/reconcile/sources/chawathe-1996-change-detection.md`
- `.firecrawl/reconcile/sources/acar-2009-self-adjusting-computation.md`
- `.firecrawl/reconcile/sources/filinski-2013-hash-consed-structures.md`
- `.firecrawl/reconcile/sources/mcs-review.md`
- `.firecrawl/reconcile/sources/react-reconciliation.md`
- `.firecrawl/reconcile/sources/ecma262-samevalue.md`
- `.firecrawl/reconcile/sources/ecma262-object-is.md`
- `.firecrawl/reconcile/sources/ecma262-ordinary-own-property-keys.md`
- `.firecrawl/reconcile/sources/mdn-map.md`
- `.firecrawl/reconcile/sources/mdn-set.md`
- `.firecrawl/reconcile/sources/mdn-structured-clone.md`
- `.firecrawl/reconcile/sources/mdn-typed-arrays.md`
