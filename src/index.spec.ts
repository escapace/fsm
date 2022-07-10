/* eslint-disable @typescript-eslint/unbound-method */
/* eslint-disable @typescript-eslint/ban-ts-comment */

import { stateMachine, interpret, SYMBOL_LOG, SYMBOL_STATE } from './index'
import { cloneDeep } from 'lodash-es'

import { assert } from 'chai'
import { spy } from 'sinon'

interface PayloadCoin {
  coin: 5 | 10 | 25 | 50
}

interface TurnstileState {
  coins: Array<5 | 10 | 25 | 50>
  active: Array<5 | 10 | 25 | 50>
}

enum TypeAction {
  Coin = 'COIN',
  Push = 'PUSH'
}

enum TypeState {
  Unlocked = 'UNLOCKED',
  Waiting = 'WAITING',
  Locked = 'LOCKED'
}

enum TypeSpy {
  Lock = 'LOCK',
  Unlock = 'UNLOCK',
  Wait = 'WAIT',
  Condition = 'CONDITION'
}

const sum = (array: number[]): number =>
  array.reduce((p: number, c: number) => p + c, 0)

const change = (...values: Array<5 | 10 | 25 | 50>) =>
  values
    .sort((a, b) => b - a)
    .reduce((acc: Array<5 | 10 | 25 | 50>, curr: 5 | 10 | 25 | 50) => {
      if (sum(acc) >= 50) {
        return acc
      }

      return [...acc, curr]
    }, [])
    .sort((a, b) => a - b)

