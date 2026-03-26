# Complete research brief for `reconcile`

## Core takeaway

`reconcile` is a deterministic, fixed-alignment, in-place publication operator over a restricted JavaScript heap surface, not a general diff, minimum-edit, or graph-matching algorithm.

Why this matters here: a semantic specification and a later Lean proof should model the current operator that exists, not a stronger optimization problem borrowed from tree-edit or graph-edit literature.

## Status of this document

This document supersedes `lean/RECONCILE-RESEARCH-BRIEF.md`, which should be treated as preliminary research.

## Scope and objective

The purpose of this brief is to provide enough researched material to write a semantic specification for `src/context-runtime.ts`, with emphasis on `reconcile`, while also mapping the relevant algorithmic literature for later performance work.

The target artifact after this brief is a semantic specification that:

- is language-independent at the mathematical level,
- models JavaScript behavior where the implementation depends on it,
- is precise enough to support Lean formalization,
- and preserves a clean separation between semantic commitments and implementation-level optimization choices.

## Method and evidence base

### Local repository sources reviewed

- `src/context-runtime.ts`
- `src/__tests__/context-runtime-direct.spec.ts`
- `src/__tests__/context-runtime.spec.ts`
- `src/interpret.ts`
- `src/state-machine.ts`
- `src/types.ts`
- `perf/context-runtime.bench.ts`
- `lean/README.md`

### Runtime verification performed

Targeted context-runtime tests were run directly:

```text
pnpm vitest run src/__tests__/context-runtime-direct.spec.ts src/__tests__/context-runtime.spec.ts --reporter=dot
```

Observed result:

- 2 test files passed
- 103 tests passed

### Web and paper corpus

Search and scrape artifacts were stored under:

- `.firecrawl/reconcile/search/`
- `.firecrawl/reconcile/sources/`
- `.firecrawl/reconcile/pdfs/`
- `.firecrawl/reconcile/ocr/`

### Primary sources collected

Core theory and algorithms:

- Demaine, Mozes, Rossman, Weimann, ordered tree edit distance:
  - `.firecrawl/reconcile/sources/demaine-2009-tree-edit-distance.md`
  - `.firecrawl/reconcile/ocr/demaine-2006-icalp-tree-edit-distance.md`
- Pawlik and Augsten, RTED:
  - `.firecrawl/reconcile/sources/pawlik-2011-rted.md`
  - `.firecrawl/reconcile/ocr/pawlik-2011-rted.md`
- Bille survey:
  - `.firecrawl/reconcile/sources/bille-2005-tree-edit-distance-survey-page.md`
- Chawathe et al., hierarchical change detection:
  - `.firecrawl/reconcile/sources/chawathe-1996-change-detection.md`
- Wang, DeWitt, Cai, X-Diff:
  - `.firecrawl/reconcile/sources/x-diff-ieee-page.md`
- Jacob, Sachde, Chakravarthy, CX-DIFF:
  - `.firecrawl/reconcile/sources/cx-diff-2003-page.md`
- Acar et al., self-adjusting computation semantics:
  - `.firecrawl/reconcile/sources/acar-2009-self-adjusting-computation.md`
  - `.firecrawl/reconcile/ocr/acar-2011-consistent-semantics-self-adjusting.md`
- Braibant, Jourdan, Monniaux, hash-consing in Coq:
  - `.firecrawl/reconcile/sources/filinski-2013-hash-consed-structures.md`
  - `.firecrawl/reconcile/ocr/braibant-2014-hash-consing.md`
- Graph edit distance survey:
  - `.firecrawl/reconcile/sources/riesen-2009-graph-edit-distance-survey.md`
- Maximum common subgraph review:
  - `.firecrawl/reconcile/sources/mcs-review.md`
- Exact unordered tree edit distance:
  - `.firecrawl/reconcile/sources/exact-unordered-tree-edit-distance.md`

JavaScript semantic sources:

- SameValue and `Object.is`:
  - `.firecrawl/reconcile/sources/ecma262-samevalue.md`
  - `.firecrawl/reconcile/sources/ecma262-object-is.md`
- ordinary own-key order and ordinary delete:
  - `.firecrawl/reconcile/sources/ecma262-ordinary-own-property-keys.md`
- `Reflect.deleteProperty`:
  - `.firecrawl/reconcile/sources/ecma262-reflection-deleteproperty-section.md`
- `Map` and `Set`:
  - `.firecrawl/reconcile/sources/ecma262-map-objects.md`
  - `.firecrawl/reconcile/sources/ecma262-set-objects.md`
  - `.firecrawl/reconcile/sources/mdn-map.md`
  - `.firecrawl/reconcile/sources/mdn-set.md`
- `ArrayBuffer`, `DataView`, and typed-array construction:
  - `.firecrawl/reconcile/sources/ecma262-arraybuffer-slice.md`
  - `.firecrawl/reconcile/sources/ecma262-dataview-constructor.md`
  - `.firecrawl/reconcile/sources/ecma262-typedarray-constructors.md`
  - `.firecrawl/reconcile/sources/mdn-typed-arrays.md`
- `structuredClone` reference point:
  - `.firecrawl/reconcile/sources/mdn-structured-clone.md`
- React reconciliation analogue:
  - `.firecrawl/reconcile/sources/react-reconciliation.md`

## Where `reconcile` sits in the runtime

`reconcile` is a publication operator at specific boundaries, not the universal reducer semantics of the system.

Repository evidence:

- `src/interpret.ts:62` sets `DEFAULT_RECONCILE_CONTEXT` to `reconcile`.
- `src/interpret.ts:211-215` calls `this.reconcileContext(this.context, step.reducer(this.context, step.action))` during commit replay.
- `src/state-machine.ts:227-230` uses `reconcile` when a child machine publishes its context slice back into the parent context.
- `src/__tests__/context-runtime.spec.ts` distinguishes root reducers that replace the live root directly from draft-commit and composed-child publication paths that publish through reconciliation.

This means the semantic target is:

- direct function semantics for `reconcile`, and
- publication semantics when used at commit replay or composed-child boundaries.

## The current implementation, precisely characterized

## High-level characterization

