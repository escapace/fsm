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

### Kept: order-driven reorderOwnKeys without re-enumeration

- Change: rewrote `reorderOwnKeys(...)` to use only `nextOwnKeys`: read current values in `nextOwnKeys` order, delete those exact keys, then reinsert them in the target order, without calling `Reflect.ownKeys(value)` during reorder.
- Rationale: after the delete sweep and update loop, the object’s final key set is already exactly `nextOwnKeys`; only order may be wrong. So the reorder step can rebuild order directly from the target key list instead of paying for another own-key enumeration. This preserves one simple algorithm while reducing reorder-path bookkeeping.
- Validation:
  - `pnpm run typecheck`: pass
  - `pnpm run test`: pass
  - `pnpm run bench -t 'reconcileContext'`: pass
  - `pnpm run bench -t 'reconcileContext'` (sanity rerun): pass
- Benchmark comparison:
  - Before:
    - `baseline cloneDeep(next) x250`: 267.00 hz
    - `reconcileContext x250`: 135.53 hz
    - Relative: baseline is `1.97x` faster than `reconcileContext`
  - After, first run:
    - `baseline cloneDeep(next) x250`: 268.37 hz
    - `reconcileContext x250`: 163.88 hz
    - Relative: baseline is `1.64x` faster than `reconcileContext`
  - After, sanity rerun:
    - `baseline cloneDeep(next) x250`: 263.74 hz
    - `reconcileContext x250`: 165.58 hz
    - Relative: baseline is `1.59x` faster than `reconcileContext`
- Decision: kept. The result improved clearly and held up on a rerun.

## Final verification

- Command: `pnpm run typecheck`
- Result: pass
- Command: `pnpm run test`
- Result: pass
- Command: `pnpm run bench -t 'reconcileContext'`
- Result:
  - `baseline cloneDeep(next) x250`: 245.97 hz
  - `reconcileContext x250`: 149.10 hz
  - Relative: baseline is `1.65x` faster than `reconcileContext`

## Overall comparison

- Original baseline:
  - baseline was `2.56x` faster than `reconcileContext`
- Final result:
  - baseline is `1.65x` faster than `reconcileContext`
- Net effect:
  - the gap to baseline shrank by about `35.5%` (`1 - 1.65 / 2.56`)
  - the runtime/baseline throughput ratio improved by about `55.1%` (`(149.10 / 245.97) / (104.29 / 267.16) ≈ 1.551`)

## Post-optimization cleanup

### Kept: consistent property-access policy and documentation cleanup

- Change: clarified the single-algorithm strategy in `src/context-runtime.ts`, marked the own-key helper arguments as readonly, and made the access policy explicit: use indexed property access for value reads/writes after own-key enumeration, and reserve `Reflect` for meta-operations such as own-key enumeration, presence checks, and deletions.
- Rationale: keep the implementation easier to reason about without changing the algorithm.
- Validation:
  - `pnpm run typecheck`: pass
  - `pnpm run test`: pass
  - `pnpm run bench -t 'reconcileContext'`: pass
- Benchmark result after cleanup:
  - `baseline cloneDeep(next) x250`: 269.91 hz
  - `reconcileContext x250`: 160.68 hz
  - Relative: baseline is `1.68x` faster than `reconcileContext`
- Decision: kept. This was primarily a readability and consistency cleanup and did not regress the required relative benchmark result.

## Explicit decisions

- Decision: keep one canonical plain-object reconciliation algorithm and no same-key-order fast path.
  - Reason: this matches the user’s requested design constraint.

- Decision: keep cached `currentOwnKeys` and `nextOwnKeys` in the plain-object path.
  - Reason: this materially improved the relative benchmark result and fits the single-algorithm design.

- Decision: keep direct indexed property access in the plain-object update loop.
  - Reason: it lowers per-key constant overhead without splitting the algorithm.

- Decision: keep the recursive traversal instead of the iterative worklist rewrite.
  - Reason: the worklist version was simpler operationally but materially slower on the required relative benchmark.

- Decision: keep the order-driven `reorderOwnKeys(...)` implementation that does not re-enumerate the object.
  - Reason: it improved the required relative benchmark result within the single-algorithm design space.

- Decision: keep `Reflect.deleteProperty(...)` in the sparse-array branch.
  - Reason: the `delete` operator variant regressed the required relative benchmark result.

- Decision: keep the existing typed-array copy implementation based on `Uint8Array(...)` views.
  - Reason: the typed-array `.set(...)` rewrite did not improve the required relative benchmark result.
