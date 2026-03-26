import { bench, describe } from 'vitest'
import { createActor, setup } from 'xstate'
import { defineMachine } from 'yay-machine'
import { interpret, stateMachine } from '../src/index'

const BATCH_SIZE = 1000
const BENCH_OPTIONS = {
  iterations: 200,
  time: 1000,
  warmupIterations: 20,
  warmupTime: 250,
}

const COIN_FARE = 50

interface CoinContext {
  accepted: number
  credit: number
  pushes: number
  revenue: number
}

type CoinEvent =
  | {
      amount: number
      type: 'coin'
    }
  | {
      type: 'push'
    }

type CoinOnlyEvent = Extract<CoinEvent, { type: 'coin' }>

const COIN_EVENT_SEQUENCE: readonly CoinEvent[] = [
  { amount: 5, type: 'coin' },
  { amount: 10, type: 'coin' },
  { amount: 25, type: 'coin' },
  { amount: 25, type: 'coin' },
  { type: 'push' },
  { amount: 50, type: 'coin' },
  { type: 'push' },
  { amount: 25, type: 'coin' },
  { type: 'push' },
]

const runBatch = (count: number, callback: () => void) => {
  for (let index = 0; index < count; index += 1) {
    callback()
  }
}

const escapaceCoin = interpret(
  stateMachine()
    .state('locked')
    .state('unlocked')
    .initial('locked')
    .action<'coin', { amount: number }>('coin')
    .action('push')
    .context<CoinContext>(() => ({ accepted: 0, credit: 0, pushes: 0, revenue: 0 }))
    .transition(
      'locked',
      ['coin', (context, action) => context.credit + action.payload.amount >= COIN_FARE],
      'unlocked',
      (context, action) => ({
        accepted: context.accepted + 1,
        credit: context.credit + action.payload.amount - COIN_FARE,
        pushes: context.pushes,
        revenue: context.revenue + COIN_FARE,
      }),
    )
    .transition('locked', 'coin', 'locked', (context, action) => ({
      accepted: context.accepted,
      credit: context.credit + action.payload.amount,
      pushes: context.pushes,
      revenue: context.revenue,
    }))
    .transition('unlocked', 'coin', 'unlocked', (context, action) => ({
      accepted: context.accepted + 1,
      credit: context.credit,
      pushes: context.pushes,
      revenue: context.revenue + action.payload.amount,
    }))
    .transition('unlocked', 'push', 'locked', (context) => ({
      accepted: context.accepted,
      credit: context.credit,
      pushes: context.pushes + 1,
      revenue: context.revenue,
    }))
    .done(),
)

const xstateCoinSetup = setup<CoinContext, CoinEvent>({})

const xstateCoin = createActor(
  xstateCoinSetup.createMachine({
    context: {
      accepted: 0,
      credit: 0,
      pushes: 0,
      revenue: 0,
    },
    id: 'coin-xstate',
    initial: 'locked',
    states: {
      locked: {
        on: {
          coin: [
            {
              actions: xstateCoinSetup.assign(({ context, event }) => {
                const coinEvent = event as CoinOnlyEvent

                return {
                  accepted: context.accepted + 1,
                  credit: context.credit + coinEvent.amount - COIN_FARE,
                  pushes: context.pushes,
                  revenue: context.revenue + COIN_FARE,
                }
              }),
              target: 'unlocked',
              guard: ({ context, event }) => context.credit + event.amount >= COIN_FARE,
            },
            {
              actions: xstateCoinSetup.assign(({ context, event }) => {
                const coinEvent = event as CoinOnlyEvent

                return {
                  accepted: context.accepted,
                  credit: context.credit + coinEvent.amount,
                  pushes: context.pushes,
                  revenue: context.revenue,
                }
              }),
              target: 'locked',
            },
          ],
        },
      },
      unlocked: {
        on: {
          coin: {
            actions: xstateCoinSetup.assign(({ context, event }) => {
              const coinEvent = event as CoinOnlyEvent

              return {
                accepted: context.accepted + 1,
                credit: context.credit,
                pushes: context.pushes,
                revenue: context.revenue + coinEvent.amount,
              }
            }),
            target: 'unlocked',
          },
          push: {
            actions: xstateCoinSetup.assign(({ context }) => ({
              accepted: context.accepted,
              credit: context.credit,
              pushes: context.pushes + 1,
              revenue: context.revenue,
            })),
            target: 'locked',
          },
        },
      },
    },
  }),
).start()

const yayCoin = defineMachine<
  {
    accepted: number
    credit: number
    name: 'locked' | 'unlocked'
    pushes: number
    revenue: number
  },
  CoinEvent
