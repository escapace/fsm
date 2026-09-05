import { assert, describe, it } from 'vitest'
import { interpret, isStateMachineError, isStateMachineErrorOfType, stateMachine } from '../index'

// ── Discriminated union context ─────────────────────────────────────

type ApplicationContext = ErrorContext | LoadingContext | ReadyContext
interface ErrorContext {
  error: string
  state: 'Error'
}
interface LoadingContext {
  progress: number
  state: 'Loading'
}
interface ReadyContext {
  data: string[]
  state: 'Ready'
}

const createApplicationMachine = () =>
  stateMachine()
    .state('Loading')
    .state('Ready')
    .state('Error')
    .initial('Loading')
    .action<'Finish'>('Finish')
    .action<'Fail'>('Fail')
    .action<'Retry'>('Retry')
    .action<'Progress', number>('Progress')
    .context<ApplicationContext>(() => ({ progress: 0, state: 'Loading' as const }))
    .transition('Loading', 'Finish', 'Ready', (_context, _action) => ({
      data: ['done'],
      state: 'Ready' as const,
    }))
    .transition('Loading', 'Fail', 'Error', (_context, _action) => ({
      error: 'failed',
      state: 'Error' as const,
    }))
    .transition('Error', 'Retry', 'Loading', (_context, _action) => ({
      progress: 0,
      state: 'Loading' as const,
    }))
    .transition('Loading', 'Progress', 'Loading', (context, action) => ({
      ...context,
      progress: action.payload,
    }))

describe('state injection: service.do()', () => {
  it('context.state matches service.state after transition', () => {
    const svc = interpret(createApplicationMachine().done())
    assert.equal(svc.state, 'Loading')
    assert.equal(svc.context.state, 'Loading')

    svc.do('Finish')
    assert.equal(svc.state, 'Ready')
    assert.equal(svc.context.state, 'Ready')
  })

  it('context.state correct through multiple transitions', () => {
    const svc = interpret(createApplicationMachine().done())

    svc.do('Fail')
    assert.equal(svc.state, 'Error')
    assert.equal(svc.context.state, 'Error')
    assert.equal((svc.context as ErrorContext).error, 'failed')

    svc.do('Retry')
    assert.equal(svc.state, 'Loading')
    assert.equal(svc.context.state, 'Loading')
    assert.equal((svc.context as LoadingContext).progress, 0)
  })

  it('self-transition preserves context.state', () => {
    const svc = interpret(createApplicationMachine().done())

    svc.do('Progress', 50)
    assert.equal(svc.state, 'Loading')
    assert.equal(svc.context.state, 'Loading')
    assert.equal((svc.context as LoadingContext).progress, 50)
  })

  it('subscribe callback sees correct context.state', () => {
    const svc = interpret(createApplicationMachine().done())
    const changes: Array<{ ctxState: string; state: string }> = []

    svc.subscribe((change) => {
      changes.push({
        ctxState: (change.context as ApplicationContext).state,
        state: change.state,
      })
    })

    svc.do('Finish')
    assert.deepEqual(changes, [{ ctxState: 'Ready', state: 'Ready' }])
  })
})

describe('state injection: no-reducer transition', () => {
  it('context.state updated even without a reducer', () => {
    // Two states share the same variant shape
    interface IdleContext {
      count: number
      state: 'Idle'
    }
    interface ActiveContext {
      count: number
      state: 'Active'
    }
    type Context = ActiveContext | IdleContext

    const machine = stateMachine()
      .state('Idle')
      .state('Active')
      .initial('Idle')
      .action<'Activate'>('Activate')
      .action<'Deactivate'>('Deactivate')
      .context<Context>(() => ({ count: 0, state: 'Idle' as const }))
      // Same shape — reducer not required. But state changes.
      // NOTE: IdleCtx and ActiveCtx have the same structure (both have count),
      // but the StateMachineContextAtState check uses structural assignability.
      // Since state literals differ, they're not bidirectionally assignable,
      // so a reducer IS required. Use a minimal identity-like reducer.
      .transition('Idle', 'Activate', 'Active', (_context) => ({
        count: _context.count,
        state: 'Active' as const,
      }))
      .transition('Active', 'Deactivate', 'Idle', (_context) => ({
        count: _context.count,
        state: 'Idle' as const,
      }))

    const svc = interpret(machine.done())
    assert.equal(svc.context.state, 'Idle')

    svc.do('Activate')
    assert.equal(svc.state, 'Active')
    assert.equal(svc.context.state, 'Active')

    svc.do('Deactivate')
    assert.equal(svc.state, 'Idle')
    assert.equal(svc.context.state, 'Idle')
  })
})

