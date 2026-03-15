import { assert, describe, it, vi } from 'vitest'
import {
  interpret,
  isStateMachineError,
  isStateMachineErrorOfType,
  StateMachineError,
  stateMachine,
} from '../index'

describe('Lean tranche alignment (P1–P6)', () => {
  it('supports machines without context and exposes undefined service context', () => {
    enum S {
      A = 'A',
      B = 'B',
    }
    enum A {
      Next = 'NEXT',
    }

    const machine = stateMachine()
      .state(S.A)
      .state(S.B)
      .initial(S.A)
      .action(A.Next)
      .transition(S.A, A.Next, S.B)

    const service = interpret(machine)

    assert.equal(service.context, undefined)
    assert.equal(service.do(A.Next), true)
    assert.equal(service.state, S.B)
    assert.equal(service.context, undefined)
  })

  it('P1: dispatch is deterministic for identical machine and action sequence', () => {
    enum S {
      A = 'A',
      B = 'B',
    }
    enum A {
      Flip = 'FLIP',
    }

    const machine = stateMachine()
      .state(S.A)
      .state(S.B)
      .initial(S.A)
      .action(A.Flip)
      .context(() => ({ steps: 0 }))
      .transition(S.A, A.Flip, S.B, (context) => ({ steps: context.steps + 1 }))
      .transition(S.B, A.Flip, S.A, (context) => ({ steps: context.steps + 1 }))

    const left = interpret(machine)
    const right = interpret(machine)

    const l1 = left.do(A.Flip)
    const r1 = right.do(A.Flip)
    assert.equal(l1, r1)
    assert.equal(left.state, right.state)
    assert.deepEqual(left.context, right.context)

    const l2 = left.do(A.Flip)
    const r2 = right.do(A.Flip)
    assert.equal(l2, r2)
    assert.equal(left.state, right.state)
    assert.deepEqual(left.context, right.context)
  })

  it('P2: success chooses a valid candidate with passing guards and first-match order', () => {
    enum S {
      End = 'END',
      Start = 'START',
      Winner = 'WINNER',
    }
    enum A {
      Go = 'GO',
    }

    const firstGuard = vi.fn(() => false)
    const secondGuard = vi.fn(() => true)
    const thirdGuard = vi.fn(() => true)

    const machine = stateMachine()
      .state(S.Start)
      .state(S.Winner)
      .state(S.End)
      .initial(S.Start)
      .action<A.Go, { n: number }>(A.Go)
      .context(() => ({ chosen: '' }))
      // candidate 1: fails
      .transition(S.Start, [A.Go, firstGuard], S.End)
      // candidate 2: passes and should be selected
      .transition(S.Start, [A.Go, secondGuard], S.Winner, () => ({ chosen: 'second' }))
      // candidate 3: also passes, but must not be reached
      .transition(S.Start, [A.Go, thirdGuard], S.End, () => ({ chosen: 'third' }))

    const service = interpret(machine)
    const observed: Array<{ payload: unknown; source: string; target: string; type: string }> = []

    service.subscribe((change) => {
      observed.push({
        payload: change.action.payload,
        source: String(change.action.source),
        target: String(change.action.target),
        type: String(change.action.type),
      })
    })

    const ok = service.do(A.Go, { n: 7 })

    assert.equal(ok, true)
    assert.equal(service.state, S.Winner)
    assert.deepEqual(service.context, { chosen: 'second' })

    assert.equal(firstGuard.mock.calls.length, 1)
    assert.equal(secondGuard.mock.calls.length, 1)
    assert.equal(thirdGuard.mock.calls.length, 0)

    assert.equal(observed.length, 1)
    assert.deepEqual(observed[0], {
      payload: { n: 7 },
      source: S.Start,
      target: S.Winner,
      type: A.Go,
    })
  })

  it('P3: failure means no candidate exists or all candidates fail guards', () => {
    enum S {
      A = 'A',
      B = 'B',
    }
    enum A {
      NoRoute = 'NO_ROUTE',
      Try = 'TRY',
    }

    const g1 = vi.fn(() => false)
    const g2 = vi.fn(() => false)

    const machine = stateMachine()
      .state(S.A)
      .state(S.B)
      .initial(S.A)
      .action(A.Try)
      .action(A.NoRoute)
      .context(() => ({ count: 0 }))
      .transition(S.A, [A.Try, g1], S.B)
      .transition(S.A, [A.Try, g2], S.B)

    const service = interpret(machine)

    // all candidates fail guards
    const failByGuards = service.do(A.Try)
    assert.equal(failByGuards, false)
    assert.equal(service.state, S.A)
    assert.equal(g1.mock.calls.length, 1)
    assert.equal(g2.mock.calls.length, 1)

    // no candidate for (state, action)
    const failByNoCandidate = service.do(A.NoRoute)
    assert.equal(failByNoCandidate, false)
    assert.equal(service.state, S.A)
  })

  it('P4: runtime state always remains in the declared state set for reachable executions', () => {
    enum S {
      A = 'A',
      B = 'B',
      C = 'C',
    }
    enum A {
      Next = 'NEXT',
    }

    const declared = new Set([S.A, S.B, S.C])

    const machine = stateMachine()
      .state(S.A)
      .state(S.B)
      .state(S.C)
      .initial(S.A)
      .action(A.Next)
      .transition(S.A, A.Next, S.B)
      .transition(S.B, A.Next, S.C)
      .transition(S.C, A.Next, S.A)

    const service = interpret(machine)

    for (let index = 0; index < 9; index++) {
      assert.equal(declared.has(service.state), true)
      service.do(A.Next)
      assert.equal(declared.has(service.state), true)
    }
  })

  it('P5: unknown actions are rejected (throw) and declared actions continue to work', () => {
    enum S {
      A = 'A',
      B = 'B',
    }
    enum A {
      Known = 'KNOWN',
    }

    const guard = vi.fn(() => true)

    const machine = stateMachine()
      .state(S.A)
      .state(S.B)
      .initial(S.A)
      .action(A.Known)
      .context(() => ({ ok: true }))
      .transition(S.A, [A.Known, guard], S.B)

    const service = interpret(machine)

    assert.throws(() => {
      service.do('UNKNOWN_ACTION' as never)
    }, 'No such action "UNKNOWN_ACTION".')

    assert.equal(guard.mock.calls.length, 0)
    assert.equal(service.state, S.A)

    const ok = service.do(A.Known)
    assert.equal(ok, true)
    assert.equal(service.state, S.B)
  })

  it('P6: array transition authoring matches explicit Cartesian expansion', () => {
    enum S {
      A = 'A',
      B = 'B',
      C = 'C',
      D = 'D',
    }
    enum A {
      Expand = 'EXPAND',
    }

    const buildExpanded = (initial: S.A | S.B) =>
      stateMachine()
        .state(S.A)
        .state(S.B)
        .state(S.C)
        .state(S.D)
        .initial(initial)
        .action(A.Expand)
        .transition([S.A, S.B], A.Expand, [S.C, S.D])

    const buildExplicit = (initial: S.A | S.B) =>
      stateMachine()
        .state(S.A)
        .state(S.B)
        .state(S.C)
        .state(S.D)
        .initial(initial)
        .action(A.Expand)
        // explicit row-major enumeration: (A,C), (A,D), (B,C), (B,D)
        .transition(S.A, A.Expand, S.C)
        .transition(S.A, A.Expand, S.D)
        .transition(S.B, A.Expand, S.C)
        .transition(S.B, A.Expand, S.D)

    const fromAExpanded = interpret(buildExpanded(S.A))
    const fromAExplicit = interpret(buildExplicit(S.A))

    assert.equal(fromAExpanded.do(A.Expand), fromAExplicit.do(A.Expand))
    assert.equal(fromAExpanded.state, fromAExplicit.state)
    assert.equal(fromAExpanded.state, S.C)

    const fromBExpanded = interpret(buildExpanded(S.B))
    const fromBExplicit = interpret(buildExplicit(S.B))

    assert.equal(fromBExpanded.do(A.Expand), fromBExplicit.do(A.Expand))
    assert.equal(fromBExpanded.state, fromBExplicit.state)
    assert.equal(fromBExpanded.state, S.C)
  })

  it('errors are StateMachineError instances with structured cause', () => {
    try {
      stateMachine()
        .state('A')
        .initial('A')
        .action('Go')
        // @ts-expect-error intentional unknown state target
        .transition('A', 'Go', 'Z')
      assert.fail('expected error')
    } catch (error) {
      assert.ok(isStateMachineError(error))
      assert.ok(error instanceof StateMachineError)
      assert.equal(error.name, 'StateMachineError')
      assert.equal(error.cause.type, 'StateUnknown')
      assert.equal(error.message, 'No such state "Z".')

      assert.ok(isStateMachineErrorOfType(error, 'StateUnknown'))

      if (isStateMachineErrorOfType(error, 'StateUnknown')) {
        assert.equal(error.cause.identifier, 'Z')
      }

      assert.ok(!isStateMachineErrorOfType(error, 'ActionUnknown'))
    }

    assert.ok(!isStateMachineError(new Error('unrelated')))
  })

  it('error message formats symbol identifiers', () => {
    const sym = Symbol('myState')

    try {
      // @ts-expect-error duplicate symbol state
      stateMachine().state(sym).state(sym)
      assert.fail('expected error')
    } catch (error) {
      assert.ok(isStateMachineError(error))
      assert.equal(error.message, 'State Symbol(myState) already exists.')
    }
  })

  it('rejects non-function context initializers', () => {
    try {
      stateMachine()
        .state('A')
        .initial('A')
        .action('Go')
        // @ts-expect-error runtime validation for JavaScript callers and casts
        .context({ count: 0 })
      assert.fail('expected error')
    } catch (error) {
      assert.ok(isStateMachineError(error))
      assert.equal(error.cause.type, 'ContextFactoryRequired')
      assert.equal(error.message, 'Context initializer must be a nullary function.')
    }
  })

  it('subscribe deduplicates identical subscription functions', () => {
    const machine = stateMachine()
      .state('A')
      .state('B')
      .initial('A')
      .action('Go')
      .transition('A', 'Go', 'B')

    const service = interpret(machine)
    let calls = 0
    const sub = () => {
      calls++
    }

    const unsub1 = service.subscribe(sub)
    const unsub2 = service.subscribe(sub)

    service.do('Go')
    assert.equal(calls, 1)

    unsub1()
    unsub2()
  })

  it('rejects composing child whose state matches group name', () => {
    // Build a child that has a state named 'g' — then compose under group 'g'
    const child = stateMachine().state('g').initial('g').action('X').transition('g', 'X', 'g')

    try {
      stateMachine().state('Root').compose('g', child)
      assert.fail('expected error')
    } catch (error) {
      assert.ok(isStateMachineError(error))
      assert.equal(error.cause.type, 'GroupExists')
    }
  })
})
