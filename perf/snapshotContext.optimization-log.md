# snapshotContext optimization log

## Baseline

- Command: `pnpm run typecheck`
- Result: pass
- Command: `pnpm run test`
- Result: pass
- Command: `pnpm run bench -t 'snapshotContext'`
- Result:
  - `baseline structuredClone x250`: 134.94 hz
  - `snapshotContext x250`: 288.47 hz
  - Relative: `snapshotContext` is `2.14x` faster than baseline

## Experiments

### Kept: local built-in type guards

- Change: replaced imported `es-toolkit` predicate helpers with local guards built from `typeof`, `instanceof`, and `ArrayBuffer.isView` in `src/context-runtime.ts`.
- Rationale: reduce helper dispatch overhead in the hot recursive snapshot path.
- Validation:
  - `pnpm run typecheck`: pass
  - `pnpm run test`: pass
  - `pnpm run bench -t 'snapshotContext'`: pass
- Benchmark comparison:
  - Before:
    - `baseline structuredClone x250`: 134.94 hz
    - `snapshotContext x250`: 288.47 hz
    - Relative: `2.14x` faster than baseline
  - After:
    - `baseline structuredClone x250`: 129.23 hz
    - `snapshotContext x250`: 294.49 hz
    - Relative: `2.28x` faster than baseline
- Decision: kept. Relative performance improved meaningfully.

### Kept: indexed own-key loop for plain-object snapshots

- Change: cached `Reflect.ownKeys(objectValue)` in the plain-object snapshot branch, iterated with an indexed loop, and switched from `Reflect.get(...)` to direct property access.
- Rationale: reduce iterator and reflective property-read overhead in a hot recursive path while preserving full own-key ordering.
- Validation:
  - `pnpm run typecheck`: pass
  - `pnpm run test`: pass
  - `pnpm run bench -t 'snapshotContext'`: pass
- Benchmark comparison:
  - Before:
    - `baseline structuredClone x250`: 129.23 hz
    - `snapshotContext x250`: 294.49 hz
    - Relative: `2.28x` faster than baseline
  - After:
    - `baseline structuredClone x250`: 126.89 hz
    - `snapshotContext x250`: 292.96 hz
    - Relative: `2.31x` faster than baseline
- Decision: kept. Relative result improved, and the loop remains straightforward.

### Reverted: `{}` fast path for plain objects

- Change: used `{}` instead of `Object.create(Object.prototype)` when the source object had the default object prototype.
- Rationale: avoid the extra `Object.create(...)` cost for the common plain-object case.
- Validation:
  - `pnpm run typecheck`: pass
  - `pnpm run test`: pass
  - `pnpm run bench -t 'snapshotContext'`: pass
- Benchmark comparison:
  - Before:
    - `baseline structuredClone x250`: 126.89 hz
    - `snapshotContext x250`: 292.96 hz
    - Relative: `2.31x` faster than baseline
  - After:
    - `baseline structuredClone x250`: 126.86 hz
    - `snapshotContext x250`: 288.40 hz
    - Relative: `2.27x` faster than baseline
- Decision: reverted. Relative performance regressed.

### Reverted: inline primitive/object check inside `snapshotValue`

- Change: replaced the shared `isObjectLikeValue(...)` call in `snapshotValue` with an inline `value === null || typeof value !== 'object'` check.
- Rationale: reduce one helper call in the recursive hot path.
- Validation:
  - `pnpm run typecheck`: pass
  - `pnpm run test`: pass
  - `pnpm run bench -t 'snapshotContext'`: pass
- Benchmark comparison:
  - Before:
    - `baseline structuredClone x250`: 126.89 hz
    - `snapshotContext x250`: 292.96 hz
    - Relative: `2.31x` faster than baseline
  - After:
    - `baseline structuredClone x250`: 135.81 hz
    - `snapshotContext x250`: 306.07 hz
    - Relative: `2.25x` faster than baseline
- Decision: reverted. Absolute throughput improved, but the required relative comparison regressed.

### Reverted: cached array length in snapshot array traversal