`reconcile(current, next)` computes a result that is intended to be observably equivalent to `next` on a supported surface, while reusing as much of `current` as is compatible with:

- node kind,
- fixed traversal alignment,
- and next-graph topology.

The operator is graph-aware.

It preserves:

- cycles,
- shared references from the next graph,
- aliasing among binary buffers and views,
- and compatible live identities.

It also prevents illegal reuse:

- a current node already consumed by one next node cannot be reused for a distinct next node,
- and incompatible same-kind binary structures are replaced rather than mutated into an impossible shape.

## The two memo tables are the core semantic mechanism

The implementation uses two `WeakMap`s.

- `currentToNext : current object ↦ next object`
- `nextToResult : next object ↦ result object`

These are not incidental implementation details. They encode the central proof obligations.

`currentToNext` prevents one reused current node from serving two distinct next nodes.

`nextToResult` guarantees that one next node has one canonical image in the result graph, whether that image is:

- a reused current node, or
- a fresh snapshot clone.

For specification work, these should be treated as semantic witness relations even if the final spec is phrased denotationally rather than operationally.

## Exact supported kind classification

The code classifies object-like values using `objectKindOf` in `src/context-runtime.ts:25-55`.

Recognized kinds:

- array
- `Date`
- `Map`
- `Set`
- `ArrayBuffer`
- `DataView`
- typed array
- plain object fallback

The local object predicate is `typeof value === 'object' && value !== null` (`src/is-object.ts`). This has two important consequences.

- Functions are not traversed as objects. They are atomic leaves and are preserved by reference.
- Any unsupported object-like JavaScript value falls into the plain-object fallback unless it is one of the recognized kinds above.

## The supported observable surface is narrower than “all JavaScript object behavior”

The code and tests support the following observables.

### Plain objects

Supported observables:

- prototype of snapshot clones,
- own-property key sequence from `Reflect.ownKeys`,
- values at those keys,
- graph topology through those property values.

Not supported as semantic commitments:

- accessor behavior,
- descriptor preservation in general,
- proxy trap behavior,
- non-configurable deletion success,
- iterator or reflection behavior during mid-operation mutation.

### Arrays

Supported observables:

- `length`,
- present numeric indices,
- holes,
- values at present numeric indices,
- nested topology through indexed entries.

Unsupported and silently excluded:

- non-index own properties on arrays,
- symbol properties on arrays,
- non-enumerable array-own properties,
- array accessors outside indexed elements.

This is a critical point. `snapshot` allocates `new Array(length)` and only traverses numeric present indices (`src/context-runtime.ts:119-130`). `reconcileArrayValue` only reads/writes indices and `length` (`src/context-runtime.ts:206-240`). Any future semantic specification that includes arbitrary array own keys would not match the code.

### `Map`

Supported observables:

- insertion-order entry sequence,
- key and value content after JS `Map` semantics are applied,
- key/value topology through recursively reconciled entries.

Not supported:

- extant iterators during mutation,
- extra own properties on `Map` instances.

### `Set`

Supported observables:

- insertion-order value sequence,
- membership under JavaScript `Set` semantics,
- topology through recursively reconciled entries.

Not supported:

- extant iterators during mutation,
- extra own properties on `Set` instances.

### `Date`

Supported observable:

- millisecond timestamp.

Not supported:

- extra own properties on `Date` instances.

### `ArrayBuffer`

Supported observables:

- current `byteLength`,
- byte contents.

Not supported:

- transfer/detachment semantics during the call,
- grow/shrink races,
- extra own properties.

### `DataView`

Supported observables:

- viewed buffer identity within the result graph,
- `byteOffset`,
- `byteLength`,
- bytes through the viewed buffer.

Not supported:

- extra own properties,
- concurrent buffer resizing semantics,
- accessor/iterator behavior external to the immediate result value.

### Typed arrays

Supported observables:

- viewed buffer identity within the result graph,
- constructor class,
- `byteOffset`,
- length and element contents.

Not supported:

- extra own properties,
- growable-buffer edge cases as semantic commitments,
- exotic reflective behavior outside indexed element reads.

### Functions

Supported observable:

- identity by reference.

Functions are treated as opaque atoms, not traversed structures.

## Unsupported or hazardous kinds that the spec should exclude explicitly

The following should be considered out of semantic scope for the first formal specification.

- `SharedArrayBuffer`
- `DataView` over `SharedArrayBuffer`
- typed arrays over `SharedArrayBuffer`
- arbitrary proxy objects as semantic values
- accessor-heavy objects
- objects whose correctness depends on descriptor fidelity
- module namespace objects and other exotic non-ordinary objects that fall through the plain-object case
- active iterators over `Map` and `Set` during reconciliation

The strongest reason is direct code evidence, not only missing tests. `snapshot(sourceView.buffer, seen)` assumes a cloneable `ArrayBuffer` path for view buffers (`src/context-runtime.ts:137-145`). A `SharedArrayBuffer` is not recognized by `objectKindOf` and would fall into the plain-object path, which does not produce a valid binary buffer clone.

## Exact algorithm of the current implementation

## Top-level entry rule

`reconcile(parentContext, nextContext)` behaves as follows (`src/context-runtime.ts:603-627`).

1. If `Object.is(parentContext, nextContext)`, return `parentContext`.
2. If either argument is non-object-like, return `nextContext`.
3. If root kinds differ, return `nextContext`.
4. Otherwise run `reconcileObjectByKind` with fresh `currentToNext` and `nextToResult` maps.

The top-level direct return of `nextContext` is a semantic asymmetry. Nested replacement does not use this rule.

## Recursive replacement rule

Nested recursion goes through `reconcileValue`, not the public root rule (`src/context-runtime.ts:534-568`).

`reconcileValue(currentValue, nextValue)`:

1. If `nextValue` is non-object-like, return `nextValue`.
2. If `nextValue` is already in `nextToResult`, return the mapped result.
3. If `currentValue` is non-object-like, return `snapshot(nextValue, nextToResult)`.
4. If `currentValue` is already in `currentToNext`, return `snapshot(nextValue, nextToResult)`.
5. If kinds differ, return `snapshot(nextValue, nextToResult)`.
6. Otherwise dispatch to kind-specific reconciliation.

