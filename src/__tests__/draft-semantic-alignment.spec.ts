import { assert, describe, it } from 'vitest'
import {
  interpret,
  isStateMachineError,
  isStateMachineErrorOfType,
  stateMachine,
  type StateMachineError,
  type StateMachineErrorType,
} from '../index'

const assertErrorType = (function_: () => unknown, type: StateMachineErrorType) => {
  try {
    function_()
    assert.fail(`Expected StateMachineError(${type})`)
  } catch (error) {
    assert.equal(isStateMachineError(error), true)
    assert.equal(isStateMachineErrorOfType(error as StateMachineError, type), true)
  }
}

describe('Lean tranche alignment (P14–P20 runtime)', () => {
  it('P14/P15: successful draft execution commits to the same final snapshot', () => {
    const machine = stateMachine()
      .state('A')
      .state('B')
      .state('C')
      .initial('A')
      .action('STEP')
      .context(() => ({ n: 0 }))
      .transition('A', 'STEP', 'B', (context) => ({ n: context.n + 1 }))
      .transition('B', 'STEP', 'C', (context) => ({ n: context.n + 1 }))

    const service = interpret(machine)
    const draft = service.draft()

    assert.equal(draft.do('STEP'), true)
    assert.equal(draft.do('STEP'), true)

    const expectedState = draft.state
    const expectedContext = { ...draft.context }

    draft.commit()

    assert.equal(service.state, expectedState)
    assert.deepEqual(service.context, expectedContext)
  })

  it('P16: root commit emits ordered change sequence matching replay order', () => {
    const machine = stateMachine()
      .state('A')
      .state('B')
      .state('C')
      .initial('A')
      .action('STEP')
      .context(() => ({ n: 0 }))
      .transition('A', 'STEP', 'B', (context) => ({ n: context.n + 1 }))
      .transition('B', 'STEP', 'C', (context) => ({ n: context.n + 1 }))

    const service = interpret(machine)
    const ordered: Array<{ source: string; state: string; target: string }> = []

    service.subscribe((change) => {
      ordered.push({
        source: String(change.action.source),
        state: String(change.state),
        target: String(change.action.target),
      })
    })

    const draft = service.draft()
    draft.do('STEP')
    draft.do('STEP')
    draft.commit()

    assert.deepEqual(ordered, [
      { source: 'A', state: 'B', target: 'B' },
      { source: 'B', state: 'C', target: 'C' },
    ])
  })

  it('P17: child commit appends into parent and parent snapshot equals child snapshot', () => {
    const machine = stateMachine()
      .state('A')
      .state('B')
      .state('C')
      .initial('A')
      .action('STEP')
      .context(() => ({ n: 0 }))
      .transition('A', 'STEP', 'B', (context) => ({ n: context.n + 1 }))
      .transition('B', 'STEP', 'C', (context) => ({ n: context.n + 1 }))

    const service = interpret(machine)
    const parent = service.draft()

    assert.equal(parent.do('STEP'), true)

    const child = parent.draft()
    assert.equal(child.do('STEP'), true)

    const childState = child.state
    const childContext = { ...child.context }

    child.commit()

    assert.equal(parent.state, childState)
    assert.deepEqual(parent.context, childContext)
  })

  it('P18: stale root and stale child commits reject with DraftOutOfDate', () => {
    const machine = stateMachine()
      .state('A')
      .state('B')
      .state('C')
      .initial('A')
      .action('STEP')
      .transition('A', 'STEP', 'B')
      .transition('B', 'STEP', 'C')

    const service = interpret(machine)

    const left = service.draft()
    const right = service.draft()
    left.do('STEP')
    left.commit()
    right.do('STEP')
    assertErrorType(() => right.commit(), 'DraftOutOfDate')

    const parent = service.draft()
    const staleChild = parent.draft()
    const sibling = parent.draft()

    sibling.do('STEP')
    sibling.commit()

    staleChild.do('STEP')
    assertErrorType(() => staleChild.commit(), 'DraftOutOfDate')
  })

  it('P19: draft failure behavior matches dispatch and does not extend effective trace', () => {
    const machine = stateMachine()
      .state('A')
      .state('B')
      .initial('A')
      .action('BLOCKED')
      .context(() => ({ n: 0 }))
      .transition('A', ['BLOCKED', () => false], 'B', (context) => ({ n: context.n + 1 }))

    const service = interpret(machine)
    const draft = service.draft()

    assert.equal(draft.do('BLOCKED'), false)
    assertErrorType(() => draft.do('UNKNOWN' as never), 'ActionUnknown')

    draft.commit()

    assert.equal(service.state, 'A')
    assert.deepEqual(service.context, { n: 0 })
  })

  it('P20: closed ancestor makes descendants non-operational', () => {
    const machine = stateMachine()
      .state('A')
      .state('B')
      .initial('A')
      .action('STEP')
      .transition('A', 'STEP', 'B')

    const service = interpret(machine)
    const parent = service.draft()
    const child = parent.draft()

    parent.discard()

    assertErrorType(() => child.do('STEP'), 'DraftClosed')
    assertErrorType(() => child.commit(), 'DraftClosed')
    assertErrorType(() => child.discard(), 'DraftClosed')
  })
})