describe('./src/index.spec.ts', () => {
  const spyTransition = spy()
  const spyObservable = spy()

  const machine = stateMachine()
    .state(TypeState.Unlocked)
    .state(TypeState.Waiting)
    .state(TypeState.Locked)
    .initial(TypeState.Locked)
    .action<TypeAction.Coin, PayloadCoin>(TypeAction.Coin)
    .action(TypeAction.Push)
    .context<TurnstileState>({ coins: [], active: [] })
    .transition(
      [TypeState.Locked, TypeState.Waiting],
      [
        TypeAction.Coin,
        (context, action) => {
          spyTransition(
            TypeSpy.Condition,
            cloneDeep(context),
            cloneDeep(action)
          )

          return sum(context.active) + action.payload.coin >= 50
        }
      ],
      TypeState.Unlocked,
      (context, action) => {
        spyTransition(TypeSpy.Unlock, cloneDeep(context), cloneDeep(action))

        context.coins = [
          ...context.coins,
          ...change(...context.active, action.payload.coin)
        ]

        context.active = []

        return context
      }
    )
    .transition(
      [TypeState.Locked, TypeState.Waiting],
      TypeAction.Coin,
      TypeState.Waiting,
      (context, action) => {
        spyTransition(TypeSpy.Wait, cloneDeep(context), cloneDeep(action))

        context.active = change(...context.active, action.payload.coin)

        return context
      }
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
      }
    )

  // it('mutabe', () => {
  //   const log = cloneDeep(machine[SYMBOL_LOG])
  //   const state = cloneDeep(machine[SYMBOL_STATE])
  //
  //   machine.transition(TypeState.Waiting, TypeAction.Push, TypeState.Unlocked)
  //
  //   assert.deepEqual(machine[SYMBOL_LOG], log)
  //   assert.deepEqual(machine[SYMBOL_STATE], state)
  // })

  it('api', () => {
    const turnstile = interpret(machine)

    assert.hasAllKeys(machine, ['transition', SYMBOL_LOG, SYMBOL_STATE])
    assert.containsAllKeys(turnstile, ['state', 'do', 'subscribe', 'context'])
  })

  it('happy path', () => {
    spyTransition.resetHistory()
    spyObservable.resetHistory()

    const turnstile = interpret(machine)

    const { unsubscribe } = turnstile.subscribe({
      next: (value) => {
        spyObservable(cloneDeep(value))
      }
    })

    const coin = (coin: 5 | 10 | 25 | 50) =>
      turnstile.do(TypeAction.Coin, { coin })

    assert.equal(turnstile.state, TypeState.Locked)

    assert.equal(spyTransition.callCount, 0)
    assert.equal(spyObservable.callCount, 0)

    // 5 -----------------------------------------------------------------------

    coin(5)

    assert.equal(spyTransition.callCount, 2)

    assert.deepEqual(spyTransition.getCall(0).args, [
      TypeSpy.Condition,
      { coins: [], active: [] },
      {
        type: TypeAction.Coin,
        payload: { coin: 5 },
        source: TypeState.Locked,
        target: TypeState.Unlocked
      }
    ])

    assert.deepEqual(spyTransition.getCall(1).args, [
      TypeSpy.Wait,
      { coins: [], active: [] },
      {
        type: TypeAction.Coin,
        payload: { coin: 5 },
        source: TypeState.Locked,
        target: TypeState.Waiting
      }
    ])

    assert.equal(turnstile.state, TypeState.Waiting)

    assert.deepEqual(turnstile.context, {
      coins: [],
      active: [5]
    })

    assert.equal(spyObservable.callCount, 1)

    assert.deepEqual(spyObservable.getCall(0).args[0], {
      state: TypeState.Waiting,
      context: {
        active: [5],
        coins: []
      },
      action: {
        type: TypeAction.Coin,
        payload: { coin: 5 },
        source: TypeState.Locked,
        target: TypeState.Waiting
      }
    })

    // 10 ----------------------------------------------------------------------

    coin(10)

    assert.equal(spyTransition.callCount, 4)

    assert.deepEqual(spyTransition.getCall(2).args, [
      TypeSpy.Condition,
      { coins: [], active: [5] },
      {
        type: TypeAction.Coin,
        payload: { coin: 10 },
        source: TypeState.Waiting,
        target: TypeState.Unlocked
      }
    ])

    assert.deepEqual(spyTransition.getCall(3).args, [
      TypeSpy.Wait,
      { coins: [], active: [5] },
      {
        type: TypeAction.Coin,
        payload: { coin: 10 },
        source: TypeState.Waiting,
        target: TypeState.Waiting
      }
    ])

    assert.equal(turnstile.state, TypeState.Waiting)

    assert.deepEqual(turnstile.context, {
      coins: [],
      active: [5, 10]
    })

    assert.equal(spyObservable.callCount, 2)

    assert.deepEqual(spyObservable.getCall(1).args[0], {
      state: TypeState.Waiting,
      context: {
        active: [5, 10],
        coins: []
      },
      action: {
        type: TypeAction.Coin,
        payload: { coin: 10 },
        source: TypeState.Waiting,
        target: TypeState.Waiting
      }
    })

    // 25 ----------------------------------------------------------------------

    coin(25)

    assert.equal(spyTransition.callCount, 6)

    assert.deepEqual(spyTransition.getCall(4).args, [
      TypeSpy.Condition,
      { coins: [], active: [5, 10] },
      {
        type: TypeAction.Coin,
        payload: { coin: 25 },
        source: TypeState.Waiting,
        target: TypeState.Unlocked
      }
    ])

    assert.deepEqual(spyTransition.getCall(5).args, [
      TypeSpy.Wait,
      { coins: [], active: [5, 10] },
      {
        type: TypeAction.Coin,
        payload: { coin: 25 },
        source: TypeState.Waiting,
        target: TypeState.Waiting
      }
    ])

    assert.equal(turnstile.state, TypeState.Waiting)

    assert.deepEqual(turnstile.context, {
      coins: [],
      active: [5, 10, 25]
    })

    assert.equal(spyObservable.callCount, 3)

    assert.deepEqual(spyObservable.getCall(2).args[0], {
      state: TypeState.Waiting,
      context: {
        active: [5, 10, 25],
        coins: []
      },
      action: {
        type: TypeAction.Coin,
        payload: { coin: 25 },
        source: TypeState.Waiting,
        target: TypeState.Waiting
      }
    })

    // 25 ----------------------------------------------------------------------

    coin(25)

    assert.equal(spyTransition.callCount, 8)

    assert.deepEqual(spyTransition.getCall(6).args, [
      TypeSpy.Condition,
      { coins: [], active: [5, 10, 25] },
      {
        type: TypeAction.Coin,
        payload: { coin: 25 },
        source: TypeState.Waiting,
        target: TypeState.Unlocked
      }
    ])

    assert.deepEqual(spyTransition.getCall(7).args, [
      TypeSpy.Unlock,
      { coins: [], active: [5, 10, 25] },
      {
        type: TypeAction.Coin,
        payload: { coin: 25 },
        source: TypeState.Waiting,
        target: TypeState.Unlocked
      }
    ])

    assert.equal(turnstile.state, TypeState.Unlocked)

    assert.deepEqual(turnstile.context, {
      coins: [25, 25],
      active: []
    })

    assert.equal(spyObservable.callCount, 4)

    assert.deepEqual(spyObservable.getCall(3).args[0], {
      state: TypeState.Unlocked,
      context: {
        active: [],
        coins: [25, 25]
      },
      action: {
        type: TypeAction.Coin,
        payload: { coin: 25 },
        source: TypeState.Waiting,
        target: TypeState.Unlocked
      }
    })

    // 25 ----------------------------------------------------------------------

    coin(25)

    assert.equal(spyTransition.callCount, 8)
    assert.equal(turnstile.state, TypeState.Unlocked)

    assert.deepEqual(turnstile.context, {
      coins: [25, 25],
      active: []
    })

    assert.equal(spyObservable.callCount, 5)

    assert.deepEqual(spyObservable.getCall(4).args[0], {
      state: TypeState.Unlocked,
      context: {
        active: [],
        coins: [25, 25]
      },
      action: {
        type: TypeAction.Coin,
        payload: { coin: 25 },
        source: TypeState.Unlocked,
        target: TypeState.Unlocked
      }
    })

    turnstile.do(TypeAction.Push)
    assert.equal(spyTransition.callCount, 9)

    assert.deepEqual(spyTransition.getCall(8).args, [
      TypeSpy.Lock,
      {
        active: [],
        coins: [25, 25]
      },
      {
        type: TypeAction.Push,
        payload: undefined,
        source: TypeState.Unlocked,
        target: TypeState.Locked
      }
    ])

    assert.equal(turnstile.state, TypeState.Locked)

    assert.equal(spyObservable.callCount, 6)

    assert.deepEqual(spyObservable.getCall(5).args[0], {
      state: TypeState.Locked,
      context: {
        active: [],
        coins: [25, 25]
      },
      action: {
        type: TypeAction.Push,
        payload: undefined,
        source: TypeState.Unlocked,
        target: TypeState.Locked
      }
    })

    // 50 ----------------------------------------------------------------------

    coin(50)
    assert.equal(spyTransition.callCount, 11)

    assert.deepEqual(spyTransition.getCall(9).args, [
      TypeSpy.Condition,
      {
        active: [],
        coins: [25, 25]
      },
      {
        type: TypeAction.Coin,
        payload: { coin: 50 },
        source: TypeState.Locked,
        target: TypeState.Unlocked
      }
    ])

    assert.deepEqual(spyTransition.getCall(10).args, [
      TypeSpy.Unlock,
      {
        active: [],
        coins: [25, 25]
      },
      {
        type: TypeAction.Coin,
        payload: { coin: 50 },
        source: TypeState.Locked,
        target: TypeState.Unlocked
      }
    ])

    assert.equal(turnstile.state, TypeState.Unlocked)

    assert.deepEqual(turnstile.context, {
      coins: [25, 25, 50],
      active: []
    })

    assert.equal(spyObservable.callCount, 7)

    assert.deepEqual(spyObservable.getCall(6).args[0], {
      state: TypeState.Unlocked,
      context: {
        active: [],
        coins: [25, 25, 50]
      },
      action: {
        type: TypeAction.Coin,
        payload: { coin: 50 },
        source: TypeState.Locked,
        target: TypeState.Unlocked
      }
    })

    unsubscribe()

    turnstile.do(TypeAction.Push)
    assert.equal(turnstile.state, TypeState.Locked)

    // 10 ----------------------------------------------------------------------

    coin(10)
    assert.equal(spyTransition.callCount, 14)

    assert.equal(turnstile.state, TypeState.Waiting)

    assert.deepEqual(turnstile.context, {
      coins: [25, 25, 50],
      active: [10]
    })

    turnstile.do(TypeAction.Push)

    assert.equal(turnstile.state, TypeState.Locked)

    assert.deepEqual(turnstile.context, {
      coins: [25, 25, 50],
      active: []
    })

    assert.equal(spyObservable.callCount, 7)
  })

  it('fff', () => {
    assert.throws(() =>
      // @ts-expect-error
      stateMachine().state(TypeState.Unlocked).state(TypeState.Unlocked)
    )

    assert.throws(() =>
      // @ts-expect-error
      stateMachine().state(TypeState.Unlocked).initial(TypeState.Locked)
    )

    assert.throws(() =>
      stateMachine()
        .state(TypeState.Unlocked)
        .initial(TypeState.Unlocked)
        .action(TypeAction.Push)
        // @ts-expect-error
        .action(TypeAction.Push)
    )

    assert.throws(() =>
      stateMachine()
        .state(TypeState.Unlocked)
        .initial(TypeState.Unlocked)
        .action(TypeAction.Push)
        // @ts-expect-error
        .transition(TypeState.Locked, TypeAction.Push, TypeState.Unlocked)
    )

    assert.throws(() =>
      stateMachine()
        .state(TypeState.Unlocked)
        .initial(TypeState.Unlocked)
        .action(TypeAction.Push)
        // @ts-expect-error
        .transition(TypeState.Unlocked, TypeAction.Coin, TypeState.Unlocked)
    )

    assert.throws(() =>
      stateMachine()
        .state(TypeState.Unlocked)
        .initial(TypeState.Unlocked)
        .action(TypeAction.Push)
        // @ts-expect-error
        .transition(TypeState.Unlocked, TypeAction.Push, TypeState.Locked)
    )

    assert.throws(() =>
      interpret(
        stateMachine()
          .state(TypeState.Unlocked)
          .initial(TypeState.Unlocked)
          .action(TypeAction.Push)
          .transition(TypeState.Unlocked, TypeAction.Push, TypeState.Unlocked)
        // @ts-expect-error
      ).do(TypeAction.Coin)
    )

    assert.throws(() =>
      // @ts-expect-error
      interpret(stateMachine().state(TypeState.Unlocked))
    )
  })
})
