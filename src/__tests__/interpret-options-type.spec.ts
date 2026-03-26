/* eslint-disable typescript/no-unused-vars */
import { describe, it } from 'vitest'
import { interpret, stateMachine, type StateMachineInterpretOptions } from '../index'

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false

// eslint-disable-next-line typescript/no-empty-function
function check<_T extends true>() {}

describe('interpret options type-level', () => {
  it('accepts correctly typed hydrate snapshot', () => {
    const machine = stateMachine()
      .state('A')
      .state('B')
      .initial('A')
      .action<'STEP'>('STEP')
      .context(() => ({ count: 0 }))
      .transition('A', 'STEP', 'B', (context) => ({ count: context.count + 1 }))

    const service = interpret(machine.done(), {
      hydrate: {
        context: { count: 10 },
        state: 'B',
      },
    })

    check<Equal<typeof service.state, 'A' | 'B'>>()
    check<Equal<typeof service.context, { count: number }>>()
  })

  it('accepts snapshot and reconcile context policy typed to machine context', () => {
    const machine = stateMachine()
      .state('A')
      .state('B')
      .initial('A')
      .action<'STEP'>('STEP')
      .context(() => ({ count: 0 }))
      .transition('A', 'STEP', 'B', (context) => ({ count: context.count + 1 }))

    type DoneOptions = Parameters<typeof machine.done>[0]

    const doneOptions: DoneOptions = {
      reconcileContext: (_parentContext, nextContext) => nextContext,
      snapshotContext: (context) => ({ count: context.count }),
    }

    const service = interpret(machine.done(doneOptions))

    check<Equal<typeof service.context, { count: number }>>()
  })

  it('rejects invalid snapshot and reconcile policy functions at compile time', () => {
    const machine = stateMachine()
      .state('A')
      .state('B')
      .initial('A')
      .action<'STEP'>('STEP')
      .context(() => ({ count: 0 }))
      .transition('A', 'STEP', 'B', (context) => ({ count: context.count + 1 }))

    type DoneOptions = Parameters<typeof machine.done>[0]

    // @ts-expect-error snapshotContext must return the machine context type
    const badSnapshot: DoneOptions = { snapshotContext: () => 1 }
    void badSnapshot

    // @ts-expect-error reconcileContext must return the machine context type
    const badReconcile: DoneOptions = { reconcileContext: () => ({ nope: true }) }
    void badReconcile

    const badReconcileParameters: DoneOptions = {
      // @ts-expect-error reconcileContext parameters must match machine context type
      reconcileContext: (_parentContext: { wrong: true }, _nextContext: { wrong: true }) => ({
        count: 1,
      }),
    }
    void badReconcileParameters
  })

  it('rejects legacy interpret snapshot/reconcile options at compile time', () => {
    const machine = stateMachine()
      .state('A')
      .state('B')
      .initial('A')
      .action<'STEP'>('STEP')
      .context(() => ({ count: 0 }))
      .transition('A', 'STEP', 'B', (context) => ({ count: context.count + 1 }))

    type InterpretOptions = StateMachineInterpretOptions<typeof machine>

    // @ts-expect-error snapshotContext is no longer an interpret option
    const badSnapshotOption: InterpretOptions = { snapshotContext: () => ({ count: 1 }) }
    void badSnapshotOption

    // @ts-expect-error reconcileContext is no longer an interpret option
    const badReconcileOption: InterpretOptions = { reconcileContext: () => ({ count: 1 }) }
    void badReconcileOption
  })

  it('rejects invalid hydrate state and context at compile time', () => {
    const machine = stateMachine()
      .state('A')
      .state('B')
      .initial('A')
      .action<'STEP'>('STEP')
      .context(() => ({ count: 0 }))
      .transition('A', 'STEP', 'B', (context) => ({ count: context.count + 1 }))

    type Options = StateMachineInterpretOptions<typeof machine>

    // @ts-expect-error state must be one of declared machine states
    const badState: Options = { hydrate: { context: { count: 1 }, state: 'Z' } }
    void badState

    // @ts-expect-error context must match machine context type
    const badContext: Options = { hydrate: { context: { nope: true }, state: 'A' } }
    void badContext
  })

  it('keeps plain interpret(machine.done()) inference unchanged', () => {
    const machine = stateMachine()
      .state('A')
      .initial('A')
      .action<'STEP'>('STEP')
      .transition('A', 'STEP', 'A')
    const service = interpret(machine.done())

    check<Equal<typeof service.state, 'A'>>()
    void service.context
  })

  it('rejects unfinished builders at compile time', () => {
    const builder = stateMachine()
      .state('A')
      .initial('A')
      .action<'STEP'>('STEP')
      .transition('A', 'STEP', 'A')

    void (() => {
      // @ts-expect-error interpret requires a finalized machine definition
      interpret(builder)
    })
  })
})
