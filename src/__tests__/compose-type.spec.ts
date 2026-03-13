/* eslint-disable typescript/no-unused-vars */
import { describe, it } from 'vitest'
import { interpret, stateMachine, type InferStateMachineModel } from '../index'
import type {
  StateMachineComposePrecondition,
  StateMachineActionPayload,
  StateMachineActions,
  StateMachineGroups,
  StateMachineStates,
} from '../types'

// ── Type-level helpers ──────────────────────────────────────────────────
// check<T>() constrains T to true at the call site; a false produces a
// compile error.  Equal<A, B> is the standard structural-equality check.
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
type IsNever<T> = [T] extends [never] ? true : false

// eslint-disable-next-line typescript/no-empty-function
function check<_T extends true>() {}

describe('compose type-level', () => {
  // ── Shared fixtures ─────────────────────────────────────────────────
  const child = stateMachine()
    .state('On')
    .state('Off')
    .initial('On')
    .action<'Toggle'>('Toggle')
    .context({ toggles: 0 })
    .transition('On', 'Toggle', 'Off')
    .transition('Off', 'Toggle', 'On')

  const composed = stateMachine()
    .state('Idle')
    .compose('power', child)
    .initial('Idle')
    .action<'Start'>('Start')
    .context({ starts: 0 })
    .transition('Idle', 'Start', 'On')
    .transition(['On', 'Off'], 'Start', 'Idle')

  type Model = InferStateMachineModel<typeof composed>

  // ── Happy path: state set ─────────────────────────────────────────
  it('merged state set is parent ∪ child states', () => {
    check<Equal<StateMachineStates<Model>, 'Idle' | 'Off' | 'On'>>()
  })

  it('rejects group names as transition targets', () => {
    type GroupAsState = StateMachineStates<Model>
    // @ts-expect-error group names are context keys only
    const _bad: GroupAsState = 'power'
    void _bad
  })

  // ── Happy path: action set ────────────────────────────────────────
  it('merged action set is parent ∪ child actions', () => {
    check<Equal<StateMachineActions<Model>, 'Start' | 'Toggle'>>()
  })

  // ── Happy path: group set ─────────────────────────────────────────
  it('groups include composed group name', () => {
    check<Equal<StateMachineGroups<Model>, 'power'>>()
  })

  // ── Happy path: compound context ──────────────────────────────────
  it('context merges parent fields with child slice under group key', () => {
    interface Expected {
      power: { toggles: number }
      starts: number
    }
    check<Equal<Model['state']['context'], Expected>>()
  })

  // ── Happy path: service types match ───────────────────────────────
  it('interpreted service context matches model context', () => {
    const service = interpret(composed)
    type ServiceContext = typeof service.context
    interface Expected {
      power: { toggles: number }
      starts: number
    }
    check<Equal<ServiceContext, Expected>>()
  })

  it('service.do accepts parent and child actions', () => {
    const service = interpret(composed)
    service.do('Start')
    service.do('Toggle')
  })

  it('subscribe callback exposes composed change types', () => {
    const service = interpret(composed)

    const unsubscribe = service.subscribe((change) => {
      interface ExpectedContext {
        readonly power: { toggles: number }
        readonly starts: number
      }

      check<Equal<typeof change.context, ExpectedContext>>()
      check<Equal<typeof change.state, 'Idle' | 'Off' | 'On'>>()
      check<Equal<typeof change.action.type, 'Start' | 'Toggle'>>()
      check<Equal<typeof change.action.source, 'Idle' | 'Off' | 'On'>>()
      check<Equal<typeof change.action.target, 'Idle' | 'Off' | 'On'>>()
      check<Equal<typeof change.action.payload, never>>()
    })

    check<Equal<typeof unsubscribe, () => void>>()
    unsubscribe()
  })

  it('parent guard sees composed context and parent action type', () => {
    const machine = stateMachine()
      .state('Idle')
      .compose('power', child)
      .initial('Idle')
      .action<'Start'>('Start')
      .context({ starts: 0 })
      .transition(
        'Idle',
        [
          'Start',
          (context, action) => {
            interface ExpectedContext {
              readonly power: { toggles: number }
              readonly starts: number
            }

            check<Equal<typeof context, ExpectedContext>>()
            check<Equal<typeof action.type, 'Start'>>()
            check<Equal<typeof action.payload, never>>()

            return true
          },
        ],
        'On',
      )

    // compile-time only: creation must type-check with the guard signature
    interpret(machine)
  })

  // ── Happy path: typed action payload from child ──────────────────
  it('typed action payload resolves through composed children', () => {
    const typedChild = stateMachine()
      .state('X')
      .initial('X')
      .action<'Typed', { n: number }>('Typed')
      .context(0)
      .transition('X', 'Typed', 'X')

    const withTypedChild = stateMachine()
      .state('Root')
      .compose('tc', typedChild)
      .initial('Root')
      .action<'Go'>('Go')
      .transition('Root', 'Go', 'X')

    type M = InferStateMachineModel<typeof withTypedChild>
    type TP = StateMachineActionPayload<M, 'Typed'>
    check<Equal<TP, { n: number }>>()
  })

  it('child guard keeps child context and typed payload', () => {
    const typedChild = stateMachine()
      .state('X')
      .state('Y')
      .initial('X')
      .action<'Typed', { n: number }>('Typed')
      .context({ count: 0 })
      .transition(
        'X',
        [
          'Typed',
          (context, action) => {
            check<Equal<typeof context, Readonly<{ count: number }>>>()
            check<Equal<typeof action.type, 'Typed'>>()
            check<Equal<typeof action.payload, { n: number }>>()

            return action.payload.n > -1
          },
        ],
        'Y',
      )

    const machine = stateMachine()
      .state('Root')
      .compose('tc', typedChild)
      .initial('Root')
      .action<'Go'>('Go')
      .transition('Root', 'Go', 'X')

    interpret(machine)
  })

  it('subscribe callback narrows payload by action discriminator', () => {
    const typedChild = stateMachine()
      .state('X')
      .initial('X')
      .action<'Typed', { n: number }>('Typed')
      .context(0)
      .transition('X', 'Typed', 'X')

    const machine = stateMachine()
      .state('Root')
      .compose('tc', typedChild)
      .initial('Root')
      .action<'Go'>('Go')
      .transition('Root', 'Go', 'X')

    const service = interpret(machine)

    service.subscribe((change) => {
      if (change.action.type === 'Typed') {
        check<Equal<typeof change.action.payload, { n: number }>>()
      }
    })
  })

  // ── Happy path: same-payload overlap ──────────────────────────────
  it('precondition rejects when sibling actions overlap even with same payload', () => {
    const left = stateMachine()
      .state('L')
      .initial('L')
      .action<'Shared', { value: number }>('Shared')
      .transition('L', 'Shared', 'L')

    const right = stateMachine()
      .state('R')
      .initial('R')
      .action<'Shared', { value: number }>('Shared')
      .transition('R', 'Shared', 'R')

    const parent = stateMachine()
      .state('Root')
      .compose('left', left)
      .initial('Root')
      .action<'Go'>('Go')
      .transition('Root', 'Go', 'L')

    type P = InferStateMachineModel<typeof parent>
    type Pre = StateMachineComposePrecondition<P, 'right', typeof right>
    check<Equal<Pre, never>>()
  })

  it('precondition allows parent-declared action overlapping child action', () => {
    const child = stateMachine()
      .state('C')
      .initial('C')
      .action<'Shared', { value: number }>('Shared')
      .transition('C', 'Shared', 'C')

    const parent = stateMachine()
      .state('P')
      .initial('P')
      .action<'Shared', { value: number }>('Shared')
      .transition('P', 'Shared', 'P')

    type P = InferStateMachineModel<typeof parent>
    type Pre = StateMachineComposePrecondition<P, 'g', typeof child>
    check<Equal<IsNever<Pre>, false>>()
  })

  // ── Failure path: state conflict ──────────────────────────────────
  it('precondition rejects when child state overlaps parent state', () => {
    const childA = stateMachine().state('A').initial('A').action<'X'>('X').transition('A', 'X', 'A')

    const parent = stateMachine().state('A').initial('A').action<'Y'>('Y').transition('A', 'Y', 'A')

    type P = InferStateMachineModel<typeof parent>
    type Pre = StateMachineComposePrecondition<P, 'g', typeof childA>
    check<Equal<Pre, never>>()
  })

  // ── Failure path: group name collides with state ──────────────────
  it('precondition rejects when group name is an existing state', () => {
    const childA = stateMachine().state('C').initial('C').action<'X'>('X').transition('C', 'X', 'C')

    const parent = stateMachine().state('g').initial('g').action<'Y'>('Y').transition('g', 'Y', 'g')

    type P = InferStateMachineModel<typeof parent>
    type Pre = StateMachineComposePrecondition<P, 'g', typeof childA>
    check<Equal<Pre, never>>()
  })

  // ── Failure path: duplicate group name ────────────────────────────
  it('precondition rejects when group name is already composed', () => {
    const childA = stateMachine().state('A').initial('A').action<'X'>('X').transition('A', 'X', 'A')

    const childB = stateMachine().state('B').initial('B').action<'X'>('X').transition('B', 'X', 'B')

    const parent = stateMachine()
      .state('Root')
      .compose('g', childA)
      .initial('Root')
      .action<'Y'>('Y')
      .transition('Root', 'Y', 'A')

    type P = InferStateMachineModel<typeof parent>
    type Pre = StateMachineComposePrecondition<P, 'g', typeof childB>
    check<Equal<Pre, never>>()
  })

  // ── Failure path: incompatible action payload ─────────────────────
  it('precondition rejects when overlapping action has different payload type', () => {
    const childNumber = stateMachine()
      .state('N')
      .initial('N')
      .action<'Shared', { v: number }>('Shared')
      .transition('N', 'Shared', 'N')

    const childString = stateMachine()
      .state('S')
      .initial('S')
      .action<'Shared', { v: string }>('Shared')
      .transition('S', 'Shared', 'S')

    const parent = stateMachine()
      .state('Root')
      .compose('num', childNumber)
      .initial('Root')
      .action<'Y'>('Y')
      .transition('Root', 'Y', 'N')

    type P = InferStateMachineModel<typeof parent>
    type Pre = StateMachineComposePrecondition<P, 'str', typeof childString>
    check<Equal<Pre, never>>()
  })

  it('precondition rejects sibling overlap with no-payload actions', () => {
    const childA = stateMachine()
      .state('A')
      .initial('A')
      .action<'Ping'>('Ping')
      .transition('A', 'Ping', 'A')

    const childB = stateMachine()
      .state('B')
      .initial('B')
      .action<'Ping'>('Ping')
      .transition('B', 'Ping', 'B')

    const parent = stateMachine()
      .state('Root')
      .compose('a', childA)
      .initial('Root')
      .action<'Go'>('Go')
      .transition('Root', 'Go', 'A')

    type P = InferStateMachineModel<typeof parent>
    type Pre = StateMachineComposePrecondition<P, 'b', typeof childB>
    check<Equal<Pre, never>>()
  })

  it('precondition rejects parent/child overlap with different payload', () => {
    const child = stateMachine()
      .state('C')
      .initial('C')
      .action<'Act', { v: string }>('Act')
      .transition('C', 'Act', 'C')

    const parent = stateMachine()
      .state('P')
      .initial('P')
      .action<'Act', { v: number }>('Act')
      .transition('P', 'Act', 'P')

    type P = InferStateMachineModel<typeof parent>
    type Pre = StateMachineComposePrecondition<P, 'g', typeof child>
    check<Equal<Pre, never>>()
  })

  it('precondition rejects when third child overlaps first but not second', () => {
    const childA = stateMachine().state('A').initial('A').action<'X'>('X').transition('A', 'X', 'A')

    const childB = stateMachine().state('B').initial('B').action<'Y'>('Y').transition('B', 'Y', 'B')

    const childC = stateMachine().state('C').initial('C').action<'X'>('X').transition('C', 'X', 'C')

    const parent = stateMachine()
      .state('Root')
      .compose('a', childA)
      .compose('b', childB)
      .initial('Root')
      .action<'Go'>('Go')
      .transition('Root', 'Go', 'A')

    type P = InferStateMachineModel<typeof parent>
    // childC's 'X' overlaps childA's 'X'
    type Pre = StateMachineComposePrecondition<P, 'c', typeof childC>
    check<Equal<Pre, never>>()
  })
})