- Change: stored `value.length` in a local `length` variable before allocating and iterating the snapshot array.
- Rationale: avoid repeated array length reads in the hot array branch.
- Validation:
  - `pnpm run typecheck`: pass
  - `pnpm run test`: pass
  - `pnpm run bench -t 'snapshotContext'`: pass
- Benchmark comparison:
  - Before:
    - `baseline structuredClone x250`: 126.89 hz
    - `snapshotContext x250`: 292.96 hz
    - Relative: `2.31x` faster than baseline
  - After:
    - `baseline structuredClone x250`: 133.29 hz
    - `snapshotContext x250`: 302.13 hz
    - Relative: `2.27x` faster than baseline
- Decision: reverted. Absolute throughput rose, but the required relative result regressed.

### Reverted: early plain-object fast path via prototype check

- Change: added a helper for generic object cloning and moved plain-object/null-prototype objects ahead of the exotic `Date`/`Map`/`Set`/binary checks.
- Rationale: skip several exotic-type checks for the common plain-object case in snapshot traversal.
- Validation:
  - `pnpm run typecheck`: pass
  - `pnpm run test`: pass
  - `pnpm run bench -t 'snapshotContext'`: pass
- Benchmark comparison:
  - Before:
    - `baseline structuredClone x250`: 126.89 hz
    - `snapshotContext x250`: 292.96 hz
    - Relative: `2.31x` faster than baseline
  - After:
    - `baseline structuredClone x250`: 136.08 hz
    - `snapshotContext x250`: 295.97 hz
    - Relative: `2.17x` faster than baseline
- Decision: reverted. Relative performance regressed materially.

### Reverted: direct `Map` and `Set` iteration

- Change: replaced `value.entries()` and `value.values()` with direct `for...of` iteration over the `Map` and `Set` instances.
- Rationale: remove explicit iterator-producing method calls in the snapshot collection branches.
- Validation:
  - `pnpm run typecheck`: pass
  - `pnpm run test`: pass
  - `pnpm run bench -t 'snapshotContext'`: pass
- Benchmark comparison:
  - Before:
    - `baseline structuredClone x250`: 126.89 hz
    - `snapshotContext x250`: 292.96 hz
    - Relative: `2.31x` faster than baseline
  - After:
    - `baseline structuredClone x250`: 127.84 hz
    - `snapshotContext x250`: 286.32 hz
    - Relative: `2.24x` faster than baseline
- Decision: reverted. Relative performance regressed.

## Final verification

- Command: `pnpm run typecheck`
- Result: pass
- Command: `pnpm run test`
- Result: pass
- Command: `pnpm run bench -t 'snapshotContext'`
- Result:
  - `baseline structuredClone x250`: 121.18 hz
  - `snapshotContext x250`: 283.94 hz
  - Relative: `snapshotContext` is `2.34x` faster than baseline
- Overall comparison versus original baseline:
  - Original relative result: `2.14x`
  - Final relative result: `2.34x`
  - Net improvement: about `9.3%` better relative throughput (`2.34 / 2.14 ≈ 1.093`)

## Explicit decisions

- Decision: keep the indexed own-key loop for plain-object snapshots.
  - Reason: it improved the required relative benchmark result and kept the code readable.

- Decision: use `es-toolkit` root imports directly, not `es-toolkit/compat` and not `es-toolkit/predicate`.
  - Reason: this matches the requested import style.

- Decision: use `es-toolkit` for `isArrayBuffer`, `isDate`, `isMap`, `isSet`, and `isTypedArray`.
  - Reason: these helpers are available from the `es-toolkit` root export and are compatible with the runtime behavior needed here.

- Decision: keep `isObjectLikeValue` local.
  - Reason: `es-toolkit` root does not export `isObjectLike` at runtime in this environment, so a local helper is required to avoid a runtime break.

- Decision: keep `isDataView` local.
  - Reason: `es-toolkit` root does not export `isDataView` in this environment.

- Decision: no extra caching micro-optimizations beyond the kept own-key caching.
  - Reason: the attempted caching change for array length regressed the required relative benchmark result, so additional cache locals are not justified here.
