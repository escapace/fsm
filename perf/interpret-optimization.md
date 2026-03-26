# interpret.ts runtime optimization log

## Task spec

- **Goal:** improve draft-path runtime performance in `src/interpret.ts`.
- **Behavioral requirement:** preserve behavior and test correctness.
- **Allowed code changes:** `src/interpret.ts` only.
- **Allowed non-code updates:** this file only.
- **Do not change:** benchmark/profile harness semantics or unrelated files.

## Hard constraints (MUST)

1. One focused hypothesis per iteration.
2. Validation order per iteration:
   1) `pnpm run typecheck`
   2) `pnpm run test`
3. Measurement order per iteration (profile first):
   1) `pnpm run profile`
   2) capture `RUN_ID`
   3) `pnpm vitest bench --run perf/fsm.bench.ts --outputJson perf/profiles/<RUN_ID>/bench.json`
4. Persist artifacts in the same run folder:
   - `perf/profiles/<RUN_ID>/analysis.json`
   - `perf/profiles/<RUN_ID>/bench.json`
5. Use normalized metrics only via the data-only comparator (no manual math):
   - Command: `pnpm run compare:perf -- --bench-previous <prev-bench.json> --profile-previous <prev-analysis.json> --bench-current <cur-bench.json> --profile-current <cur-analysis.json>`
   - Bench normalization: within-group ratios (`scenario hz / group baseline hz`) and deltas vs previous accepted run.
   - Profile normalization: within-run decomposition/relationships and deltas vs previous accepted run.
   - Raw cross-run absolute hz/µs must not be used for decisions.
   - When comparator evidence is mixed, prioritize normalized profile deltas over normalized benchmark deltas for keep/revert decisions.
6. **Single source of truth policy (MUST):** all reported normalized ratios/deltas and keep/revert decisions must come from `pnpm run compare:perf` output only.
7. Keep/revert must be based on normalized draft-path impact and correctness.
8. If reverting, restore `src/interpret.ts` from backup and re-run:
   - `pnpm run typecheck`
   - `pnpm run test`

## Iteration workflow

1. Backup `src/interpret.ts` → `tmp/interpret.ts.backup`.
2. Re-read `src/interpret.ts`; identify targeted hot path, then read the corresponding profiling report for the current accepted baseline and think carefully before changing code—use prior attempt outcomes in this log to avoid repeating failed patterns.
3. Apply one hypothesis.
4. Run validation commands in required order.
5. Run measurement commands in required order.
6. Compare current vs previous accepted run with comparator script and treat its output as the only allowed data source.
7. Propose KEEP/REVERT with normalized evidence copied from comparator output (no manual derivation).
8. Do not finalize KEEP/REVERT until explicit user confirmation.
9. Log results immediately in this file.

## Required log content per iteration

- Hypothesis
- Exact change
- Files changed
- Validation status
- Artifact paths (RUN_ID, analysis.json, bench.json)
- Benchmark normalized ratios (current + deltas vs previous accepted; copied from `compare:perf` output)
- Profile normalized decomposition/relationships (current + deltas vs previous accepted; copied from `compare:perf` output)
- Keep/revert rationale
- Decision status (`PENDING USER CONFIRMATION` / `KEEP` / `REVERT`)

## Current state summary

- **Currently kept changes:**
  - Replay-only empty-subscription notify guard in `ServiceRuntime.replayStep()` and `DraftRuntime.replayStep()`.
  - `DraftRuntime.do()` empty-subscription notify guard.
  - Guard empty-array `.length = 0` writes in `close()` for subscriptions and trace.
  - Remove trace array truncation from `close()`.
  - Convert `indiceActions` / `indiceStates` runtime lookups from `Map` to plain records and `transitions` from `Map` to `DirectAddressTable` once in `interpret()`.
- **Accepted reference run for next comparisons:** `01KMT2Y39N1C1BGHGQF4M28M0E`.
- **All tested micro-refactors since baseline:** reverted unless explicitly user-confirmed and listed above.
- **Latest pending experiment:** replay-engine DRY refinement (`replayCursor` + direct `replayStep` sink calls), measured in `01KMT4YAH4SVGR5NP9AZFG0RHQ`, decision pending.

