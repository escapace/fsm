import { assert, describe, it } from 'vitest'
import {
  interpret,
  isStateMachineError,
  isStateMachineErrorOfType,
  stateMachine,
  type StateMachineError,
} from '../index'

const noop = () => undefined

const assertDraftClosed = (operation: () => unknown) => {
  try {
    operation()
    assert.fail('expected DraftClosed')
  } catch (error) {
    assert.equal(isStateMachineError(error), true)
    assert.equal(isStateMachineErrorOfType(error as StateMachineError, 'DraftClosed'), true)
  }
}

describe('draft reentrancy and callback mutation semantics', () => {
  it('parent callback can unsubscribe a sibling callback during child publication replay', () => {
    const machine = stateMachine()
      .state('A')
      .state('B')
      .initial('A')
      .action('STEP')
      .transition('A', 'STEP', 'B')

    const service = interpret(machine.done())
    const parent = service.draft()
    const child = parent.draft()

    assert.equal(child.do('STEP'), true)

    const seen: string[] = []

    let unsubscribeB: () => void = noop

    parent.subscribe(() => {
      seen.push('A')
      unsubscribeB()
    })

    unsubscribeB = parent.subscribe(() => {
      seen.push('B')
    })

    child.commit()

    assert.deepEqual(seen, ['A'])
  })

  it('parent callback can subscribe a new callback during child publication replay', () => {
    const machine = stateMachine()
      .state('A')
      .state('B')
      .initial('A')
      .action('STEP')
      .transition('A', 'STEP', 'B')

    const service = interpret(machine.done())
    const parent = service.draft()
    const child = parent.draft()

    assert.equal(child.do('STEP'), true)

    const seen: string[] = []

    parent.subscribe(() => {
      seen.push('A')

      parent.subscribe(() => {
        seen.push('C')
      })
    })

    child.commit()

    assert.deepEqual(seen, ['A', 'C'])
  })

  it('discarding the committing draft blocks new operations without cancelling replay', () => {
    const machine = stateMachine()
      .state('A')
      .state('B')
      .state('C')
      .initial('A')
      .action('STEP')
      .context(() => ({ count: 0 }))
      .transition('A', 'STEP', 'B', (context) => ({ count: context.count + 1 }))
      .transition('B', 'STEP', 'C', (context) => ({ count: context.count + 1 }))

    const service = interpret(machine.done())
    const draft = service.draft()
    const seen: string[] = []

    service.subscribe((change) => {
      seen.push(change.state)
      if (change.state === 'B') {
        draft.discard()

        assert.equal(draft.status(), 'closed')
        assertDraftClosed(() => draft.do('STEP'))
        assertDraftClosed(() => draft.commit())
        assertDraftClosed(() => draft.draft())
        assert.equal(service.state, 'B')
        assert.deepEqual(service.context, { count: 1 })
      }
    })

    assert.equal(draft.do('STEP'), true)
    assert.equal(draft.do('STEP'), true)
    // Service subscribers observe publication, not speculative draft steps.
    assert.deepEqual(seen, [])
    assert.equal(draft.status(), 'open')

    draft.commit()

    assert.deepEqual(seen, ['B', 'C'])
    assert.equal(service.state, 'C')
    assert.deepEqual(service.context, { count: 2 })
    assert.equal(draft.status(), 'closed')
    assertDraftClosed(() => draft.commit())
  })

  it('discarding the receiving parent closes observation without cancelling child replay', () => {
    const machine = stateMachine()
      .state('A')
      .state('B')
      .state('C')
      .initial('A')
      .action('STEP')
      .context(() => ({ count: 0 }))
      .transition('A', 'STEP', 'B', (context) => ({ count: context.count + 1 }))
      .transition('B', 'STEP', 'C', (context) => ({ count: context.count + 1 }))

    const service = interpret(machine.done())
    const parent = service.draft()
    const child = parent.draft()
    const parentSeen: string[] = []
    const serviceSeen: string[] = []

    service.subscribe((change) => {
      serviceSeen.push(change.state)
    })
    parent.subscribe((change) => {
      parentSeen.push(change.state)
      parent.discard()

      assert.equal(parent.status(), 'closed')
      assert.equal(child.status(), 'closed')
      assertDraftClosed(() => parent.do('STEP'))
      assertDraftClosed(() => parent.commit())
      assertDraftClosed(() => child.do('STEP'))
      assertDraftClosed(() => child.commit())
      assert.equal(parent.state, 'B')
      assert.deepEqual(parent.context, { count: 1 })
    })

    assert.equal(child.do('STEP'), true)
    assert.equal(child.do('STEP'), true)
    assert.deepEqual(parentSeen, [])

    child.commit()

    // The in-progress replay finishes, but discard closes the observation channel
    // and prevents any later publication from this parent to the live service.
    assert.deepEqual(parentSeen, ['B'])
    assert.equal(parent.state, 'C')
    assert.deepEqual(parent.context, { count: 2 })
    assert.equal(parent.status(), 'closed')
    assert.equal(child.status(), 'closed')
    assertDraftClosed(() => parent.commit())
    assert.equal(service.state, 'A')
    assert.deepEqual(service.context, { count: 0 })
    assert.deepEqual(serviceSeen, [])
  })

  it('reentrant child.commit during child publication replay rejects with DraftCommitConflict', () => {
    const machine = stateMachine()
      .state('A')
      .state('B')
      .initial('A')
      .action('STEP')
      .transition('A', 'STEP', 'B')

    const service = interpret(machine.done())
    const parent = service.draft()
    const child = parent.draft()

    assert.equal(child.do('STEP'), true)

    let reentrantError: unknown

    parent.subscribe(() => {
      try {
        child.commit()
      } catch (error) {
        reentrantError = error
      }
    })

    child.commit()

    assert.equal(isStateMachineError(reentrantError), true)
    assert.equal(
      isStateMachineErrorOfType(reentrantError as StateMachineError, 'DraftCommitConflict'),
      true,
    )
  })
})
