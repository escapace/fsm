# Semantic specification

## Purpose

This document defines the semantics of the flat extended finite state machine (EFSM) implemented by `@escapace/fsm` in language-independent terms. A reader should be able to determine the outcome of any dispatch without consulting TypeScript source code. The specification is precise enough to encode directly in Lean 4.

## Scope

This specification covers the **semantic model** — the observable behavior of machine definition, composition, dispatch, and draft-based speculative execution. It deliberately excludes:

- paired-key (Szudzik) indexing used for transition lookup at runtime,
- mutable builder internals and builder action log,
- pre-allocated object reuse in the interpreter,
- TypeScript type-level encoding and staged builder types,
- subscription object identity and allocation strategy,
- `Symbol`-keyed internal properties,
- context cloning algorithms and object identity preservation (§4.15).

These are implementation details. The proofs target the semantic layer only.

Drafts (§4) are an additive operational layer over the same flat EFSM semantics. They do not change the semantic class of the machine.

## 1 — Definitions

### 1.1 — Identifier

An **identifier** is an opaque value drawn from a countable set. In the implementation these are `number | string | symbol`. For the semantic model, identifiers need only support equality comparison.

### 1.2 — Machine definition

A **machine definition** `M` is a tuple:

```
M = (S, A, C₀, s₀, T)
```

where:

- `S` is a finite, non-empty, ordered set of **state identifiers**. Order is declaration order.
- `A` is a finite, non-empty, ordered set of **action identifiers**. Order is declaration order.
- `C₀` is the **initial context factory**, a nullary function called exactly once per interpretation to produce the initial context value.
- `s₀ ∈ S` is the **initial state**. Required for standalone interpretation; may be absent in a child machine used only through composition (§11.1).
- `T` is a finite, ordered list of **transition rules** (see §1.3).

Uniqueness constraints enforced at definition time:

- Every element of `S` is distinct. Attempting to add a duplicate state is an error.
- Every element of `A` is distinct. Attempting to add a duplicate action is an error.
- `s₀` must be a member of `S`. Referencing an undeclared state as initial is an error.
- Every action referenced in a transition rule must be a member of `A`. Referencing an undeclared action is an error.
- Every state referenced as source or target in a transition rule must be a member of `S`. Referencing an undeclared state is an error.

### 1.3 — Transition rule

A **transition rule** `t` is a tuple:

```
t = (source, action, target, guards, reducer)
```

where:

- `source ∈ S` — the state from which this transition may fire.
- `action ∈ A` — the action that triggers this transition.
- `target ∈ S` — the state the machine enters if this transition fires.
- `guards` — an ordered (possibly empty) list of **guard functions** `[g₁, g₂, …, gₖ]`. Each guard is a function `(context, actionInfo) → bool`. An empty guard list is always satisfied.
- `reducer` — an optional function `(context, actionInfo) → context'` that computes the next context value. When absent, the context is unchanged.

### 1.4 — Transition expansion

The builder API accepts arrays for `source` and `target` parameters:

```
transition(sources, action, targets, reducer?)
```

where `sources` and `targets` may each be a single identifier or an array of identifiers.

**Expansion rule.** When `sources = [s₁, …, sₘ]` and `targets = [t₁, …, tₙ]`, the builder produces `m × n` transition rules — one for every pair in the Cartesian product `sources × targets`. The order of the expanded rules follows row-major enumeration of the product.

Each expanded rule shares the same `action`, `guards`, and `reducer` from the original call. Only `source` and `target` vary.

**Semantic equivalence.** The expanded transition rules are semantically identical to explicitly declaring each `(sᵢ, action, tⱼ, guards, reducer)` individually in the same order.

### 1.5 — Candidate list

For a given current state `s` and dispatched action `a`, the **candidate list** `candidates(s, a)` is the sub-sequence of `T` containing exactly those transition rules where `source = s` and `action = a`, preserving declaration order.

