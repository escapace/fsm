import { assert, describe, it } from 'vitest'
import { interpret, stateMachine } from '../index'

const noop = () => undefined

describe('service runtime edge semantics', () => {
  it('service callback can unsubscribe a sibling callback during notification', () => {
    const machine = stateMachine()
      .state('A')
      .state('B')
      .initial('A')
      .action('STEP')
      .transition('A', 'STEP', 'B')

    const service = interpret(machine)
    const seen: string[] = []

    let unsubscribeB: () => void = noop

    service.subscribe(() => {
      seen.push('A')
      unsubscribeB()
    })

    unsubscribeB = service.subscribe(() => {
      seen.push('B')
    })

    assert.equal(service.do('STEP'), true)
    assert.deepEqual(seen, ['A'])
  })

  it('service callback can subscribe a new callback during notification', () => {
    const machine = stateMachine()
      .state('A')
      .state('B')
      .initial('A')
      .action('STEP')
      .transition('A', 'STEP', 'B')

    const service = interpret(machine)
    const seen: string[] = []

    service.subscribe(() => {
      seen.push('A')

      service.subscribe(() => {
        seen.push('C')
      })
    })

    assert.equal(service.do('STEP'), true)
    assert.deepEqual(seen, ['A', 'C'])
  })

  it('service callback can dispatch a second action reentrantly', () => {
    const machine = stateMachine()
      .state('A')
      .state('B')
      .state('C')
      .initial('A')
      .action('FIRST')
      .action('SECOND')
      .transition('A', 'FIRST', 'B')
      .transition('B', 'SECOND', 'C')

    const service = interpret(machine)
    const seen: string[] = []

    service.subscribe((change) => {
      seen.push(String(change.state))

      if (change.action.type === 'FIRST') {
        assert.equal(service.do('SECOND'), true)
      }
    })

    assert.equal(service.do('FIRST'), true)
    assert.equal(service.state, 'C')
    assert.deepEqual(seen, ['B', 'C'])
  })
})
