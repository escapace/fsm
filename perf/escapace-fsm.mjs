import { stateMachine, interpret } from '../lib/esm/index.mjs'
import { performance } from 'perf_hooks'
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

;[...Array(1000000).keys()].forEach(() => service.do('TOGGLE'))

log(A, B)