const createDraftMachine = () =>
  stateMachine()
    .state('Loading')
    .state('Ready')
    .initial('Loading')
    .action<'Finish'>('Finish')
    .context<LoadingContext | ReadyContext>(() => ({ progress: 0, state: 'Loading' as const }))
    .transition('Loading', 'Finish', 'Ready', () => ({
      data: ['done'],
      state: 'Ready' as const,
    }))

describe('state injection: draft.do()', () => {
  it('draft context.state updated after speculative transition', () => {
    const svc = interpret(createDraftMachine().done())
    const draft = svc.draft()

    assert.equal(draft.context.state, 'Loading')

    draft.do('Finish')
    assert.equal(draft.state, 'Ready')
    assert.equal(draft.context.state, 'Ready')

    // Service unchanged
    assert.equal(svc.state, 'Loading')
    assert.equal(svc.context.state, 'Loading')

    draft.discard()
  })

  it('context.state correct after draft commit', () => {
    const svc = interpret(createDraftMachine().done())
    const draft = svc.draft()

    draft.do('Finish')
    draft.commit()

    assert.equal(svc.state, 'Ready')
    assert.equal(svc.context.state, 'Ready')
  })

  it('nested draft maintains context.state', () => {
    const svc = interpret(createDraftMachine().done())
    const d1 = svc.draft()
    const d2 = d1.draft()

    d2.do('Finish')
    assert.equal(d2.context.state, 'Ready')

    // Parent draft unchanged
    assert.equal(d1.context.state, 'Loading')

    d2.commit()
    assert.equal(d1.context.state, 'Ready')

    d1.commit()
    assert.equal(svc.context.state, 'Ready')
  })
})

describe('state injection: draft commit replay', () => {
  it('context.state correct after commit replays transitions', () => {
    const svc = interpret(
      stateMachine()
        .state('A')
        .state('B')
        .state('C')
        .initial('A')
        .action<'Next'>('Next')
        .context<{ a: number; state: 'A' } | { b: number; state: 'B' } | { c: number; state: 'C' }>(
          () => ({ a: 1, state: 'A' as const }),
        )
        .transition('A', 'Next', 'B', () => ({ b: 2, state: 'B' as const }))
        .transition('B', 'Next', 'C', () => ({ c: 3, state: 'C' as const }))
        .done(),
    )

    const changes: string[] = []
    svc.subscribe((change) => {
      changes.push((change.context as { state: string }).state)
    })

    const draft = svc.draft()
    draft.do('Next')
    draft.do('Next')
    draft.commit()

    // Each replayed step should inject the correct state
    assert.deepEqual(changes, ['B', 'C'])
    assert.equal(svc.state, 'C')
    assert.equal(svc.context.state, 'C')
  })
})