This rule is why nested replacement preserves next-graph topology and detachment, while root replacement may return the exact `nextContext` reference.

## Equal-fast-path rule

`reconcileEntryValue` uses `Object.is(currentEntry, nextEntry)` before deeper work (`src/context-runtime.ts:194-204`).

If `Object.is` is true and the value is non-object-like, the current primitive or function is reused directly.

If `Object.is` is true and the value is object-like, `reconcileSharedObjectValue` decides among three cases:

1. `nextValue` already mapped in `nextToResult`:
   - return the previously mapped result.
2. `currentValue` already consumed in `currentToNext`:
   - return `snapshot(nextValue, nextToResult)`.
3. otherwise:
   - record `currentToNext[currentValue] = nextValue`,
   - record `nextToResult[nextValue] = currentValue`,
   - return `currentValue`.

This is the operator’s main topology-preserving device.

## Kind-specific reconciliation rules

### Arrays

Implementation: `src/context-runtime.ts:206-240`.

Algorithm:

1. Resize current array to next length.
2. For each index `i` in `[0, next.length)`:
   - if `i in next`, recursively reconcile `current[i]` and `next[i]`, then assign only if changed by `Object.is`;
   - else if `i in current`, delete index `i`.
3. Return current array.

Observations:

- holes are preserved,
- array reorder is not solved as a diff problem; matching is strictly by index,
- non-index keys are ignored.

### Plain objects

Implementation: `src/context-runtime.ts:398-482`.

Algorithm:

1. Read `currentOwnKeys = Reflect.ownKeys(current)`.
2. Read `nextOwnKeys = Reflect.ownKeys(next)`.
3. Optimistically assume aligned key order.
4. Iterate `nextOwnKeys` in order.
5. While aligned:
   - reconcile `current[key]` with `next[key]`,
   - record only changed entries.
6. On first key-order mismatch:
   - allocate `reconciledEntries`,
   - backfill already processed entries, including earlier replacements,
   - continue reconciling into `reconciledEntries`.
7. If alignment survived to the end:
   - write only changed keys,
   - delete trailing current-only keys,
   - return current object.
8. If alignment failed:
   - delete all current own keys,
   - reassign keys in `nextOwnKeys` order from `reconciledEntries`,
   - return current object.

Observations:

- matching is by exact property key, not by position alone,
- next key order is authoritative,
- object rebuild happens only on key-order divergence,
- prototype of a retained current plain object is not changed.

### `Date`

Implementation: `src/context-runtime.ts:242-248`.

Algorithm:

- `currentDate.setTime(nextDate.getTime())`
- return current date.

### `Map`

Implementation: `src/context-runtime.ts:250-303`.

Algorithm:

1. Iterate current entries and next entries in lockstep by ordinal position.
2. For each next entry:
   - reconcile current key to next key,
   - reconcile current value to next value,
   - store reconciled pair in a temporary flat array.
3. Track `canReturnCurrent`, initially `current.size === next.size`.
4. If every ordinal pair stayed `Object.is`-equal and sizes matched, return current map unchanged.
5. Otherwise:
   - `currentMap.clear()`
   - reinsert reconciled entries in next iteration order
   - return current map.

Important semantic consequence:

- This is ordinal alignment, not associative key matching.
- A next `Map` entry is not matched by looking up the same key in the current map.
- If any ordinal key or value replacement occurs, the container rebuilds.

### `Set`

Implementation: `src/context-runtime.ts:305-349`.

Algorithm:

1. Iterate current and next values in lockstep by ordinal position.
2. Reconcile each pair.
3. Track `canReturnCurrent` exactly as for maps.
4. If sizes and every ordinal reconciled value stayed `Object.is`-equal, return current set.
5. Otherwise:
   - `currentSet.clear()`
   - re-add reconciled values in next iteration order
   - return current set.

Again, this is ordinal alignment, not membership matching.

### `ArrayBuffer`

Implementation: `src/context-runtime.ts:351-365`.

Algorithm:

1. If byte lengths differ:
   - clone `nextBuffer.slice(0)`,
   - record `nextToResult[nextBuffer] = replacement`,
   - return replacement.
2. Otherwise:
   - copy bytes from next into current using `Uint8Array(current).set(Uint8Array(next))`,
   - return current.

Important point:

- no byte-equality fast path exists,
- equal-length buffers always incur a full byte copy.

### `DataView` and typed arrays

Implementation: `src/context-runtime.ts:367-396`.

Algorithm:

1. Reconcile the backing buffer first.
2. If all of the following hold, return current view:
   - current buffer is the reconciled buffer,
   - constructors match,
   - `byteOffset` matches,
   - `byteLength` matches.
3. Otherwise:
   - clone a new view of the next constructor over the reconciled buffer,
   - record that replacement in `nextToResult`,
   - return it.

This rule is the reason the result preserves aliasing among multiple views that share one next buffer.

## The exact current `snapshot` operator matters because `reconcile` uses it internally

`reconcile` depends on `snapshot` for nested replacement and topology splitting, so the semantic specification cannot ignore `snapshot` completely.

Implementation overview (`src/context-runtime.ts:102-192`):

- non-object-like values are returned unchanged,
- previously seen objects are reused from `seen`,
- arrays clone only indexed structure and holes,
- plain objects clone with `Object.create(Object.getPrototypeOf(source))` and `Reflect.ownKeys`,
- maps and sets clone logical entries only,
- binary values clone buffers and views while preserving aliasing,
- functions remain shared by reference.

`structuredClone()` is only a rough analogue. MDN states that `structuredClone()` creates a deep clone and throws on non-serializable values such as functions, while the runtime `snapshot` intentionally preserves functions by reference. Therefore the semantic specification should not borrow `structuredClone` as its spec text.

## Contract distilled from the direct tests

The test suite is extensive enough to treat it as part of the operator contract.

### Guarantees directly supported by tests

From `src/__tests__/context-runtime-direct.spec.ts` and `src/__tests__/context-runtime.spec.ts`:

- primitive equality fast path preserves the current value under `Object.is`
- primitive boundary crossing returns `next` at the root
- compatible arrays and plain-object subtrees preserve identity
- next key order wins over previous plain-object key order
- sparse array holes are preserved
- self cycles are preserved
- next sharing is preserved across plain objects, arrays, maps, sets, and binary aliasing structures
- previously shared current nodes split when next requires distinct nodes
- equal-fast-path traversal does not collapse distinct next nodes
- buffer/view aliasing is preserved when next aliases and broken when next separates
- function values are preserved by reference
- root replacement occurs across kind boundaries
- only incompatible subtrees are replaced when the parent can be retained
- next plain-object prototype is preserved across replacement boundaries
- retained non-enumerable writable data properties can preserve descriptor shape when updated in place
- deletion of absent-next non-configurable properties is not guaranteed and currently fails
- Vue reactive and alien-deepsignals live objects preserve wrapper identity through publication paths that use reconciliation

### Guarantees not established by tests and contradicted by the code

These should be excluded from the first semantic specification.

- arbitrary array own-property preservation
- arbitrary own-property preservation on `Map`, `Set`, `Date`, `ArrayBuffer`, `DataView`, and typed arrays
- accessor preservation
- generalized descriptor preservation
- `SharedArrayBuffer`
- active iterator semantics during collection mutation

## Resolved semantic questions and gaps

The earlier preliminary brief left several points open. Code, tests, and language sources resolve most of them.

## 1. What happens to plain-object prototypes during in-place reconciliation?

Answer:

- retained plain objects keep the current prototype,
- replacement plain-object subtrees get the next subtree’s prototype because replacement is produced via `snapshot`.

Reason:

- `reconcilePlainObjectValue` never reads or writes prototypes; it mutates `currentObjectValue` in place,
- `snapshot` creates `Object.create(Object.getPrototypeOf(sourceObject))`.

Therefore the semantic rule is not “plain-object prototype follows next.” The exact rule is path-dependent.

## 2. What happens to property descriptors?

Answer:

Descriptor preservation is accidental and partial, not a stable semantic commitment.

Directly supported facts:

- retained writable data properties can preserve attributes when updated through ordinary assignment; a non-enumerable retained key is tested and preserved,
- rebuild paths delete and recreate properties, which discards descriptor shape,
- snapshot cloning recreates properties by assignment, not by descriptor cloning,
- accessor properties are not preserved as accessors.

The semantic specification should therefore treat descriptors as out of scope, with one optional note: some retained writable data properties may preserve their descriptors incidentally when no rebuild occurs.

## 3. What does `Map` or `Set` equality mean here?

Answer:

There are two layers.

JavaScript collection semantics:

- `Map` and `Set` discriminate keys/values by `SameValueZero` and canonicalize `-0` to `+0` through `CanonicalizeKeyedCollectionKey`.
- insertion order is part of the observable collection state.

`reconcile` retention semantics:

- container reuse is decided by `Object.is` equality of ordinally aligned reconciled entries.

That is not a contradiction. It means:

- container-level logical uniqueness follows JavaScript collection semantics,
- in-place container retention is a stronger identity-preservation condition used only by `reconcile`.

## 4. Are arrays treated like ordinary objects with `Reflect.ownKeys`?

Answer: no.

This is one of the most important clarified gaps.

The code treats arrays structurally by indexed elements and `length` only. Any semantic specification that models arrays as ordinary objects with arbitrary own keys would not match the implementation.

## 5. Are binary views characterized only by constructor and contents?

Answer: no.

The compatibility predicate is:

- reconciled backing buffer identity,
- constructor equality,
- `byteOffset` equality,
- `byteLength` equality.

For typed arrays, byte-length plus constructor implies element count compatibility.

## 6. Is root identity preserved whenever root kinds match?

Answer: not always.

Preserved at the root for matching kinds when in-place mutation is possible, including:

- arrays,
- plain objects,
- dates,
- maps,
- sets,
- equal-length `ArrayBuffer`,
- compatible views.

Not preserved even when kinds match for incompatible binary structures, including:

- `ArrayBuffer` with different byte lengths,
- `DataView` or typed-array root with constructor, offset, or byte-length mismatch.

## 7. Is there a directly matching named problem in the literature?

Answer: no direct exact match was found in the sources surveyed.

The nearest classes are:

- ordered tree edit distance,
- unordered tree/XML differencing,
- self-adjusting computation,
- graph edit distance,
- maximum common subgraph,
- hash-consing and maximal sharing.

Each captures one aspect of the operator, but none matches the exact combination of:

- fixed alignment,
- object-graph topology preservation,
- in-place current-node reuse,
- nested snapshot replacement,
- and JavaScript collection/buffer semantics.

## 8. How should the broad docstrings be handled where code is narrower?

Answer:

The semantic specification should follow code plus tests, not broad docstring prose, when they diverge.

The clearest example is array own-key behavior. The snapshot docstring says the snapshot preserves “observable structure” broadly, but the implementation only preserves array index structure, holes, and length.

## 9. What should be done with proxies and reactive wrappers?

Answer:

A first semantic specification should exclude proxies as semantic values and instead model the ordinary object surface that proxy-backed runtimes are expected to present.

Reason:

- tests show compatibility with Vue and alien-deepsignals live contexts,
- but proxy trap semantics are not the semantic point of `reconcile`,
- and a fully general proxy-aware specification would be far larger than the operator contract the tests enforce.

## JavaScript semantic facts that must constrain the specification

## `Object.is` and SameValue

ECMA-262 states that `Object.is` delegates to `SameValue`.

Relevant consequences:

- `NaN` is equal to itself under `Object.is`,
- `+0` and `-0` are distinct under `Object.is`.

`reconcile` uses this relation in:

- top-level fast path,
- per-entry fast path,
- container retention checks.

This is not replaceable with `===` in the semantic spec.

## Own-key order for ordinary objects

ECMA-262 `OrdinaryOwnPropertyKeys` orders keys as:

1. array-index keys in ascending numeric order,
2. other string keys in creation order,
3. symbol keys in creation order.

Because `reconcilePlainObjectValue` uses `Reflect.ownKeys`, this ordering is part of the observable semantics for plain objects.

## `Reflect.deleteProperty` and non-configurable properties

ECMA-262 specifies:

