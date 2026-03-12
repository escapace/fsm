# Semantic specification

## Purpose

This document defines the semantics of the flat extended finite state machine (EFSM) implemented by `@escapace/fsm` in language-independent terms. A reader should be able to determine the outcome of any dispatch without consulting TypeScript source code. The specification is precise enough to encode directly in Lean 4.

## Scope

This specification covers the **semantic model** — the observable behavior of machine definition, composition, and dispatch. It deliberately excludes:

- paired-key (Szudzik) indexing used for transition lookup at runtime,
- mutable builder internals and builder action log,
- pre-allocated object reuse in the interpreter,
- TypeScript type-level encoding and staged builder types,
- subscription object identity and allocation strategy,
- `Symbol`-keyed internal properties.

These are implementation details. The proofs target the semantic layer only.

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
- `C₀` is the **initial context**, either a value or a nullary factory function. When `C₀` is a function, it is called exactly once per interpretation to produce the initial context value.
- `s₀ ∈ S` is the **initial state**. Required for standalone interpretation; may be absent in a child machine used only through composition (§9.1).
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

## 4 — Context initialization

### 4.1 — Value initialization

If `C₀` is not a function, the initial context of each machine instance is `C₀` directly. Multiple instances share the same reference.

### 4.2 — Factory initialization

If `C₀` is a function (nullary), the initial context of each machine instance is the return value of `C₀()`. The factory is called exactly once per `interpret(M)` call, producing an independent context for each instance.

## 5 — Definition-time errors

These errors are raised during machine construction (builder calls), not during dispatch:

| Condition                                                                           | Error                                                      |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Adding a state identifier already in `S`                                            | "State already exists."                                    |
| Adding an action identifier already in `A`                                          | "Action already exists."                                   |
| Setting initial state to an identifier not in `S`                                   | "No such state."                                           |
| Referencing a source or target state not in `S` in a transition                     | "No such state."                                           |
| Referencing an action not in `A` in a transition                                    | "No such action."                                          |
| Calling `interpret` on a value that is not a machine definition                     | "Parameter is not a state machine."                        |
| Composing with a group name that is an existing state or group                      | "Group already exists or conflicts with a declared state." |
| Composing with a child whose state names overlap parent or sibling states           | "State already exists."                                    |
| Composing with a child whose action overlaps a previously composed sibling's action | "Action … overlaps a previously composed child action."    |
| Composing with a value that is not a machine definition                             | "Parameter is not a state machine."                        |

## 6 — Dispatch-time errors

| Condition                   | Behavior                            |
| --------------------------- | ----------------------------------- |
| Action `a ∉ A`              | Throws "No such action."            |
| No candidates for `(sₙ, a)` | Returns `false`                     |
| All candidate guards fail   | Returns `false`                     |
| A candidate is selected     | Executes transition, returns `true` |

## 7 — Properties for Lean verification

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

When `C₀` is a factory function, each call to `interpret(M)` produces an independent initial context. When `C₀` is a value, all instances share the same initial reference.

### P8 — Lookup abstraction (optional)

Any transition lookup function that, given `(s, a)`, returns exactly `candidates(s, a)` in declaration order is a correct implementation of the semantic candidate lookup — regardless of the indexing strategy used.

### P9 — Context isolation

A lifted child reducer updates only the child context slice. Projecting the compound context through the child lens after applying a lifted reducer yields the same result as applying the original child reducer to the projected child context. Independent projections (parent context, sibling context) are unchanged.

### P10 — Merge well-formedness

If parent and child state sets are individually unique (nodup) and mutually disjoint, the merged state set is unique. Action sets must be disjoint across composed siblings; parent/child action overlap with compatible payloads is deduplicated so the merged action set remains unique. If all child transitions reference states in the child state set, all lifted child transitions reference states in the merged state set.

### P11 — Group-name exclusion

If the group name is absent from both parent and child state sets, it is absent from the merged state set. The group name is a context key only and never appears as a runtime state.

### P12 — Dispatch preservation through composition

Candidate selection on lifted transitions with compound context produces the same result as candidate selection on original child transitions with the projected child context. Guard evaluation commutes with lifting. This ensures dispatch semantics are preserved exactly through composition.

### P13 — Flattening associativity

Lifting through a composed lens (outer ∘ inner) equals lifting twice (inner then outer). Merging parent with an already-merged child produces the same transition list as merging all three levels at once. Nested composition is therefore associative.

## 8 — Out of scope for the current proof work

The following are explicitly excluded from Lean formalization:

- Guard side effects and non-deterministic guard behavior.
- Reducer correctness beyond type-level return (reducers are opaque functions).
- Subscription ordering guarantees relative to external events.
- Object identity, allocation, and memory reuse semantics.
- TypeScript type-level inference and staged builder typing.
- Performance characteristics (latency, allocation counts).
- Concurrent or re-entrant dispatch (the model assumes sequential dispatch).

## 9 — Composition semantics

Composition is an authoring-time operation that merges a child machine into a parent machine. The result is a flat machine definition conforming to the same model described in §1–§2. No runtime hierarchy exists after composition.

### 9.1 — Composition operation

Given a parent machine `P` and a child machine `M_child`:

```
compose(group, M_child)
```

