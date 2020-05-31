const { performance } = require('perf_hooks')
const log = require('./log')

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

;[...Array(1000000).keys()].forEach(() => send())

log(A, B)