### 1.6 — Machine instance

A **machine instance** (service) is a mutable configuration:

```
instance = (M, sₙ, cₙ, subscribers)
```

where:

- `M` is the machine definition.
- `sₙ ∈ S` is the current state, initially `s₀`.
- `cₙ` is the current context, initially the resolved value of `C₀`.
- `subscribers` is an ordered list of subscription functions.

## 2 — Dispatch semantics

Dispatch is the core operation. Given a machine instance and a dispatched action `a` with optional payload `p`:

### 2.1 — Action validation

If `a ∉ A` (the action is not declared in the machine definition), dispatch **throws an error**. This check occurs before any transition lookup.

### 2.2 — Candidate lookup

Compute `candidates(sₙ, a)`. If the candidate list is empty (no transition rules exist for the current state and action pair), dispatch **returns `false`**. The state and context are unchanged. No subscriptions fire.

### 2.3 — Guard evaluation

Evaluate candidates in declaration order. For each candidate `t = (source, action, target, [g₁, …, gₖ], reducer)`:

1. Construct an action information record: `actionInfo = { type: a, payload: p, source: t.source, target: t.target }`.
2. Evaluate guards in order: `g₁(cₙ, actionInfo)`, then `g₂(cₙ, actionInfo)`, and so on.
3. If any guard `gⱼ` returns `false`, **short-circuit**: skip remaining guards for this candidate and proceed to the next candidate.
4. If all guards return `true` (or the guard list is empty), this candidate is **selected**. Stop evaluating further candidates.

If no candidate is selected after evaluating all candidates, dispatch **returns `false`**. The state and context are unchanged. No subscriptions fire.

### 2.4 — The two `false` outcomes

Dispatch returns `false` in exactly two cases:

1. **No candidates**: `candidates(sₙ, a)` is empty. No transition rules exist for the current state–action pair.
2. **All guards failed**: `candidates(sₙ, a)` is non-empty, but every candidate had at least one guard that returned `false`.

In both cases the observable effect is identical: no state change, no context change, no subscription notification. The caller receives `false`.

### 2.5 — Transition execution

When a candidate `t` is selected:

1. **State update**: set `sₙ ← t.target`.
2. **Context update**: if `t.reducer` is defined, set `cₙ ← t.reducer(cₙ, actionInfo)`. If `t.reducer` is `undefined`, `cₙ` is unchanged.
3. **Subscription notification**: for each subscriber in `subscribers` (in registration order), invoke the subscriber with a change record `{ state: sₙ, context: cₙ, action: actionInfo }`. The change record reflects the **post-transition** state and context.
4. **Return `true`**.

### 2.6 — Determinism

Transition selection is **deterministic**. Given the same current state, context, action, and payload, the same candidate is always selected (or the same `false` outcome occurs). This follows from:

- The candidate list has a fixed order (declaration order).
- Guards are evaluated in a fixed order per candidate.
- The first candidate whose guards all pass is selected.

Guard functions themselves may be non-deterministic (e.g., reading external state), which can cause different candidates to be selected across calls with the same arguments. Determinism of selection holds given fixed guard return values.

## 3 — Subscription semantics

### 3.1 — Registration

`subscribe(f)` appends `f` to the subscriber list if `f` is not already present (identity comparison). Returns an unsubscribe function that removes `f` from the list.

### 3.2 — Deduplication

If `subscribe(f)` is called with a function `f` that is already in the subscriber list, the list is unchanged. A new unsubscribe function is still returned.

### 3.3 — Notification timing

Subscribers are notified **only** after a successful transition (dispatch returns `true`). They are never notified on `false` outcomes or thrown errors.

### 3.4 — Notification order

Subscribers are invoked in registration order.

### 3.5 — Change record

The change record passed to each subscriber contains:

- `state` — the new current state (post-transition).
- `context` — the new current context (post-reducer, or unchanged if no reducer).
- `action` — the action information record `{ type, payload, source, target }` of the selected transition.

