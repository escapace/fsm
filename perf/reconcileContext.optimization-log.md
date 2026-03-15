# reconcileContext optimization log

## Baseline

- Command: `pnpm run typecheck`
- Result: pass
- Command: `pnpm run test`
- Result: pass
- Command: `pnpm run bench -t 'reconcileContext'`
- Result:
  - `baseline cloneDeep(next) x250`: 267.16 hz
  - `reconcileContext x250`: 104.29 hz
  - Relative: baseline is `2.56x` faster than `reconcileContext`

## Phase 1: generic optimizations

### Kept: cached next/current own-key lists in plain-object reconciliation

- Change: changed `sameOwnKeyOrder(...)` to compare precomputed key arrays, cached `Reflect.ownKeys(nextObjectValue)`, iterated that list with an indexed loop, then reused it for the post-update key-order check and reorder step.
- Rationale: reduce repeated own-key enumeration in the hot plain-object reconciliation path while keeping the control flow direct.
- Validation:
  - `pnpm run typecheck`: pass
  - `pnpm run test`: pass
  - `pnpm run bench -t 'reconcileContext'`: pass
- Benchmark comparison:
  - Before:
    - `baseline cloneDeep(next) x250`: 267.16 hz
    - `reconcileContext x250`: 104.29 hz
    - Relative: baseline is `2.56x` faster than `reconcileContext`
  - After:
    - `baseline cloneDeep(next) x250`: 250.35 hz
    - `reconcileContext x250`: 125.23 hz
    - Relative: baseline is `2.00x` faster than `reconcileContext`
- Decision: kept. Relative throughput improved materially.

### Reverted: indexed reorderOwnKeys loops

- Change: replaced `reorderOwnKeys(...)` map/`for...of` logic with indexed loops over cached entry values and cached own-key deletion order.
- Rationale: reduce intermediate pair allocation and iterator overhead in the reorder path.
- Validation:
  - `pnpm run typecheck`: pass
  - `pnpm run test`: pass
  - `pnpm run bench -t 'reconcileContext'`: pass
- Benchmark comparison:
  - Before:
    - `baseline cloneDeep(next) x250`: 250.35 hz
    - `reconcileContext x250`: 125.23 hz
    - Relative: baseline is `2.00x` faster than `reconcileContext`
  - After:
    - `baseline cloneDeep(next) x250`: 265.92 hz
    - `reconcileContext x250`: 124.42 hz
    - Relative: baseline is `2.14x` faster than `reconcileContext`
- Decision: reverted. Relative throughput regressed.

### Reverted: `delete` operator in sparse-array reconciliation

- Change: replaced `Reflect.deleteProperty(currentValue, index)` with `delete currentValue[index]` in the sparse-array branch.
- Rationale: try a lower-overhead hole-preserving delete path in the hot array loop.
- Validation:
  - `pnpm run typecheck`: pass
  - `pnpm run test`: pass
  - `pnpm run bench -t 'reconcileContext'`: pass
- Benchmark comparison:
  - Before:
    - `baseline cloneDeep(next) x250`: 250.35 hz
    - `reconcileContext x250`: 125.23 hz
    - Relative: baseline is `2.00x` faster than `reconcileContext`
  - After:
    - `baseline cloneDeep(next) x250`: 245.06 hz
    - `reconcileContext x250`: 114.39 hz
    - Relative: baseline is `2.14x` faster than `reconcileContext`
- Decision: reverted. Relative throughput regressed.

### Reverted: `Object.hasOwn(...)` in the plain-object delete sweep

- Change: replaced `Reflect.has(nextObjectValue, key)` with `Object.hasOwn(nextObjectValue, key)` while deleting keys absent from the next object.
- Rationale: align the check more closely with own-key semantics and test whether it reduced reflective overhead.
- Validation:
  - `pnpm run typecheck`: pass
  - `pnpm run test`: pass
  - `pnpm run bench -t 'reconcileContext'`: pass
