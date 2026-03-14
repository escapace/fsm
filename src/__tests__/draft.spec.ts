import { assert, describe, it, vi } from 'vitest'
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

describe('draft runtime semantics', () => {
  it('service.draft() captures isolated snapshot and leaves parent unchanged', () => {
    const machine = stateMachine()
      .state('A')
      .state('B')
      .initial('A')
      .action('NEXT')
      .context(() => ({ count: 0 }))
      .transition('A', 'NEXT', 'B', (context) => {
        context.count += 1
        return context
      })

    const service = interpret(machine)
    const parentContextReference = service.context
    const draft = service.draft()

    assert.equal(draft.do('NEXT'), true)

    assert.equal(service.state, 'A')
    assert.deepEqual(service.context, { count: 0 })
    assert.equal(service.context, parentContextReference)

    assert.equal(draft.state, 'B')
    assert.deepEqual(draft.context, { count: 1 })
    assert.notEqual(draft.context, service.context)
  })

  it('draft.do(...) mirrors false outcomes and unknown action throw', () => {
    const machine = stateMachine()
      .state('A')
      .state('B')
      .initial('A')
      .action('BLOCKED')
      .action('MISSING')
      .action('PASS')
      .context(() => ({ attempts: 0 }))
      .transition('A', ['BLOCKED', () => false], 'B')
      .transition('A', 'PASS', 'B', (context) => ({ attempts: context.attempts + 1 }))

    const service = interpret(machine)
    const draft = service.draft()

    assert.equal(draft.do('MISSING'), false)
    assert.equal(draft.state, 'A')

    assert.equal(draft.do('BLOCKED'), false)
    assert.equal(draft.state, 'A')

    assertErrorType(() => draft.do('UNKNOWN' as never), 'ActionUnknown')
  })

  it('root commit replays notifications in order', () => {
    const machine = stateMachine()
      .state('A')
      .state('B')
      .state('C')
      .initial('A')
      .action('STEP')
      .context(() => ({ ticks: 0 }))
      .transition('A', 'STEP', 'B', (context) => ({ ticks: context.ticks + 1 }))
      .transition('B', 'STEP', 'C', (context) => ({ ticks: context.ticks + 1 }))

    const service = interpret(machine)
    const events: Array<{ source: string; state: string; target: string; ticks: number }> = []

    service.subscribe((change) => {
      events.push({
        source: String(change.action.source),
        state: String(change.state),
        target: String(change.action.target),
        ticks: change.context.ticks,
      })
    })

    const draft = service.draft()
    assert.equal(draft.do('STEP'), true)
    assert.equal(draft.do('STEP'), true)

    assert.equal(events.length, 0)

    draft.commit()

    assert.equal(events.length, 2)
    assert.deepEqual(events[0], { source: 'A', state: 'B', target: 'B', ticks: 1 })
    assert.deepEqual(events[1], { source: 'B', state: 'C', target: 'C', ticks: 2 })
  })

  it('discard closes handle and drops draft changes', () => {
    const machine = stateMachine()
      .state('A')
      .state('B')
      .initial('A')
      .action('STEP')
      .context(() => ({ count: 0 }))
      .transition('A', 'STEP', 'B', (context) => ({ count: context.count + 1 }))

    const service = interpret(machine)
    const draft = service.draft()

    assert.equal(draft.do('STEP'), true)
    draft.discard()

    assert.equal(service.state, 'A')
    assert.deepEqual(service.context, { count: 0 })

    assertErrorType(() => draft.do('STEP'), 'DraftClosed')
    assertErrorType(() => draft.commit(), 'DraftClosed')
    assertErrorType(() => draft.discard(), 'DraftClosed')
  })

  it('multiple root drafts conflict by DraftOutOfDate', () => {
    const machine = stateMachine()
      .state('A')
      .state('B')
      .initial('A')
      .action('STEP')
      .transition('A', 'STEP', 'B')

    const service = interpret(machine)
    const left = service.draft()
    const right = service.draft()

    assert.equal(left.do('STEP'), true)
    left.commit()

    assert.equal(right.do('STEP'), true)
    assertErrorType(() => right.commit(), 'DraftOutOfDate')
  })

  it('nested drafts commit recursively into parent and then service', () => {
    const machine = stateMachine()
      .state('A')
      .state('B')
      .state('C')
      .initial('A')
      .action('STEP')
      .context(() => ({ count: 0 }))
      .transition('A', 'STEP', 'B', (context) => ({ count: context.count + 1 }))
      .transition('B', 'STEP', 'C', (context) => ({ count: context.count + 1 }))

    const service = interpret(machine)
    const notifications: string[] = []

    service.subscribe((change) => {
      notifications.push(String(change.state))
    })

    const parent = service.draft()
    assert.equal(parent.do('STEP'), true)

    const child = parent.draft()
    assert.equal(child.do('STEP'), true)
    child.commit()

    assert.equal(parent.state, 'C')
    assert.deepEqual(parent.context, { count: 2 })

    parent.commit()

    assert.equal(service.state, 'C')
    assert.deepEqual(service.context, { count: 2 })
    assert.deepEqual(notifications, ['B', 'C'])
  })

  it('closing an ancestor invalidates descendants', () => {
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
    assertErrorType(() => child.draft(), 'DraftClosed')
  })

  it('empty-trace root commit is a no-op and closes handle', () => {
    const machine = stateMachine()
      .state('A')
      .state('B')
      .initial('A')
      .action('STEP')
      .context(() => ({ count: 0 }))
      .transition('A', 'STEP', 'B', (context) => ({ count: context.count + 1 }))

    const service = interpret(machine)
    const seen: string[] = []

    service.subscribe((change) => {
      seen.push(String(change.state))
    })

    const draft = service.draft()
    draft.commit()

    assert.equal(service.state, 'A')
    assert.deepEqual(service.context, { count: 0 })
    assert.deepEqual(seen, [])

    assertErrorType(() => draft.do('STEP'), 'DraftClosed')
  })

  it('empty-trace child commit is a no-op on parent and closes child', () => {
    const machine = stateMachine()
      .state('A')
      .state('B')
      .initial('A')
      .action('STEP')
      .context(() => ({ count: 0 }))
      .transition('A', 'STEP', 'B', (context) => ({ count: context.count + 1 }))

    const service = interpret(machine)
    const parent = service.draft()
    const child = parent.draft()

    child.commit()

    assert.equal(parent.state, 'A')
    assert.deepEqual(parent.context, { count: 0 })

    assertErrorType(() => child.do('STEP'), 'DraftClosed')
  })

  it('commit does not re-run predicates', () => {
    const guard = vi.fn(() => true)

    const machine = stateMachine()
      .state('A')
      .state('B')
      .initial('A')
      .action('STEP')
      .transition('A', ['STEP', guard], 'B')

    const service = interpret(machine)
    const draft = service.draft()

    assert.equal(draft.do('STEP'), true)
    assert.equal(guard.mock.calls.length, 1)

    draft.commit()

    assert.equal(guard.mock.calls.length, 1)
    assert.equal(service.state, 'B')
  })

  it('context materialization preserves parent object identity on commit', () => {
    const machine = stateMachine()
      .state('A')
      .state('B')
      .initial('A')
      .action('STEP')
      .context<Record<string, number>>(() => ({ keep: 1, remove: 2 }))
      .transition('A', 'STEP', 'B', () => ({ add: 3, keep: 9 }))

    const service = interpret(machine)
    const parentContextReference = service.context
    const draft = service.draft()

    assert.equal(draft.do('STEP'), true)
    draft.commit()

    assert.equal(service.context, parentContextReference)
    assert.deepEqual(service.context, { add: 3, keep: 9 })
  })

  it('draft creation rejects unsupported context values cleanly', () => {
    const machine = stateMachine()
      .state('A')
      .initial('A')
      .action('NOP')
      .context(() => ({ bad: () => 1 }))
      .transition('A', 'NOP', 'A')

    const service = interpret(machine)

    assertErrorType(() => service.draft(), 'DraftContextCloneFailed')
  })
})