### 3.6 — Observation caveat

The change record object is shared and reused across dispatch calls. Subscribers that need to retain the change record must copy it before the subscription function returns. This is an implementation-level characteristic documented here for completeness; the semantic model treats each notification as delivering the values described in §3.5.

## 4 — Draft semantics

Drafts are an additive operational layer over the flat EFSM dispatch and subscription semantics defined in §1–§3. They provide provisional speculative execution with explicit commit or discard. A draft does not change the semantic class of the machine; it reuses the same dispatch rules, candidate selection, and transition execution defined in §2.

### 4.1 — Service cursor

A machine instance (§1.6) maintains an internal monotonic cursor `serviceCursor : Nat`, starting at `0` and incremented by one after every successful transition visible on the live service.

### 4.2 — Selected step

A **selected step** records a successful dispatch:

```
SelectedStep = { transition, action }
```

- `transition` — the selected transition rule (§1.3).
- `action` — the action information record `{ type, payload, source, target }` (§2.3).

### 4.3 — Selected-step application

```
applySelected(snapshot, step) → snapshot'
```

Sets `state := step.transition.target` and applies `step.transition.reducer` to the context if present, delegating to `applyReducer` (§2.5). No candidate lookup or guard evaluation.

### 4.4 — Trace replay

```
replayTrace(snapshot, trace) → snapshot'
```

Left fold of `applySelected` over `trace`:

```
replayTrace(snap, [])           = snap
replayTrace(snap, step :: rest) = replayTrace(applySelected(snap, step), rest)
```

### 4.5 — Draft handle

A **draft handle** stores three fields:

```
Draft = { baseCursor, baseSnapshot, trace }
```

- `baseCursor : Nat` — the parent cursor captured at draft creation.
- `baseSnapshot = { state, context }` — the parent snapshot captured at draft creation.
- `trace` — an append-only list of selected steps (§4.2).

Two values are derived, not stored:

```
currentSnapshot = replayTrace(baseSnapshot, trace)
draftHeadCursor = baseCursor + length(trace)
```

The runtime additionally tracks a `closed : Bool` flag and a parent reference for lifecycle management; those are outside the semantic model (§10).

### 4.6 — Service `draft()`

`service.draft()` creates a draft handle with:

- `baseCursor = serviceCursor`,
- `baseSnapshot = { state = service.state, context = clone(service.context) }`,
- `trace = []`.

This operation does not mutate the service and does not notify subscribers.

### 4.7 — Draft `do(action, payload?)`

`draft.do(...)` applies the ordinary dispatch semantics (§2) against `currentSnapshot`:

- If `action ∉ A`: throw the same unknown-action error as the service (§2.1).
- If dispatch would return `false` (no candidates, or all guards fail): return `false`. Leave `trace` and `currentSnapshot` unchanged.
- If dispatch succeeds with selected transition `t`, action record `a`, and post-snapshot `snap'`:
  - append `{ transition = t, action = a }` to `trace`,
  - set `currentSnapshot := snap'`,
  - return `true`.

Draft `do(...)` does not notify subscribers.

### 4.8 — Nested `draft()`

`draft.draft()` on an open draft creates a child draft handle with:

- `baseCursor = draftHeadCursor` (of the parent draft),
- `baseSnapshot = clone(parent.currentSnapshot)`,
- `trace = []`.

This operation does not mutate the parent draft.

### 4.9 — `discard()`

`draft.discard()`:

- Marks the handle as closed (`closed = true`).
- Does not mutate the parent.
- Does not notify subscribers.

After discard, all mutating methods on the handle fail with `DraftClosed`.

### 4.10 — `commit()` into a parent draft

For a child draft whose parent is another draft:

1. If this handle is closed, fail with `DraftClosed`.
2. If any ancestor draft is closed, fail with `DraftClosed`.
3. Let `parentHead = parent.baseCursor + length(parent.trace)`.
4. If `parentHead ≠ this.baseCursor`, fail with `DraftOutOfDate`.
5. If `trace` is empty, close this draft and return success without mutating the parent.
6. Otherwise:
   - append `this.trace` to `parent.trace`,
   - set `parent.currentSnapshot := this.currentSnapshot`,
   - close this draft,
   - return success.

No subscriptions fire, because drafts do not expose subscriptions (§4.13).

### 4.11 — `commit()` into the service

For a root draft whose parent is the live service:

1. If this handle is closed, fail with `DraftClosed`.
2. If `serviceCursor ≠ this.baseCursor`, fail with `DraftOutOfDate`.
3. If `trace` is empty, close this draft and return success without mutating the service.
4. Otherwise, replay each selected step in `trace` onto the service in order:
   - apply the selected step directly to the service snapshot,
   - increment `serviceCursor` by one,
   - notify subscribers with the ordinary post-transition change record (§3.5).
5. After replay completes, the service snapshot equals `this.currentSnapshot`.
6. Close the draft and return success.

This is the only draft operation that emits subscription notifications.

### 4.12 — Conflict semantics

#### Cursor equality

Conflict detection uses cursor equality, not snapshot equality. Snapshot equality is insufficient because different histories can reach the same snapshot, and the runtime does not define general equality for arbitrary context values.

#### Root conflicts

A root draft is stale if the live service has advanced since draft creation:

```
serviceCursor ≠ draft.baseCursor
```

Advancement includes successful `service.do(...)` or successful commit from another root draft.

#### Nested conflicts

A child draft is stale if its parent draft's head cursor has advanced since child creation:

```
parent.draftHeadCursor ≠ child.baseCursor
```

Advancement includes parent draft `do(...)` or commit from a sibling child draft.

#### Multiple drafts

Multiple drafts are allowed. Conflict resolution is optimistic: the first successful commit wins; later commits against an advanced parent fail with `DraftOutOfDate`.

### 4.13 — Subscription policy

Drafts do not expose `subscribe(...)`.

Draft execution is private. The publication boundary is commit. Parent subscribers observe only committed transitions.

#### Root commit replay

During root commit (§4.11), subscriber callbacks on the live service are invoked exactly as if the replayed transitions had been executed on the live service in order:

- One callback per replayed successful transition.
- Subscribers invoked in registration order (§3.4).
- Post-transition state and context in each callback (§3.5).
- Action equal to the recorded selected step action.

#### Child commit

Child commit into a parent draft (§4.10) produces no subscription effects because drafts have no subscriptions.

### 4.14 — Closure semantics

#### Terminal closure

`commit()` and `discard()` are terminal. After either call succeeds:

- `do(...)` fails with `DraftClosed`.
- `draft()` fails with `DraftClosed`.
- `commit()` fails with `DraftClosed`.
- `discard()` fails with `DraftClosed`.

#### Ancestor closure

If any ancestor draft is closed, descendant draft mutating operations fail with `DraftClosed`.

#### Read-only access after closure

The specification does not require `state` and `context` getters to throw after closure. The implementation may leave them readable as last-known snapshots. No mutating behavior is permitted after closure.

### 4.15 — Context treatment

The semantic model treats context as a value. Context cloning at draft creation, materialization strategy on commit, and the choice of runtime cloning mechanism are implementation concerns outside the semantic model. The Lean formalization reasons about resulting context values, not about object identity or cloning algorithms.

## 5 — Context initialization

### 5.1 — Factory initialization

`C₀` is a nullary factory function. The initial context of each machine instance is the return value of `C₀()`. The factory is called exactly once per `interpret(M)` call, producing an independent context for each instance.

## 6 — Definition-time errors

These errors are raised during machine construction (builder calls), not during dispatch:

| Condition                                                                           | Error                                                      |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Adding a state identifier already in `S`                                            | "State already exists."                                    |
| Adding an action identifier already in `A`                                          | "Action already exists."                                   |
| Setting initial state to an identifier not in `S`                                   | "No such state."                                           |
| Referencing a source or target state not in `S` in a transition                     | "No such state."                                           |
| Referencing an action not in `A` in a transition                                    | "No such action."                                          |
| Calling `interpret` on a value that is not a machine definition                     | "Parameter is not a state machine."                        |
| Providing a non-function context initializer                                        | "Context initializer must be a nullary function."          |
| Composing with a group name that is an existing state or group                      | "Group already exists or conflicts with a declared state." |
| Composing with a child whose state names overlap parent or sibling states           | "State already exists."                                    |
| Composing with a child whose action overlaps a previously composed sibling's action | "Action … overlaps a previously composed child action."    |
| Composing with a value that is not a machine definition                             | "Parameter is not a state machine."                        |

## 7 — Dispatch-time errors

| Condition                   | Behavior                            |
| --------------------------- | ----------------------------------- |
| Action `a ∉ A`              | Throws "No such action."            |
| No candidates for `(sₙ, a)` | Returns `false`                     |
| All candidate guards fail   | Returns `false`                     |
| A candidate is selected     | Executes transition, returns `true` |

## 8 — Draft-time errors

| Condition                                         | Behavior                         |
| ------------------------------------------------- | -------------------------------- |
| `do(...)` on a closed draft                       | Throws `DraftClosed`             |
| `do(...)` on a draft with a closed ancestor       | Throws `DraftClosed`             |
| `draft()` on a closed draft                       | Throws `DraftClosed`             |
| `commit()` on a closed draft                      | Throws `DraftClosed`             |
| `discard()` on a closed draft                     | Throws `DraftClosed`             |
| `commit()` when parent cursor ≠ `baseCursor`      | Throws `DraftOutOfDate`          |
| `draft()` when `structuredClone` fails on context | Throws `DraftContextCloneFailed` |

## 9 — Properties for Lean verification

The following properties are derived from the semantics above and form the target theorem set.

### P1 — Determinism of transition selection

For any machine instance state `(sₙ, cₙ)`, action `a`, and payload `p`: if all guard functions are pure (deterministic given their arguments), then the selected candidate (or the `false` outcome) is uniquely determined.

### P2 — Success soundness

If `dispatch(a, p)` returns `true`, then there exists a transition rule `t ∈ candidates(sₙ, a)` such that all guards of `t` evaluated to `true`, and `t` is the first such candidate in declaration order.

### P3 — Failure characterization

If `dispatch(a, p)` returns `false`, then either:

- `candidates(sₙ, a)` is empty, or
- for every `t ∈ candidates(sₙ, a)`, at least one guard of `t` evaluated to `false`.

### P4 — Reachability safety

If the machine starts in state `s₀ ∈ S`, and every transition rule has `target ∈ S`, then every reachable state belongs to `S`. (This is an invariant of well-formed machine definitions.)

### P5 — Action validity

Unknown actions are rejected (by throwing) before any transition lookup or guard evaluation occurs.

### P6 — Transition-expansion correctness

For any `sources = [s₁, …, sₘ]`, `targets = [t₁, …, tₙ]`, `action a`, `guards gs`, and `reducer r`: the candidate lists produced by the expanded transition rules are identical to those that would result from explicitly declaring each `(sᵢ, a, tⱼ, gs, r)` individually in the same row-major order.

### P7 — Context initialization (optional)

Each call to `interpret(M)` produces an independent initial context by invoking `C₀()` exactly once.

### P8 — Lookup abstraction (optional)

Any transition lookup function that, given `(s, a)`, returns exactly `candidates(s, a)` in declaration order is a correct implementation of the semantic candidate lookup — regardless of the indexing strategy used.

### P9 — Context isolation