- Benchmark comparison:
  - Before:
    - `baseline cloneDeep(next) x250`: 250.35 hz
    - `reconcileContext x250`: 125.23 hz
    - Relative: baseline is `2.00x` faster than `reconcileContext`
  - After:
    - `baseline cloneDeep(next) x250`: 265.03 hz
    - `reconcileContext x250`: 122.64 hz
    - Relative: baseline is `2.16x` faster than `reconcileContext`
- Decision: reverted. Relative throughput regressed.

### Historical note: previous fast-path experiments

- A same-key-order plain-object fast path and direct indexed property access were also explored in the generic phase.
- The fast path improved the unconstrained benchmark, but the user later requested one simple algorithm with no fast paths, so that branch was manually reverted before the final constrained search.

## Phase 2: constrained search for one simple algorithm

### Constraint pivot

- User direction changed: keep one simple algorithm and remove fast paths.
- Response: manually reverted the same-key-order fast path and continued optimization only within the single-algorithm design space.

### Reverted: iterative worklist traversal

- Change: replaced recursive reconciliation with an explicit iterative worklist that handled both child reconciliation and plain-object finalization.
- Rationale: preserve one algorithm while reducing recursion overhead and making traversal mechanics more uniform.
- Validation:
  - `pnpm run typecheck`: pass
  - `pnpm run test`: pass
  - `pnpm run bench -t 'reconcileContext'`: pass
- Benchmark comparison:
  - Before constrained rewrite attempt:
    - `baseline cloneDeep(next) x250`: 253.22 hz
    - `reconcileContext x250`: 143.56 hz
    - Relative: baseline is `1.76x` faster than `reconcileContext`
  - After:
    - `baseline cloneDeep(next) x250`: 265.92 hz
    - `reconcileContext x250`: 123.83 hz
    - Relative: baseline is `2.15x` faster than `reconcileContext`
- Decision: reverted. The simpler traversal was correct but materially slower.

### Established constrained baseline: canonical recursive single-path reconciler

- Change: restored recursion, removed the same-key-order fast path, and kept one canonical plain-object algorithm: collect current keys, collect next keys, delete absent keys, reconcile all next keys, then reorder if needed.
- Rationale: satisfy the user’s single-algorithm requirement while retaining the constant-factor improvements that do not split the algorithm.
- Validation:
  - `pnpm run typecheck`: pass
  - `pnpm run test`: pass
  - `pnpm run bench -t 'reconcileContext'`: pass
- Benchmark result:
  - `baseline cloneDeep(next) x250`: 267.00 hz
  - `reconcileContext x250`: 135.53 hz
  - Relative: baseline is `1.97x` faster than `reconcileContext`
- Decision: used as the constrained baseline for further work.

### Kept: whole-object rebuild in next-key order

- Change: simplified the plain-object branch to one whole-object rewrite. It now enumerates `currentOwnKeys` and `nextOwnKeys`, reconciles all next-key values into a temporary array, deletes all current own keys, then rebuilds the object in `nextOwnKeys` order.
- Rationale: algorithmically, this is a cleaner canonical form of the single-algorithm object update. It removes per-key own-presence checks from the object branch and makes order preservation a direct consequence of the rewrite itself.
- Validation:
  - `pnpm run typecheck`: pass
  - `pnpm run test`: pass
  - `pnpm run bench -t 'reconcileContext'`: pass
- Benchmark comparison:
  - Before:
    - `baseline cloneDeep(next) x250`: 267.00 hz
    - `reconcileContext x250`: 135.53 hz
    - Relative: baseline is `1.97x` faster than `reconcileContext`
  - After:
    - `baseline cloneDeep(next) x250`: 265.61 hz
    - `reconcileContext x250`: 195.28 hz
    - Relative: baseline is `1.36x` faster than `reconcileContext`
- Decision: kept. Relative throughput improved materially and the whole algorithm became simpler.

### Reverted: in-loop delete and reinsert per next key