## What was tried

These were explored earlier and are retained here only as “do not repeat blindly” notes.

* Cached target state index in trace steps to remove lookup during commit replay — **not kept**.
* Parent reference specialization (`parentService` / `parentDraft`) for lifecycle methods — **not kept**.
* Historical root-draft empty fast path in `close()` — explored before the current artifact set; **not part of the current kept-change summary**.
* Direct parent-draft references for close teardown branching — **not kept**.
* Local alias hoists for `subscriptions` / `trace` in `close()` — **not kept**.
* Collapsed duplicate `commit()` close/return control flow — **not kept**.
* Precomputed root-draft boolean flag in constructor — **not kept**.
* Reordered close fast-path checks and reused a `parent` local — **not kept**.
* Expanded root close fast path to include non-empty traces for root commits/discards — **not kept**.
* Guard all notification sites (`do` + replay) behind empty-subscription checks — **REVERT**.
* Guard replay-only notification sites behind empty-subscription checks — **KEEP**.
* Hoist repeated `this` property accesses in hot transition/commit/do/replay paths — **REVERT**.
* Large combined pass (variable reuse + `this` access hoisting across transition/replay/do/close paths) — **REVERT**.
* Isolate `this`-hoisting to non-commit transition/do paths only — **REVERT**.
* Guard `DraftRuntime.do()` notification dispatch behind empty-subscription check — **KEEP**.
* Replace trace step wrapper objects with parallel trace arrays (`traceActions` / `traceReducers`) — **REVERT** after confirmation rerun.
* Guard `subscriptions.length = 0` and `trace.length = 0` in `close()` with non-empty checks — **KEEP**.
* Flatten `InternalSelectedStep` and lazily reconstruct action shape via `stepAction()` — **REVERT**.
* Remove trace array truncation from `close()` entirely — **KEEP**.
* Replace `instanceof` parent checks with pointer equality (`parent === this.service`) — **REVERT**.
* Make `parentChangeBuffer` lazy in `DraftRuntime` — **REVERT**.
* Replace trace step objects with a flat `unknown[]` / stride-based trace representation — **REVERT**.
* Manually inline `applyCommitStep` into replay sites and remove the shared prototype method — **REVERT**.
* Convert runtime lookup structures once in `interpret()` from builder-time `Map`s to direct-access runtime structures (records + `DirectAddressTable`) — **KEEP**.
* Single-step replay fast path in `DraftRuntime.commit()` (`traceLength === 1`) — **REVERT**.
* Service-parent no-subscription commit replay bypass (`DraftRuntime.commit()` calls `ServiceRuntime.replayStepWithoutNotify()`) — **REVERT**.
* Materialized-step commit replay (store post-transition draft contexts in trace and reconcile them during commit; no reducer rerun at commit boundaries) — **REVERT** (validation failure).
* Replay-engine unification via commit sink methods (`assertReplayCursor` + `publishReplayStep` on service/draft parents) — **PENDING USER CONFIRMATION**.
* Replay-engine DRY refinement (`replayCursor` + direct `replayStep` sink calls) — **PENDING USER CONFIRMATION**.

## Current heuristic takeaways

- Replay-notification work is worth guarding when subscriptions are usually absent.
- `DraftRuntime.do()` is already relatively lean; large structural changes there tended to lose on profile metrics.
- `close()` was a real source of avoidable overhead; small teardown-path changes produced durable wins.
- Dispatch lookup simplification helped when done once at runtime-boundary setup time instead of inside hot loops.
- Prototype / shape changes in the dispatcher hierarchy are risky; hidden-class disruption can outweigh any local simplification.

## Iteration: large hypothesis (variable reuse + `this` access hoisting in one pass)

- Hypothesis
  - Reusing local aliases (`actionBuffer`, `changeBuffer`, `subscriptions`, `context`) and hoisting repeated `this.*` access in hot methods (`resolveTransition`, `applyTransition`, `applyCommitStep`, `do`, replay helpers, `close`) reduces dispatch overhead on draft-heavy paths.

