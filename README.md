# @escapace/fsm

Type-safe finite state machine library for TypeScript.

## Features

- Type-safe state machine definition and execution
- Conditional transitions with predicates
- Context management with reducers
- State change subscriptions
- High-frequency transition performance (8x faster than @xstate/fsm)

## Installation

```bash
pnpm add @escapace/fsm
```

## Example

```typescript
import { stateMachine, interpret } from '@escapace/fsm'

// Define coin values and state types
type Coin = 5 | 10 | 25 | 50
enum State {
  Locked = 'LOCKED',
  Unlocked = 'UNLOCKED',
}
enum Action {
  Coin = 'COIN',
  Push = 'PUSH',
}

// Create a turnstile that requires 50 cents to unlock
const machine = stateMachine()
  .state(State.Locked) // Define possible states
  .state(State.Unlocked)
  .initial(State.Locked) // Set starting state
  .action<Action.Coin, { coin: Coin }>(Action.Coin) // Define action with payload type
  .action(Action.Push) // Define action without payload
  .context<{ total: number }>({ total: 0 }) // Set context type and initial value
  .transition(
    State.Locked, // From locked state
    [
      Action.Coin,
      (
        context,
        action, // On coin insert, with predicate
      ) => context.total + action.payload.coin >= 50,
    ],
    State.Unlocked, // Go to unlocked state
    (context, action) => {
      // Run this reducer
      context.total += action.payload.coin
      return context
    },
  )
  .transition(
    State.Locked, // Fallback transition when not enough coins
    Action.Coin,
    State.Locked,
    (context, action) => {
      // Add coin to total
      context.total += action.payload.coin
      return context
    },
  )
  .transition(State.Unlocked, Action.Coin, State.Unlocked) // Stay unlocked on coin insert
  .transition(
    [State.Locked, State.Unlocked], // Push always locks
    Action.Push,
    State.Locked,
    (context) => {
      // Reset total on push
      context.total = 0
      return context
    },
  )

// Create and use the state machine
const turnstile = interpret(machine)

console.log(turnstile.state) // 'LOCKED'

turnstile.do(Action.Coin, { coin: 25 }) // Insert 25 cents
console.log(turnstile.state) // 'LOCKED'

turnstile.do(Action.Coin, { coin: 25 }) // Insert another 25 cents (total 50)
console.log(turnstile.state) // 'UNLOCKED'

turnstile.do(Action.Push) // Push through turnstile
console.log(turnstile.state) // 'LOCKED'
```

## API

### `stateMachine()`

Creates a new state machine builder.

**⚠️ Important: The builder pattern uses mutation for performance optimization. Each method call modifies the internal state directly rather than creating new objects. This means the builder is not immutable.**

#### Methods

- `.state(name)` - Define a state
- `.initial(state)` - Set initial state
- `.action<Type, Payload>(name)` - Define an action type
- `.context<Type>(initialValue)` - Set context type and initial value
- `.transition(source, action, target, reducer?)` - Define state transition

### `interpret(machine)`

Creates an executable state machine instance.

#### Properties

- `.state` - Current state (readonly)
- `.context` - Current context (readonly)

#### Methods

- `.do(action, payload?)` - Dispatch an action, returns boolean indicating success
- `.subscribe(callback)` - Subscribe to state changes

### Action Dispatch Return Values

The `.do()` method returns a boolean that indicates whether the action successfully triggered a state transition:

**Returns `true` when:**

- A valid transition exists for the current state + action combination
- All transition predicates (if any) evaluate to `true`
- The state transition executes successfully

**Returns `false` when:**

- No transition is defined for the current state + action combination
- All transition predicates fail (return `false`)

This return value enables precise control flow based on whether state changes actually occurred.

```typescript
const machine = stateMachine()
  .state('idle')
  .state('working')
  .initial('idle')
  .action('start')
  .action('stop')
  .transition('idle', 'start', 'working')
// Note: no 'stop' transition from 'idle'

const service = interpret(machine)

const started = service.do('start') // true - transition succeeds
console.log(service.state) // 'working'

const stopped = service.do('stop') // false - no transition defined
console.log(service.state) // still 'working'
```
