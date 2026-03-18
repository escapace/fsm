import { assert, describe, it, vi } from 'vitest'
import {
  interpret,
  isStateMachineError,
  isStateMachineErrorOfType,
  stateMachine,
  type StateMachineError,
} from '../index'

describe('interpret hydration', () => {
  it('hydrates state and context, then continues normal dispatch', () => {
    const machine = stateMachine()
      .state('A')
      .state('B')
      .state('C')
      .initial('A')
      .action('STEP')
      .context(() => ({ count: 0 }))
      .transition('A', 'STEP', 'B', (context) => ({ count: context.count + 1 }))
      .transition('B', 'STEP', 'C', (context) => ({ count: context.count + 1 }))

    const service = interpret(machine, {
      hydrate: {
        context: { count: 1 },
        state: 'B',
      },
    })

    assert.equal(service.state, 'B')
    assert.deepEqual(service.context, { count: 1 })
    assert.equal(service.do('STEP'), true)
    assert.equal(service.state, 'C')
    assert.deepEqual(service.context, { count: 2 })
  })

  it('rejects unknown hydrated state with StateNotDeclared', () => {
    const machine = stateMachine()
      .state('A')
      .initial('A')
      .action('STEP')
      .transition('A', 'STEP', 'A')

    try {
      interpret(machine, {
        hydrate: {
          context: undefined,
          state: 'Z' as never,
        },
      })
      assert.fail('expected StateNotDeclared')
    } catch (error) {
      assert.equal(isStateMachineError(error), true)
      assert.equal(isStateMachineErrorOfType(error as StateMachineError, 'StateNotDeclared'), true)
    }
  })

  it('rejects startup discriminant mismatch on hydrated context', () => {
    const machine = stateMachine()
      .state('A')
      .state('B')
      .initial('A')
      .action('STEP')
      .context<{ state: 'A'; value: number } | { state: 'B'; value: number }>(() => ({
        state: 'A' as const,
        value: 0,
      }))
      .transition('A', 'STEP', 'B', () => ({ state: 'B' as const, value: 1 }))

    try {
      interpret(machine, {
        hydrate: {
          context: { state: 'A' as const, value: 10 },
          state: 'B',
        },
      })
      assert.fail('expected ContextStateMismatch')
    } catch (error) {
      assert.equal(isStateMachineError(error), true)
      assert.equal(
        isStateMachineErrorOfType(error as StateMachineError, 'ContextStateMismatch'),
        true,
      )
    }
  })

  it('does not execute context factory when hydration is provided', () => {
    const contextFactory = vi.fn(() => ({ count: 0 }))

    const machine = stateMachine()
      .state('A')
      .state('B')
      .initial('A')
      .action('STEP')
      .context(contextFactory)
      .transition('A', 'STEP', 'B')

    const service = interpret(machine, {
      hydrate: {
        context: { count: 9 },
        state: 'B',
      },
    })

    assert.equal(contextFactory.mock.calls.length, 0)
    assert.equal(service.state, 'B')
    assert.deepEqual(service.context, { count: 9 })
  })

  it('works without context factory when hydrating', () => {
    const machine = stateMachine()
      .state('A')
      .state('B')
      .initial('A')
      .action('STEP')
      .transition('A', 'STEP', 'B')

    const service = interpret(machine, {
      hydrate: {
        context: undefined,
        state: 'B',
      },
    })

    assert.equal(service.state, 'B')
    assert.equal(service.context, undefined)
  })

  it('ignores non-object options for compatibility', () => {
    const machine = stateMachine()
      .state('A')
      .initial('A')
      .action('STEP')
      .transition('A', 'STEP', 'A')

    const service = interpret(machine, 1 as never)

    assert.equal(service.state, 'A')
    assert.equal(service.do('STEP'), true)
    assert.equal(service.state, 'A')
  })

  it('treats undefined hydrate as no hydration', () => {
    const machine = stateMachine()
      .state('A')
      .initial('A')
      .action('STEP')
      .transition('A', 'STEP', 'A')

    const service = interpret(machine, { hydrate: undefined })

    assert.equal(service.state, 'A')
    assert.equal(service.do('STEP'), true)
  })

  it('accepts hydrated undefined context when context type permits it', () => {
    const machine = stateMachine()
      .state('A')
      .initial('A')
      .action('STEP')
      .transition('A', 'STEP', 'A')

    const service = interpret(machine, {
      hydrate: {
        context: undefined,
        state: 'A',
      },
    })

    assert.equal(service.context, undefined)
    assert.equal(service.state, 'A')
  })

  it('ignores prototype-inherited hydrate property', () => {
    const machine = stateMachine()
      .state('A')
      .initial('A')
      .action('STEP')
      .transition('A', 'STEP', 'A')

    const options = Object.create({ hydrate: { context: undefined, state: 'Z' } }) as {
      hydrate?: unknown
    }

    const service = interpret(machine, options as never)

    assert.equal(service.state, 'A')
  })

  it('rejects malformed hydrate payloads deterministically', () => {
    const machine = stateMachine()
      .state('A')
      .initial('A')
      .action('STEP')
      .transition('A', 'STEP', 'A')

    const cases = [
      { hydrate: null },
      { hydrate: 1 },
      { hydrate: {} },
      { hydrate: { context: 1 } },
      { hydrate: { state: 'A' } },
    ]

    for (const options of cases) {
      try {
        interpret(machine, options as never)
        assert.fail('expected HydrationShapeMismatch')
      } catch (error) {
        assert.equal(isStateMachineError(error), true)
        assert.equal(
          isStateMachineErrorOfType(error as StateMachineError, 'HydrationShapeMismatch'),
          true,
        )
      }
    }
  })

  it('supports hydration for composed context and child transitions', () => {
    const child = stateMachine()
      .state('On')
      .state('Off')
      .initial('On')
      .action('Toggle')
      .context(() => ({ toggles: 0 }))
      .transition('On', 'Toggle', 'Off', (context) => ({ toggles: context.toggles + 1 }))
      .transition('Off', 'Toggle', 'On', (context) => ({ toggles: context.toggles + 1 }))

    const machine = stateMachine()
      .state('Idle')
      .compose('power', child)
      .initial('Idle')
      .action('Start')
      .context(() => ({ starts: 0 }))
      .transition('Idle', 'Start', 'On', (context) => ({
        power: context.power,
        starts: context.starts + 1,
      }))

    const service = interpret(machine, {
      hydrate: {
        context: { power: { toggles: 2 }, starts: 5 },
        state: 'On',
      },
    })

    assert.equal(service.state, 'On')
    assert.deepEqual(service.context, { power: { toggles: 2 }, starts: 5 })

    assert.equal(service.do('Toggle'), true)
    assert.equal(service.state, 'Off')
    assert.deepEqual(service.context, { power: { toggles: 3 }, starts: 5 })
  })

  it('draft semantics remain unchanged after hydration', () => {
    const machine = stateMachine()
      .state('A')
      .state('B')
      .state('C')
      .initial('A')
      .action('STEP')
      .context(() => ({ n: 0 }))
      .transition('A', 'STEP', 'B', (context) => ({ n: context.n + 1 }))
      .transition('B', 'STEP', 'C', (context) => ({ n: context.n + 1 }))

    const service = interpret(machine, {
      hydrate: {
        context: { n: 1 },
        state: 'B',
      },
    })

    const draft = service.draft()
    assert.equal(draft.do('STEP'), true)
    draft.commit()

    assert.equal(service.state, 'C')
    assert.deepEqual(service.context, { n: 2 })
  })

  it('keeps stale draft rejection behavior after hydration', () => {
    const machine = stateMachine()
      .state('A')
      .state('B')
      .state('C')
      .initial('A')
      .action('STEP')
      .transition('A', 'STEP', 'B')
      .transition('B', 'STEP', 'C')

    const service = interpret(machine, {
      hydrate: {
        context: undefined,
        state: 'A',
      },
    })

    const left = service.draft()
    const right = service.draft()

    assert.equal(left.do('STEP'), true)
    left.commit()

    assert.equal(right.do('STEP'), true)

    try {
      right.commit()
      assert.fail('expected DraftCommitConflict')
    } catch (error) {
      assert.equal(isStateMachineError(error), true)
      assert.equal(
        isStateMachineErrorOfType(error as StateMachineError, 'DraftCommitConflict'),
        true,
      )
    }
  })

  it('keeps subscription edge semantics from hydrated baseline', () => {
    const machine = stateMachine()
      .state('A')
      .state('B')
      .state('C')
      .initial('A')
      .action('FIRST')
      .action('SECOND')
      .transition('A', 'FIRST', 'B')
      .transition('B', 'SECOND', 'C')

    const service = interpret(machine, {
      hydrate: {
        context: undefined,
        state: 'A',
      },
    })

    const seen: string[] = []

    let unsubscribeSecond: () => void = () => undefined

    service.subscribe((change) => {
      seen.push(String(change.state))

      if (change.action.type === 'FIRST') {
        unsubscribeSecond()
        assert.equal(service.do('SECOND'), true)
      }
    })

    unsubscribeSecond = service.subscribe(() => {
      seen.push('second-subscriber')
    })

    assert.equal(service.do('FIRST'), true)
    assert.deepEqual(seen, ['B', 'C'])
  })
})
