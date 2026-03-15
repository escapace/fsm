# @escapace/fsm

Flat extended finite state machines for event-driven application logic in TypeScript, with builder composition. A typed builder API keeps states, actions, and payloads explicit, with payload types flowing through dispatch, guards, reducers, and subscriptions. Optimistic drafts provide isolated speculative execution with explicit commit/discard.

## Installation

```bash
pnpm add @escapace/fsm
```

## Example

```typescript
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
  .action<Action.Coin, { coin: Coin }>(Action.Coin)
  .action(Action.Push)
  .context<{ total: number }>(() => ({ total: 0 }))
  .transition(
    State.Locked,
    [Action.Coin, (context, action) => context.total + action.payload.coin >= 50],
    State.Unlocked,
    (context, action) => {
      context.total += action.payload.coin
      return context
    },
  )
  .transition(State.Locked, Action.Coin, State.Locked, (context, action) => {
    context.total += action.payload.coin
    return context
  })
  .transition(State.Unlocked, Action.Coin, State.Unlocked)
  .transition([State.Locked, State.Unlocked], Action.Push, State.Locked, (context) => {
    context.total = 0
    return context
  })

const turnstile = interpret(machine)

turnstile.do(Action.Coin, { coin: 25 })
console.log(turnstile.state) // 'LOCKED'

turnstile.do(Action.Coin, { coin: 25 })
console.log(turnstile.state) // 'UNLOCKED'

turnstile.do(Action.Push)
console.log(turnstile.state) // 'LOCKED'
```

## What the library guarantees

The repository treats these behaviors as the user-facing semantic contract:

- states and actions must be declared before they are used,
- candidate transitions are selected by current state and dispatched action,
- candidate transitions are evaluated in declaration order,
- guards are evaluated in order and stop at the first failure,
- the first transition whose guards all pass is selected,
- reducers run only after a transition has been selected,
- subscribers are notified only after successful live transitions,
- `service.draft()` captures an isolated snapshot of state and context,
- `draft.do(...)` uses the same action validation, candidate selection, guard evaluation, and reducer semantics as service dispatch,
- successful draft execution remains private until commit,
- root draft commit replays successful draft steps onto the live service in order and notifies subscribers per replayed step,
- child draft commit updates the parent draft only and does not notify subscribers,
- source and target arrays in `.transition(...)` expand as the Cartesian product of sources and targets,
- `.compose(group, child)` merges child states/actions/transitions into the same flat machine,
- states must be disjoint across parent and all children; actions must be disjoint across composed siblings,
- group names are reserved context keys for child slices only; parent context factories must not return the same keys, and transitions target explicit state identifiers.

## Dispatch behavior

`interpret(machine)` returns a service with:

- `state` — current state
- `context` — current context
- `do(action, payload?)` — dispatches an action
- `draft()` — creates an isolated draft handle
- `subscribe(callback)` — observes successful transitions

### `do(action, payload?)`

`do(...)` has three outcomes:

- it returns `true` when a transition is selected and executed,
- it returns `false` when no transition exists for the current state and action,
- it returns `false` when transitions exist but all guards fail,
- it throws when the action is not declared in the machine.

Example:

```typescript
const machine = stateMachine()
  .state('idle')
  .state('working')
  .initial('idle')
  .action('start')
  .action('stop')
  .transition('idle', 'start', 'working')

const service = interpret(machine)

service.do('start') // true
console.log(service.state) // 'working'

service.do('stop') // false
console.log(service.state) // 'working'
```

## Drafts

`service.draft()` creates an isolated draft handle from the current live snapshot. `draft.do(...)` applies the same dispatch semantics as `service.do(...)`, but keeps state and context changes private until commit.

```typescript
const machine = stateMachine()
  .state('idle')
  .state('working')
  .state('done')
  .initial('idle')
  .action('start')
  .action('finish')
  .context(() => ({ steps: 0 }))
  .transition('idle', 'start', 'working', (context) => ({ steps: context.steps + 1 }))
  .transition('working', 'finish', 'done', (context) => ({ steps: context.steps + 1 }))

const service = interpret(machine)
const draft = service.draft()

draft.do('start')
console.log(service.state) // 'idle'
console.log(draft.state) // 'working'

draft.commit()
console.log(service.state) // 'working'
console.log(service.context) // { steps: 1 }
```

Draft behavior:

- `draft.do(action, payload?)` returns `true` on a selected transition, returns `false` on the same two failure cases as service dispatch, and throws for undeclared actions,
- `draft.discard()` closes the handle and drops speculative work,
- `draft.draft()` creates a nested draft from the current draft snapshot,
- child `commit()` merges into the parent draft only; root `commit()` replays successful draft steps onto the live service in order,
- draft publication reconciles into the existing parent or live context instead of blindly replacing the whole value; ordinary mutable object and array subtrees preserve next-key order, sparse-array holes, cycles, and shared-reference structure, compatible collection and binary values are updated in place, and only incompatible subtrees are replaced; plain-object reconciliation does not guarantee preservation of arbitrary property-descriptor semantics such as non-enumerability, accessors, or non-configurable retained properties,
- subscribers are notified only for successful live transitions and root draft replay,
- `commit()` throws `DraftOutOfDate` when the parent has advanced since draft creation,
- after `commit()` or `discard()`, mutating draft methods throw `DraftClosed`,
- draft creation snapshots context into detached draft data; primitives are returned unchanged, supported object graphs preserve order and topology, and unsupported values throw `DraftContextCloneFailed`.

## Known limits and non-goals

These points are worth knowing up front:

- `false` from `do(...)` has two meanings: either no transition exists for the current state and action, or transitions exist but all guards fail; this is deliberate, because both cases have the same observable machine effect (no state change, no context change, no subscription notification), and the API is intentionally optimized for the common question `did the machine advance?`,
- the service type does not narrow itself to the current runtime state, so action availability is still checked at runtime,
- reducers may either mutate the existing context object or return a new one; for direct live root dispatch, returning a fresh object replaces `service.context`, while draft commit and composed child publication preserve the parent or live context object and reconcile nested updates into it, preserving key order, sparse array shape, and graph topology where possible for ordinary mutable object surfaces and replacing only incompatible subtrees; reconciliation does not guarantee preservation of arbitrary property-descriptor semantics such as non-enumerability, accessors, or non-configurable retained properties,
- primitive context values are supported directly; draft snapshots return them unchanged, and reconciliation returns the next primitive value,
- drafts require context values that the draft snapshotter can detach safely at draft-creation time; unsupported values such as functions throw `DraftContextCloneFailed`,
- reconciliation and live publication do not eagerly enforce that resulting context stays draftable; unsupported values can be published and may surface later when `draft()` or another snapshot operation is requested,
- drafts do not expose `subscribe(...)`; the publication boundary is commit,
- conflict detection is optimistic: stale commits are rejected with `DraftOutOfDate` rather than merged,
- composed machines are still flat at runtime; `.compose(...)` is authoring-time structure, not runtime hierarchy,
- group names are not states and cannot be transition targets,
- the library models flat state machines only; it does not provide hierarchy, parallel regions, history states, or other statechart semantics.

## API

### `stateMachine()`

Creates a machine builder.

#### Methods

- `.state(name)` — declare a state
- `.initial(state)` — set the initial state
- `.action<Type, Payload>(name)` — declare an action and optional payload type
- `.context<Type>(() => initialValue)` — set the initial context factory
- `.compose(group, childMachine)` — merge a child builder into the current machine (flat semantics)
- `.transition(source, action, target, reducer?)` — declare a transition (target is an explicit state)

### `reconcileContext(parentContext, nextContext)`

Reconciles a next context graph into an existing context value while preserving compatible subtree identity where possible.

For ordinary mutable object surfaces, reconciliation preserves keys, values, next-key order, sparse-array holes, and graph topology. Compatible collection and binary values are updated in place, and incompatible subtrees are replaced.

This is the runtime reconciliation primitive used internally for draft commits and composed child context updates.

### `interpret(machine)`

Creates an executable machine service.

#### Properties

- `.state` — current state
- `.context` — current context

#### Methods

- `.do(action, payload?)` — dispatch an action
- `.draft()` — create an isolated draft handle
- `.subscribe(callback)` — subscribe to successful transitions

### `StateMachineDraft`

Represents an isolated speculative execution handle.

#### Properties

- `.state` — current draft state
- `.context` — current draft context

#### Methods

- `.do(action, payload?)` — dispatch an action against the draft snapshot
- `.draft()` — create a nested draft
- `.commit()` — publish changes to the parent draft or live service
- `.discard()` — close the draft without publishing changes

## Performance

`@escapace/fsm` shows about 11.5x higher throughput than `@xstate/fsm` in the repository’s representative benchmark (guarded transitions with immutable context updates), while a handwritten baseline is about 7.7x faster than `@escapace/fsm`, indicating the remaining abstraction cost versus direct state updates. These figures come from microbenchmarks run in tight loops in a controlled single-process setup, so they measure transition-dispatch overhead rather than end-to-end application latency.