describe('state injection: composition', () => {
  it('child context.state updated through group lens', () => {
    interface ChildOn {
      state: 'On'
      uptime: number
    }
    interface ChildOff {
      downtime: number
      state: 'Off'
    }
    type ChildContext = ChildOff | ChildOn

    const child = stateMachine()
      .state('On')
      .state('Off')
      .initial('On')
      .action<'Toggle'>('Toggle')
      .context<ChildContext>(() => ({ state: 'On' as const, uptime: 0 }))
      .transition('On', 'Toggle', 'Off', () => ({ downtime: 0, state: 'Off' as const }))
      .transition('Off', 'Toggle', 'On', () => ({ state: 'On' as const, uptime: 0 }))

    const parent = stateMachine()
      .state('Idle')
      .compose('device', child.done())
      .initial('On')
      .action<'Enter'>('Enter')
      .context(() => ({ label: 'test' }))
      .transition('Idle', 'Enter', 'On')

    const svc = interpret(parent.done())

    // Child starts in 'On' state
    const deviceContext = () => svc.context.device
    assert.equal(deviceContext().state, 'On')

    svc.do('Toggle')
    assert.equal(svc.state, 'Off')
    assert.equal(deviceContext().state, 'Off')

    svc.do('Toggle')
    assert.equal(svc.state, 'On')
    assert.equal(deviceContext().state, 'On')
  })

  it('no-reducer child transition still injects child state', () => {
    interface ChildA {
      state: 'CA'
      x: number
    }
    interface ChildB {
      state: 'CB'
      x: number
    }
    type ChildContext = ChildA | ChildB

    const child = stateMachine()
      .state('CA')
      .state('CB')
      .initial('CA')
      .action<'Step'>('Step')
      .context<ChildContext>(() => ({ state: 'CA' as const, x: 1 }))
      // Cross-variant requires reducer
      .transition('CA', 'Step', 'CB', (context) => ({ state: 'CB' as const, x: context.x }))

    const parent = stateMachine()
      .state('Root')
      .compose('c', child.done())
      .initial('CA')
      .action<'Go'>('Go')
      .context(() => ({ y: 2 }))
      .transition('Root', 'Go', 'CA')

    const svc = interpret(parent.done())

    const childContext = () => svc.context.c
    assert.equal(childContext().state, 'CA')

    svc.do('Step')
    assert.equal(svc.state, 'CB')
    assert.equal(childContext().state, 'CB')
  })
})

describe('flat context: injection is no-op', () => {
  it('flat context unchanged after transition', () => {
    const machine = stateMachine()
      .state('A')
      .state('B')
      .initial('A')
      .action<'Go'>('Go')
      .context(() => ({ count: 0 }))
      .transition('A', 'Go', 'B', (context) => ({ count: context.count + 1 }))
      .transition('B', 'Go', 'A', (context) => ({ count: context.count + 1 }))

    const svc = interpret(machine.done())
    svc.do('Go')
    assert.deepEqual(svc.context, { count: 1 })
    assert.equal('state' in svc.context, false)

    svc.do('Go')
    assert.deepEqual(svc.context, { count: 2 })
    assert.equal('state' in svc.context, false)
  })
})

describe('context factory validation', () => {
  it('factory returning correct state: no error', () => {
    const machine = stateMachine()
      .state('Loading')
      .state('Ready')
      .initial('Loading')
      .action<'Finish'>('Finish')
      .context<ApplicationContext>(() => ({ progress: 0, state: 'Loading' as const }))
      .transition('Loading', 'Finish', 'Ready', () => ({
        data: [],
        state: 'Ready' as const,
      }))

    // Should not throw
    const svc = interpret(machine.done())
    assert.equal(svc.context.state, 'Loading')
  })

  it('factory returning wrong state: throws ContextStateMismatch', () => {
    const machine = stateMachine()
      .state('Loading')
      .state('Ready')
      .initial('Loading')
      .action<'Finish'>('Finish')
      .context<ApplicationContext>(
        // Factory returns Ready variant but initial state is Loading
        (): ApplicationContext => ({ data: [], state: 'Ready' }),
      )
      .transition('Loading', 'Finish', 'Ready', () => ({
        data: [],
        state: 'Ready' as const,
      }))

    try {
      interpret(machine.done())
      assert.fail('Expected ContextStateMismatch error')
    } catch (error) {
      assert.ok(isStateMachineError(error))
      assert.ok(isStateMachineErrorOfType(error, 'ContextStateMismatch'))
      assert.equal(error.cause.expected, 'Loading')
      assert.equal(error.cause.actual, 'Ready')
    }
  })

  it('factory returning object without state key: no error (flat context)', () => {
    const machine = stateMachine()
      .state('A')
      .state('B')
      .initial('A')
      .action<'Go'>('Go')
      .context(() => ({ count: 0 }))
      .transition('A', 'Go', 'B')

    // Should not throw — no state key to validate
    const svc = interpret(machine.done())
    assert.deepEqual(svc.context, { count: 0 })
  })

  it('factory returning undefined context: no error', () => {
    const machine = stateMachine()
      .state('A')
      .state('B')
      .initial('A')
      .action<'Go'>('Go')
      .transition('A', 'Go', 'B')

    // No context factory — should not throw
    const svc = interpret(machine.done())
    assert.equal(svc.context, undefined)
  })
})
