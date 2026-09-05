import { assert, describe, expectTypeOf, it, vi } from 'vitest'
import { interpret, stateMachine, StateMachineError } from '../index'

describe('composition context finalization', () => {
  it('initializes siblings once without a parent context factory', () => {
    const leftContext = vi.fn(() => ({ left: 1 }))
    const rightContext = vi.fn(() => ({ right: 2 }))
    const left = stateMachine().state('L').initial('L').action('LEFT').context(leftContext).done()
    const right = stateMachine()
      .state('R')
      .initial('R')
      .action('RIGHT')
      .context(rightContext)
      .done()
    const machine = stateMachine()
      .state('Idle')
      .compose('left', left)
      .compose('right', right)
      .initial('Idle')
      .done()

    for (let index = 0; index < 2; index++) {
      const service = interpret(machine)
      assert.deepEqual(service.context, { left: { left: 1 }, right: { right: 2 } })
      assert.deepEqual(service.draft().context, service.context)
    }
    assert.equal(leftContext.mock.calls.length, 2)
    assert.equal(rightContext.mock.calls.length, 2)
  })

  it('initializes context-free siblings', () => {
    const left = stateMachine().state('L').done()
    const right = stateMachine().state('R').done()
    const machine = stateMachine()
      .state('Idle')
      .compose('left', left)
      .compose('right', right)
      .initial('Idle')
      .done()
    assert.deepEqual(interpret(machine).context, { left: undefined, right: undefined })
  })

  it('replaces parent fields while preserving composed slices in runtime and types', () => {
    const child = stateMachine()
      .state('C')
      .initial('C')
      .action('CHILD')
      .context(() => undefined)
      .done()
    const machine = stateMachine()
      .state('A')
      .initial('A')
      .action('STEP')
      .context(() => ({ oldField: 1 }))
      .compose('child', child)
      .context(() => ({ newField: 2 }))
      .transition('A', 'STEP', 'A', (context) => {
        expectTypeOf(context).toEqualTypeOf<{ child: undefined; newField: number }>()
        return { child: context.child, newField: context.newField + 1 }
      })
      .done()
    const service = interpret(machine)
    expectTypeOf(service.context).toEqualTypeOf<{ child: undefined; newField: number }>()
    // @ts-expect-error the previous parent context factory was replaced
    void service.context.oldField
    assert.deepEqual(service.context, { child: undefined, newField: 2 })
    service.do('STEP')
    assert.deepEqual(service.context, { child: undefined, newField: 3 })
  })

  it('keeps only child slices when the replacement parent context is primitive', () => {
    const child = stateMachine()
      .state('C')
      .initial('C')
      .action('CHILD')
      .context(() => undefined)
      .done()
    const machine = stateMachine()
      .state('A')
      .initial('A')
      .action('STEP')
      .context(() => ({ oldField: 1 }))
      .compose('child', child)
      .context(() => 42)
      .done()
    const service = interpret(machine)
    expectTypeOf(service.context).toEqualTypeOf<{ child: undefined }>()
    assert.deepEqual(service.context, { child: undefined })
  })
})

describe('composed group property keys', () => {
  const left = stateMachine()
    .state('L')
    .initial('L')
    .action('LEFT')
    .context(() => ({ left: 1 }))
    .done()
  const right = stateMachine()
    .state('R')
    .initial('R')
    .action('RIGHT')
    .context(() => ({ right: 2 }))
    .done()

  it.each([
    [1, '1'],
    [-0, '0'],
    [1e21, '1e+21'],
  ] as const)('rejects aliases %s and %s in either order', (numericGroup, stringGroup) => {
    for (const [build, identifier] of [
      [
        () =>
          stateMachine()
            .state('Root')
            .compose(numericGroup, left)
            .compose(stringGroup, right)
            .done(),
        stringGroup,
      ],
      [
        () =>
          stateMachine()
            .state('Root')
            .compose(stringGroup, left)
            .compose(numericGroup, right)
            .done(),
        numericGroup,
      ],
    ] as const) {
      try {
        build()
        assert.fail('expected a group collision')
      } catch (error) {
        assert.instanceOf(error, StateMachineError)
        assert(error.cause.type === 'GroupNameConflict')
        assert.equal(error.cause.identifier, identifier)
      }
    }
  })

  it('keeps non-canonical numeric strings and distinct symbols separate', () => {
    const first = Symbol('group')
    const second = Symbol('group')
    const machine = stateMachine()
      .state('Root')
      .compose(1, left)
      .compose('01', right)
      .compose(first, stateMachine().state('First').done())
      .compose(second, stateMachine().state('Second').done())
      .initial('Root')
      .done()

    assert.deepEqual(interpret(machine).context, {
      '01': { right: 2 },
      1: { left: 1 },
      [first]: undefined,
      [second]: undefined,
    })
  })
})

describe('identifier index validation at finalization', () => {
  const numericChild = stateMachine().state(1).initial(1).action(2).done()
  const stringChild = stateMachine().state('1').initial('1').action('2').done()

  it.each([
    [
      'numeric then string action',
      () => stateMachine().state('A').initial('A').action(1).action('1').done(),
      'ActionAlreadyDeclared',
    ],
    [
      'string then numeric action',
      () => stateMachine().state('A').initial('A').action('1').action(1).done(),
      'ActionAlreadyDeclared',
    ],
    [
      'numeric then string state',
      () => stateMachine().state(1).state('1').done(),
      'StateAlreadyDeclared',
    ],
    [
      'string then numeric state',
      () => stateMachine().state('1').state(1).done(),
      'StateAlreadyDeclared',
    ],
    [
      'parent/child action',
      () =>
        stateMachine().state('A').initial('A').action('2').compose('child', numericChild).done(),
      'ActionAlreadyDeclared',
    ],
    [
      'parent/child state',
      () => stateMachine().state('1').compose('child', numericChild).done(),
      'StateAlreadyDeclared',
    ],
    [
      'sibling action',
      () =>
        stateMachine()
          .state('A')
          .compose('left', numericChild)
          .compose('right', stateMachine().state('B').initial('B').action('2').done())
          .done(),
      'ActionAlreadyDeclared',
    ],
    [
      'sibling state',
      () =>
        stateMachine()
          .state('A')
          .compose('left', stateMachine().state(1).done())
          .compose('right', stringChild)
          .done(),
      'StateAlreadyDeclared',
    ],
  ] as const)('rejects %s collisions before interpretation', (_name, finalize, type) => {
    try {
      finalize()
      assert.fail('expected an identifier collision')
    } catch (error) {
      assert.instanceOf(error, StateMachineError)
      assert.equal(error.cause.type, type)
    }
  })

  it('preserves non-colliding mixed identifiers and separate action/state namespaces', () => {
    const first = Symbol('state')
    const second = Symbol('state')
    const machine = stateMachine()
      .state(1)
      .state('2')
      .state(first)
      .state(second)
      .initial(1)
      .action('1')
      .action(2)
      .action(first)
      .action(second)
      .transition(1, '1', '2')
      .transition('2', 2, first)
      .transition(first, first, second)
      .transition(second, second, 1)
      .done()
    const service = interpret(machine)
    assert.equal(service.do('1'), true)
    assert.equal(service.state, '2')
    assert.equal(service.do(2), true)
    assert.equal(service.state, first)
    assert.equal(service.do(first), true)
    assert.equal(service.state, second)
    assert.equal(service.do(second), true)
    assert.equal(service.state, 1)
  })
})