- `Reflect.deleteProperty(target, key)` returns `target.[[Delete]](key)`.
- `OrdinaryDelete` returns `false` for a present own property whose descriptor is non-configurable.

The current implementation ignores the returned boolean from `Reflect.deleteProperty`. Therefore non-configurable deletion failure is not repaired by fallback logic. This exactly explains the failing direct test.

## `Map` and `Set`

ECMA-262 specifies:

- distinct `Map` keys and `Set` values use `SameValueZero`,
- `CanonicalizeKeyedCollectionKey` maps `-0` to `+0`,
- collection storage is conceptually ordered by insertion sequence,
- the implementation model must provide sublinear average access.

These facts constrain the semantic layer for rebuilt collection results.

## `ArrayBuffer.prototype.slice`

ECMA-262 specifies that `ArrayBuffer.prototype.slice` constructs a new buffer and copies a range of bytes.

This matters because `snapshot` and incompatible-length `ArrayBuffer` replacement both rely on cloning semantics consistent with slice-style byte copying.

## `DataView` and typed-array construction

ECMA-262 specifies:

- `DataView(buffer, byteOffset, byteLength)` stores viewed buffer, offset, and byte length, with range checks,
- typed-array initialization from an array buffer requires constructor-dependent element size alignment, byte-offset compatibility, and in-bounds size.

This supports the interpretation that constructor, offset, and size are semantic compatibility conditions for buffer-view retention.

## The local algorithm, in specification-ready pseudocode

The following pseudocode is a direct semantic summary of the current implementation.

```text
reconcileRoot(current, next):
  if Object.is(current, next):
    return current
  if current not object-like or next not object-like:
    return next
  if kind(current) != kind(next):
    return next
  return reconcileObjectByKind(current, next, emptyCurrentToNext, emptyNextToResult)
```

```text
reconcileValue(current, next, currentToNext, nextToResult):
  if next is not object-like:
    return next
  if next in nextToResult:
    return nextToResult[next]
  if current is not object-like:
    return snapshot(next, nextToResult)
  if current in currentToNext:
    return snapshot(next, nextToResult)
  if kind(current) != kind(next):
    return snapshot(next, nextToResult)
  return reconcileObjectByKind(current, next, currentToNext, nextToResult)
```

```text
reconcileSharedObjectValue(current, next, currentToNext, nextToResult):
  if next in nextToResult:
    return nextToResult[next]
  if current in currentToNext:
    return snapshot(next, nextToResult)
  currentToNext[current] := next
  nextToResult[next] := current
  return current
```

That pseudocode should be very close to the eventual Lean operational layer.

## Literature review by problem class

## 1. Ordered tree edit distance

### Bille survey (2005)

Primary source: `.firecrawl/reconcile/sources/bille-2005-tree-edit-distance-survey-page.md`

Abstract contribution:

- surveys tree edit distance, alignment distance, and inclusion,
- reviews available results,
- presents central algorithms in detail.

Relevance:

- best entry point for the exact ordered-tree family,
- clarifies the boundary between local edit operations and stronger matching models,
- useful for terminology and problem taxonomy.

### Demaine, Mozes, Rossman, Weimann

Primary sources:

- `.firecrawl/reconcile/sources/demaine-2009-tree-edit-distance.md`
- `.firecrawl/reconcile/ocr/demaine-2006-icalp-tree-edit-distance.md`

What the paper gives:

- an `O(n^3)` worst-case algorithm for ordered tree edit distance,
- a matching lower bound within decomposition-strategy algorithms,
- a divide-and-conquer heavy-path recursion that alternates dependence on both trees.

Algorithm capsule from the OCR’d ICALP version:

1. Always order the input pair so `F` is the larger tree.
2. Let `TopLight_F` be the roots of subtrees obtained by removing the heavy path of `F`.
3. Recursively compute distances for every `F_v` where `v ∈ TopLight_F` against `G`.
4. Then compute `δ(F, G)` using Klein’s left/right strategy on the remaining heavy-path structure, skipping subproblems already solved in the recursive calls.
5. Count relevant subproblems to obtain the `O(m^2 n (1 + log(n/m)))` bound.

Why it matters here:

- proves how expensive the problem becomes when optimal decomposition is part of the semantics,
- offers a lower-bound template restricted to a family of algorithms,
- strongly supports the claim that keeping fixed alignment is what keeps `reconcile` out of this complexity class.

Limit relative to `reconcile`:

- operates on ordered trees, not cyclic or shared-reference object graphs,
- minimizes edit distance rather than maximizing valid in-place reuse under fixed alignment,
- does not model JavaScript collection or binary-view semantics.

### RTED and GTED

Primary sources:

- `.firecrawl/reconcile/sources/pawlik-2011-rted.md`
- `.firecrawl/reconcile/ocr/pawlik-2011-rted.md`

What the paper gives:

- GTED, a general tree edit distance framework parameterized by a path strategy,
- LRH strategies using left, right, and heavy paths,
- a baseline dynamic-programming strategy search,
- OptStrategy, an `O(n^2)` algorithm to compute the optimal LRH strategy,
- RTED, which runs GTED using that optimal strategy.

Algorithm capsule:

### GTED

Given trees `F`, `G`, strategy `S`, and distance matrix `D`:

1. Look up the root-leaf path `γ = S(F, G)`.
2. If `γ` lies in `F`:
   - recursively solve every relevant subtree in `F - γ` against `G`,
   - then run the single-path function appropriate for `γ` (`Δ^L`, `Δ^R`, or `Δ^I`).
3. If `γ` lies in `G`, transpose the problem and recurse symmetrically.
4. Fill the subtree-distance matrix bottom-up in `O(n^2)` space.

### Baseline LRH strategy search

For each subtree pair `(F_v, G_w)`:

1. If already memoized, return stored cost.
2. Evaluate the six choices:
   - left in `F`, right in `F`, heavy in `F`,
   - left in `G`, right in `G`, heavy in `G`.
3. Add path-local cost plus recursive relevant-subtree costs.
4. Store the minimum-cost path in the strategy array.
5. Store the minimum cost in the memoization matrix.

### OptStrategy

Instead of recomputing repeated sums, maintain incremental cost arrays for left, right, and heavy decomposition in both trees, then process subtree pairs in postorder and update parent cost sums. This reduces optimal-strategy computation from cubic to quadratic time.

