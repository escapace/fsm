# @escapace/fsm

Flat extended finite state machines in TypeScript with a typed builder, declaration-order transition selection, and isolated drafts for speculative execution.
It fits event-driven logic with one explicit current state, one explicit context value, and predictable dispatch rules.

## Installation

Install the package and its peer dependencies:

```bash
pnpm add @escapace/fsm coastal @escapace/typelevel
```

## Quick start

```ts
import { interpret, stateMachine } from '@escapace/fsm'

type Coin = 5 | 10 | 25 | 50

enum State {
  Locked = 'LOCKED',
  Unlocked = 'UNLOCKED',
}

enum Action {
  Coin = 'COIN',
  Push = 'PUSH',
}

const machine = stateMachine()
  .state(State.Locked)
  .state(State.Unlocked)
  .initial(State.Locked)
  .action<Action.Coin, { amount: Coin }>(Action.Coin)
  .action(Action.Push)
  .context(() => ({ balance: 0 }))
  .transition(
    State.Locked,
    [Action.Coin, (context, action) => context.balance + action.payload.amount >= 50],
    State.Unlocked,
    (context, action) => ({ balance: context.balance + action.payload.amount - 50 }),
  )
  .transition(State.Locked, Action.Coin, State.Locked, (context, action) => ({
    balance: context.balance + action.payload.amount,
  }))
  .transition(State.Unlocked, Action.Coin, State.Unlocked)
  .transition(State.Unlocked, Action.Push, State.Locked, () => ({ balance: 0 }))

const service = interpret(machine)

service.do(Action.Coin, { amount: 25 }) // true
console.log(service.state) // 'LOCKED'
console.log(service.context) // { balance: 25 }

service.do(Action.Push) // false
console.log(service.state) // 'LOCKED'

service.do(Action.Coin, { amount: 25 }) // true
console.log(service.state) // 'UNLOCKED'
console.log(service.context) // { balance: 0 }
```

A machine definition declares states, actions, an initial state, an optional context factory, and transitions. `interpret(...)` turns that definition into a runnable service.

## Core model

A running service exposes `state`, `context`, `do(action, payload?)`, `draft()`, and `subscribe(callback)`.

Standalone interpretation requires an initial state. Composition does not add runtime hierarchy; after `.compose(...)` the machine is still flat.

## Outcome model

Most valid operations report ordinary outcomes through return values instead of exceptions.

- `service.do(...)` and `draft.do(...)` return `true` on a selected transition and `false` when a valid dispatch does not select one
- `subscribe(...)` returns an unsubscribe function
- `draft.commit()` and `draft.discard()` return normally on success, including an empty-trace commit
- thrown `StateMachineError` values indicate invalid definitions, undeclared actions, unsupported draft snapshots, closed drafts, or stale draft commits

A `false` dispatch always means the machine did not advance. State, context, and subscriptions remain unchanged.

This split keeps no-op machine outcomes ordinary and reserves exceptions for calls that fall outside the declared machine contract or the current draft lifecycle state.

## Dispatch

For valid dispatches, transition selection follows one rule set:

- candidates are selected by current state and dispatched action
- candidates are tried in declaration order
- guards inside one candidate run left to right and stop at the first `false`
- the first candidate whose guards all pass is selected
- only the selected candidate's reducer runs

Source and target arrays in `.transition(...)` expand as the Cartesian product of sources and targets.

Subscriptions observe successful live transitions only. Callbacks receive post-transition `state`, `context`, and `action`. Identical callback functions are deduplicated. The change object is reused across notifications, so retained values should be copied inside the callback.

## Context correlated with state

This is primarily a type-level ergonomics feature.

When context is a union discriminated by `state`, guards narrow to source-state variants, reducers narrow from source state to target state, and subscription changes narrow to the transition result. In practice that removes most manual casts and turns wrong target variants into type errors.

The runtime layer is smaller. It validates the initial context discriminant at `interpret(...)` time and keeps `context.state` synchronized after successful live dispatch, draft replay, and composed child updates.

