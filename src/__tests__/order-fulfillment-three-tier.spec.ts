import { assert, describe, it } from 'vitest'
import { interpret, stateMachine, type InferStateMachineModel } from '../index'
import type {
  StateMachineActionPayload,
  StateMachineActions,
  StateMachineGroups,
  StateMachineStates,
} from '../types'

/**
 * User story:
 * As an operations lead for a commerce platform, I need one machine that can
 * orchestrate checkout, payment authorization, and fraud review so that I can
 * track and audit the full order journey in one deterministic workflow.
 *
 * Jobs to be done:
 * 1) Move an order from cart to completion across three tiers.
 * 2) Branch correctly when guards fail (invalid totals, high fraud score).
 * 3) Surface coherent subscription events for every accepted transition.
 */

// Type-level helper
// Produces a compile-time error at call-site when T is not true.
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
// eslint-disable-next-line typescript/no-empty-function
function check<_T extends true>() {}

interface FraudContext {
  lastScore: number | null
  reviewed: number
}

interface PaymentContext {
  attempts: number
  capturedBy: string | null
}

interface OrderContext {
  checkpoints: string[]
  orderId: string | null
  total: number
}

const buildFraudMachine = () =>
  stateMachine()
    .state('FraudPending')
    .state('FraudClear')
    .state('FraudBlock')
    .initial('FraudPending')
    .action<'Screen', { score: number }>('Screen')
    .context<FraudContext>(() => ({ lastScore: null, reviewed: 0 }))
    .transition(
      'FraudPending',
      [
        'Screen',
        (context, action) => {
          check<Equal<typeof context, Readonly<FraudContext>>>()
          check<Equal<typeof action.type, 'Screen'>>()
          check<Equal<typeof action.payload, { score: number }>>()

          return action.payload.score < 70
        },
      ],
      'FraudClear',
      (context, action) => {
        context.lastScore = action.payload.score
        context.reviewed += 1

        return context
      },
    )
    .transition('FraudPending', 'Screen', 'FraudBlock', (context, action) => {
      context.lastScore = action.payload.score
      context.reviewed += 1

      return context
    })

const buildPaymentMachine = () => {
  const fraud = buildFraudMachine()

  return stateMachine()
    .state('PaymentIdle')
    .state('PaymentAuthorizing')
    .state('PaymentApproved')
    .state('PaymentDeclined')
    .compose('fraud', fraud.done())
    .initial('PaymentIdle')
    .action<'StartAuth'>('StartAuth')
    .action<'StartFraud'>('StartFraud')
    .action<'Capture', { processorId: string }>('Capture')
    .action<'Decline'>('Decline')
    .context<PaymentContext>(() => ({ attempts: 0, capturedBy: null }))
    .transition('PaymentIdle', 'StartAuth', 'PaymentAuthorizing', (context) => {
      context.attempts += 1

      return context
    })
    .transition('PaymentAuthorizing', 'StartFraud', 'FraudPending')
    .transition('FraudClear', 'Capture', 'PaymentApproved', (context, action) => {
      context.capturedBy = action.payload.processorId

      return context
    })
    .transition('FraudBlock', 'Decline', 'PaymentDeclined')
}

const buildOrderMachine = () => {
  const payment = buildPaymentMachine()

  return stateMachine()
    .state('Cart')
    .state('Checkout')
    .state('Completed')
    .state('Cancelled')
    .compose('payment', payment.done())
    .initial('Cart')
    .action<'BeginCheckout'>('BeginCheckout')
    .action<'SubmitOrder', { orderId: string; total: number }>('SubmitOrder')
    .action<'FinalizeOrder'>('FinalizeOrder')
    .action<'Cancel'>('Cancel')
    .context<OrderContext>(() => ({ checkpoints: [], orderId: null, total: 0 }))
    .transition('Cart', 'BeginCheckout', 'Checkout', (context) => {
      context.checkpoints.push('checkout')

      return context
    })
    .transition(
      'Checkout',
      [
        'SubmitOrder',
        (context, action) => {
          check<
            Equal<
              typeof context,
              Readonly<{
                checkpoints: string[]
                orderId: string | null
                payment: {
                  attempts: number
                  capturedBy: string | null
                  fraud: {
                    lastScore: number | null
                    reviewed: number
                  }
                }
                total: number
              }>
            >
          >()
          check<Equal<typeof action.type, 'SubmitOrder'>>()
          check<Equal<typeof action.payload, { orderId: string; total: number }>>()

          return action.payload.total > 0
        },
      ],
      'PaymentIdle',
      (context, action) => {
        context.orderId = action.payload.orderId
        context.total = action.payload.total
        context.checkpoints.push('submitted')

        return context
      },
    )
    .transition('PaymentApproved', 'FinalizeOrder', 'Completed', (context) => {
      context.checkpoints.push('completed')

      return context
    })
    .transition(
      [
        'Cart',
        'Checkout',
        'PaymentIdle',
        'PaymentAuthorizing',
        'FraudPending',
        'FraudClear',
        'FraudBlock',
        'PaymentDeclined',
      ],
      'Cancel',
      'Cancelled',
      (context) => {
        context.checkpoints.push('cancelled')

        return context
      },
    )
}

