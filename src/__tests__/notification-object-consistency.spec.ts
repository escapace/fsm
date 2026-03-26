import { assert, describe, it } from 'vitest'
import { interpret, stateMachine } from '../index'

interface CounterContext {
  count: number
}

const createTwoStepGuardedMachine = (
  guardActionArguments: unknown[],
  reducerActionArguments: unknown[],
) => {
  const guard = (_context: CounterContext, action: unknown) => {
    guardActionArguments.push(action)
    return true
  }

  const reducer = (context: CounterContext, action: unknown): CounterContext => {
    reducerActionArguments.push(action)
    return { count: context.count + 1 }
  }

  return stateMachine()
    .state('A')
    .state('B')
    .initial('A')
    .action('STEP')
    .context(() => ({ count: 0 }))
    .transition('A', ['STEP', guard], 'B', reducer)
    .transition('B', ['STEP', guard], 'A', reducer)
}

describe('notification object identity consistency matrix', () => {
  it('service.do: gate/reducer args reuse, subscriber envelope reuse, subscriber action reuse', () => {
    const guardActionArguments: unknown[] = []
    const reducerActionArguments: unknown[] = []
    const machine = createTwoStepGuardedMachine(guardActionArguments, reducerActionArguments)
    const service = interpret(machine.done())

    const subscriberChanges: unknown[] = []
    const subscriberActions: unknown[] = []

    service.subscribe((change) => {
      subscriberChanges.push(change)
      subscriberActions.push(change.action)
    })

    assert.equal(service.do('STEP'), true)
    assert.equal(service.do('STEP'), true)

    assert.equal(guardActionArguments.length, 2)
    assert.equal(reducerActionArguments.length, 2)
    assert.equal(subscriberChanges.length, 2)
    assert.equal(subscriberActions.length, 2)

    assert.equal(guardActionArguments[0], reducerActionArguments[0])
    assert.equal(guardActionArguments[1], reducerActionArguments[1])
    assert.equal(reducerActionArguments[0], subscriberActions[0])
    assert.equal(reducerActionArguments[1], subscriberActions[1])

    assert.equal(guardActionArguments[0], guardActionArguments[1])
    assert.equal(reducerActionArguments[0], reducerActionArguments[1])
    assert.equal(subscriberChanges[0], subscriberChanges[1])
    assert.equal(subscriberActions[0], subscriberActions[1])
  })

  it('draft.do: gate/reducer args reuse, subscriber envelope reuse, subscriber action per-step', () => {
    const guardActionArguments: unknown[] = []
    const reducerActionArguments: unknown[] = []
    const machine = createTwoStepGuardedMachine(guardActionArguments, reducerActionArguments)
    const service = interpret(machine.done())
    const draft = service.draft()

    const subscriberChanges: unknown[] = []
    const subscriberActions: unknown[] = []

    draft.subscribe((change) => {
      subscriberChanges.push(change)
      subscriberActions.push(change.action)
    })

    assert.equal(draft.do('STEP'), true)
    assert.equal(draft.do('STEP'), true)

    assert.equal(guardActionArguments.length, 2)
    assert.equal(reducerActionArguments.length, 2)
    assert.equal(subscriberChanges.length, 2)
    assert.equal(subscriberActions.length, 2)

    assert.equal(guardActionArguments[0], reducerActionArguments[0])
    assert.equal(guardActionArguments[1], reducerActionArguments[1])
    assert.notEqual(reducerActionArguments[0], subscriberActions[0])
    assert.notEqual(reducerActionArguments[1], subscriberActions[1])

    assert.equal(guardActionArguments[0], guardActionArguments[1])
    assert.equal(reducerActionArguments[0], reducerActionArguments[1])
    assert.equal(subscriberChanges[0], subscriberChanges[1])
    assert.notEqual(subscriberActions[0], subscriberActions[1])
  })

  it('draft.commit -> service: no gate rerun, reducer rerun with per-step actions, service envelope reuse', () => {
    const guardActionArguments: unknown[] = []
    const reducerActionArguments: unknown[] = []
    const machine = createTwoStepGuardedMachine(guardActionArguments, reducerActionArguments)
    const service = interpret(machine.done())
    const draft = service.draft()

    const subscriberChanges: unknown[] = []
    const subscriberActions: unknown[] = []

    service.subscribe((change) => {
      subscriberChanges.push(change)
      subscriberActions.push(change.action)
    })

    assert.equal(draft.do('STEP'), true)
    assert.equal(draft.do('STEP'), true)

    const guardCallsBeforeCommit = guardActionArguments.length
    draft.commit()

    assert.equal(guardActionArguments.length, guardCallsBeforeCommit)
    assert.equal(reducerActionArguments.length, 4)
    assert.equal(reducerActionArguments[0], reducerActionArguments[1])
    assert.notEqual(reducerActionArguments[2], reducerActionArguments[3])

    assert.equal(subscriberChanges.length, 2)
    assert.equal(subscriberActions.length, 2)
    assert.equal(reducerActionArguments[2], subscriberActions[0])
    assert.equal(reducerActionArguments[3], subscriberActions[1])
    assert.equal(subscriberChanges[0], subscriberChanges[1])
    assert.notEqual(subscriberActions[0], subscriberActions[1])
  })

  it('child draft.commit -> parent draft: no gate rerun, parent replay envelope reuse, per-step subscriber actions', () => {
    const guardActionArguments: unknown[] = []
    const reducerActionArguments: unknown[] = []
    const machine = createTwoStepGuardedMachine(guardActionArguments, reducerActionArguments)
    const service = interpret(machine.done())
    const parent = service.draft()
    const child = parent.draft()

    const parentSubscriberChanges: unknown[] = []
    const parentSubscriberActions: unknown[] = []

    parent.subscribe((change) => {
      parentSubscriberChanges.push(change)
      parentSubscriberActions.push(change.action)
    })

    assert.equal(child.do('STEP'), true)
    assert.equal(child.do('STEP'), true)

    const guardCallsBeforeCommit = guardActionArguments.length
    child.commit()

    assert.equal(guardActionArguments.length, guardCallsBeforeCommit)
    assert.equal(reducerActionArguments.length, 4)
    assert.equal(reducerActionArguments[0], reducerActionArguments[1])
    assert.notEqual(reducerActionArguments[2], reducerActionArguments[3])

    assert.equal(parentSubscriberChanges.length, 2)
    assert.equal(parentSubscriberActions.length, 2)
    assert.equal(reducerActionArguments[2], parentSubscriberActions[0])
    assert.equal(reducerActionArguments[3], parentSubscriberActions[1])

    assert.equal(parentSubscriberChanges[0], parentSubscriberChanges[1])
    assert.notEqual(parentSubscriberActions[0], parentSubscriberActions[1])
  })

  // Comparative inconsistency being encoded here:
  // - service.do(...) notifies subscribers with `change.action` referencing the reused runtime action buffer,
  //   so identity is stable across consecutive notifications.
  // - draft.do(...) notifies subscribers with `change.action` referencing per-step trace action objects,
  //   so identity changes per notification.
  // The assertion intentionally expects these two identity policies to match, and is marked `it.fails`
  // until a single policy is chosen for both paths.
  it.fails(
    'inconsistency: service.do and draft.do currently expose different subscriber action identity semantics',
    () => {
      const serviceGuardArguments: unknown[] = []
      const serviceReducerArguments: unknown[] = []
      const serviceMachine = createTwoStepGuardedMachine(
        serviceGuardArguments,
        serviceReducerArguments,
      )
      const service = interpret(serviceMachine.done())

      const serviceSubscriberActions: unknown[] = []
      service.subscribe((change) => {
        serviceSubscriberActions.push(change.action)
      })

      assert.equal(service.do('STEP'), true)
      assert.equal(service.do('STEP'), true)

      const draftGuardArguments: unknown[] = []
      const draftReducerArguments: unknown[] = []
      const draftMachine = createTwoStepGuardedMachine(draftGuardArguments, draftReducerArguments)
      const draftService = interpret(draftMachine.done())
      const draft = draftService.draft()

      const draftSubscriberActions: unknown[] = []
      draft.subscribe((change) => {
        draftSubscriberActions.push(change.action)
      })

      assert.equal(draft.do('STEP'), true)
      assert.equal(draft.do('STEP'), true)

      const serviceActionReused = serviceSubscriberActions[0] === serviceSubscriberActions[1]
      const draftActionReused = draftSubscriberActions[0] === draftSubscriberActions[1]

      assert.equal(serviceActionReused, draftActionReused)
    },
  )
})