```ts
enum PinInputState {
  Idle = 'IDLE',
  Focused = 'FOCUSED',
  Completed = 'COMPLETED',
  Error = 'ERROR',
}

enum PinInputAction {
  Focus = 'FOCUS',
  Input = 'INPUT',
}

type PinInputContext =
  | { state: PinInputState.Idle; focusedIndex: -1; values: string[] }
  | { state: PinInputState.Focused; focusedIndex: number; values: string[] }
  | { state: PinInputState.Completed; focusedIndex: number; values: string[] }
  | {
      state: PinInputState.Error
      error: string
      focusedIndex: number
      values: string[]
    }

const machine = stateMachine()
  .state(PinInputState.Idle)
  .state(PinInputState.Focused)
  .state(PinInputState.Completed)
  .state(PinInputState.Error)
  .initial(PinInputState.Idle)
  .action<PinInputAction.Focus, { index: number }>(PinInputAction.Focus)
  .action<PinInputAction.Input, { index: number; value: string }>(PinInputAction.Input)
  .context<PinInputContext>(() => ({
    focusedIndex: -1 as const,
    state: PinInputState.Idle as const,
    values: ['', '', '', ''],
  }))
  .transition(
    PinInputState.Idle,
    PinInputAction.Focus,
    PinInputState.Focused,
    (context, action) => ({
      focusedIndex: action.payload.index,
      state: PinInputState.Focused as const,
      values: context.values,
    }),
  )
  .transition(
    PinInputState.Focused,
    [PinInputAction.Input, (_context, action) => /^\d$/.test(action.payload.value)],
    PinInputState.Completed,
    (context, action) => ({
      focusedIndex: action.payload.index,
      state: PinInputState.Completed as const,
      values: context.values.map((entry, index) =>
        index === action.payload.index ? action.payload.value : entry,
      ),
    }),
  )
  .transition(
    PinInputState.Focused,
    [PinInputAction.Input, (_context, action) => !/^\d$/.test(action.payload.value)],
    PinInputState.Error,
    (context, action) => ({
      error: `Invalid numeric input: ${action.payload.value}`,
      focusedIndex: context.focusedIndex,
      state: PinInputState.Error as const,
      values: context.values,
    }),
  )
```

The example is abridged, but it shows the main rules:

- reducer input narrows by source state and reducer output narrows by target state
- returning the wrong variant for a target state is a type error
- subscription changes keep `change.state`, `change.action.target`, and `change.context` aligned to the same transition result
- `change.state` and `change.action.target` are the stable discriminators when one action can reach multiple targets
- `interpret(...)` validates that an initial context discriminant matches the machine initial state
- successful transitions synchronize `context.state`
- automatic synchronization updates only the `state` discriminant field; every other field remains reducer-defined

For enum-based states, the context discriminant should use enum member types rather than raw string literals.

Flat object contexts and primitive contexts remain valid. When no `state` field exists, runtime state injection is skipped.

## Drafts

`service.draft()` creates an isolated draft handle from the current live snapshot. `draft.do(...)` uses the same action validation, candidate selection, guard evaluation, and reducer semantics as live dispatch, but successful steps stay private until commit.

Draft behavior:

- `draft.do(...)` returns `true`, `false`, or throws for the same reasons as service dispatch
- a `false` draft dispatch leaves the draft snapshot unchanged
- draft execution never notifies subscribers before commit
- `draft.discard()` closes the handle and drops speculative work
- `draft.draft()` creates a nested draft from the current draft snapshot
- child `commit()` merges into the parent draft only and reconciles into the existing parent draft context when possible
- root `commit()` replays successful draft steps onto the live service in order and reconciles into the existing live context when possible
- root commit notifies subscribers once per replayed step
- empty-trace `commit()` is a no-op that still closes the draft
- after `commit()` or `discard()`, mutating draft methods throw `DraftClosed`
- stale commits are rejected with `DraftOutOfDate`
- drafts do not expose `subscribe(...)`

Draft snapshots support primitives, arrays, ordinary objects, `Date`, `Map`, `Set`, `ArrayBuffer`, `DataView`, typed arrays, cycles, and shared references. Unsupported values such as functions fail at draft creation with `DraftContextCloneFailed`.

## Composition

`.compose(group, child)` merges a child machine into the parent definition while mounting child context under `context[group]`.