describe('three-tier order orchestration (type-level)', () => {
  const machine = buildOrderMachine()
  type Model = InferStateMachineModel<typeof machine>

  it('infers full nested state/action/context model', () => {
    check<
      Equal<
        StateMachineStates<Model>,
        | 'Cancelled'
        | 'Cart'
        | 'Checkout'
        | 'Completed'
        | 'FraudBlock'
        | 'FraudClear'
        | 'FraudPending'
        | 'PaymentApproved'
        | 'PaymentAuthorizing'
        | 'PaymentDeclined'
        | 'PaymentIdle'
      >
    >()

    check<
      Equal<
        StateMachineActions<Model>,
        | 'BeginCheckout'
        | 'Cancel'
        | 'Capture'
        | 'Decline'
        | 'FinalizeOrder'
        | 'Screen'
        | 'StartAuth'
        | 'StartFraud'
        | 'SubmitOrder'
      >
    >()

    check<Equal<StateMachineGroups<Model>, 'payment'>>()

    interface ExpectedContext {
      checkpoints: string[]
      orderId: string | null
      payment: {
        attempts: number
        capturedBy: string | null
        fraud: {
          lastScore: number | null
          reviewed: number
        }
      }
      total: number
    }

    check<Equal<Model['state']['context'], ExpectedContext>>()
  })

  it('infers nested payload types through all tiers', () => {
    check<Equal<StateMachineActionPayload<Model, 'Screen'>, { score: number }>>()
    check<Equal<StateMachineActionPayload<Model, 'Capture'>, { processorId: string }>>()
    check<Equal<StateMachineActionPayload<Model, 'Cancel'>, never>>()
  })

  it('service surface accepts deep actions and subscription type matches expansion', () => {
    const service = interpret(machine.done())

    service.do('BeginCheckout')
    service.do('SubmitOrder', { orderId: 'o-1', total: 100 })
    service.do('StartAuth')
    service.do('StartFraud')
    service.do('Screen', { score: 10 })
    service.do('Capture', { processorId: 'psp-1' })
    service.do('FinalizeOrder')

    const unsubscribe = service.subscribe((change) => {
      check<
        Equal<
          typeof change.action.type,
          | 'BeginCheckout'
          | 'Cancel'
          | 'Capture'
          | 'Decline'
          | 'FinalizeOrder'
          | 'Screen'
          | 'StartAuth'
          | 'StartFraud'
          | 'SubmitOrder'
        >
      >()

      if (change.action.type === 'Screen') {
        check<Equal<typeof change.action.payload, { score: number }>>()
      }

      if (change.action.type === 'Capture') {
        check<Equal<typeof change.action.payload, { processorId: string }>>()
      }
    })

    check<Equal<typeof unsubscribe, () => void>>()
    unsubscribe()
  })

  it('exposes nested group type at intermediate tier', () => {
    // eslint-disable-next-line typescript/no-unused-vars
    const payment = buildPaymentMachine()
    type PaymentModel = InferStateMachineModel<typeof payment>

    check<Equal<StateMachineGroups<PaymentModel>, 'fraud'>>()
  })
})