Why it matters here:

- makes the “strategy family versus optimal strategy within that family” distinction explicit,
- provides a direct analogue for future proofs that restrict the admissible algorithm family,
- gives a concrete warning that once dynamic path choice is part of the problem, a separate optimization pass may be needed just to choose the decomposition.

Limit relative to `reconcile`:

- still solves exact ordered tree edit distance,
- still assumes tree structure rather than aliasing graphs,
- still optimizes subproblem count rather than in-place reuse.

## 2. Hierarchical and XML change detection

### Chawathe et al. (1996)

Primary source: `.firecrawl/reconcile/sources/chawathe-1996-change-detection.md`

Abstract contribution:

- formulates hierarchical change detection as finding a minimum-cost edit script from one data tree to another,
- emphasizes domain-specific restrictions for substantially better performance than general-purpose algorithms,
- studies both analytical and empirical performance.

Why it matters here:

- this is the closest high-level justification for constraining semantics to match domain structure,
- the paper supports the idea that the right problem is a restricted publication/change-detection problem, not the strongest possible general tree-edit problem.

Limit:

- the accessible source provides the abstract but not the full algorithmic details,
- the paper still targets trees and edit scripts, not reuse-preserving object-graph publication.

### X-Diff (2003)

Primary source: `.firecrawl/reconcile/sources/x-diff-ieee-page.md`

Abstract contribution:

- argues that unordered XML trees are a more accurate model for many database applications,
- states explicitly that unordered change detection is substantially harder than ordered change detection,
- proposes an algorithm integrating XML-specific structure characteristics with tree-to-tree correction techniques.

Why it matters here:

- gives direct evidence that relaxing sibling order changes the problem class materially,
- supports a specification choice that preserves order-sensitive semantics where the implementation does.

### CX-DIFF (2003)

Primary source: `.firecrawl/reconcile/sources/cx-diff-2003-page.md`

Abstract contribution:

- focuses on customized change detection for ordered XML content under user intent,
- proposes an algorithm for content-level changes that may span multiple text nodes,
- presents an optimization for XML pages with favorable characteristics.

Why it matters here:

- useful as a reminder that semantic intent can be more specific than structural tree differencing,
- relevant if a future specification distinguishes value-preserving publication from edit-script derivation.

## 3. Self-adjusting computation and change propagation

### Acar and collaborators

Primary sources:

- `.firecrawl/reconcile/sources/acar-2009-self-adjusting-computation.md`
- `.firecrawl/reconcile/ocr/acar-2011-consistent-semantics-self-adjusting.md`

What the semantics paper gives:

- memoization modeled as a non-deterministic oracle,
- stable and changeable evaluations that produce traces,
- change propagation that adapts a reused trace to a mutated store,
- consistency and correctness theorems,
- machine-checked metatheory.

Algorithm capsule from the semantics:

1. Evaluate expressions while producing traces of allocations, reads, writes, and control composition.
2. On a memo hit, do not reuse the prior answer directly.
3. Instead, change-propagate the prior trace into the current store.
4. When a read in the trace still sees the same store value, keep propagating forward.
5. When a read sees a changed location value, re-evaluate the dependent computation from that point.
6. Maintain invariants ensuring well-formedness and consistency with pure semantics.

Why it matters here:

- `reconcile` is not self-adjusting computation, but it is a change-propagation style publication operator in spirit,
- the trace-and-reuse viewpoint is useful for theorem design around locality of change,
- the proof pattern “reuse plus mutation remains observationally correct” is strongly relevant.

Limit relative to `reconcile`:

- AML semantics work over store traces, memo hits, and read dependencies rather than direct heap-to-heap publication,
- the reuse mechanism is trace adaptation, not identity-preserving graph reconciliation.

## 4. Hash-consing and maximal sharing

### Braibant, Jourdan, Monniaux

Primary sources:

- `.firecrawl/reconcile/sources/filinski-2013-hash-consed-structures.md`
- `.firecrawl/reconcile/ocr/braibant-2014-hash-consing.md`

What the paper gives:

- a clear explanation of hash-consing as maintaining a global unique table of immutable nodes,
- design patterns for unique-node allocation and memoization in Coq,
- explicit discussion of proof/performance trade-offs.

Algorithm capsule from the paper:

1. Maintain a map `graph : id -> node` and a reverse map `hmap : node -> id`.
2. On `mk_node(l, v, h)`:
   - if `l == h`, reuse `l` directly in reduced form,
   - else look up `(l, v, h)` in `hmap`,
   - if found, return existing node id,
   - otherwise allocate a fresh id, update both maps, and return it.
3. Memoize higher-level operations by tables keyed by unique node identifiers.

Why it matters here:

- gives the cleanest counterpoint to `reconcile`’s semantics,
- hash-consing globally maximizes structural sharing for immutable values,
- `reconcile` locally reuses live mutable identity under a next-topology constraint.

This distinction is important. A future optimization that introduces hash-cons-style canonicalization would be a semantic change, not merely a faster implementation.

## 5. Graph edit distance and maximum common subgraph

### Graph edit distance survey

Primary source: `.firecrawl/reconcile/sources/riesen-2009-graph-edit-distance-survey.md`

Abstract contribution:

- surveys graph edit distance as the base of inexact graph matching,
- categorizes algorithms by graph model and edit costs,
- emphasizes limitations and future directions.

Why it matters here:

- if matching among graph nodes is allowed to vary freely, the problem resembles GED much more than current `reconcile`,
- this is the correct cautionary literature for any future semantics that permit cross-position node correspondence search.

### Maximum common subgraph review

Primary source: `.firecrawl/reconcile/sources/mcs-review.md`

Abstract contribution:

- reviews exact maximum common subgraph algorithms and applications.

Why it matters here:

- “maximize reusable common structure” is not the current semantics, but it is the nearest alternative optimization objective for a graph-based publication operator.

### Exact unordered tree edit distance

Primary source: `.firecrawl/reconcile/sources/exact-unordered-tree-edit-distance.md`

Abstract contribution:

- gives a fixed-parameter algorithm `O(2.62^k * poly(n))` for unordered tree edit distance under unit cost,
- gives polynomial cases under bounded-degree constraints.

