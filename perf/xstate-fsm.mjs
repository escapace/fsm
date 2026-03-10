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
          target: 'inactive',
          actions: () => B.push(performance.now()),
        },
      },
    },
    inactive: {
      on: {
        TOGGLE: {
          target: 'active',
          actions: () => A.push(performance.now()),
        },
      },
    },
  },
})

const service = interpret(machine).start()

;[...Array(1_000_000).keys()].forEach(() => service.send('TOGGLE'))

log(A, B)
