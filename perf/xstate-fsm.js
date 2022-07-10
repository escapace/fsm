import { createMachine, interpret } from '@xstate/fsm'
import { performance } from 'perf_hooks'
import { log } from './log.mjs'

const A = []
const B = []

const machine = createMachine({
  id: 'toggle',
  initial: 'inactive',
  states: {
    inactive: {
      on: {
        TOGGLE: {
          target: 'active',
          actions: () => A.push(performance.now())
        }
      }
    },
    active: {
      on: {
        TOGGLE: {
          target: 'inactive',
          actions: () => B.push(performance.now())
        }
      }
    }
  }
})

const service = interpret(machine).start()

;[...Array(1000000).keys()].forEach(() => service.send('TOGGLE'))

log(A, B)
