import { performance } from 'node:perf_hooks'
import { log } from './log.mjs'

const A = []
const B = []

let state = 'inactive'

const send = () => {
  if (state === 'inactive') {
    state = 'active'

    A.push(performance.now())
  } else {
    state = 'inactive'

    B.push(performance.now())
  }
}

;[...Array(1_000_000).keys()].forEach(() => send())

log(A, B)
