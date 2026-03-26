import { assert, describe, it } from 'vitest'
import {
  interpret,
  isStateMachineError,
  isStateMachineErrorOfType,
  stateMachine,
  type StateMachineError,
} from '../index'

const noop = () => undefined

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