describe('three-tier order orchestration (runtime)', () => {
  it('walks happy path across root -> payment -> fraud -> completion', () => {
    const machine = buildOrderMachine()
    const service = interpret(machine.done())

    const events: Array<{ source: string; state: string; target: string; type: string }> = []

    const unsubscribe = service.subscribe((change) => {
      events.push({
        source: String(change.action.source),
        state: String(change.state),
        target: String(change.action.target),
        type: String(change.action.type),
      })
    })

    assert.equal(service.state, 'Cart')
    assert.deepEqual(service.context, {
      checkpoints: [],
      orderId: null,
      payment: {
        attempts: 0,
        capturedBy: null,
        fraud: {
          lastScore: null,
          reviewed: 0,
        },
      },
      total: 0,
    })

    assert.equal(service.do('BeginCheckout'), true)
    assert.equal(service.state, 'Checkout')

    assert.equal(service.do('SubmitOrder', { orderId: 'ord-42', total: 149 }), true)
    assert.equal(service.state, 'PaymentIdle')

    assert.equal(service.do('StartAuth'), true)
    assert.equal(service.state, 'PaymentAuthorizing')

    assert.equal(service.do('StartFraud'), true)
    assert.equal(service.state, 'FraudPending')

    assert.equal(service.do('Screen', { score: 42 }), true)
    assert.equal(service.state, 'FraudClear')

    assert.equal(service.do('Capture', { processorId: 'psp-9' }), true)
    assert.equal(service.state, 'PaymentApproved')

    assert.equal(service.do('FinalizeOrder'), true)
    assert.equal(service.state, 'Completed')

    assert.deepEqual(service.context, {
      checkpoints: ['checkout', 'submitted', 'completed'],
      orderId: 'ord-42',
      payment: {
        attempts: 1,
        capturedBy: 'psp-9',
        fraud: {
          lastScore: 42,
          reviewed: 1,
        },
      },
      total: 149,
    })

    assert.deepEqual(
      events.map((event) => event.type),
      [
        'BeginCheckout',
        'SubmitOrder',
        'StartAuth',
        'StartFraud',
        'Screen',
        'Capture',
        'FinalizeOrder',
      ],
    )

    // Group-target aliasing: SubmitOrder -> payment -> PaymentIdle, StartFraud -> fraud -> FraudPending.
    assert.deepEqual(events[1], {
      source: 'Checkout',
      state: 'PaymentIdle',
      target: 'PaymentIdle',
      type: 'SubmitOrder',
    })
    assert.deepEqual(events[3], {
      source: 'PaymentAuthorizing',
      state: 'FraudPending',
      target: 'FraudPending',
      type: 'StartFraud',
    })

    unsubscribe()
  })

  it('enforces guard failures, declined branch, and false returns for missing candidates', () => {
    const machine = buildOrderMachine()
    const service = interpret(machine.done())

    assert.equal(service.do('BeginCheckout'), true)

    // Root guard fails: total <= 0 keeps state/context unchanged.
    assert.equal(service.do('SubmitOrder', { orderId: 'bad', total: 0 }), false)
    assert.equal(service.state, 'Checkout')

    // Continue with valid order.
    assert.equal(service.do('SubmitOrder', { orderId: 'ord-99', total: 10 }), true)
    assert.equal(service.state, 'PaymentIdle')

    assert.equal(service.do('StartAuth'), true)
    assert.equal(service.state, 'PaymentAuthorizing')

    assert.equal(service.do('StartFraud'), true)
    assert.equal(service.state, 'FraudPending')

    // Fraud guard fails first candidate -> fallback transition to FraudBlock.
    assert.equal(service.do('Screen', { score: 95 }), true)
    assert.equal(service.state, 'FraudBlock')

    // No Capture transition from FraudBlock.
    assert.equal(service.do('Capture', { processorId: 'psp-x' }), false)
    assert.equal(service.state, 'FraudBlock')

    assert.equal(service.do('Decline'), true)
    assert.equal(service.state, 'PaymentDeclined')

    // No FinalizeOrder transition from declined branch.
    assert.equal(service.do('FinalizeOrder'), false)
    assert.equal(service.state, 'PaymentDeclined')

    // Cancel uses array source and works from declined branch.
    assert.equal(service.do('Cancel'), true)
    assert.equal(service.state, 'Cancelled')
  })

  it('throws on unknown action and unsubscribe stops notifications', () => {
    const machine = buildOrderMachine()
    const service = interpret(machine.done())

    let calls = 0
    const unsubscribe = service.subscribe(() => {
      calls += 1
    })

    assert.equal(service.do('BeginCheckout'), true)
    assert.equal(calls, 1)

    unsubscribe()

    assert.equal(service.do('Cancel'), true)
    assert.equal(calls, 1)

    assert.throws(() => {
      service.do('UNKNOWN_ACTION' as never)
    }, 'Action "UNKNOWN_ACTION" is not declared in this state machine.')
  })
})