Composition stays flat at runtime.

- group names are reserved context keys only
- group names are not states and cannot be transition targets
- parent and child states must be disjoint
- composed siblings cannot share action names
- a parent and child may share an action name when payload types are compatible
- child guards and reducers operate on the child context slice only
- parent and sibling context slices are preserved during child updates
- parent context factories must not define keys that collide with composed group names
- `.context(...).compose(...)` and `.compose(...).context(...)` produce the same compound context shape
- a child used only through composition may omit its own initial state when transitions target explicit child states

## `reconcileContext(...)`

Reducers may mutate and return the current context value or return a fresh one.

On direct live root dispatch, a fresh reducer result becomes `service.context` directly. Draft commit and composed child updates use `reconcileContext(parentContext, nextContext)` instead. That path reconciles into the existing parent or live context graph when possible rather than blindly replacing the whole value.

For ordinary mutable object surfaces, reconciliation preserves compatible subtree identity where possible while rebuilding the result to match the next graph. That includes next-key order, sparse-array holes, cycles, shared-reference topology, and compatible `Date`, `Map`, `Set`, `ArrayBuffer`, `DataView`, and typed-array instances in place.

When either side is not object-like, reconciliation returns `nextContext`.

Plain-object reconciliation does not preserve arbitrary property-descriptor behavior such as accessors, non-enumerability, or non-configurable retained properties. Publication also does not eagerly validate that the resulting graph stays snapshot-safe for future drafts.

## Errors

All thrown errors are `StateMachineError` instances. The human-readable message is paired with a structured `cause.type` that can be inspected programmatically.

| Error                        | Raised when                                                                                                                    |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `ActionExists`               | `.action(...)` declares an action that already exists in the current machine.                                                  |
| `ActionOverlap`              | `.compose(...)` introduces an action already used by a previously composed sibling.                                            |
| `ActionUnknown`              | a transition references an undeclared action, or `do(...)` / `draft.do(...)` dispatches an undeclared action.                  |
| `ContextFactoryRequired`     | a context initializer is not a nullary function.                                                                               |
| `ContextFactoryStateInvalid` | the initial context has a `state` discriminant that does not match the machine initial state.                                  |
| `ContextGroupConflict`       | a parent context factory returns an own key that collides with a composed group name.                                          |
| `DraftClosed`                | `do(...)`, `draft()`, `commit()`, or `discard()` is called on a closed draft or below a closed ancestor.                       |
| `DraftContextCloneFailed`    | `draft()` cannot snapshot the current context, usually because it contains unsupported values such as functions.               |
| `DraftOutOfDate`             | `commit()` runs after the live service or parent draft has advanced since draft creation.                                      |
| `GroupExists`                | `.compose(group, child)` reuses a group name, collides with a declared state, or uses a group name that matches a child state. |
| `NotStateMachine`            | `interpret(...)` or `.compose(...)` receives a value that is not a state machine definition.                                   |
| `StateExists`                | `.state(...)` declares a state that already exists, or `.compose(...)` introduces a child state that already exists.           |
| `StateUnknown`               | `.initial(...)` or `.transition(...)` references a state that has not been declared.                                           |

The package also exports `isStateMachineError(...)`, `isStateMachineErrorOfType(...)`, and `STATE_MACHINE_ERROR_TYPES`.

## Limits

A few boundaries are deliberate:

- `false` from `do(...)` conflates two cases: no transition for `(state, action)` and matching transitions whose guards all fail
- the service type does not narrow itself to the current runtime state; action availability remains a runtime question
- drafts snapshot context at creation time; unsupported values fail there, not at machine definition time
- the library stays flat at runtime and does not implement hierarchy, parallel regions, or history semantics

## Performance

`@escapace/fsm` shows about 11.5x higher throughput than `@xstate/fsm` in the repository’s representative benchmark (guarded transitions with immutable context updates), while a handwritten baseline is about 7.7x faster than `@escapace/fsm`, indicating the remaining abstraction cost versus direct state updates. These figures come from microbenchmarks run in tight loops in a controlled single-process setup, so they measure transition-dispatch overhead rather than end-to-end application latency.