- Exact change
  - Hoisted repeated field reads into locals in:
    - `AbstractDispatcher.resolveTransition()`
    - `AbstractDispatcher.applyTransition()`
    - `AbstractDispatcher.applyCommitStep()`
    - `ServiceRuntime.replayStep()`
    - `ServiceRuntime.do()`
    - `DraftRuntime.replayStep()`
    - `DraftRuntime.do()`
    - `DraftRuntime.close()`
  - Preserved control flow and external behavior.

- Files changed
  - `src/interpret.ts`
  - `perf/interpret-optimization.md`

- Validation status
  - `pnpm run typecheck` ✅
  - `pnpm run test` ✅

- Artifact paths
  - Baseline bootstrap run (pre-change):
    - RUN_ID: `01KMT2Y39N1C1BGHGQF4M28M0E`
    - `perf/profiles/01KMT2Y39N1C1BGHGQF4M28M0E/analysis.json`
    - `perf/profiles/01KMT2Y39N1C1BGHGQF4M28M0E/bench.json`
  - Candidate run (post-change):
    - RUN_ID: `01KMT33NMFHW003JDDKRXPC261`
    - `perf/profiles/01KMT33NMFHW003JDDKRXPC261/analysis.json`
    - `perf/profiles/01KMT33NMFHW003JDDKRXPC261/bench.json`

- Benchmark normalized ratios (copied from comparator output)
  - perf/fsm.bench.ts > fsm throughput - bare transitions
    - escapace/fsm x1000 (do string): ratioPointDelta=+0.109117 relativeDelta=+9.56%
    - @xstate/fsm x1000 (send string): ratioPointDelta=+0.002843 relativeDelta=+5.79%
    - @xstate/fsm x1000 (send object): ratioPointDelta=+0.002562 relativeDelta=+5.18%
  - perf/fsm.bench.ts > fsm throughput - guard + immutable context update
    - escapace/fsm x1000 (predicate + reducer): ratioPointDelta=+0.040699 relativeDelta=+6.99%
    - escapace/fsm x1000 (draft create+do+commit): ratioPointDelta=+0.001152 relativeDelta=+6.84%
    - escapace/fsm x1000 (draft create+do+commit, cheapest hooks): ratioPointDelta=+0.002151 relativeDelta=+6.34%
    - @xstate/fsm x1000 (cond + assign): ratioPointDelta=+0.003075 relativeDelta=+7.49%
  - perf/fsm.bench.ts > fsm throughput - transition callback cost
    - escapace/fsm x1000 (reducer noop): ratioPointDelta=+0.036393 relativeDelta=+6.74%
    - @xstate/fsm x1000 (actions noop): ratioPointDelta=+0.001794 relativeDelta=+6.05%

- Profile normalized decomposition/relationships (copied from comparator output)
  - commit_over_direct: delta=-0.475022 relativeDelta=-3.35%
  - commit_over_do_discard: delta=-0.100469 relativeDelta=-4.52%
  - commit_replay: delta=-0.122938 relativeDelta=-8.53%
  - construction: delta=-0.053410 relativeDelta=-7.02%
  - discard_over_direct: delta=-0.227209 relativeDelta=-4.44%
  - do_discard_over_direct: delta=+0.071567 relativeDelta=+1.12%
  - do_discard_over_discard: delta=+0.066343 relativeDelta=+5.32%
  - draft_step: delta=+0.052580 relativeDelta=+22.57%

- Keep/revert rationale
  - Comparator output is mixed: benchmark ratios are positive, but several core normalized profile metrics for draft-heavy costs regress (negative deltas in `commit_replay`, `construction`, `commit_over_do_discard`, and `commit_over_direct`).
  - Per policy, normalized profile deltas take priority when evidence is mixed.
  - Proposed action: **REVERT**.

- Decision status
  - **REVERT**

- Revert validation (post-confirmation)
  - Restored `src/interpret.ts` from `tmp/interpret.ts.backup`.
  - `pnpm run typecheck` ✅
  - `pnpm run test` ✅

## Iteration: single-step replay fast path in `commit()`

- Hypothesis
  - A dedicated `traceLength === 1` fast path in `DraftRuntime.commit()` reduces overhead for the benchmark-dominant lifecycle (`draft → do → commit` with one recorded step), especially in cheapest-hooks mode.