A lifted child reducer updates only the child context slice. Projecting the compound context through the child lens after applying a lifted reducer yields the same result as applying the original child reducer to the projected child context. Independent projections (parent context, sibling context) are unchanged.

### P10 — Merge well-formedness

If parent and child state sets are individually unique (nodup) and mutually disjoint, the merged state set is unique. Action sets must be disjoint across composed siblings; parent/child action overlap with compatible payloads is deduplicated (`parent ++ filter (∉ parent) child`) and the merged action set remains unique. Both the disjoint merge and the dedup merge preserve nodup, and every action from both inputs is present in the merged result. If all child transitions reference states in the child state set, all lifted child transitions reference states in the merged state set.

### P11 — Group-name exclusion

If the group name is absent from both parent and child state sets, it is absent from the merged state set. The group name is a context key only and never appears as a runtime state.

### P12 — Dispatch preservation through composition

Candidate selection on lifted transitions with compound context produces the same result as candidate selection on original child transitions with the projected child context. Guard evaluation commutes with lifting. This ensures dispatch semantics are preserved exactly through composition.

### P13 — Flattening associativity

Lifting through a composed lens (outer ∘ inner) equals lifting twice (inner then outer). Merging parent with an already-merged child produces the same transition list as merging all three levels at once. Nested composition is therefore associative.

### P14 — Selected-step replay equivalence

If ordinary dispatch succeeds with selected transition `t`, action record `a`, and post-snapshot `snap'`, then `applySelected(preSnap, { transition = t, action = a }) = snap'`. That is, applying a selected step to the pre-dispatch snapshot produces the same result as the dispatch itself (excluding subscriber notification).

### P15 — Draft trace invariant

For every open draft handle, `currentSnapshot = replayTrace(baseSnapshot, trace)`. This holds after draft creation (empty trace) and is preserved by every successful `draft.do(...)`.

### P16 — Root commit replay soundness

If a root draft is open and the parent service cursor still equals `baseCursor`, then commit produces a live service snapshot equal to the draft's `currentSnapshot`.

The Lean theorem additionally requires `svc.snapshot = d.baseSnapshot` as an explicit hypothesis, because the semantic model does not formalize the runtime lifecycle invariant that cursor equality implies snapshot equality (see §10).

The specification also states that commit "emits the same ordered change sequence as replaying the trace step by step." The subscription notification ordering aspect of this claim is outside the scope of the current Lean formalization (see §10). The snapshot equality result is the core semantic content; the notification ordering follows from the runtime implementation structure.

### P17 — Child commit append soundness

If a child draft commits against an unchanged open parent draft, then the parent draft trace becomes `oldParentTrace ++ childTrace`, and the parent draft snapshot becomes the child draft snapshot. The Lean formalization proves both claims via a unified `commitChildDraft` operation that combines cursor gate and trace merge, parallel to the root `commitRootDraft`.

### P18 — Stale commit rejection

If parent cursor differs from `baseCursor`, commit rejects with `DraftOutOfDate` and leaves the parent unchanged. This is proved for both root drafts (`commitRootDraft`) and nested drafts (`commitChildDraft`).

### P19 — Draft failure preservation

Draft `do(...)` preserves the same failure cases as ordinary dispatch: unknown action throws, no candidate returns `false`, all guards failing returns `false`. The Lean formalization proves failure characterization and unknown-action rejection by direct delegation to the existing dispatch theorems (P3, P5). The claim that "unsuccessful calls do not extend the trace" is an operational property of the runtime dispatch path — in the pure semantic model, `appendStep` is called only after successful dispatch, so non-extension is structural rather than a separate theorem.

### P20 — Ancestor closure safety

If any ancestor draft in a chain is closed, the chain is not all-open and the draft is not operational. The Lean formalization proves this as a pure predicate over ancestor closed-flag lists (`ancestorsAllOpen`). The specific runtime error type (`DraftClosed`) and integration with draft operation signatures are runtime-level concerns outside the semantic model (see §10).

