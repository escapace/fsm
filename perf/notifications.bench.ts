import { bench, describe } from 'vitest'
import { interpret, stateMachine } from '../src/index'

const BATCH_SIZE = 1000
const machine = stateMachine()
  .state('A')
  .initial('A')
  .action('STEP')
  .transition('A', 'STEP', 'A')
  .done()

// Keep observable subscriber work in the notification benchmarks without allocating
// on each callback.
const counter = { notifications: 0 }
const observe = () => {
  counter.notifications += 1
}
const bare = interpret(machine)
const one = interpret(machine)
const multiple = interpret(machine)
const draft = interpret(machine).draft()
one.subscribe(observe)
for (let index = 0; index < 4; index++) {
  multiple.subscribe(() => {
    counter.notifications += 1
  })
}
draft.subscribe(observe)

const runBatch = (dispatch: () => void) => {
  for (let index = 0; index < BATCH_SIZE; index++) dispatch()
}

// Warm each receiver before measurement, including notification bookkeeping.
for (let index = 0; index < 50_000; index++) {
  bare.do('STEP')
  one.do('STEP')
  multiple.do('STEP')
}

describe('notification throughput', () => {
  bench('no subscribers', () => {
    runBatch(() => {
      bare.do('STEP')
    })
  })
  bench('one subscriber', () => {
    runBatch(() => {
      one.do('STEP')
    })
  })
  bench('four subscribers', () => {
    runBatch(() => {
      multiple.do('STEP')
    })
  })
  bench('draft dispatch and discard with one subscriber', () => {
    runBatch(() => {
      const child = draft.draft()
      child.subscribe(observe)
      child.do('STEP')
      child.discard()
    })
  })
  bench('subscribe, dispatch, unsubscribe', () => {
    runBatch(() => {
      const unsubscribe = bare.subscribe(observe)
      bare.do('STEP')
      unsubscribe()
    })
  })
})

// Reading the counter keeps the callback side effect observable to the harness.
if (counter.notifications === 0) throw new Error('Notification benchmark warmup did not notify')
