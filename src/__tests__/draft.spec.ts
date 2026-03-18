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
  it('service.draft() preserves undefined context for machines without context', () => {
    const machine = stateMachine()
      .state('A')
      .state('B')
      .initial('A')
      .action('NEXT')
      .transition('A', 'NEXT', 'B')

    const service = interpret(machine)
    const draft = service.draft()

    assert.equal(service.context, undefined)
    assert.equal(draft.context, undefined)
    assert.equal(draft.do('NEXT'), true)
    assert.equal(service.state, 'A')
    assert.equal(service.context, undefined)

    draft.commit()

    assert.equal(service.state, 'B')
    assert.equal(service.context, undefined)
  })

  it('service.draft() captures isolated composed child context when the parent has no context', () => {
    const child = stateMachine()
      .state('ChildA')
      .state('ChildB')
      .initial('ChildA')
      .action('STEP')
      .context(() => ({ value: 0 }))
      .transition('ChildA', 'STEP', 'ChildB', (context) => ({ value: context.value + 1 }))

    const machine = stateMachine()
      .state('Idle')
      .compose('child', child)
      .initial('Idle')
      .action('ENTER')
      .transition('Idle', 'ENTER', 'ChildA')

    const service = interpret(machine)

    assert.deepEqual(service.context, {
      child: { value: 0 },
    })

    assert.equal(service.do('ENTER'), true)

    const parentContextReference = service.context
    const childContextReference = parentContextReference.child
    const draft = service.draft()

    assert.notEqual(draft.context, parentContextReference)
    assert.notEqual(draft.context.child, childContextReference)
    assert.deepEqual(draft.context, {
      child: { value: 0 },
    })

    assert.equal(draft.do('STEP'), true)
    assert.equal(service.state, 'ChildA')
    assert.deepEqual(service.context, {
      child: { value: 0 },
    })

    draft.commit()

    assert.equal(service.state, 'ChildB')
    assert.equal(service.context, parentContextReference)
    assert.equal(service.context.child, childContextReference)
    assert.deepEqual(service.context, {
      child: { value: 1 },
    })
  })

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

    assertErrorType(() => draft.do('UNKNOWN' as never), 'ActionNotDeclared')
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

  it('draft.subscribe(...) receives local notifications and service stays silent before root commit', () => {
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
    const serviceStates: string[] = []
    const draftStates: string[] = []

    service.subscribe((change) => {
      serviceStates.push(String(change.state))
    })

    const draft = service.draft()
    draft.subscribe((change) => {
      draftStates.push(String(change.state))
    })

    assert.equal(draft.do('STEP'), true)
    assert.equal(draft.do('STEP'), true)

    assert.deepEqual(draftStates, ['B', 'C'])
    assert.deepEqual(serviceStates, [])

    draft.commit()

    assert.deepEqual(serviceStates, ['B', 'C'])
  })

  it('child commit publishes to parent subscribers with stepwise parent-visible state', () => {
    const machine = stateMachine()
      .state('A')
      .state('B')
      .state('C')
      .state('D')
      .initial('A')
      .action('STEP')
      .context(() => ({ count: 0 }))
      .transition('A', 'STEP', 'B', (context) => ({ count: context.count + 1 }))
      .transition('B', 'STEP', 'C', (context) => ({ count: context.count + 1 }))
      .transition('C', 'STEP', 'D', (context) => ({ count: context.count + 1 }))

    const service = interpret(machine)
    const parent = service.draft()

    assert.equal(parent.do('STEP'), true)

    const child = parent.draft()
    assert.equal(child.do('STEP'), true)
    assert.equal(child.do('STEP'), true)

    const snapshots: Array<{ contextCount: number; eventCount: number; state: string }> = []

    parent.subscribe((change) => {
      snapshots.push({
        contextCount: parent.context.count,
        eventCount: change.context.count,
        state: String(parent.state),
      })
    })

    child.commit()

    assert.deepEqual(snapshots, [
      { contextCount: 2, eventCount: 2, state: 'C' },
      { contextCount: 3, eventCount: 3, state: 'D' },
    ])
  })

  it('grandchild commit publishes to child only, not parent or service', () => {
    const machine = stateMachine()
      .state('A')
      .state('B')
      .state('C')
      .state('D')
      .initial('A')
      .action('STEP')
      .context(() => ({ count: 0 }))
      .transition('A', 'STEP', 'B', (context) => ({ count: context.count + 1 }))
      .transition('B', 'STEP', 'C', (context) => ({ count: context.count + 1 }))
      .transition('C', 'STEP', 'D', (context) => ({ count: context.count + 1 }))

    const service = interpret(machine)
    const parent = service.draft()
    const child = parent.draft()
    const grandchild = child.draft()

    const childSeen: string[] = []
    const parentSeen: string[] = []
    const serviceSeen: string[] = []

    child.subscribe((change) => {
      childSeen.push(String(change.state))
    })

    parent.subscribe((change) => {
      parentSeen.push(String(change.state))
    })

    service.subscribe((change) => {
      serviceSeen.push(String(change.state))
    })

    assert.equal(grandchild.do('STEP'), true)
    assert.equal(grandchild.do('STEP'), true)

    assert.deepEqual(childSeen, [])
    assert.deepEqual(parentSeen, [])
    assert.deepEqual(serviceSeen, [])

    grandchild.commit()

    assert.deepEqual(childSeen, ['B', 'C'])
    assert.deepEqual(parentSeen, [])
    assert.deepEqual(serviceSeen, [])
  })

  it('parent subscriber can create and commit a parent draft during child publication replay', () => {
    const machine = stateMachine()
      .state('A')
      .state('B')
      .initial('A')
      .action('STEP')
      .transition('A', 'STEP', 'B')

    const service = interpret(machine)
    const parent = service.draft()
    const child = parent.draft()

    assert.equal(child.do('STEP'), true)

    let nestedCommitError: unknown

    parent.subscribe(() => {
      try {
        const nested = parent.draft()
        nested.commit()
      } catch (error) {
        nestedCommitError = error
      }
    })

    child.commit()

    assert.equal(nestedCommitError, undefined)
  })

  it('draft subscribe deduplicates identical handlers and unsubscribe is safe after close', () => {
    const machine = stateMachine()
      .state('A')
      .state('B')
      .initial('A')
      .action('STEP')
      .transition('A', 'STEP', 'B')

    const service = interpret(machine)
    const draft = service.draft()

    let calls = 0
    const subscriber = () => {
      calls += 1
    }

    const unsubscribeA = draft.subscribe(subscriber)
    const unsubscribeB = draft.subscribe(subscriber)

    assert.equal(draft.do('STEP'), true)
    assert.equal(calls, 1)

    draft.discard()

    unsubscribeA()
    unsubscribeB()
  })

  it('retained child unsubscribe does not keep child operational after ancestor close', () => {
    const machine = stateMachine()
      .state('A')
      .state('B')
      .initial('A')
      .action('STEP')
      .transition('A', 'STEP', 'B')

    const service = interpret(machine)
    const parent = service.draft()
    const child = parent.draft()

    let seen = 0
    const unsubscribe = child.subscribe(() => {
      seen += 1
    })

    parent.discard()

    assertErrorType(() => child.do('STEP'), 'DraftClosed')

    unsubscribe()
    unsubscribe()

    assert.equal(seen, 0)
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

    assert.equal(draft.status(), 'open')
    assert.equal(draft.do('STEP'), true)
    draft.discard()

    assert.equal(service.state, 'A')
    assert.deepEqual(service.context, { count: 0 })
    assert.equal(draft.status(), 'closed')

    assertErrorType(() => draft.do('STEP'), 'DraftClosed')
    assertErrorType(() => draft.commit(), 'DraftClosed')
    assertErrorType(() => draft.discard(), 'DraftClosed')
  })

  it('status reports stale root drafts after another root commit wins', () => {
    const machine = stateMachine()
      .state('A')
      .state('B')
      .initial('A')
      .action('STEP')
      .transition('A', 'STEP', 'B')

    const service = interpret(machine)
    const left = service.draft()
    const right = service.draft()

    assert.equal(left.status(), 'open')
    assert.equal(right.status(), 'open')

    assert.equal(left.do('STEP'), true)
    left.commit()

    assert.equal(left.status(), 'closed')
    assert.equal(right.status(), 'stale')
  })

  it('status reports stale root drafts with local changes after live service advancement', () => {
    const machine = stateMachine()
      .state('A')
      .state('B')
      .state('C')
      .initial('A')
      .action('STEP')
      .transition('A', 'STEP', 'B')
      .transition('B', 'STEP', 'C')

    const service = interpret(machine)
    const draft = service.draft()

    assert.equal(draft.do('STEP'), true)
    assert.equal(draft.status(), 'open')
    assert.equal(service.do('STEP'), true)
    assert.equal(draft.status(), 'stale')
  })

  it('status reports stale empty-trace root drafts after live service advancement', () => {
    const machine = stateMachine()
      .state('A')
      .state('B')
      .initial('A')
      .action('STEP')
      .transition('A', 'STEP', 'B')

    const service = interpret(machine)
    const draft = service.draft()

    assert.equal(draft.status(), 'open')
    assert.equal(service.do('STEP'), true)
    assert.equal(draft.status(), 'stale')
  })

  it('open status is advisory and does not guarantee root commit success', () => {
    const machine = stateMachine()
      .state('A')
      .state('B')
      .initial('A')
      .action('STEP')
      .transition('A', 'STEP', 'B')

    const service = interpret(machine)
    const left = service.draft()
    const right = service.draft()

    assert.equal(right.status(), 'open')
    assert.equal(left.do('STEP'), true)
    left.commit()

    assert.equal(right.status(), 'stale')
    assertErrorType(() => right.commit(), 'DraftCommitConflict')
  })

  it('multiple root drafts conflict by DraftCommitConflict', () => {
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
    assertErrorType(() => right.commit(), 'DraftCommitConflict')
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

    assert.equal(child.status(), 'open')

    parent.discard()

    assert.equal(child.status(), 'closed')
    assertErrorType(() => child.do('STEP'), 'DraftClosed')
    assertErrorType(() => child.commit(), 'DraftClosed')
    assertErrorType(() => child.discard(), 'DraftClosed')
    assertErrorType(() => child.draft(), 'DraftClosed')
    assertErrorType(() => child.subscribe(() => undefined), 'DraftClosed')
  })

  it('status reports stale child drafts after the parent advances', () => {
    const machine = stateMachine()
      .state('A')
      .state('B')
      .state('C')
      .initial('A')
      .action('STEP')
      .transition('A', 'STEP', 'B')
      .transition('B', 'STEP', 'C')

    const service = interpret(machine)
    const parent = service.draft()
    const staleChild = parent.draft()
    const winningChild = parent.draft()

    assert.equal(staleChild.status(), 'open')
    assert.equal(winningChild.do('STEP'), true)
    winningChild.commit()

    assert.equal(winningChild.status(), 'closed')
    assert.equal(staleChild.status(), 'stale')
  })

  it('status reports stale child drafts after parent.do advances the parent cursor', () => {
    const machine = stateMachine()
      .state('A')
      .state('B')
      .state('C')
      .initial('A')
      .action('STEP')
      .transition('A', 'STEP', 'B')
      .transition('B', 'STEP', 'C')

    const service = interpret(machine)
    const parent = service.draft()
    const child = parent.draft()

    assert.equal(child.status(), 'open')
    assert.equal(parent.do('STEP'), true)
    assert.equal(child.status(), 'stale')
  })

  it('closed status overrides stale when an ancestor closes later', () => {
    const machine = stateMachine()
      .state('A')
      .state('B')
      .state('C')
      .initial('A')
      .action('STEP')
      .transition('A', 'STEP', 'B')
      .transition('B', 'STEP', 'C')

    const service = interpret(machine)
    const parent = service.draft()
    const child = parent.draft()

    assert.equal(parent.do('STEP'), true)
    assert.equal(child.status(), 'stale')

    parent.discard()

    assert.equal(child.status(), 'closed')
  })

  it('open status is advisory and does not guarantee child commit success', () => {
    const machine = stateMachine()
      .state('A')
      .state('B')
      .state('C')
      .initial('A')
      .action('STEP')
      .transition('A', 'STEP', 'B')
      .transition('B', 'STEP', 'C')

    const service = interpret(machine)
    const parent = service.draft()
    const child = parent.draft()

    assert.equal(child.status(), 'open')
    assert.equal(parent.do('STEP'), true)

    assert.equal(child.status(), 'stale')
    assertErrorType(() => child.commit(), 'DraftCommitConflict')
  })

  it('status does not notify subscribers or change runtime state', () => {
    const machine = stateMachine()
      .state('A')
      .state('B')
      .initial('A')
      .action('STEP')
      .context(() => ({ count: 0 }))
      .transition('A', 'STEP', 'B', (context) => ({ count: context.count + 1 }))

    const service = interpret(machine)
    const draft = service.draft()
    let draftNotifications = 0
    let serviceNotifications = 0

    draft.subscribe(() => {
      draftNotifications += 1
    })

    service.subscribe(() => {
      serviceNotifications += 1
    })

    assert.equal(draft.status(), 'open')
    assert.equal(draft.status(), 'open')
    assert.equal(service.state, 'A')
    assert.deepEqual(service.context, { count: 0 })
    assert.equal(draft.state, 'A')
    assert.deepEqual(draft.context, { count: 0 })
    assert.equal(draftNotifications, 0)
    assert.equal(serviceNotifications, 0)
  })

  it('false draft.do leaves status unchanged', () => {
    const machine = stateMachine()
      .state('A')
      .state('B')
      .initial('A')
      .action('BLOCKED')
      .transition('A', ['BLOCKED', () => false], 'B')

    const service = interpret(machine)
    const draft = service.draft()

    assert.equal(draft.status(), 'open')
    assert.equal(draft.do('BLOCKED'), false)
    assert.equal(draft.status(), 'open')
  })

  it('throwing draft.do leaves status unchanged', () => {
    const failure = new Error('draft-status-guard-failure')

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

    const service = interpret(machine)
    const draft = service.draft()

    assert.equal(draft.status(), 'open')
    assert.throws(() => draft.do('STEP'), failure)
    assert.equal(draft.status(), 'open')
  })

  it('empty-trace root commit closes status', () => {
    const machine = stateMachine()
      .state('A')
      .state('B')
      .initial('A')
      .action('STEP')
      .transition('A', 'STEP', 'B')

    const service = interpret(machine)
    const draft = service.draft()

    assert.equal(draft.status(), 'open')
    draft.commit()
    assert.equal(draft.status(), 'closed')
  })

  it('empty-trace child commit closes status', () => {
    const machine = stateMachine()
      .state('A')
      .state('B')
      .initial('A')
      .action('STEP')
      .transition('A', 'STEP', 'B')

    const service = interpret(machine)
    const parent = service.draft()
    const child = parent.draft()

    assert.equal(child.status(), 'open')
    child.commit()
    assert.equal(child.status(), 'closed')
  })

  it('grandchild becomes stale after immediate parent advancement', () => {
    const machine = stateMachine()
      .state('A')
      .state('B')
      .state('C')
      .initial('A')
      .action('STEP')
      .transition('A', 'STEP', 'B')
      .transition('B', 'STEP', 'C')

    const service = interpret(machine)
    const parent = service.draft()
    const child = parent.draft()
    const grandchild = child.draft()

    assert.equal(grandchild.status(), 'open')
    assert.equal(child.do('STEP'), true)
    assert.equal(grandchild.status(), 'stale')
  })

  it('ancestor commit closes descendants recursively', () => {
    const machine = stateMachine()
      .state('A')
      .state('B')
      .initial('A')
      .action('STEP')
      .transition('A', 'STEP', 'B')

    const service = interpret(machine)
    const parent = service.draft()
    const child = parent.draft()
    const grandchild = child.draft()

    assert.equal(parent.do('STEP'), true)
    parent.commit()

    assertErrorType(() => child.do('STEP'), 'DraftClosed')
    assertErrorType(() => child.subscribe(() => undefined), 'DraftClosed')
    assertErrorType(() => grandchild.do('STEP'), 'DraftClosed')
    assertErrorType(() => grandchild.subscribe(() => undefined), 'DraftClosed')
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

  it('commit replay does not evaluate guards that would throw on re-run', () => {
    const failure = new Error('guard-should-not-rerun')
    const guard = vi.fn(() => {
      if (guard.mock.calls.length > 1) {
        throw failure
      }

      return true
    })

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

  it('nested publication re-runs reducers at each commit boundary', () => {
    const reducer = vi.fn((context: { count: number }) => ({ count: context.count + 1 }))

    const machine = stateMachine()
      .state('A')
      .state('B')
      .initial('A')
      .action('STEP')
      .context(() => ({ count: 0 }))
      .transition('A', 'STEP', 'B', reducer)

    const service = interpret(machine)
    const parent = service.draft()
    const child = parent.draft()
    const grandchild = child.draft()

    assert.equal(grandchild.do('STEP'), true)
    assert.equal(reducer.mock.calls.length, 1)

    grandchild.commit()
    assert.equal(reducer.mock.calls.length, 2)

    child.commit()
    assert.equal(reducer.mock.calls.length, 3)

    parent.commit()
    assert.equal(reducer.mock.calls.length, 4)
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

    assertErrorType(() => service.draft(), 'DraftSnapshotFailed')
  })
})