- Exact change
  - In both `ServiceRuntime` parent and `DraftRuntime` parent branches of `DraftRuntime.commit()`, added:
    - `if (traceLength === 1) { parent.replayStep(trace[0]); this.close(); return }`
  - Kept existing `traceLength === 0` fast path and multi-step loop unchanged.

- Files changed
  - `src/interpret.ts`
  - `perf/interpret-optimization.md`

- Validation status
  - `pnpm run typecheck` ✅
  - `pnpm run test` ✅

- Artifact paths (current candidate)
  - RUN_ID: `01KMT3R8QGAB1GB2HJ58YH5XAB`
  - `perf/profiles/01KMT3R8QGAB1GB2HJ58YH5XAB/analysis.json`
  - `perf/profiles/01KMT3R8QGAB1GB2HJ58YH5XAB/bench.json`

- Benchmark normalized ratios (copied from comparator output)
  - perf/fsm.bench.ts > fsm throughput - bare transitions
    - escapace/fsm x1000 (do string): ratioPointDelta=+0.066278 relativeDelta=+5.80%
    - @xstate/fsm x1000 (send string): ratioPointDelta=+0.002238 relativeDelta=+4.56%
    - @xstate/fsm x1000 (send object): ratioPointDelta=+0.001760 relativeDelta=+3.56%
  - perf/fsm.bench.ts > fsm throughput - guard + immutable context update
    - escapace/fsm x1000 (predicate + reducer): ratioPointDelta=+0.025239 relativeDelta=+4.34%
    - escapace/fsm x1000 (draft create+do+commit): ratioPointDelta=+0.000654 relativeDelta=+3.88%
    - escapace/fsm x1000 (draft create+do+commit, cheapest hooks): ratioPointDelta=+0.000948 relativeDelta=+2.79%
    - @xstate/fsm x1000 (cond + assign): ratioPointDelta=+0.002155 relativeDelta=+5.25%
  - perf/fsm.bench.ts > fsm throughput - transition callback cost
    - escapace/fsm x1000 (reducer noop): ratioPointDelta=+0.023344 relativeDelta=+4.32%
    - @xstate/fsm x1000 (actions noop): ratioPointDelta=+0.001305 relativeDelta=+4.40%

- Profile normalized decomposition/relationships (copied from comparator output)
  - commit_over_direct: delta=-1.205602 relativeDelta=-8.49%
  - commit_over_do_discard: delta=-0.155791 relativeDelta=-7.01%
  - commit_replay: delta=-0.164930 relativeDelta=-11.44%
  - construction: delta=-0.075054 relativeDelta=-9.87%
  - discard_over_direct: delta=-0.522746 relativeDelta=-10.21%
  - do_discard_over_direct: delta=-0.088695 relativeDelta=-1.39%
  - do_discard_over_discard: delta=+0.099752 relativeDelta=+8.00%
  - draft_step: delta=+0.083906 relativeDelta=+36.01%

- Keep/revert rationale
  - Comparator output is mixed: benchmark ratios are positive (including cheapest-hooks), but key normalized profile metrics for commit-heavy draft cost regress (`commit_replay`, `commit_over_do_discard`, `commit_over_direct`, and `construction`).
  - Per policy, normalized profile deltas outweigh benchmark deltas when mixed.
  - Proposed action: **REVERT**.

- Decision status
  - **REVERT**

- Revert validation (post-confirmation)
  - Restored `src/interpret.ts` from `tmp/interpret.ts.backup`.
  - `pnpm run typecheck` ✅
  - `pnpm run test` ✅

## Iteration: service-parent no-subscription commit replay bypass

- Hypothesis
  - In the primary benchmark path (`service.draft()` → `do()` → `commit()`), parent service subscriptions are typically empty; bypassing `replayStep()` and calling a no-notify replay method removes per-step notify-guard overhead on commit replay.

- Exact change
  - Added two methods to `ServiceRuntime`:
    - `hasSubscriptions()`
    - `replayStepWithoutNotify(step)`
  - Updated `DraftRuntime.commit()` service-parent branch:
    - when `!parent.hasSubscriptions()`, replay via `parent.replayStepWithoutNotify(step)` loop;
    - otherwise keep existing `parent.replayStep(step)` loop.
  - Draft-parent branch unchanged.

