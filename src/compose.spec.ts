import { assert, describe, it, vi } from 'vitest'
import { STATE_MACHINE_STATE, interpret, stateMachine } from './index'

describe('compose', () => {
  it('resolves group-name targets to child initial and keeps group out of runtime states', () => {
    const child = stateMachine()
      .state('On')
      .state('Off')
      .initial('On')
      .action('Toggle')
      .context({ toggles: 0 })
      .transition('On', 'Toggle', 'Off', (context) => ({ toggles: context.toggles + 1 }))
      .transition('Off', 'Toggle', 'On', (context) => ({ toggles: context.toggles + 1 }))

    const machine = stateMachine()
      .state('Idle')
      .compose('power', child)
      .initial('Idle')
      .action('Start')
      .action('Stop')
      .context({ starts: 0 })
      .transition('Idle', 'Start', 'power', (context) => ({ ...context, starts: 1 }))
      .transition(['On', 'Off'], 'Stop', 'Idle')

    const service = interpret(machine)

    assert.equal(service.state, 'Idle')
    assert.equal(service.do('Start'), true)
    assert.equal(service.state, 'On')

    const states = machine[STATE_MACHINE_STATE].states as string[]
    assert.equal(states.includes('power'), false)
    assert.equal(states.includes('On'), true)
    assert.equal(states.includes('Off'), true)
  })

  it('lifts child guards/reducers to child slice and preserves parent slice', () => {
    const seenGuardContext = vi.fn((_context: unknown) => undefined)

    const child = stateMachine()
      .state('ChildA')
      .state('ChildB')
      .initial('ChildA')
      .action('Step')
      .context({ value: 0 })
      .transition(
        'ChildA',
        [
          'Step',
          (context) => {
            seenGuardContext(context)
            return true
          },
        ],
        'ChildB',
        (context) => ({ value: context.value + 1 }),
      )

    const machine = stateMachine()
      .state('Idle')
      .compose('child', child)
      .initial('Idle')
      .action('Enter')
      .context({ parent: 41 })
      .transition('Idle', 'Enter', 'child')

    const service = interpret(machine)

    assert.equal(service.do('Enter'), true)
    assert.equal(service.state, 'ChildA')

    assert.equal(service.do('Step'), true)
    assert.equal(service.state, 'ChildB')

    assert.deepEqual(seenGuardContext.mock.calls[0][0], { value: 0 })
    assert.deepEqual(service.context, {
      child: { value: 1 },
      parent: 41,
    })
  })

  it('supports nested composition recursively', () => {
    const leaf = stateMachine()
      .state('LeafA')
      .state('LeafB')
      .initial('LeafA')
      .action('LeafNext')
      .context({ n: 0 })
      .transition('LeafA', 'LeafNext', 'LeafB', (context) => ({ n: context.n + 1 }))

    const middle = stateMachine()
      .state('MiddleIdle')
      .compose('leaf', leaf)
      .initial('MiddleIdle')
      .action('EnterLeaf')
      .context({ m: 0 })
      .transition('MiddleIdle', 'EnterLeaf', 'leaf')

    const root = stateMachine()
      .state('RootIdle')
      .compose('middle', middle)
      .initial('RootIdle')
      .action('EnterMiddle')
      .context({ r: 0 })
      .transition('RootIdle', 'EnterMiddle', 'middle')

    const service = interpret(root)

    assert.equal(service.do('EnterMiddle'), true)
    assert.equal(service.state, 'MiddleIdle')

    assert.equal(service.do('EnterLeaf'), true)
    assert.equal(service.state, 'LeafA')

    assert.equal(service.do('LeafNext'), true)
    assert.equal(service.state, 'LeafB')

    assert.deepEqual(service.context, {
      middle: {
        leaf: {
          n: 1,
        },
        m: 0,
      },
      r: 0,
    })
  })

  it('rejects state and group conflicts during compose', () => {
    const child = stateMachine().state('A').initial('A').action('Go').transition('A', 'Go', 'A')

    assert.throws(() => {
      // @ts-expect-error state 'A' in child conflicts with parent state 'A'
      stateMachine().state('A').compose('x', child)
    })

    assert.throws(() => {
      // @ts-expect-error group 'x' conflicts with parent state 'x'
      stateMachine().state('x').compose('x', child)
    })
  })

  it('rejects composing a child without initial with a precise error', () => {
    const childWithoutInitial = stateMachine()
      .state('A')
      .initial('A')
      .action('Go')
      .transition('A', 'Go', 'A')

    ;(childWithoutInitial[STATE_MACHINE_STATE] as { initial?: unknown }).initial = undefined

    assert.throws(() => {
      stateMachine().state('Root').compose('child', childWithoutInitial)
    }, 'Composed machine must declare an initial state.')
  })

  it('rejects malformed child machine with not-state-machine error', () => {
    assert.throws(() => {
      // @ts-expect-error intentionally malformed machine input for runtime validation
      stateMachine().state('Root').compose('child', {})
    }, 'Parameter is not a state machine.')
  })
})