## 10 — Out of scope for the current proof work

The following are explicitly excluded from Lean formalization:

- Guard side effects and non-deterministic guard behavior.
- Reducer correctness beyond type-level return (reducers are opaque functions).
- Subscription ordering guarantees relative to external events.
- Object identity, allocation, and memory reuse semantics.
- TypeScript type-level inference and staged builder typing.
- Performance characteristics (latency, allocation counts).
- Concurrent or re-entrant dispatch (the model assumes sequential dispatch).
- Context cloning algorithms and object identity preservation on draft creation and commit.
- Runtime materialization strategy for parent-context updates on commit.
- Subscription notification ordering during root draft commit replay (P16). The snapshot equality result is proved; the notification sequence follows from the runtime implementation.
- Runtime lifecycle invariant connecting cursor equality to snapshot equality (P16). The Lean model takes `svc.snapshot = d.baseSnapshot` as an explicit hypothesis; the runtime guarantees this because every state change increments the cursor.
- Trace non-extension on dispatch failure (P19). In the pure model, `appendStep` is called only after successful dispatch, making non-extension structural rather than a theorem.
- Draft error-type semantics: `DraftClosed` and `DraftOutOfDate` as specific error constructors (P18, P20). The Lean model uses `outOfDate` result constructors and a chain predicate; the mapping to runtime error types is straightforward.

## 11 — Composition semantics

Composition is an authoring-time operation that merges a child machine into a parent machine. The result is a flat machine definition conforming to the same model described in §1–§2. No runtime hierarchy exists after composition.

### 11.1 — Composition operation

Given a parent machine `P` and a child machine `M_child`:

```
compose(group, M_child)
```

where `group` is an identifier that:

- is not a member of `P.S` (not an existing parent state),
- is not the name of a previously composed group,
- is not a member of any previously composed child's state set.

The child machine `M_child` must have declared states and actions but does **not** require an initial state (`s₀`). An initial state is required only for standalone interpretation via `interpret(M)`.

### 11.2 — Group names

Group names are **context keys only**. A group name:

- identifies the child context slice within the compound context,
- is never added to the merged state set `S`,
- is not a valid transition target.

Transitions must target explicit child states, not group names.

### 11.3 — State and action merging

The composed machine merges parent and child identifiers:

- `S_composed = S_parent ∪ S_child` — state sets are concatenated. States must be disjoint across parent and all children.
- `A_composed = A_parent ∪ A_child` — action sets are concatenated. Actions must be disjoint across composed siblings. Parent-declared actions that overlap a child's actions are deduplicated on merge, provided their payload types are compatible; incompatible payload overlap is rejected at the type level.

### 11.4 — Transition merging

Child transitions are lifted to operate on the compound context and appended after parent transitions:

```
T_composed = T_parent ++ lift(lens, T_child)
```

where `lift(lens, t)` preserves the source, action, and target of each child transition rule while lifting guards and reducers through a context lens (§11.5).

The merged transition list follows the same ordered-candidate semantics defined in §1.5 and §2.3. Parent transitions appear before child transitions in candidate order.

### 11.5 — Context lens

A **context lens** is a pair of functions `(get, set)` satisfying the standard lens laws:

- `get(set(c, x)) = x` — reading after writing yields the written value.
- `set(c, get(c)) = c` — writing back the current value is a no-op.

The lens projects the child context slice from the compound context. Guards and reducers are lifted through it:

- **Guard lifting**: `liftGuard(lens, g) = (ctx, info) → g(lens.get(ctx), info)`.
- **Reducer lifting**: `liftReducer(lens, r) = (ctx, info) → lens.set(ctx, r(lens.get(ctx), info))`.

### 11.6 — Compound context

The compound context is constructed from the parent's own context and each child's context, keyed by group name:

```
C_compound = C_parent & { [group₁]: C_child₁, [group₂]: C_child₂, … }
```

The compound context factory calls the parent factory and each child's factory once per interpretation, producing an independent compound context for each instance.

Build order does not affect the resulting compound context: `context(...).compose(...)` and `compose(...).context(...)` produce equivalent definitions.

### 11.7 — Composition diagnostics

| Condition                                                    | Error                                                      |
| ------------------------------------------------------------ | ---------------------------------------------------------- |
| Child is not a machine definition                            | "Parameter is not a state machine."                        |
| Group name is an existing state or existing group            | "Group already exists or conflicts with a declared state." |
| Child state overlaps parent or sibling state                 | "State already exists."                                    |
| Child action overlaps a previously composed sibling's action | "Action … overlaps a previously composed child action."    |

### 11.8 — Nested composition

Composition may be applied recursively: a child machine may itself be a composed machine. The resulting flattened machine is equivalent regardless of nesting depth, because transition lifting through composed lenses is associative (P13).

### 11.9 — Post-composition semantics

After composition, the resulting flat machine follows the dispatch semantics of §2 without modification. There is no runtime awareness of composition boundaries, parent–child relationships, or group names beyond the context structure.

## 12 — Lean proof files

The Lean proof files in `lean/` (leanprover/lean4:v4.27.0) encode and verify the semantic properties listed in §9.

| File                        | Content                                                                                                                                                  | Properties    |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| `Defs.lean`                 | Core types: ActionInfo, TransitionRule, Machine, DispatchResult                                                                                          | —             |
| `Dispatch.lean`             | Functions (mkActionInfo, allGuardsPass, selectCandidate, candidates, dispatch) + helper lemmas                                                           | —             |
| `Determinism.lean`          | dispatch_deterministic, selectCandidate_deterministic                                                                                                    | P1            |
| `Soundness.lean`            | Success soundness (candidate membership, guard success, source/action/target agreement, ordered-selection minimality); dispatch_failure_characterization | P2, P3        |
| `Reachability.lean`         | reachable_mem_states, dispatch_success_target_mem_states                                                                                                 | P4            |
| `Validity.lean`             | unknown_action_rejected, dispatch_unknownAction_iff                                                                                                      | P5            |
| `Expansion.lean`            | Candidate-list correctness for Cartesian expansion under `sources.Nodup`                                                                                 | P6            |
| `Compose.lean`              | CtxLens, liftGuard, liftReducer, liftTransition, mergeTransitions; guard/candidate/selectCandidate commutativity with lifting                            | P9, P12       |
| `ComposeSoundness.lean`     | Context isolation (child slice + other slices), merge well-formedness (nodup, transition wf, dedup merge), group-name exclusion                          | P9, P10, P11  |
| `ComposeAssociativity.lean` | composeLens, lifting/merging associativity                                                                                                               | P13           |
| `Replay.lean`               | Snapshot, SelectedStep, applySelected, replayTrace, replayTrace_append; selected-step replay equivalence                                                 | P14           |
| `DraftDefs.lean`            | ServiceState, DraftHandle, currentSnapshot, headCursor, mkRootDraft, appendStep, commitRootDraft                                                         | —             |
| `Draft.lean`                | Draft trace invariant, draft failure preservation, stale commit rejection (root)                                                                         | P15, P18, P19 |
| `DraftCommit.lean`          | Root commit replay soundness (snapshot equality), empty-trace commit, fresh-draft commit                                                                 | P16           |
| `DraftNested.lean`          | mkChildDraft, mergeChildTrace, commitChildDraft; child commit append soundness, stale child rejection, ancestor closure safety                           | P17, P18, P20 |

### Proof invariants

- All files compile cleanly (`lake build` exits 0).
- Zero sorries.
- Standard axioms only: all declarations use only `propext` and `Quot.sound`.
- Proof scope is limited to semantic behavior; no dependency on JavaScript allocation or object identity.