- Files changed
  - `src/interpret.ts`
  - `perf/interpret-optimization.md`

- Validation status
  - `pnpm run typecheck` ✅
  - `pnpm run test` ✅

- Artifact paths (current candidate)
  - RUN_ID: `01KMT40NBSF9356DVRDVBMW39N`
  - `perf/profiles/01KMT40NBSF9356DVRDVBMW39N/analysis.json`
  - `perf/profiles/01KMT40NBSF9356DVRDVBMW39N/bench.json`

- Benchmark normalized ratios (copied from comparator output)
  - perf/fsm.bench.ts > fsm throughput - bare transitions
    - escapace/fsm x1000 (do string): ratioPointDelta=+0.082977 relativeDelta=+7.27%
    - @xstate/fsm x1000 (send string): ratioPointDelta=+0.001845 relativeDelta=+3.76%
    - @xstate/fsm x1000 (send object): ratioPointDelta=+0.001449 relativeDelta=+2.93%
  - perf/fsm.bench.ts > fsm throughput - guard + immutable context update
    - escapace/fsm x1000 (predicate + reducer): ratioPointDelta=+0.019203 relativeDelta=+3.30%
    - escapace/fsm x1000 (draft create+do+commit): ratioPointDelta=+0.000564 relativeDelta=+3.35%
    - escapace/fsm x1000 (draft create+do+commit, cheapest hooks): ratioPointDelta=+0.000976 relativeDelta=+2.88%
    - @xstate/fsm x1000 (cond + assign): ratioPointDelta=+0.001417 relativeDelta=+3.45%
  - perf/fsm.bench.ts > fsm throughput - transition callback cost
    - escapace/fsm x1000 (reducer noop): ratioPointDelta=-0.000584 relativeDelta=-0.11%
    - @xstate/fsm x1000 (actions noop): ratioPointDelta=+0.001225 relativeDelta=+4.13%

- Profile normalized decomposition/relationships (copied from comparator output)
  - commit_over_direct: delta=-0.713150 relativeDelta=-5.02%
  - commit_over_do_discard: delta=-0.032733 relativeDelta=-1.47%
  - commit_replay: delta=-0.052730 relativeDelta=-3.66%
  - construction: delta=-0.173096 relativeDelta=-22.77%
  - discard_over_direct: delta=-1.065530 relativeDelta=-20.81%
  - do_discard_over_direct: delta=-0.223423 relativeDelta=-3.50%
  - do_discard_over_discard: delta=+0.178597 relativeDelta=+14.33%
  - draft_step: delta=+0.157284 relativeDelta=+67.50%

- Keep/revert rationale
  - Comparator output is mixed, with benchmark gains including cheapest-hooks, but normalized profile decomposition shows broad regressions in commit and construction components.
  - Per policy, normalized profile deltas take precedence under mixed evidence.
  - Proposed action: **REVERT**.

- Decision status
  - **REVERT**

- Revert validation (post-confirmation)
  - Restored `src/interpret.ts` from `tmp/interpret.ts.backup`.
  - `pnpm run typecheck` ✅
  - `pnpm run test` ✅

## Iteration: materialized-step commit replay (algorithmic)

- Hypothesis
  - Replace reducer re-execution during commit replay with a materialized-step model: each draft step stores post-transition context, and commit replay reconciles to stored contexts instead of invoking reducers again.

- Exact change
  - Changed `InternalSelectedStep` shape from `{ action, reducer }` to `{ action, context }`.
  - In `DraftRuntime.do()`, stored `context: this.snapshotContext(this.context)` in each trace step.
  - In `AbstractDispatcher.applyCommitStep()`, replaced reducer invocation with `this.context = this.reconcileContext(this.context, step.context)`.

- Files changed
  - `src/interpret.ts`
  - `perf/interpret-optimization.md`

- Validation status
  - `pnpm run typecheck` ✅
  - `pnpm run test` ❌ (6 failing tests)

