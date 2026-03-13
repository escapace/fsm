/* eslint-disable typescript/ban-ts-comment */

import { cloneDeep } from 'es-toolkit'
import { interpret, STATE_MACHINE_LOG, STATE_MACHINE_STATE, stateMachine } from '../index'

import { assert, describe, it, vi } from 'vitest'

interface PayloadCoin {
  coin: 10 | 25 | 5 | 50
}

interface TurnstileState {
  active: Array<10 | 25 | 5 | 50>
  coins: Array<10 | 25 | 5 | 50>
}

enum TypeAction {
  Coin = 'COIN',
  Push = 'PUSH',
}

enum TypeState {
  Locked = 'LOCKED',
  Unlocked = 'UNLOCKED',
  Waiting = 'WAITING',
}

enum TypeSpy {
  Condition = 'CONDITION',
  Lock = 'LOCK',
  Unlock = 'UNLOCK',
  Wait = 'WAIT',
}

const sum = (array: number[]): number => array.reduce((p: number, c: number) => p + c, 0)

const change = (...values: Array<10 | 25 | 5 | 50>) =>
  values
    .sort((a, b) => b - a)
    .reduce((accumulator: Array<10 | 25 | 5 | 50>, current: 10 | 25 | 5 | 50) => {
      if (sum(accumulator) >= 50) {
        return accumulator
      }

      return [...accumulator, current]
    }, [])
    .sort((a, b) => a - b)

