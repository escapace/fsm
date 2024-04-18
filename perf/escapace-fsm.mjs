import { performance } from 'node:perf_hooks'
import { interpret, stateMachine } from '../lib/esm/index.mjs'
import { log } from './log.mjs'

const A = []
const B = []

const machine = stateMachine()
  .state('inactive')
  .state('active')
  .initial('inactive')
  .action('TOGGLE')
  .transition('inactive', 'TOGGLE', 'active', () => A.push(performance.now()))
  .transition('active', 'TOGGLE', 'inactive', () => B.push(performance.now()))

const service = interpret(machine)

;[...Array(1_000_000).keys()].forEach(() => service.do('TOGGLE'))

log(A, B)