- Failure summary
  - `src/__tests__/draft-retention-behavior.spec.ts`:
    - root commit reducer throw does not advance live state and can be retried
    - child commit reducer throw does not advance parent state and emits no notification
    - mixed child publication failure keeps first successful step and notification only
  - `src/__tests__/draft.spec.ts`:
    - nested publication re-runs reducers at each commit boundary
  - `src/__tests__/notification-object-consistency.spec.ts`:
    - draft.commit -> service: no gate rerun, reducer rerun with per-step actions, service envelope reuse
    - child draft.commit -> parent draft: no gate rerun, parent replay envelope reuse, per-step subscriber actions

- Measurement status
  - Not run (validation failed).

- Keep/revert rationale
  - The algorithm changes observable semantics (commit-time reducer rerun behavior and failure propagation), violating current behavioral expectations enforced by tests.
  - Must revert.

- Decision status
  - **REVERT**

- Revert validation
  - Restored `src/interpret.ts` from `tmp/interpret.ts.backup`.
  - `pnpm run typecheck` ✅
  - `pnpm run test` ✅

## Iteration: replay-engine unification via commit sink methods

- Hypothesis
  - Replace parent-type branching inside `DraftRuntime.commit()` with a unified replay engine where both `ServiceRuntime` and `DraftRuntime` expose the same commit-sink operations (`assertReplayCursor`, `publishReplayStep`).

- Exact change
  - Added to `ServiceRuntime`:
    - `assertReplayCursor(expectedCursor)`
    - `publishReplayStep(step)`
  - Added to `DraftRuntime`:
    - `assertReplayCursor(expectedCursor)`
    - `publishReplayStep(step)`
  - Reworked `DraftRuntime.commit()`:
    - removed `instanceof ServiceRuntime` branching logic;
    - uses unified parent sink calls for conflict check and replay loop.

- Files changed
  - `src/interpret.ts`
  - `perf/interpret-optimization.md`

- Validation status
  - `pnpm run typecheck` ✅
  - `pnpm run test` ✅

- Artifact paths (current candidate)
  - RUN_ID: `01KMT4KWDVWKGRFYHS4BEK49HX`
  - `perf/profiles/01KMT4KWDVWKGRFYHS4BEK49HX/analysis.json`
  - `perf/profiles/01KMT4KWDVWKGRFYHS4BEK49HX/bench.json`

- Benchmark normalized ratios (copied from comparator output)
  - perf/fsm.bench.ts > fsm throughput - bare transitions
    - escapace/fsm x1000 (do string): ratioPointDelta=+0.086235 relativeDelta=+7.55%
    - @xstate/fsm x1000 (send string): ratioPointDelta=+0.002880 relativeDelta=+5.87%
    - @xstate/fsm x1000 (send object): ratioPointDelta=+0.002305 relativeDelta=+4.66%
  - perf/fsm.bench.ts > fsm throughput - guard + immutable context update
    - escapace/fsm x1000 (predicate + reducer): ratioPointDelta=+0.046002 relativeDelta=+7.90%
    - escapace/fsm x1000 (draft create+do+commit): ratioPointDelta=+0.001539 relativeDelta=+9.13%
    - escapace/fsm x1000 (draft create+do+commit, cheapest hooks): ratioPointDelta=+0.002709 relativeDelta=+7.98%
    - @xstate/fsm x1000 (cond + assign): ratioPointDelta=+0.004699 relativeDelta=+11.44%
  - perf/fsm.bench.ts > fsm throughput - transition callback cost
    - escapace/fsm x1000 (reducer noop): ratioPointDelta=+0.044606 relativeDelta=+8.26%
    - @xstate/fsm x1000 (actions noop): ratioPointDelta=+0.002334 relativeDelta=+7.87%

- Profile normalized decomposition/relationships (copied from comparator output)
  - commit_over_direct: delta=-0.108595 relativeDelta=-0.76%
  - commit_over_do_discard: delta=-0.129455 relativeDelta=-5.82%
  - commit_replay: delta=-0.141472 relativeDelta=-9.81%
  - construction: delta=-0.168314 relativeDelta=-22.14%
  - discard_over_direct: delta=-0.705069 relativeDelta=-13.77%
  - do_discard_over_direct: delta=+0.305012 relativeDelta=+4.78%
  - do_discard_over_discard: delta=+0.203220 relativeDelta=+16.30%
  - draft_step: delta=+0.184368 relativeDelta=+79.12%

