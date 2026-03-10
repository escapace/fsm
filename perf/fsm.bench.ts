import { assign, createMachine, interpret as interpretXState } from '@xstate/fsm'
import { bench, describe } from 'vitest'
import { interpret, stateMachine } from '../src/index'

const BATCH_SIZE = 1000
const WARMUP_ITERATIONS = 50_000
const TOGGLE_EVENT = { type: 'TOGGLE' } as const

interface CounterContext {
  count: number
}

interface ToggleEvent {
  type: 'TOGGLE'
}

const alwaysTrue = () => true
const noop = () => undefined

const runBatch = (count: number, callback: () => void) => {
  for (let index = 0; index < count; index++) {
    callback()
  }
}

const warmup = (callback: () => void) => {
  runBatch(WARMUP_ITERATIONS, callback)
}

const escapaceBare = interpret(
  stateMachine()
    .state('inactive')
    .state('active')
    .initial('inactive')
    .action('TOGGLE')
    .transition('inactive', 'TOGGLE', 'active')
    .transition('active', 'TOGGLE', 'inactive'),
)

const xstateBare = interpretXState(
  createMachine({
    id: 'toggle-bare',
    initial: 'inactive',
    states: {
      active: {
        on: {
          TOGGLE: {
            target: 'inactive',
          },
        },
      },
      inactive: {
        on: {
          TOGGLE: {
            target: 'active',
          },
        },
      },
    },
  }),
).start()

const escapaceWithCallback = interpret(
  stateMachine()
    .state('inactive')
    .state('active')
    .initial('inactive')
    .action('TOGGLE')
    .transition('inactive', 'TOGGLE', 'active', noop)
    .transition('active', 'TOGGLE', 'inactive', noop),
)

const xstateWithCallback = interpretXState(
  createMachine({
    id: 'toggle-callback',
    initial: 'inactive',
    states: {
      active: {
        on: {
          TOGGLE: {
            actions: noop,
            target: 'inactive',
          },
        },
      },
      inactive: {
        on: {
          TOGGLE: {
            actions: noop,
            target: 'active',
          },
        },
      },
    },
  }),
).start()

const xstateIncrement = assign<CounterContext, ToggleEvent>({
  count: (context: CounterContext) => context.count + 1,
})

const escapaceGuardedReducer = interpret(
  stateMachine()
    .state('inactive')
    .state('active')
    .initial('inactive')
    .action('TOGGLE')
    .context(() => ({ count: 0 }))
    .transition('inactive', ['TOGGLE', alwaysTrue], 'active', (context) => ({
      count: context.count + 1,
    }))
    .transition('active', ['TOGGLE', alwaysTrue], 'inactive', (context) => ({
      count: context.count + 1,
    })),
)

const xstateGuardedReducer = interpretXState(
  createMachine({
    context: { count: 0 },
    id: 'toggle-guarded-reducer',
    initial: 'inactive',
    states: {
      active: {
        on: {
          TOGGLE: {
            actions: xstateIncrement,
            cond: alwaysTrue,
            target: 'inactive',
          },
        },
      },
      inactive: {
        on: {
          TOGGLE: {
            actions: xstateIncrement,
            cond: alwaysTrue,
            target: 'active',
          },
        },
      },
    },
  }),
).start()

let _baselineState = 0
let baselineContext = { count: 0 }

const baselineBare = () => {
  _baselineState ^= 1
}

const baselineWithCallback = () => {
  _baselineState ^= 1
  noop()
}

const baselineGuardedReducer = () => {
  if (alwaysTrue()) {
    _baselineState ^= 1
    baselineContext = { count: baselineContext.count + 1 }
  }
}

warmup(baselineBare)
warmup(() => escapaceBare.do('TOGGLE'))
warmup(() => xstateBare.send('TOGGLE'))
warmup(() => xstateBare.send(TOGGLE_EVENT))

warmup(baselineWithCallback)
warmup(() => escapaceWithCallback.do('TOGGLE'))
warmup(() => xstateWithCallback.send(TOGGLE_EVENT))

warmup(baselineGuardedReducer)
warmup(() => escapaceGuardedReducer.do('TOGGLE'))
warmup(() => xstateGuardedReducer.send(TOGGLE_EVENT))

describe('fsm throughput - bare transitions', () => {
  bench(`baseline x${BATCH_SIZE}`, () => {
    runBatch(BATCH_SIZE, baselineBare)
  })

  bench(`escapace/fsm x${BATCH_SIZE} (do string)`, () => {
    runBatch(BATCH_SIZE, () => escapaceBare.do('TOGGLE'))
  })

  bench(`@xstate/fsm x${BATCH_SIZE} (send string)`, () => {
    runBatch(BATCH_SIZE, () => xstateBare.send('TOGGLE'))
  })

  bench(`@xstate/fsm x${BATCH_SIZE} (send object)`, () => {
    runBatch(BATCH_SIZE, () => xstateBare.send(TOGGLE_EVENT))
  })
})

describe('fsm throughput - transition callback cost', () => {
  bench(`baseline x${BATCH_SIZE}`, () => {
    runBatch(BATCH_SIZE, baselineWithCallback)
  })

  bench(`escapace/fsm x${BATCH_SIZE} (reducer noop)`, () => {
    runBatch(BATCH_SIZE, () => escapaceWithCallback.do('TOGGLE'))
  })

  bench(`@xstate/fsm x${BATCH_SIZE} (actions noop)`, () => {
    runBatch(BATCH_SIZE, () => xstateWithCallback.send(TOGGLE_EVENT))
  })
})

describe('fsm throughput - guard + immutable context update', () => {
  bench(`baseline x${BATCH_SIZE}`, () => {
    runBatch(BATCH_SIZE, baselineGuardedReducer)
  })

  bench(`escapace/fsm x${BATCH_SIZE} (predicate + reducer)`, () => {
    runBatch(BATCH_SIZE, () => escapaceGuardedReducer.do('TOGGLE'))
  })

  bench(`@xstate/fsm x${BATCH_SIZE} (cond + assign)`, () => {
    runBatch(BATCH_SIZE, () => xstateGuardedReducer.send(TOGGLE_EVENT))
  })
})
