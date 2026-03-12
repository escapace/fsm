import { assert, describe, it } from 'vitest'
import { interpret, stateMachine, type InferStateMachineModel } from './index'

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
function check<_T extends true>(): void {
  return undefined
}

describe('compose build-order edge cases', () => {
  it('context before compose still yields compound context (runtime + type-level)', () => {
    const child = stateMachine()
      .state('On')
      .state('Off')
      .initial('On')
      .action<'Toggle'>('Toggle')
      .context({ toggles: 0 })
      .transition('On', 'Toggle', 'Off', (context) => ({ toggles: context.toggles + 1 }))
      .transition('Off', 'Toggle', 'On', (context) => ({ toggles: context.toggles + 1 }))

    const parent = stateMachine()
      .state('Idle')
      .initial('Idle')
      .action<'Start'>('Start')
      .context({ starts: 0 })
      .compose('power', child)
      .transition('Idle', 'Start', 'On')

    type Model = InferStateMachineModel<typeof parent>
    interface ExpectedContext {
      power: { toggles: number }
      starts: number
    }

    check<Equal<Model['state']['context'], ExpectedContext>>()

    const service = interpret(parent)
    check<Equal<typeof service.context, ExpectedContext>>()

    assert.deepEqual(service.context, {
      power: { toggles: 0 },
      starts: 0,
    })

    assert.equal(service.do('Start'), true)
    assert.equal(service.state, 'On')

    assert.equal(service.do('Toggle'), true)
    assert.equal(service.state, 'Off')
    assert.deepEqual(service.context, {
      power: { toggles: 1 },
      starts: 0,
    })
  })

  it('compose after context update keeps all composed groups in context (runtime + type-level)', () => {
    const childA = stateMachine()
      .state('A1')
      .initial('A1')
      .action<'TickA'>('TickA')
      .context({ a: 0 })
      .transition('A1', 'TickA', 'A1', (context) => ({ a: context.a + 1 }))

    const childB = stateMachine()
      .state('B1')
      .initial('B1')
      .action<'TickB'>('TickB')
      .context({ b: 0 })
      .transition('B1', 'TickB', 'B1', (context) => ({ b: context.b + 1 }))

    const parent = stateMachine()
      .state('Idle')
      .compose('left', childA)
      .initial('Idle')
      .action<'EnterLeft'>('EnterLeft')
      .context({ root: 1 })
      .compose('right', childB)
      .action<'EnterRight'>('EnterRight')
      .transition('Idle', 'EnterLeft', 'A1')
      .transition('Idle', 'EnterRight', 'B1')

    type Model = InferStateMachineModel<typeof parent>
    interface ExpectedContext {
      left: { a: number }
      right: { b: number }
      root: number
    }

    check<Equal<Model['state']['context'], ExpectedContext>>()

    const service = interpret(parent)
    check<Equal<typeof service.context, ExpectedContext>>()

    assert.deepEqual(service.context, {
      left: { a: 0 },
      right: { b: 0 },
      root: 1,
    })

    assert.equal(service.do('EnterRight'), true)
    assert.equal(service.state, 'B1')
    assert.equal(service.do('TickB'), true)
    assert.deepEqual(service.context, {
      left: { a: 0 },
      right: { b: 1 },
      root: 1,
    })
  })

  it('context factories initialize once per interpret across build-order variants', () => {
    let parentCalls = 0
    let childCalls = 0

    const child = stateMachine()
      .state('C')
      .initial('C')
      .action<'Nop'>('Nop')
      .context(() => {
        childCalls += 1
        return { c: 0 }
      })
      .transition('C', 'Nop', 'C')

    const machine = stateMachine()
      .state('Idle')
      .initial('Idle')
      .action<'Start'>('Start')
      .context(() => {
        parentCalls += 1
        return { p: 0 }
      })
      .compose('child', child)
      .transition('Idle', 'Start', 'C')

    const service1 = interpret(machine)
    assert.deepEqual(service1.context, { child: { c: 0 }, p: 0 })
    assert.equal(parentCalls, 1)
    assert.equal(childCalls, 1)

    const service2 = interpret(machine)
    assert.deepEqual(service2.context, { child: { c: 0 }, p: 0 })
    assert.equal(parentCalls, 2)
    assert.equal(childCalls, 2)
  })
})