- Keep/revert rationale
  - Comparator output is mixed: benchmark normalized ratios improve (including cheapest-hooks), but normalized profile decomposition regresses in key commit and construction metrics (`commit_replay`, `commit_over_do_discard`, `construction`, `discard_over_direct`).
  - Per policy, profile deltas are decisive under mixed evidence.
  - Proposed action: **REVERT**.

- Decision status
  - **PENDING USER CONFIRMATION**

## Iteration: replay-engine DRY refinement (`replayCursor` + direct `replayStep`)

- Hypothesis
  - Keep replay-engine unification but reduce abstraction overhead by removing wrapper sink methods (`assertReplayCursor` / `publishReplayStep`) and using a shared cursor property plus direct replay-step calls.

- Exact change
  - Replaced `assertReplayCursor` and `publishReplayStep` methods with:
    - `ServiceRuntime.replayCursor` getter
    - `DraftRuntime.replayCursor` getter
  - Changed `DraftRuntime.replayStep` visibility from private to class-callable method and updated `commit()` loop to call `parent.replayStep(step)` directly.
  - Updated conflict check in `DraftRuntime.commit()` to compare `parent.replayCursor` against `baseCursor`.

- Files changed
  - `src/interpret.ts`
  - `perf/interpret-optimization.md`

- Validation status
  - `pnpm run typecheck` ✅
  - `pnpm run test` ✅

- Artifact paths (current candidate)
  - RUN_ID: `01KMT4YAH4SVGR5NP9AZFG0RHQ`
  - `perf/profiles/01KMT4YAH4SVGR5NP9AZFG0RHQ/analysis.json`
  - `perf/profiles/01KMT4YAH4SVGR5NP9AZFG0RHQ/bench.json`

- Benchmark normalized ratios (copied from comparator output)
  - perf/fsm.bench.ts > fsm throughput - bare transitions
    - escapace/fsm x1000 (do string): ratioPointDelta=+0.084114 relativeDelta=+7.37%
    - @xstate/fsm x1000 (send string): ratioPointDelta=+0.002316 relativeDelta=+4.72%
    - @xstate/fsm x1000 (send object): ratioPointDelta=+0.001891 relativeDelta=+3.82%
  - perf/fsm.bench.ts > fsm throughput - guard + immutable context update
    - escapace/fsm x1000 (predicate + reducer): ratioPointDelta=+0.015656 relativeDelta=+2.69%
    - escapace/fsm x1000 (draft create+do+commit): ratioPointDelta=+0.000967 relativeDelta=+5.74%
    - escapace/fsm x1000 (draft create+do+commit, cheapest hooks): ratioPointDelta=+0.001333 relativeDelta=+3.93%
    - @xstate/fsm x1000 (cond + assign): ratioPointDelta=+0.002559 relativeDelta=+6.23%
  - perf/fsm.bench.ts > fsm throughput - transition callback cost
    - escapace/fsm x1000 (reducer noop): ratioPointDelta=+0.040368 relativeDelta=+7.47%
    - @xstate/fsm x1000 (actions noop): ratioPointDelta=+0.001613 relativeDelta=+5.44%

- Profile normalized decomposition/relationships (copied from comparator output)
  - commit_over_direct: delta=-0.257695 relativeDelta=-1.82%
  - commit_over_do_discard: delta=-0.073214 relativeDelta=-3.29%
  - commit_replay: delta=-0.124954 relativeDelta=-8.67%
  - construction: delta=-0.059804 relativeDelta=-7.87%
  - discard_over_direct: delta=-0.152279 relativeDelta=-2.97%
  - do_discard_over_direct: delta=+0.091281 relativeDelta=+1.43%
  - do_discard_over_discard: delta=+0.053310 relativeDelta=+4.28%
  - draft_step: delta=+0.037376 relativeDelta=+16.04%

- Keep/revert rationale
  - Comparator output remains mixed: benchmark normalized ratios improve (including cheapest-hooks), but key normalized profile metrics remain negative (`commit_replay`, `commit_over_do_discard`, `construction`, `discard_over_direct`).
  - Per policy, profile decomposition deltas decide under mixed evidence.
  - Proposed action: **REVERT**.

- Decision status
  - **PENDING USER CONFIRMATION**
