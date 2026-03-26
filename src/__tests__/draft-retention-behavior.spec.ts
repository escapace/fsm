import { assert, describe, it, vi } from 'vitest'
import { interpret, stateMachine } from '../index'

describe('draft retention and lifecycle behavior', () => {
  it('service.do guard throw does not advance state', () => {
    const failure = new Error('service-guard-failure')

    const machine = stateMachine()
      .state('A')
      .state('B')
      .initial('A')
      .action('STEP')
      .transition(
        'A',
        [
          'STEP',
          () => {
            throw failure
          },
        ],
        'B',
      )

    const service = interpret(machine.done())

    assert.throws(() => service.do('STEP'), failure)
    assert.equal(service.state, 'A')
  })

  it('draft.do guard throw does not advance state or trace', () => {
    const failure = new Error('draft-guard-failure')

    const machine = stateMachine()
      .state('A')
      .state('B')
      .initial('A')
      .action('STEP')
      .transition(
        'A',
        [
          'STEP',
          () => {
            throw failure
          },
        ],
        'B',
      )

    const service = interpret(machine.done())
    const draft = service.draft()

    assert.throws(() => draft.do('STEP'), failure)
    assert.equal(draft.state, 'A')

    draft.commit()
    assert.equal(service.state, 'A')
  })

  it('closed draft subscribers do not receive later live service transitions', () => {
    const machine = stateMachine()
      .state('A')
      .state('B')
      .state('C')
      .initial('A')
      .action('STEP')
      .transition('A', 'STEP', 'B')
      .transition('B', 'STEP', 'C')

    const service = interpret(machine.done())
    const draft = service.draft()

    let draftNotifications = 0

    draft.subscribe(() => {
      draftNotifications += 1
    })

    draft.discard()

    assert.equal(service.do('STEP'), true)
    assert.equal(service.do('STEP'), true)
    assert.equal(draftNotifications, 0)
  })

  it('retained unsubscribe is idempotent and remains harmless after close and later activity', () => {
    const machine = stateMachine()
      .state('A')
      .state('B')
      .initial('A')
      .action('STEP')
      .transition('A', 'STEP', 'B')

    const service = interpret(machine.done())
    const draft = service.draft()

    const spy = vi.fn()
    const unsubscribe = draft.subscribe(spy)

    draft.discard()

    unsubscribe()
    unsubscribe()

    assert.equal(service.do('STEP'), true)
    assert.equal(spy.mock.calls.length, 0)
  })

  it('service.do reducer throw does not advance state', () => {
    const failure = new Error('service-do-failure')
    const reducer = vi.fn((context: { n: number }) => {
      if (reducer.mock.calls.length === 1) {
        throw failure
      }

      return { n: context.n + 1 }
    })

    const machine = stateMachine()
      .state('A')
      .state('B')
      .initial('A')
      .action('STEP')
      .context(() => ({ n: 0 }))
      .transition('A', 'STEP', 'B', reducer)

    const service = interpret(machine.done())

    assert.throws(() => service.do('STEP'), failure)
    assert.equal(service.state, 'A')
    assert.deepEqual(service.context, { n: 0 })

    assert.equal(service.do('STEP'), true)
    assert.equal(service.state, 'B')
    assert.deepEqual(service.context, { n: 1 })
  })

  it('draft.do reducer throw does not advance draft state or trace', () => {
    const failure = new Error('draft-do-failure')
    const reducer = vi.fn((context: { n: number }) => {
      if (reducer.mock.calls.length === 1) {
        throw failure
      }

      return { n: context.n + 1 }
    })

    const machine = stateMachine()
      .state('A')
      .state('B')
      .initial('A')
      .action('STEP')
      .context(() => ({ n: 0 }))
      .transition('A', 'STEP', 'B', reducer)

    const service = interpret(machine.done())
    const draft = service.draft()

    assert.throws(() => draft.do('STEP'), failure)
    assert.equal(draft.state, 'A')
    assert.deepEqual(draft.context, { n: 0 })

    draft.commit()

    assert.equal(service.state, 'A')
    assert.deepEqual(service.context, { n: 0 })
  })

  it('root commit reducer throw does not advance live state and can be retried', () => {
    const failure = new Error('root-commit-failure')
    const reducer = vi.fn((context: { n: number }) => {
      if (reducer.mock.calls.length === 2) {
        throw failure
      }

      return { n: context.n + 1 }
    })

    const machine = stateMachine()
      .state('A')
      .state('B')
      .initial('A')
      .action('STEP')
      .context(() => ({ n: 0 }))
      .transition('A', 'STEP', 'B', reducer)

    const service = interpret(machine.done())
    const draft = service.draft()

    assert.equal(draft.do('STEP'), true)
    assert.throws(() => draft.commit(), failure)

    assert.equal(service.state, 'A')
    assert.deepEqual(service.context, { n: 0 })

    draft.commit()

    assert.equal(service.state, 'B')
    assert.deepEqual(service.context, { n: 1 })
  })

  it('child commit reducer throw does not advance parent state and emits no notification', () => {
    const failure = new Error('publish-failure')
    const reducer = vi.fn((context: { n: number }) => {
      if (reducer.mock.calls.length === 2) {
        throw failure
      }

      return { n: context.n + 1 }
    })

    const machine = stateMachine()
      .state('A')
      .state('B')
      .initial('A')
      .action('STEP')
      .context(() => ({ n: 0 }))
      .transition('A', 'STEP', 'B', reducer)

    const service = interpret(machine.done())
    const parent = service.draft()
    const child = parent.draft()

    assert.equal(child.do('STEP'), true)

    const seen: string[] = []

    parent.subscribe((change) => {
      seen.push(String(change.state))
    })

    assert.throws(() => child.commit(), failure)

    assert.equal(reducer.mock.calls.length, 2)
    assert.equal(parent.state, 'A')
    assert.deepEqual(parent.context, { n: 0 })
    assert.deepEqual(seen, [])

    child.discard()
  })

  it('mixed child publication failure keeps first successful step and notification only', () => {
    const failure = new Error('mixed-publish-failure')
    const reducer = vi.fn((context: { n: number }) => {
      if (reducer.mock.calls.length === 4) {
        throw failure
      }

      return { n: context.n + 1 }
    })

    const machine = stateMachine()
      .state('A')
      .state('B')
      .state('C')
      .initial('A')
      .action('STEP')
      .context(() => ({ n: 0 }))
      .transition('A', 'STEP', 'B', reducer)
      .transition('B', 'STEP', 'C', reducer)

    const service = interpret(machine.done())
    const parent = service.draft()
    const child = parent.draft()

    assert.equal(child.do('STEP'), true)
    assert.equal(child.do('STEP'), true)

    const seen: string[] = []

    parent.subscribe((change) => {
      seen.push(String(change.state))
    })

    assert.throws(() => child.commit(), failure)

    assert.deepEqual(seen, ['B'])
    assert.equal(parent.state, 'B')
    assert.deepEqual(parent.context, { n: 1 })

    parent.commit()

    assert.equal(service.state, 'B')
    assert.deepEqual(service.context, { n: 1 })
  })
})