Why it matters here:

- strong evidence that relaxing ordered matching quickly changes complexity class,
- useful as a concrete caution against widening current ordered/fixed-alignment semantics without a deliberate reason.

## 6. Industrial analogue: React reconciliation

Primary source: `.firecrawl/reconcile/sources/react-reconciliation.md`

What the docs say:

- exact tree diff algorithms can be `O(n^3)`,
- React instead adopts a heuristic `O(n)` algorithm under fixed assumptions,
- keys make child matching more predictable and efficient.

Why it matters here:

- it is a practical demonstration that constrained matching semantics are often the decisive performance choice,
- it supports treating fixed alignment as a first-class semantic design decision rather than a temporary simplification.

## Comparison matrix: literature classes versus current `reconcile`

| Problem class | Matching freedom | Structure model | Main objective | Closest overlap with `reconcile` | Main mismatch |
| --- | --- | --- | --- | --- | --- |
| Ordered tree edit distance | searched, strategy-dependent | ordered trees | minimum edit cost | ordered local decomposition ideas | no aliasing, no live reuse semantics |
| Unordered tree/XML diff | higher matching freedom | unordered trees | better semantic matching/edit scripts | caution on reordered collections | much harder problem class |
| Self-adjusting computation | reuse through traces | store plus dependency traces | efficient recomputation under change | locality-of-change reasoning | trace adaptation, not heap publication |
| Hash-consing | canonical global sharing | DAG / immutable structure | maximal sharing | sharing and memoization theory | changes identity model completely |
| Graph edit distance / MCS | free graph matching | general graphs | inexact matching / maximal commonality | graph viewpoint | no fixed alignment, very different objective |
| Current `reconcile` | fixed by kind and position/key | rooted heap graph with restricted kinds | publish next into current while preserving valid identity | exact target | n/a |

## The main research conclusion for semantic design

The current operator belongs to a much narrower and more tractable class than the classic diff problems.

A correct semantic statement is close to this:

Given current graph `C` and next graph `N`, compute a result graph `R` such that:

1. `R` is observably equivalent to `N` on the supported surface.
2. Each next node has exactly one image in `R`.
3. Distinct next nodes remain distinct in `R`.
4. Equal next references remain equal in `R`.
5. Reused current nodes are reused only when kind, metadata, and topology constraints permit.
6. Matching is fixed by kind-specific alignment rules rather than discovered by search.

That last clause is what keeps the problem out of tree-edit-distance and graph-edit-distance territory.

## Candidate formal model for the semantic specification

## Value model

A good first model is a finite rooted heap graph.

```text
Value := Atom a | Ref n
```

where `Atom` includes:

- primitives,
- function atoms,
- opaque labels such as symbols.

Each node `n` carries a kind-tagged payload.

### Suggested node kinds

- `PlainObject(proto, orderedKeys, keyToValue)`
- `Array(length, presentIndexToValue)`
- `Date(ms)`
- `Map(entrySeq)`
- `Set(valueSeq)`
- `ArrayBuffer(bytes)`
- `DataView(bufferRef, byteOffset, byteLength)`
- `TypedArray(constructorTag, bufferRef, byteOffset, length)`

This model is specification-ready because it encodes:

- identity,
- topology,
- ordered keys or entry sequences,
- binary aliasing through shared `bufferRef`.

## Supported observability relation

The spec should define `ObsEq_kindwise(R, N)` over the supported surface.

Recommended shape:

- plain objects: same prototype observability only for snapshot clones and replacement subtrees if that is kept in scope; otherwise prototype on retained plain objects is excluded from the observable relation
- arrays: same length, same present indices, same indexed values recursively
- maps: same insertion-order entry sequence after JS container semantics
- sets: same insertion-order value sequence after JS container semantics
- buffers: same byte length and bytes
- views: same constructor/offset/length and same viewed bytes through the referenced buffer
- graph topology: equality and distinction of references must match the next graph under the result mapping

## Suggested proof relations

### Image relation

`Image(nextNode) = resultNode`

This is the specification analogue of `nextToResult`.

### Reuse relation

`Reuse(currentNode, nextNode)` when a current node is selected as the image of a next node.

This is the analogue of `currentToNext`.

These relations should satisfy:

- function property on next nodes,
- injectivity on reused current nodes,
- no-collapse of distinct next nodes.

## Specification decisions that should be frozen explicitly

The following should be written into the semantic specification, not left implicit.

1. Arrays align by numeric index only.
2. Plain objects align by exact own property key, iterated in `Reflect.ownKeys(next)` order.
3. Maps align by ordinal entry position, not by key lookup.
4. Sets align by ordinal iteration position, not by membership lookup.
5. Buffer views align through backing-buffer reconciliation plus metadata equality.
6. Nested replacement uses snapshot semantics; root replacement across primitive or kind boundaries returns `next` directly.
7. The semantic surface excludes non-index array properties and extra own properties on non-plain exotics.
8. Descriptor semantics, accessors, proxies, and non-configurable deletion behavior are excluded.

Without those decisions, the specification will drift into a different problem.

## Performance implications from the research

## Asymptotic class

If the semantics above are frozen, the strongest current hypothesis is that the correct asymptotic target is linear in the supported reachable surface, plus byte-copy work.

A reasonable abstract cost expression is:

```text
cost = O(
  next_nodes_visited
  + current_keys_deleted_or_rebuilt
  + current_entries_cleared_or_reinserted
  + bytes_copied
)
```

The tree-edit and graph-edit literature matters mainly as a contrast class that explains why stronger matching semantics would be much more expensive.

## Lower-bound sketch

Any correct algorithm under the current semantics appears to require at least:

- inspecting each reachable next node or entry once,
- inspecting any current-only tail that must be deleted,
- copying bytes proportional to mutated binary payload size when replacement or overwrite occurs.

So a plausible lower bound is:

```text
Ω(next_surface_size + required_current_deletion_work + bytes_copied)
```

This is the right place to look for a future optimality argument.

## Current implementation versus that target

The current implementation is already close to that regime.

