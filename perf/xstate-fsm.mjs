import { createMachine, interpret } from '@xstate/fsm'
import { performance } from 'node:perf_hooks'
import { log } from './log.mjs'

const A = []
const B = []

const machine = createMachine({
  id: 'toggle',
  initial: 'inactive',
  states: {
    active: {
      on: {
        TOGGLE: {
          actions: () => B.push(performance.now()),
          target: 'inactive',
        },
      },
    },
    inactive: {
      on: {
        TOGGLE: {
          actions: () => A.push(performance.now()),
          target: 'active',
        },
      },
    },
  },
})

const service = interpret(machine).start()

;[...Array(1_000_000).keys()].forEach(() => service.send('TOGGLE'))

log(A, B)
