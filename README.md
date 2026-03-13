# @escapace/fsm

Flat extended finite state machines for event-driven application logic in TypeScript. A typed builder API keeps states, actions, and payloads explicit, with payload types flowing through dispatch, guards, reducers, and subscriptions. Builder composition (`.compose(...)`) flattens child machines into the same runtime model (no runtime hierarchy).

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
  .context<{ total: number }>({ total: 0 })
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
- subscribers are notified only after successful transitions,
- source and target arrays in `.transition(...)` expand as the Cartesian product of sources and targets,
- `.compose(group, child)` merges child states/actions/transitions into the same flat machine,
- states must be disjoint across parent and all children; actions must be disjoint across composed siblings,
- group names are context keys only; transitions target explicit state identifiers.

## Dispatch behavior

`interpret(machine)` returns a service with:

- `state` — current state
- `context` — current context
- `do(action, payload?)` — dispatches an action
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

## Known limits and non-goals

These points are worth knowing up front:

- `false` from `do(...)` has two meanings: either no transition exists for the current state and action, or transitions exist but all guards fail; this is deliberate, because both cases have the same observable machine effect (no state change, no context change, no subscription notification), and the API is intentionally optimized for the common question `did the machine advance?`,
- the service type does not narrow itself to the current runtime state, so action availability is still checked at runtime,
- reducers may either mutate the existing context object or return a new one,
- subscription callbacks are best treated as immediate notifications rather than durable event records; code that needs retained history should copy the received values,
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
- `.context<Type>(initialValue)` — set the initial context value or factory
- `.compose(group, childMachine)` — merge a child builder into the current machine (flat semantics)
- `.transition(source, action, target, reducer?)` — declare a transition (target is an explicit state)

### `interpret(machine)`

Creates an executable machine service.

#### Properties

- `.state` — current state
- `.context` — current context

#### Methods

- `.do(action, payload?)` — dispatch an action
- `.subscribe(callback)` — subscribe to successful transitions

## Performance

`@escapace/fsm` shows about 11.5x higher throughput than `@xstate/fsm` in the repository’s representative benchmark (guarded transitions with immutable context updates), while a handwritten baseline is about 7.7x faster than `@escapace/fsm`, indicating the remaining abstraction cost versus direct state updates. These figures come from microbenchmarks run in tight loops in a controlled single-process setup, so they measure transition-dispatch overhead rather than end-to-end application latency.