- Arrays are single-pass.
- Plain objects are single-pass over next keys plus either trailing deletes or full rebuild.
- Maps and sets are single-pass over next iteration order plus clear/rebuild if needed.
- Equal-length buffers copy once.
- Shared next nodes are memoized through `nextToResult`.
- Split-required replacements snapshot the next subtree only once per next node image.

This supports the view that future performance work is mostly constant-factor engineering unless semantics change.

## Constant-factor hotspots suggested by the code

### Plain-object path

The plain-object path has the most control-flow complexity and the most mixed cases:

- key alignment detection,
- deferred changed-entry recording,
- rebuild transition and backfill,
- delete and rewrite phases.

This is the main likely constant-factor hotspot under the current semantics.

### Map and Set rebuild policy

Ordinal alignment means that any replaced ordinal key or value forces a container rebuild. That may be near-optimal for the fixed semantics, because JavaScript does not expose a better stable-insertion-order patch interface on these containers.

### ArrayBuffer copy behavior

Equal-length buffers always incur a byte copy. That is semantically straightforward and already close to an obvious byte lower bound, but it is a likely throughput hotspot for binary-heavy inputs.

### Buffer-view replacement

Constructor, offset, or length mismatch on views causes allocation of a replacement view object even if the buffer can be reused. That is semantically necessary under the current view-compatibility rule.

## Local benchmark context

`perf/context-runtime.bench.ts` compares:

- `snapshot` against `structuredClone`, and
- `reconcile` against `cloneDeep(next)`.

That benchmark framing is informative. It suggests the practical performance question in this repository is not “beat exact tree-edit algorithms,” but “beat full reconstruction baselines while preserving the required publication semantics.”

## Recommendations for the semantic specification artifact

The next specification document should contain the following sections.

1. Supported and excluded value surface.
2. Root and nested publication semantics as distinct rules.
3. Graph model with explicit node identity and sharing.
4. Kind classification function.
5. `snapshot` semantics, because `reconcile` depends on it internally.
6. `reconcile` operational rules with witness relations.
7. Observational equivalence relation for supported kinds.
8. Proven or intended invariants.
9. Out-of-scope JavaScript features.
10. Cost model assumptions.

## Recommended theorem list for Lean

1. `snapshot` soundness on the supported surface.
2. `snapshot` topology preservation for sharing and cycles.
3. `reconcile` soundness: result is observably equivalent to next.
4. Root preservation for compatible retained kinds.
5. No-collapse theorem: distinct next nodes remain distinct in the result.
6. Sharing theorem: equal next references map to equal result references.
7. Split theorem: reused current nodes are not reused for conflicting next nodes.
8. Replacement locality theorem: only incompatible subtrees are replaced when the parent is retainable.
9. Canonical-alignment theorem: the operator’s result is determined by fixed kindwise traversal rules.
10. Work-bound theorem under the abstract cost model.

## Bottom line

The literature does not point toward a faster exact matching algorithm for the current semantics. It points toward a more important conclusion: the current semantics already avoid the expensive part of tree and graph differencing by fixing alignment up front.

The strongest research-backed path forward is therefore:

- specify the current operator exactly,
- formalize its graph and JavaScript-surface invariants,
- prove soundness and reuse properties,
- and only then ask whether any asymptotic or constant-factor improvement remains under that fixed semantics.

If later work broadens the semantics to allow reordering-aware or search-based matching, that should be treated as a new problem statement and judged against tree-edit, XML-diff, GED, and MCS literature rather than as a micro-optimization of the current operator.

## Source index

### Local repository

- `src/context-runtime.ts`
- `src/__tests__/context-runtime-direct.spec.ts`
- `src/__tests__/context-runtime.spec.ts`
- `src/interpret.ts`
- `src/state-machine.ts`
- `src/types.ts`
- `perf/context-runtime.bench.ts`
- `lean/README.md`

### Saved web and OCR sources

- `.firecrawl/reconcile/sources/demaine-2009-tree-edit-distance.md`
- `.firecrawl/reconcile/ocr/demaine-2006-icalp-tree-edit-distance.md`
- `.firecrawl/reconcile/sources/pawlik-2011-rted.md`
- `.firecrawl/reconcile/ocr/pawlik-2011-rted.md`
- `.firecrawl/reconcile/sources/bille-2005-tree-edit-distance-survey-page.md`
- `.firecrawl/reconcile/sources/chawathe-1996-change-detection.md`
- `.firecrawl/reconcile/sources/x-diff-ieee-page.md`
- `.firecrawl/reconcile/sources/cx-diff-2003-page.md`
- `.firecrawl/reconcile/sources/acar-2009-self-adjusting-computation.md`
- `.firecrawl/reconcile/ocr/acar-2011-consistent-semantics-self-adjusting.md`
- `.firecrawl/reconcile/sources/filinski-2013-hash-consed-structures.md`
- `.firecrawl/reconcile/ocr/braibant-2014-hash-consing.md`
- `.firecrawl/reconcile/sources/riesen-2009-graph-edit-distance-survey.md`
- `.firecrawl/reconcile/sources/mcs-review.md`
- `.firecrawl/reconcile/sources/exact-unordered-tree-edit-distance.md`
- `.firecrawl/reconcile/sources/ecma262-samevalue.md`
- `.firecrawl/reconcile/sources/ecma262-object-is.md`
- `.firecrawl/reconcile/sources/ecma262-ordinary-own-property-keys.md`
- `.firecrawl/reconcile/sources/ecma262-reflection-deleteproperty-section.md`
- `.firecrawl/reconcile/sources/ecma262-map-objects.md`
- `.firecrawl/reconcile/sources/ecma262-set-objects.md`
- `.firecrawl/reconcile/sources/ecma262-arraybuffer-slice.md`
- `.firecrawl/reconcile/sources/ecma262-dataview-constructor.md`
- `.firecrawl/reconcile/sources/ecma262-typedarray-constructors.md`
- `.firecrawl/reconcile/sources/mdn-map.md`
- `.firecrawl/reconcile/sources/mdn-set.md`
- `.firecrawl/reconcile/sources/mdn-structured-clone.md`
- `.firecrawl/reconcile/sources/mdn-typed-arrays.md`
- `.firecrawl/reconcile/sources/react-reconciliation.md`
