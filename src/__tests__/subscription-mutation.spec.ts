import { assert, describe, it } from 'vitest'
import { interpret, stateMachine } from '../index'

const failure = new Error('callback failure')
const createMachine = () =>
  stateMachine()
    .state('A')
    .state('B')
    .state('C')
    .initial('A')
    .action('STEP')
    .transition('A', 'STEP', 'B')
    .transition('B', 'STEP', 'C')
    .done()

describe('subscription mutation', () => {
  it.each(['service', 'draft', 'replay', 'nested replay'] as const)(
    '%s: self-unsubscription preserves other active callbacks',
    (mode) => {
      const service = interpret(createMachine())
      const receiver = mode === 'draft' || mode === 'nested replay' ? service.draft() : service
      const seen: string[] = []
      const unsubscribe = receiver.subscribe(() => {
        seen.push('first')
        unsubscribe()
        unsubscribe()
      })
      receiver.subscribe(() => {
        seen.push('second')
      })
      if (mode === 'replay' || mode === 'nested replay') {
        const child = receiver.draft()
        child.do('STEP')
        child.commit()
      } else {
        receiver.do('STEP')
      }
      assert.deepEqual(seen, ['first', 'second'])
      receiver.do('STEP')
      assert.deepEqual(seen, ['first', 'second', 'second'])
    },
  )

  it('removing both earlier and current callbacks does not skip later callbacks', () => {
    const service = interpret(createMachine())
    const seen: string[] = []
    const first = service.subscribe(() => {
      seen.push('first')
    })
    const second = service.subscribe(() => {
      seen.push('second')
      first()
      second()
    })
    service.subscribe(() => {
      seen.push('third')
    })
    service.subscribe(() => {
      seen.push('fourth')
    })
    service.do('STEP')
    assert.deepEqual(seen, ['first', 'second', 'third', 'fourth'])
  })

  it('propagates callback errors and permits later dispatch after self-unsubscription', () => {
    const service = interpret(createMachine())
    const seen: string[] = []
    const unsubscribe = service.subscribe(() => {
      unsubscribe()
      throw failure
    })
    service.subscribe((change) => {
      seen.push(change.state)
    })
    assert.throws(() => service.do('STEP'), failure)
    assert.equal(service.state, 'B')
    assert.equal(service.do('STEP'), true)
    assert.deepEqual(seen, ['C'])
  })
})
