import { assert, describe, it } from 'vitest'
import { interpret, stateMachine, type InferStateMachineModel } from '../index'
import type {
  StateMachineContextAtState,
  StateMachinePredicate,
  StateMachineReducer,
} from '../types'

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
// eslint-disable-next-line typescript/no-empty-function
function check<_T extends true>() {}

// ── Fixtures ────────────────────────────────────────────────────────

const numberMachine = stateMachine()
  .state('A')
  .state('B')
  .initial('A')
  .action<'Go'>('Go')
  .context<number>(() => 0)
  .transition('A', 'Go', 'B', (context) => context + 1)
  .transition('B', 'Go', 'A', (context) => context + 1)

type NModel = InferStateMachineModel<typeof numberMachine>

const stringMachine = stateMachine()
  .state('X')
  .state('Y')
  .initial('X')
  .action<'Swap'>('Swap')
  .context<string>(() => 'hello')
  .transition('X', 'Swap', 'Y', (context) => context.toUpperCase())
  .transition('Y', 'Swap', 'X', (context) => context.toLowerCase())

type SModel = InferStateMachineModel<typeof stringMachine>

// ── Type-level ──────────────────────────────────────────────────────

describe('primitive context: type-level', () => {
  it('StateMachineContextAtState falls back to primitive type', () => {
    check<Equal<StateMachineContextAtState<number, 'A'>, number>>()
    check<Equal<StateMachineContextAtState<number, 'B'>, number>>()
    check<Equal<StateMachineContextAtState<string, 'X'>, string>>()
  })

  it('guard context is Readonly<number>', () => {
    type Guard = StateMachinePredicate<NModel, 'A', 'Go', 'B'>
    type GuardContext = Parameters<Guard>[0]
    check<Equal<GuardContext, Readonly<number>>>()
  })

  it('reducer input and output are both number', () => {
    type Reducer = StateMachineReducer<NModel, 'A', 'Go', 'B'>
    type ReducerInput = Parameters<Reducer>[0]
    type ReducerOutput = globalThis.ReturnType<Reducer>
    check<Equal<ReducerInput, number>>()
    check<Equal<ReducerOutput, number>>()
  })

  it('string context: reducer input and output are both string', () => {
    type Reducer = StateMachineReducer<SModel, 'X', 'Swap', 'Y'>
    type ReducerInput = Parameters<Reducer>[0]
    type ReducerOutput = globalThis.ReturnType<Reducer>
    check<Equal<ReducerInput, string>>()
    check<Equal<ReducerOutput, string>>()
  })

  it('reducer is optional for cross-state transition (no variants to differ)', () => {
    // Compiles without reducer — StateMachineContextAtState<number, 'A'> === StateMachineContextAtState<number, 'B'>
    stateMachine()
      .state('A')
      .state('B')
      .initial('A')
      .action<'Go'>('Go')
      .context<number>(() => 0)
      .transition('A', 'Go', 'B')
  })
})

// ── Runtime ─────────────────────────────────────────────────────────

describe('primitive context: runtime', () => {
  it('number context: transitions update context correctly', () => {
    const svc = interpret(numberMachine.done())
    assert.equal(svc.context, 0)
    assert.equal(svc.state, 'A')

    svc.do('Go')
    assert.equal(svc.context, 1)
    assert.equal(svc.state, 'B')

    svc.do('Go')
    assert.equal(svc.context, 2)
    assert.equal(svc.state, 'A')
  })

  it('string context: transitions update context correctly', () => {
    const svc = interpret(stringMachine.done())
    assert.equal(svc.context, 'hello')

    svc.do('Swap')
    assert.equal(svc.context, 'HELLO')
    assert.equal(svc.state, 'Y')

    svc.do('Swap')
    assert.equal(svc.context, 'hello')
    assert.equal(svc.state, 'X')
  })

  it('injection is no-op for primitive context', () => {
    const svc = interpret(numberMachine.done())
    svc.do('Go')

    // number has no 'state' property — injection guard skips
    assert.equal(typeof svc.context, 'number')
    assert.equal(svc.context, 1)
  })

  it('draft works with primitive context', () => {
    const svc = interpret(numberMachine.done())
    const draft = svc.draft()

    draft.do('Go')
    assert.equal(draft.context, 1)
    assert.equal(svc.context, 0)

    draft.commit()
    assert.equal(svc.context, 1)
  })

  it('subscribe sees correct primitive context', () => {
    const svc = interpret(numberMachine.done())
    const seen: number[] = []

    svc.subscribe((change) => {
      seen.push(change.context)
    })

    svc.do('Go')
    svc.do('Go')
    assert.deepEqual(seen, [1, 2])
  })
})
