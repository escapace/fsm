/**
 * Turnstile State Machine Test Suite
 *
 * This test demonstrates a simple turnstile gate control system that specifically
 * tests transition guard conditions and invalid transition handling.
 */

import { assert, describe, it, vi } from 'vitest'
import { interpret, stateMachine } from '../index'

enum TurnstileState {
  Locked = 'LOCKED',
  Unlocked = 'UNLOCKED',
}

enum TurnstileAction {
  Coin = 'COIN',
  Push = 'PUSH',
}

interface PayloadCoin {
  amount: number
}

interface TurnstileContext {
  coinBalance: number
  pushCount: number
}

describe('Turnstile State Machine', () => {
  it('tests guard condition evaluation and invalid transitions', () => {
    const guardSpy = vi.fn()

    const machine = stateMachine()
      .state(TurnstileState.Locked)
      .state(TurnstileState.Unlocked)
      .initial(TurnstileState.Locked)
      .action(TurnstileAction.Push)
      .action<TurnstileAction.Coin, PayloadCoin>(TurnstileAction.Coin)
      .context<TurnstileContext>(() => ({
        coinBalance: 0,
        pushCount: 0,
      }))
      .transition(
        TurnstileState.Locked,
        [
          TurnstileAction.Coin,
          (context, action) => {
            const result = context.coinBalance + action.payload.amount >= 50
            guardSpy('coinGuard', result, context.coinBalance + action.payload.amount)
            return result
          },
        ],
        TurnstileState.Unlocked,
        (context, action) => ({
          ...context,
          coinBalance: context.coinBalance + action.payload.amount - 50,
        }),
      )
      .transition(
        TurnstileState.Locked,
        TurnstileAction.Coin,
        TurnstileState.Locked,
        (context, action) => ({
          ...context,
          coinBalance: context.coinBalance + action.payload.amount,
        }),
      )
      .transition(
        TurnstileState.Unlocked,
        TurnstileAction.Push,
        TurnstileState.Locked,
        (context) => ({
          ...context,
          pushCount: context.pushCount + 1,
        }),
      )
    // No transition for Push when Locked - tests line 122-123

    const turnstile = interpret(machine)

    // Test guard condition failure
    guardSpy.mockClear()
    turnstile.do(TurnstileAction.Coin, { amount: 25 })
    assert.equal(guardSpy.mock.calls.length, 1)
    assert.deepEqual(guardSpy.mock.calls[0], ['coinGuard', false, 25])
    assert.equal(turnstile.state, TurnstileState.Locked) // Guard failed, uses fallback transition
    assert.equal(turnstile.context.coinBalance, 25)

    // Test guard condition success
    guardSpy.mockClear()
    turnstile.do(TurnstileAction.Coin, { amount: 50 })
    assert.equal(guardSpy.mock.calls.length, 1)
    assert.deepEqual(guardSpy.mock.calls[0], ['coinGuard', true, 75])
    assert.equal(turnstile.state, TurnstileState.Unlocked)
    assert.equal(turnstile.context.coinBalance, 25)

    // Test invalid transition
    turnstile.do(TurnstileAction.Push)
    assert.equal(turnstile.state, TurnstileState.Locked)
    assert.equal(turnstile.context.pushCount, 1)

    // Try invalid action from locked state
    const initialContext = { ...turnstile.context }
    turnstile.do(TurnstileAction.Push) // No transition defined for Push when Locked
    assert.equal(turnstile.state, TurnstileState.Locked) // State unchanged
    assert.deepEqual(turnstile.context, initialContext) // Context unchanged
  })

  it('tests multiple guard conditions with early break', () => {
    const guard1Spy = vi.fn()
    const guard2Spy = vi.fn()

    const machine = stateMachine()
      .state(TurnstileState.Locked)
      .state(TurnstileState.Unlocked)
      .initial(TurnstileState.Locked)
      .action<TurnstileAction.Coin, PayloadCoin>(TurnstileAction.Coin)
      .context<TurnstileContext>({
        coinBalance: 0,
        pushCount: 0,
      })
      .transition(
        TurnstileState.Locked,
        [
          TurnstileAction.Coin,
          (context, action) => {
            const result = context.coinBalance + action.payload.amount >= 50
            guard1Spy('firstGuard', result)
            return result
          },
          (context) => {
            const result = context.pushCount < 10
            guard2Spy('secondGuard', result)
            return result
          },
        ],
        TurnstileState.Unlocked,
        (context, action) => ({
          ...context,
          coinBalance: context.coinBalance + action.payload.amount - 50,
        }),
      )

    const turnstile = interpret(machine)

    // First guard fails, second should not be evaluated
    guard1Spy.mockClear()
    guard2Spy.mockClear()
    turnstile.do(TurnstileAction.Coin, { amount: 25 })

    assert.equal(guard1Spy.mock.calls.length, 1)
    assert.deepEqual(guard1Spy.mock.calls[0], ['firstGuard', false])
    assert.equal(guard2Spy.mock.calls.length, 0) // Second guard not called due to early break
    assert.equal(turnstile.state, TurnstileState.Locked)
  })
})