describe('./src/__tests__/index.spec.ts', () => {
  const spyTransition = vi.fn()
  const spyObservable = vi.fn()

  const machine = stateMachine()
    .state(TypeState.Unlocked)
    .state(TypeState.Waiting)
    .state(TypeState.Locked)
    .initial(TypeState.Locked)
    .action<TypeAction.Coin, PayloadCoin>(TypeAction.Coin)
    .action(TypeAction.Push)
    .context<TurnstileState>({ active: [], coins: [] })
    .transition(
      [TypeState.Locked, TypeState.Waiting],
      [
        TypeAction.Coin,
        (context, action) => {
          spyTransition(TypeSpy.Condition, cloneDeep(context), cloneDeep(action))

          return sum(context.active) + action.payload.coin >= 50
        },
      ],
      TypeState.Unlocked,
      (context, action) => {
        spyTransition(TypeSpy.Unlock, cloneDeep(context), cloneDeep(action))

        context.coins = [...context.coins, ...change(...context.active, action.payload.coin)]

        context.active = []

        return context
      },
    )
    .transition(
      [TypeState.Locked, TypeState.Waiting],
      TypeAction.Coin,
      TypeState.Waiting,
      (context, action) => {
        spyTransition(TypeSpy.Wait, cloneDeep(context), cloneDeep(action))

        context.active = change(...context.active, action.payload.coin)

        return context
      },
    )
    .transition(TypeState.Unlocked, TypeAction.Coin, [TypeState.Unlocked])
    .transition(
      [TypeState.Locked, TypeState.Unlocked, TypeState.Waiting],
      TypeAction.Push,
      TypeState.Locked,
      (context, action) => {
        spyTransition(TypeSpy.Lock, cloneDeep(context), cloneDeep(action))

        context.active = []

        return context
      },
    )

  it('api', () => {
    const turnstile = interpret(machine)

    assert.hasAllKeys(machine, ['compose', 'transition', STATE_MACHINE_LOG, STATE_MACHINE_STATE])
    assert.containsAllKeys(turnstile, ['state', 'do', 'subscribe', 'context'])
  })

  it('happy path', () => {
    spyTransition.mockReset()
    spyObservable.mockReset()

    const turnstile = interpret(machine)

    const unsubscribe = turnstile.subscribe((value) => {
      spyObservable(cloneDeep(value))
    })

    const coin = (coin: 10 | 25 | 5 | 50) => turnstile.do(TypeAction.Coin, { coin })

    assert.equal(turnstile.state, TypeState.Locked)

    assert.equal(spyTransition.mock.calls.length, 0)
    assert.equal(spyObservable.mock.calls.length, 0)

    // 5 -----------------------------------------------------------------------

    coin(5)

    assert.equal(spyTransition.mock.calls.length, 2)

    assert.deepEqual(spyTransition.mock.calls[0], [
      TypeSpy.Condition,
      { active: [], coins: [] },
      {
        payload: { coin: 5 },
        source: TypeState.Locked,
        target: TypeState.Unlocked,
        type: TypeAction.Coin,
      },
    ])

    assert.deepEqual(spyTransition.mock.calls[1], [
      TypeSpy.Wait,
      { active: [], coins: [] },
      {
        payload: { coin: 5 },
        source: TypeState.Locked,
        target: TypeState.Waiting,
        type: TypeAction.Coin,
      },
    ])

    assert.equal(turnstile.state, TypeState.Waiting)

    assert.deepEqual(turnstile.context, {
      active: [5],
      coins: [],
    })

    assert.equal(spyObservable.mock.calls.length, 1)

    assert.deepEqual(spyObservable.mock.calls[0][0], {
      action: {
        payload: { coin: 5 },
        source: TypeState.Locked,
        target: TypeState.Waiting,
        type: TypeAction.Coin,
      },
      context: {
        active: [5],
        coins: [],
      },
      state: TypeState.Waiting,
    })

    // 10 ----------------------------------------------------------------------

    coin(10)

    assert.equal(spyTransition.mock.calls.length, 4)

    assert.deepEqual(spyTransition.mock.calls[2], [
      TypeSpy.Condition,
      { active: [5], coins: [] },
      {
        payload: { coin: 10 },
        source: TypeState.Waiting,
        target: TypeState.Unlocked,
        type: TypeAction.Coin,
      },
    ])

    assert.deepEqual(spyTransition.mock.calls[3], [
      TypeSpy.Wait,
      { active: [5], coins: [] },
      {
        payload: { coin: 10 },
        source: TypeState.Waiting,
        target: TypeState.Waiting,
        type: TypeAction.Coin,
      },
    ])

    assert.equal(turnstile.state, TypeState.Waiting)

    assert.deepEqual(turnstile.context, {
      active: [5, 10],
      coins: [],
    })

    assert.equal(spyObservable.mock.calls.length, 2)

    assert.deepEqual(spyObservable.mock.calls[1][0], {
      action: {
        payload: { coin: 10 },
        source: TypeState.Waiting,
        target: TypeState.Waiting,
        type: TypeAction.Coin,
      },
      context: {
        active: [5, 10],
        coins: [],
      },
      state: TypeState.Waiting,
    })

    // 25 ----------------------------------------------------------------------

    coin(25)

    assert.equal(spyTransition.mock.calls.length, 6)

    assert.deepEqual(spyTransition.mock.calls[4], [
      TypeSpy.Condition,
      { active: [5, 10], coins: [] },
      {
        payload: { coin: 25 },
        source: TypeState.Waiting,
        target: TypeState.Unlocked,
        type: TypeAction.Coin,
      },
    ])

    assert.deepEqual(spyTransition.mock.calls[5], [
      TypeSpy.Wait,
      { active: [5, 10], coins: [] },
      {
        payload: { coin: 25 },
        source: TypeState.Waiting,
        target: TypeState.Waiting,
        type: TypeAction.Coin,
      },
    ])

    assert.equal(turnstile.state, TypeState.Waiting)

    assert.deepEqual(turnstile.context, {
      active: [5, 10, 25],
      coins: [],
    })

    assert.equal(spyObservable.mock.calls.length, 3)

    assert.deepEqual(spyObservable.mock.calls[2][0], {
      action: {
        payload: { coin: 25 },
        source: TypeState.Waiting,
        target: TypeState.Waiting,
        type: TypeAction.Coin,
      },
      context: {
        active: [5, 10, 25],
        coins: [],
      },
      state: TypeState.Waiting,
    })

    // 25 ----------------------------------------------------------------------

    coin(25)

    assert.equal(spyTransition.mock.calls.length, 8)

    assert.deepEqual(spyTransition.mock.calls[6], [
      TypeSpy.Condition,
      { active: [5, 10, 25], coins: [] },
      {
        payload: { coin: 25 },
        source: TypeState.Waiting,
        target: TypeState.Unlocked,
        type: TypeAction.Coin,
      },
    ])

    assert.deepEqual(spyTransition.mock.calls[7], [
      TypeSpy.Unlock,
      { active: [5, 10, 25], coins: [] },
      {
        payload: { coin: 25 },
        source: TypeState.Waiting,
        target: TypeState.Unlocked,
        type: TypeAction.Coin,
      },
    ])

    assert.equal(turnstile.state, TypeState.Unlocked)

    assert.deepEqual(turnstile.context, {
      active: [],
      coins: [25, 25],
    })

    assert.equal(spyObservable.mock.calls.length, 4)

    assert.deepEqual(spyObservable.mock.calls[3][0], {
      action: {
        payload: { coin: 25 },
        source: TypeState.Waiting,
        target: TypeState.Unlocked,
        type: TypeAction.Coin,
      },
      context: {
        active: [],
        coins: [25, 25],
      },
      state: TypeState.Unlocked,
    })

    // 25 ----------------------------------------------------------------------

    coin(25)

    assert.equal(spyTransition.mock.calls.length, 8)
    assert.equal(turnstile.state, TypeState.Unlocked)

    assert.deepEqual(turnstile.context, {
      active: [],
      coins: [25, 25],
    })

    assert.equal(spyObservable.mock.calls.length, 5)

    assert.deepEqual(spyObservable.mock.calls[4][0], {
      action: {
        payload: { coin: 25 },
        source: TypeState.Unlocked,
        target: TypeState.Unlocked,
        type: TypeAction.Coin,
      },
      context: {
        active: [],
        coins: [25, 25],
      },
      state: TypeState.Unlocked,
    })

    turnstile.do(TypeAction.Push)
    assert.equal(spyTransition.mock.calls.length, 9)

    assert.deepEqual(spyTransition.mock.calls[8], [
      TypeSpy.Lock,
      {
        active: [],
        coins: [25, 25],
      },
      {
        payload: undefined,
        source: TypeState.Unlocked,
        target: TypeState.Locked,
        type: TypeAction.Push,
      },
    ])

    assert.equal(turnstile.state, TypeState.Locked)

    assert.equal(spyObservable.mock.calls.length, 6)

    assert.deepEqual(spyObservable.mock.calls[5][0], {
      action: {
        payload: undefined,
        source: TypeState.Unlocked,
        target: TypeState.Locked,
        type: TypeAction.Push,
      },
      context: {
        active: [],
        coins: [25, 25],
      },
      state: TypeState.Locked,
    })

    // 50 ----------------------------------------------------------------------

    coin(50)
    assert.equal(spyTransition.mock.calls.length, 11)

    assert.deepEqual(spyTransition.mock.calls[9], [
      TypeSpy.Condition,
      {
        active: [],
        coins: [25, 25],
      },
      {
        payload: { coin: 50 },
        source: TypeState.Locked,
        target: TypeState.Unlocked,
        type: TypeAction.Coin,
      },
    ])

    assert.deepEqual(spyTransition.mock.calls[10], [
      TypeSpy.Unlock,
      {
        active: [],
        coins: [25, 25],
      },
      {
        payload: { coin: 50 },
        source: TypeState.Locked,
        target: TypeState.Unlocked,
        type: TypeAction.Coin,
      },
    ])

    assert.equal(turnstile.state, TypeState.Unlocked)

    assert.deepEqual(turnstile.context, {
      active: [],
      coins: [25, 25, 50],
    })

    assert.equal(spyObservable.mock.calls.length, 7)

    assert.deepEqual(spyObservable.mock.calls[6][0], {
      action: {
        payload: { coin: 50 },
        source: TypeState.Locked,
        target: TypeState.Unlocked,
        type: TypeAction.Coin,
      },
      context: {
        active: [],
        coins: [25, 25, 50],
      },
      state: TypeState.Unlocked,
    })

    unsubscribe()

    turnstile.do(TypeAction.Push)
    assert.equal(turnstile.state, TypeState.Locked)

    // 10 ----------------------------------------------------------------------

    coin(10)
    assert.equal(spyTransition.mock.calls.length, 14)

    assert.equal(turnstile.state, TypeState.Waiting)

    assert.deepEqual(turnstile.context, {
      active: [10],
      coins: [25, 25, 50],
    })

    turnstile.do(TypeAction.Push)

    assert.equal(turnstile.state, TypeState.Locked)

    assert.deepEqual(turnstile.context, {
      active: [],
      coins: [25, 25, 50],
    })

    assert.equal(spyObservable.mock.calls.length, 7)
  })

  it('service.do() boolean return values', () => {
    // Create a focused state machine to test service.do() return values
    // Based on interpret.ts logic:
    // - Returns false: No transitions for state+action OR all predicates fail
    // - Returns true: Valid transition found and executed

    enum TestState {
      StateA = 'STATE_A',
      StateB = 'STATE_B',
    }

    enum TestAction {
      Always = 'ALWAYS',
      Conditional = 'CONDITIONAL',
      Never = 'NEVER',
      Undefined = 'UNDEFINED', // Won't be defined in machine
    }

    interface TestContext {
      counter: number
    }

    const testMachine = stateMachine()
      .state(TestState.StateA)
      .state(TestState.StateB)
      .initial(TestState.StateA)
      .action<TestAction.Always>(TestAction.Always)
      .action<TestAction.Never>(TestAction.Never)
      .action<TestAction.Conditional, { shouldPass: boolean }>(TestAction.Conditional)
      .context<TestContext>({ counter: 0 })
      // Transition that always succeeds (no predicate)
      .transition(TestState.StateA, TestAction.Always, TestState.StateB)
      // Transition with predicate that always fails
      .transition(
        TestState.StateA,
        [TestAction.Never, () => false], // Predicate always returns false
        TestState.StateB,
      )
      // Transition with conditional predicate
      .transition(
        TestState.StateA,
        [TestAction.Conditional, (_, action) => action.payload.shouldPass],
        TestState.StateB,
      )
    // Note: No transition defined for TestAction.Undefined

    const testService = interpret(testMachine)

    // Test case 1: Valid transition with no predicate - should return true
    assert.equal(testService.state, TestState.StateA)
    const alwaysResult = testService.do(TestAction.Always)
    assert.equal(alwaysResult, true, 'service.do() should return true for valid transition')
    assert.equal(
      testService.state,
      TestState.StateB,
      'State should change after successful transition',
    )

    // Reset to StateA for remaining tests
    const resetMachine = interpret(testMachine)

    // Test case 2: Transition with failing predicate - should return false
    const neverResult = resetMachine.do(TestAction.Never)
    assert.equal(neverResult, false, 'service.do() should return false when predicate fails')
    assert.equal(
      resetMachine.state,
      TestState.StateA,
      'State should not change when transition fails',
    )

    // Test case 3: Transition with passing predicate - should return true
    const conditionalTrueResult = resetMachine.do(TestAction.Conditional, { shouldPass: true })
    assert.equal(
      conditionalTrueResult,
      true,
      'service.do() should return true when predicate passes',
    )
    assert.equal(resetMachine.state, TestState.StateB, 'State should change when predicate passes')

    // Reset again for final test
    const resetMachine2 = interpret(testMachine)

    // Test case 4: Transition with failing predicate - should return false
    const conditionalFalseResult = resetMachine2.do(TestAction.Conditional, { shouldPass: false })
    assert.equal(
      conditionalFalseResult,
      false,
      'service.do() should return false when predicate fails',
    )
    assert.equal(
      resetMachine2.state,
      TestState.StateA,
      'State should not change when predicate fails',
    )

    // Test case 5: Action with no defined transitions - should return false
    // From StateB, try an action that only has transitions from StateA
    testService.do(TestAction.Always) // Move to StateB if not already there
    assert.equal(testService.state, TestState.StateB)

    const noTransitionResult = testService.do(TestAction.Never)
    assert.equal(
      noTransitionResult,
      false,
      'service.do() should return false when no transitions exist for state+action',
    )
    assert.equal(
      testService.state,
      TestState.StateB,
      'State should not change when no transition exists',
    )
  })

  it('fff', () => {
    assert.throws(() =>
      // @ts-expect-error
      stateMachine().state(TypeState.Unlocked).state(TypeState.Unlocked),
    )

    assert.throws(() =>
      // @ts-expect-error
      stateMachine().state(TypeState.Unlocked).initial(TypeState.Locked),
    )

    assert.throws(() =>
      stateMachine()
        .state(TypeState.Unlocked)
        .initial(TypeState.Unlocked)
        .action(TypeAction.Push)
        // @ts-expect-error
        .action(TypeAction.Push),
    )

    assert.throws(() =>
      stateMachine()
        .state(TypeState.Unlocked)
        .initial(TypeState.Unlocked)
        .action(TypeAction.Push)
        // @ts-expect-error
        .transition(TypeState.Locked, TypeAction.Push, TypeState.Unlocked),
    )

    assert.throws(() =>
      stateMachine()
        .state(TypeState.Unlocked)
        .initial(TypeState.Unlocked)
        .action(TypeAction.Push)
        // @ts-expect-error
        .transition(TypeState.Unlocked, TypeAction.Coin, TypeState.Unlocked),
    )

    assert.throws(() =>
      stateMachine()
        .state(TypeState.Unlocked)
        .initial(TypeState.Unlocked)
        .action(TypeAction.Push)
        // @ts-expect-error
        .transition(TypeState.Unlocked, TypeAction.Push, TypeState.Locked),
    )

    assert.throws(() =>
      interpret(
        stateMachine()
          .state(TypeState.Unlocked)
          .initial(TypeState.Unlocked)
          .action(TypeAction.Push)
          .transition(TypeState.Unlocked, TypeAction.Push, TypeState.Unlocked),
        // @ts-expect-error
      ).do(TypeAction.Coin),
    )

    assert.throws(() =>
      // @ts-expect-error
      interpret(stateMachine().state(TypeState.Unlocked)),
    )
  })
})