>({
  initialState: {
    accepted: 0,
    credit: 0,
    name: 'locked',
    pushes: 0,
    revenue: 0,
  },
  states: {
    locked: {
      on: {
        coin: [
          {
            to: 'unlocked',
            data: ({ event, state }) => ({
              ...state,
              accepted: state.accepted + 1,
              credit: state.credit + event.amount - COIN_FARE,
              revenue: state.revenue + COIN_FARE,
            }),
            when: ({ event, state }) => state.credit + event.amount >= COIN_FARE,
          },
          {
            to: 'locked',
            data: ({ event, state }) => ({
              ...state,
              credit: state.credit + event.amount,
            }),
          },
        ],
      },
    },
    unlocked: {
      on: {
        coin: {
          to: 'unlocked',
          data: ({ event, state }) => ({
            ...state,
            accepted: state.accepted + 1,
            revenue: state.revenue + event.amount,
          }),
        },
        push: {
          to: 'locked',
          data: ({ state }) => ({
            ...state,
            pushes: state.pushes + 1,
          }),
        },
      },
    },
  },
})
  .newInstance()
  .start()

let baselineCoinContext: CoinContext = {
  accepted: 0,
  credit: 0,
  pushes: 0,
  revenue: 0,
}
let baselineCoinState: 'locked' | 'unlocked' = 'locked'

const baselineCoinSend = (event: CoinEvent): void => {
  if (baselineCoinState === 'locked') {
    if (event.type !== 'coin') {
      return
    }

    if (baselineCoinContext.credit + event.amount >= COIN_FARE) {
      baselineCoinState = 'unlocked'
      baselineCoinContext = {
        accepted: baselineCoinContext.accepted + 1,
        credit: baselineCoinContext.credit + event.amount - COIN_FARE,
        pushes: baselineCoinContext.pushes,
        revenue: baselineCoinContext.revenue + COIN_FARE,
      }
      return
    }

    baselineCoinContext = {
      accepted: baselineCoinContext.accepted,
      credit: baselineCoinContext.credit + event.amount,
      pushes: baselineCoinContext.pushes,
      revenue: baselineCoinContext.revenue,
    }

    return
  }

  if (event.type === 'coin') {
    baselineCoinContext = {
      accepted: baselineCoinContext.accepted + 1,
      credit: baselineCoinContext.credit,
      pushes: baselineCoinContext.pushes,
      revenue: baselineCoinContext.revenue + event.amount,
    }

    return
  }

  baselineCoinState = 'locked'
  baselineCoinContext = {
    accepted: baselineCoinContext.accepted,
    credit: baselineCoinContext.credit,
    pushes: baselineCoinContext.pushes + 1,
    revenue: baselineCoinContext.revenue,
  }
}

const createCoinSequenceDispatcher = (dispatch: (event: CoinEvent) => void): (() => void) => {
  let cursor = 0

  return () => {
    dispatch(COIN_EVENT_SEQUENCE[cursor])
    cursor = (cursor + 1) % COIN_EVENT_SEQUENCE.length
  }
}

const baselineCoinDispatch = createCoinSequenceDispatcher((event) => {
  baselineCoinSend(event)
})

const escapaceCoinDispatch = createCoinSequenceDispatcher((event) => {
  if (event.type === 'coin') {
    escapaceCoin.do('coin', event)
    return
  }

  escapaceCoin.do('push')
})
const xstateCoinDispatch = createCoinSequenceDispatcher((event) => {
  xstateCoin.send(event)
})
const yayCoinDispatch = createCoinSequenceDispatcher((event) => {
  yayCoin.send(event)
})

describe('fsm alternatives throughput - coin flow (guards + reducers + payload)', () => {
  bench(
    `baseline x${BATCH_SIZE} (send object sequence)`,
    () => {
      runBatch(BATCH_SIZE, baselineCoinDispatch)
    },
    BENCH_OPTIONS,
  )

  bench(
    `escapace/fsm x${BATCH_SIZE} (do with payload sequence)`,
    () => {
      runBatch(BATCH_SIZE, escapaceCoinDispatch)
    },
    BENCH_OPTIONS,
  )

  bench(
    `xstate x${BATCH_SIZE} (send object sequence)`,
    () => {
      runBatch(BATCH_SIZE, xstateCoinDispatch)
    },
    BENCH_OPTIONS,
  )

  bench(
    `yay-machine x${BATCH_SIZE} (send object sequence)`,
    () => {
      runBatch(BATCH_SIZE, yayCoinDispatch)
    },
    BENCH_OPTIONS,
  )
})
