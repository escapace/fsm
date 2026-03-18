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

    const service = interpret(machine, {
      hydrate: {
        context: { count: 10 },
        state: 'B',
      },
    })

    check<Equal<typeof service.state, 'A' | 'B'>>()
    check<Equal<typeof service.context, { count: number }>>()
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

  it('keeps plain interpret(machine) inference unchanged', () => {
    const machine = stateMachine()
      .state('A')
      .initial('A')
      .action<'STEP'>('STEP')
      .transition('A', 'STEP', 'A')
    const service = interpret(machine)

    check<Equal<typeof service.state, 'A'>>()
    void service.context
  })
})