- Change: after switching to integrated order reconstruction, rewrote the object pass to reconcile each `nextOwnKeys` entry and immediately `delete` + reinsert that same key, eliminating the temporary entry array.
- Rationale: this is the mathematically tightest form of the integrated-order algorithm. It reduces the object pass to delete-absent plus per-key reconcile/delete/reinsert.
- Validation:
  - `pnpm run typecheck`: pass
  - `pnpm run test`: pass
  - `pnpm run bench -t 'reconcileContext'`: pass
- Benchmark comparison:
  - Before:
    - `baseline cloneDeep(next) x250`: 248.92 hz
    - `reconcileContext x250`: 174.26 hz
    - Relative: baseline is `1.43x` faster than `reconcileContext`
  - After:
    - `baseline cloneDeep(next) x250`: 270.73 hz
    - `reconcileContext x250`: 181.00 hz
    - Relative: baseline is `1.50x` faster than `reconcileContext`
- Decision: reverted. The temporary-entry integrated-order version remained better on the required relative benchmark.

## Post-optimization cleanup

### Kept: consistent property-access policy and documentation cleanup

- Change: clarified the single-algorithm strategy in `src/context-runtime.ts` and made the access policy explicit: use indexed property access for value reads/writes after own-key enumeration, and reserve `Reflect` for meta-operations such as own-key enumeration and deletions.
- Rationale: keep the implementation easier to reason about without changing the algorithm.
- Validation:
  - `pnpm run typecheck`: pass
  - `pnpm run test`: pass
  - `pnpm run bench -t 'reconcileContext'`: pass
- Benchmark result after cleanup:
  - `baseline cloneDeep(next) x250`: 241.58 hz
  - `reconcileContext x250`: 174.38 hz
  - Relative: baseline is `1.39x` faster than `reconcileContext`
- Decision: kept. This was primarily a readability and consistency cleanup and did not regress the required relative benchmark result.

## Final verification

- Command: `pnpm run typecheck`
- Result: pass
- Command: `pnpm run test`
- Result: pass
- Command: `pnpm run bench -t 'reconcileContext'`
- Result:
  - `baseline cloneDeep(next) x250`: 241.58 hz
  - `reconcileContext x250`: 174.38 hz
  - Relative: baseline is `1.39x` faster than `reconcileContext`

## Overall comparison

- Original baseline:
  - baseline was `2.56x` faster than `reconcileContext`
- Final result:
  - baseline is `1.39x` faster than `reconcileContext`
- Net effect:
  - the gap to baseline shrank by about `45.7%` (`1 - 1.39 / 2.56`)
  - the runtime/baseline throughput ratio improved by about `84.8%` (`(174.38 / 241.58) / (104.29 / 267.16) ≈ 1.848`)

## Explicit decisions

- Decision: keep one canonical plain-object reconciliation algorithm and no same-key-order fast path.
  - Reason: this matches the user’s requested design constraint.

- Decision: keep cached `currentOwnKeys` and `nextOwnKeys` in the plain-object path.
  - Reason: this materially improved the relative benchmark result and fits the single-algorithm design.

- Decision: keep direct indexed property access in the plain-object update loop.
  - Reason: it lowers per-key constant overhead without splitting the algorithm.

- Decision: keep the recursive traversal instead of the iterative worklist rewrite.
  - Reason: the worklist version was simpler operationally but materially slower on the required relative benchmark.

- Decision: keep the whole-object rebuild strategy for plain objects.
  - Reason: it improved the required relative benchmark result and gives the clearest single-algorithm formulation: reconcile next-key values, delete current keys, rebuild in next-key order.

- Decision: keep `Reflect.deleteProperty(...)` in the sparse-array branch.
  - Reason: the `delete` operator variant regressed the required relative benchmark result.

- Decision: keep the existing typed-array copy implementation based on `Uint8Array(...)` views.
  - Reason: the typed-array `.set(...)` rewrite did not improve the required relative benchmark result.