where `group` is an identifier that:

- is not a member of `P.S` (not an existing parent state),
- is not the name of a previously composed group,
- is not a member of any previously composed child's state set.

The child machine `M_child` must have declared states and actions but does **not** require an initial state (`s₀`). An initial state is required only for standalone interpretation via `interpret(M)`.

### 9.2 — Group names

Group names are **context keys only**. A group name:

- identifies the child context slice within the compound context,
- is never added to the merged state set `S`,
- is not a valid transition target.

Transitions must target explicit child states, not group names.

### 9.3 — State and action merging

The composed machine merges parent and child identifiers:

- `S_composed = S_parent ∪ S_child` — state sets are concatenated. States must be disjoint across parent and all children.
- `A_composed = A_parent ∪ A_child` — action sets are concatenated. Actions must be disjoint across composed siblings. Parent-declared actions that overlap a child's actions are deduplicated on merge, provided their payload types are compatible; incompatible payload overlap is rejected at the type level.

### 9.4 — Transition merging

Child transitions are lifted to operate on the compound context and appended after parent transitions:

```
T_composed = T_parent ++ lift(lens, T_child)
```

where `lift(lens, t)` preserves the source, action, and target of each child transition rule while lifting guards and reducers through a context lens (§9.5).

The merged transition list follows the same ordered-candidate semantics defined in §1.5 and §2.3. Parent transitions appear before child transitions in candidate order.

### 9.5 — Context lens

A **context lens** is a pair of functions `(get, set)` satisfying the standard lens laws:

- `get(set(c, x)) = x` — reading after writing yields the written value.
- `set(c, get(c)) = c` — writing back the current value is a no-op.

The lens projects the child context slice from the compound context. Guards and reducers are lifted through it:

- **Guard lifting**: `liftGuard(lens, g) = (ctx, info) → g(lens.get(ctx), info)`.
- **Reducer lifting**: `liftReducer(lens, r) = (ctx, info) → lens.set(ctx, r(lens.get(ctx), info))`.

### 9.6 — Compound context

The compound context is constructed from the parent's own context and each child's context, keyed by group name:

```
C_compound = C_parent & { [group₁]: C_child₁, [group₂]: C_child₂, … }
```

When the parent context is a factory function, the compound context factory calls the parent factory and each child's factory (or value) once per interpretation, producing an independent compound context for each instance.

Build order does not affect the resulting compound context: `context(...).compose(...)` and `compose(...).context(...)` produce equivalent definitions.

### 9.7 — Composition diagnostics

| Condition                                                    | Error                                                      |
| ------------------------------------------------------------ | ---------------------------------------------------------- |
| Child is not a machine definition                            | "Parameter is not a state machine."                        |
| Group name is an existing state or existing group            | "Group already exists or conflicts with a declared state." |
| Child state overlaps parent or sibling state                 | "State already exists."                                    |
| Child action overlaps a previously composed sibling's action | "Action … overlaps a previously composed child action."    |

### 9.8 — Nested composition

Composition may be applied recursively: a child machine may itself be a composed machine. The resulting flattened machine is equivalent regardless of nesting depth, because transition lifting through composed lenses is associative (P13).

### 9.9 — Post-composition semantics

After composition, the resulting flat machine follows the dispatch semantics of §2 without modification. There is no runtime awareness of composition boundaries, parent–child relationships, or group names beyond the context structure.

## 10 — Lean proof files

The Lean proof files in `lean/` (leanprover/lean4:v4.27.0) encode and verify the semantic properties listed in §7.

| File                        | Content                                                                                                                                                  | Properties   |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| `Defs.lean`                 | Core types: ActionInfo, TransitionRule, Machine, DispatchResult                                                                                          | —            |
| `Dispatch.lean`             | Functions (mkActionInfo, allGuardsPass, selectCandidate, candidates, dispatch) + helper lemmas                                                           | —            |
| `Determinism.lean`          | dispatch_deterministic, selectCandidate_deterministic                                                                                                    | P1           |
| `Soundness.lean`            | Success soundness (candidate membership, guard success, source/action/target agreement, ordered-selection minimality); dispatch_failure_characterization | P2, P3       |
| `Reachability.lean`         | reachable_mem_states, dispatch_success_target_mem_states                                                                                                 | P4           |
| `Validity.lean`             | unknown_action_rejected, dispatch_unknownAction_iff                                                                                                      | P5           |
| `Expansion.lean`            | Candidate-list correctness for Cartesian expansion under `sources.Nodup`                                                                                 | P6           |
| `Compose.lean`              | CtxLens, liftGuard, liftReducer, liftTransition, mergeTransitions; guard/candidate/selectCandidate commutativity with lifting                            | P9, P12      |
| `ComposeSoundness.lean`     | Context isolation (child slice + other slices), merge well-formedness (nodup, transition wf), group-name exclusion                                       | P9, P10, P11 |
| `ComposeAssociativity.lean` | composeLens, lifting/merging associativity                                                                                                               | P13          |

### Proof invariants

- All files compile cleanly (`lake build` exits 0).
- Zero sorries.
- Standard axioms only: all declarations use only `propext` and `Quot.sound`.
- Proof scope is limited to semantic behavior; no dependency on JavaScript allocation or object identity.
