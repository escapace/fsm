import { assert, describe, it, vi } from 'vitest'
import {
  interpret,
  isStateMachineError,
  isStateMachineErrorOfType,
  stateMachine,
  type StateMachineError,
} from '../index'

describe('context policy edge coverage', () => {
  it('keeps no-context machine semantics with policy on draft and commit', () => {
    const snapshotContext = vi.fn((context: unknown) => context)
    const reconcileContext = vi.fn((_parentContext: unknown, nextContext: unknown) => nextContext)

    const machine = stateMachine()
      .state('A')
      .state('B')
      .initial('A')
      .action('STEP')
      .transition('A', 'STEP', 'B')

    const service = interpret(machine.done({ reconcileContext, snapshotContext }))
    const draft = service.draft()

    assert.equal(snapshotContext.mock.calls.length, 1)
    assert.deepEqual(snapshotContext.mock.calls[0], [undefined])

    assert.equal(draft.do('STEP'), true)
    draft.commit()

    assert.equal(service.state, 'B')
    assert.equal(service.context, undefined)
    assert.equal(reconcileContext.mock.calls.length, 0)
  })

  it('keeps primitive context semantics with custom policy functions', () => {
    const machine = stateMachine()
      .state('A')
      .state('B')
      .initial('A')
      .action('STEP')
      .context(() => 0)
      .transition('A', 'STEP', 'B', (context) => context + 1)

    const service = interpret(
      machine.done({
        reconcileContext: (_parentContext, nextContext) => nextContext,
        snapshotContext: (context) => context,
      }),
    )

    const draft = service.draft()

    assert.equal(draft.context, 0)
    assert.equal(draft.do('STEP'), true)
    draft.commit()

    assert.equal(service.state, 'B')
    assert.equal(service.context, 1)
  })

  it('applies composed child snapshot policy at parent draft boundary', () => {
    const child = stateMachine()
      .state('ChildA')
      .initial('ChildA')
      .action('STAY')
      .context<{ child: boolean; childSnapshot?: boolean }>(() => ({ child: true }))
      .transition('ChildA', 'STAY', 'ChildA')
      .done({
        snapshotContext: (context) => ({ ...context, childSnapshot: true }),
      })

    const parent = stateMachine()
      .state('Idle')
      .compose('child', child)
      .initial('Idle')
      .action('ENTER')
      .context<{ parent: boolean; parentSnapshot?: boolean }>(() => ({ parent: true }))
      .transition('Idle', 'ENTER', 'ChildA')
      .done({
        snapshotContext: (context) => ({ ...context, parentSnapshot: true }),
      })

    const service = interpret(parent)
    const draft = service.draft()

    assert.deepEqual(draft.context, {
      child: {
        child: true,
        childSnapshot: true,
      },
      parent: true,
      parentSnapshot: true,
    })

    assert.deepEqual(service.context, {
      child: {
        child: true,
      },
      parent: true,
    })
  })

  it('supports different child reconcile policies in the same composed parent', () => {
    const childA = stateMachine()
      .state('A1')
      .state('A2')
      .initial('A1')
      .action('A_STEP')
      .context<{ value: number; tag?: 'A' }>(() => ({ value: 0 }))
      .transition('A1', 'A_STEP', 'A2', (context) => ({ value: context.value + 1 }))
      .done({
        reconcileContext: (_parentContext, nextContext) => ({ ...nextContext, tag: 'A' }),
      })

    const childB = stateMachine()
      .state('B1')
      .state('B2')
      .initial('B1')
      .action('B_STEP')
      .context<{ value: number; tag?: 'B' }>(() => ({ value: 0 }))
      .transition('B1', 'B_STEP', 'B2', (context) => ({ value: context.value + 1 }))
      .done({
        reconcileContext: (_parentContext, nextContext) => ({ ...nextContext, tag: 'B' }),
      })

    const parent = stateMachine()
      .state('Idle')
      .compose('a', childA)
      .compose('b', childB)
      .initial('Idle')
      .action('GO_A')
      .action('GO_B')
      .action('RESET')
      .context(() => ({ parent: true }))
      .transition('Idle', 'GO_A', 'A1')
      .transition('Idle', 'GO_B', 'B1')
      .transition(['A1', 'A2', 'B1', 'B2'], 'RESET', 'Idle')

    const service = interpret(parent.done())

    assert.equal(service.do('GO_A'), true)
    assert.equal(service.do('A_STEP'), true)
    assert.deepEqual(service.context, {
      a: { tag: 'A', value: 1 },
      b: { value: 0 },
      parent: true,
    })

    assert.equal(service.do('RESET'), true)
    assert.equal(service.do('GO_B'), true)
    assert.equal(service.do('B_STEP'), true)
    assert.deepEqual(service.context, {
      a: { tag: 'A', value: 1 },
      b: { tag: 'B', value: 1 },
      parent: true,
    })
  })

  it('keeps child slice replacement lock during child-owned replay', () => {
    const child = stateMachine()
      .state('ChildA')
      .state('ChildB')
      .initial('ChildA')
      .action('STEP')
      .context(() => ({ childOwned: false as boolean, n: 0, overwritten: false as boolean }))
      .transition('ChildA', 'STEP', 'ChildB', (context) => ({
        childOwned: context.childOwned,
        n: context.n + 1,
        overwritten: context.overwritten,
      }))

    const parent = stateMachine()
      .state('Idle')
      .compose(
        'child',
        child.done({
          reconcileContext: (_parentContext, nextContext) => ({
            ...nextContext,
            childOwned: true,
          }),
        }),
      )
      .initial('Idle')
      .action('ENTER')
      .context(() => ({ parent: 0, parentPublished: false }))
      .transition('Idle', 'ENTER', 'ChildA')

    const service = interpret(
      parent.done({
        reconcileContext: (_parentContext, nextContext) => ({
          ...nextContext,
          child: { childOwned: false, n: 999, overwritten: true },
          parentPublished: true,
        }),
      }),
    )

    assert.equal(service.do('ENTER'), true)

    const draft = service.draft()
    assert.equal(draft.do('STEP'), true)
    draft.commit()

    assert.deepEqual(service.context, {
      child: { childOwned: true, n: 1, overwritten: false },
      parent: 0,
      parentPublished: true,
    })
  })

  it('applies snapshot policy at each nested draft boundary and reconcile policy at each replay boundary', () => {
    const snapshotContext = vi.fn((context: { n: number }) => ({ ...context }))
    const reconcileContext = vi.fn((parentContext: { n: number }, nextContext: { n: number }) => {
      parentContext.n = nextContext.n
      return parentContext
    })

    const machine = stateMachine()
      .state('A')
      .state('B')
      .initial('A')
      .action('STEP')
      .context(() => ({ n: 0 }))
      .transition('A', 'STEP', 'B', (context) => ({ n: context.n + 1 }))

    const service = interpret(machine.done({ reconcileContext, snapshotContext }))
    const draft = service.draft()
    const nested = draft.draft()

    assert.equal(snapshotContext.mock.calls.length, 2)

    assert.equal(nested.do('STEP'), true)
    nested.commit()
    draft.commit()

    assert.equal(reconcileContext.mock.calls.length, 2)
    assert.equal(service.state, 'B')
    assert.deepEqual(service.context, { n: 1 })
  })

  it('keeps context.state injection correct with custom policy on root and child slices', () => {
    const child = stateMachine()
      .state('ChildA')
      .state('ChildB')
      .initial('ChildA')
      .action('STEP')
      .action('BACK')
      .context<{ childCount: number; state: 'ChildA' | 'ChildB' }>(() => ({
        childCount: 0,
        state: 'ChildA',
      }))
      .transition('ChildA', 'STEP', 'ChildB', (context) => ({
        childCount: context.childCount + 1,
        state: 'ChildB',
      }))
      .transition('ChildB', 'BACK', 'ChildA', (context) => ({
        childCount: context.childCount + 1,
        state: 'ChildA',
      }))
      .done({
        reconcileContext: (parentContext, nextContext) => Object.assign(parentContext, nextContext),
        snapshotContext: (context) => ({ ...context }),
      })

    const parent = stateMachine()
      .state('Idle')
      .compose('device', child)
      .initial('Idle')
      .action('ENTER')
      .context<{ parentCount: number; state: string }>(() => ({ parentCount: 0, state: 'Idle' }))
      .transition('Idle', 'ENTER', 'ChildA', (context) => ({
        ...context,
        parentCount: context.parentCount + 1,
        state: 'Idle',
      }))
      .done({
        reconcileContext: (parentContext, nextContext) => Object.assign(parentContext, nextContext),
        snapshotContext: (context) => ({ ...context }),
      })

    const service = interpret(parent)

    assert.equal(service.context.state, 'Idle')
    assert.equal(service.context.device.state, 'ChildA')

    assert.equal(service.do('ENTER'), true)
    assert.equal(service.state, 'ChildA')
    assert.equal(service.context.state, 'ChildA')
    assert.equal(service.context.device.state, 'ChildA')

    assert.equal(service.do('STEP'), true)
    assert.equal(service.state, 'ChildB')
    assert.equal(service.context.state, 'ChildB')
    assert.equal(service.context.device.state, 'ChildB')

    const draft = service.draft()
    assert.equal(draft.do('BACK'), true)
    assert.equal(draft.state, 'ChildA')
    assert.equal(draft.context.state, 'ChildA')
    assert.equal(draft.context.device.state, 'ChildA')

    draft.commit()

    assert.equal(service.state, 'ChildA')
    assert.equal(service.context.state, 'ChildA')
    assert.equal(service.context.device.state, 'ChildA')
  })

  it('applies nested snapshot policy recursively across composed boundaries', () => {
    const leaf = stateMachine()
      .state('Leaf')
      .initial('Leaf')
      .action('LEAF_NOOP')
      .context<{ leaf: boolean; leafSnapshot?: boolean }>(() => ({ leaf: true }))
      .done({
        snapshotContext: (context) => ({ ...context, leafSnapshot: true }),
      })

    const middle = stateMachine()
      .state('Middle')
      .compose('leaf', leaf)
      .initial('Middle')
      .action('MIDDLE_NOOP')
      .context<{ middle: boolean; middleSnapshot?: boolean }>(() => ({ middle: true }))
      .done({
        snapshotContext: (context) => ({ ...context, middleSnapshot: true }),
      })

    const root = stateMachine()
      .state('Root')
      .compose('middle', middle)
      .initial('Root')
      .action('ROOT_NOOP')
      .context<{ root: boolean; rootSnapshot?: boolean }>(() => ({ root: true }))
      .done({
        snapshotContext: (context) => ({ ...context, rootSnapshot: true }),
      })

    const service = interpret(root)
    const draft = service.draft()

    assert.deepEqual(draft.context, {
      middle: {
        leaf: {
          leaf: true,
          leafSnapshot: true,
        },
        middle: true,
        middleSnapshot: true,
      },
      root: true,
      rootSnapshot: true,
    })

    assert.deepEqual(service.context, {
      middle: {
        leaf: {
          leaf: true,
        },
        middle: true,
      },
      root: true,
    })
  })

  it('keeps composed no-reducer child transitions stable under policy pipeline', () => {
    const child = stateMachine()
      .state('Off')
      .state('On')
      .initial('Off')
      .action('TOGGLE')
      .context<{ state: 'Off' | 'On' }>(() => ({ state: 'Off' }))
      .transition('Off', 'TOGGLE', 'On')
      .transition('On', 'TOGGLE', 'Off')
      .done({
        reconcileContext: (parentContext, nextContext) => Object.assign(parentContext, nextContext),
        snapshotContext: (context) => ({ ...context }),
      })

    const parent = stateMachine()
      .state('Idle')
      .compose('child', child)
      .initial('Idle')
      .action('ENTER')
      .context<{ state: string; replayed?: boolean }>(() => ({ state: 'Idle' }))
      .transition('Idle', 'ENTER', 'Off')

    const service = interpret(
      parent.done({
        reconcileContext: (_parentContext, nextContext) => ({ ...nextContext, replayed: true }),
        snapshotContext: (context) => ({ ...context }),
      }),
    )

    assert.equal(service.do('ENTER'), true)
    assert.equal(service.state, 'Off')
    assert.equal(service.context.replayed, undefined)
    assert.equal(service.context.child.state, 'Off')

    assert.equal(service.do('TOGGLE'), true)
    assert.equal(service.state, 'On')
    assert.equal(service.context.replayed, undefined)
    assert.equal(service.context.child.state, 'On')

    const draft = service.draft()
    assert.equal(draft.do('TOGGLE'), true)
    draft.commit()

    assert.equal(service.state, 'Off')
    assert.equal(service.context.replayed, true)
    assert.equal(service.context.child.state, 'Off')
  })

  it('keeps composed replay policy behavior after hydration, including child-slice replacement lock', () => {
    const childReconcileContext = vi.fn((_parentContext: unknown, nextContext: unknown) => ({
      ...(nextContext as { childOwned: boolean; n: number; overwritten: boolean }),
      childOwned: true,
    }))

    const parentReconcileContext = vi.fn((_parentContext: unknown, nextContext: unknown) => ({
      ...(nextContext as {
        child: { childOwned: boolean; n: number; overwritten: boolean }
        parent: number
        parentPublished: boolean
      }),
      child: { childOwned: false, n: 999, overwritten: true },
      parentPublished: true,
    }))

    const child = stateMachine()
      .state('ChildA')
      .state('ChildB')
      .initial('ChildA')
      .action('STEP')
      .context(() => ({ childOwned: false as boolean, n: 0, overwritten: false as boolean }))
      .transition('ChildA', 'STEP', 'ChildB', (context) => ({
        childOwned: context.childOwned,
        n: context.n + 1,
        overwritten: context.overwritten,
      }))
      .done({
        reconcileContext: childReconcileContext,
        snapshotContext: (context) => ({ ...context }),
      })

    const parent = stateMachine()
      .state('Idle')
      .compose('child', child)
      .initial('Idle')
      .action('ENTER')
      .context(() => ({ parent: 0, parentPublished: false }))
      .transition('Idle', 'ENTER', 'ChildA')

    const service = interpret(
      parent.done({
        reconcileContext: parentReconcileContext,
        snapshotContext: (context) => ({ ...context }),
      }),
      {
        hydrate: {
          context: {
            child: { childOwned: false, n: 0, overwritten: false },
            parent: 0,
            parentPublished: false,
          },
          state: 'ChildA',
        },
      },
    )

    assert.equal(service.state, 'ChildA')
    assert.deepEqual(service.context, {
      child: { childOwned: false, n: 0, overwritten: false },
      parent: 0,
      parentPublished: false,
    })

    const draft = service.draft()
    assert.equal(draft.do('STEP'), true)
    draft.commit()

    assert.equal(service.state, 'ChildB')
    assert.deepEqual(service.context, {
      child: { childOwned: true, n: 1, overwritten: false },
      parent: 0,
      parentPublished: true,
    })
    assert.equal(parentReconcileContext.mock.calls.length, 1)
    assert.equal(childReconcileContext.mock.calls.length, 2)
  })

  it('keeps hydration discriminant validation unchanged when custom policy is configured', () => {
    const snapshotContext = vi.fn((context: { n: number; state: 'A' | 'B' }) => ({ ...context }))
    const reconcileContext = vi.fn(
      (
        _parentContext: { n: number; state: 'A' | 'B' },
        nextContext: { n: number; state: 'A' | 'B' },
      ) => ({ ...nextContext }),
    )

    const machine = stateMachine()
      .state('A')
      .state('B')
      .initial('A')
      .action('STEP')
      .context<{ n: number; state: 'A' } | { n: number; state: 'B' }>(() => ({
        n: 0,
        state: 'A',
      }))
      .transition('A', 'STEP', 'B', (context) => ({ n: context.n + 1, state: 'B' as const }))

    const doneMachine = machine.done({ reconcileContext, snapshotContext })

    const hydrated = interpret(doneMachine, {
      hydrate: {
        context: { n: 10, state: 'B' as const },
        state: 'B',
      },
    })

    assert.equal(hydrated.state, 'B')
    assert.deepEqual(hydrated.context, { n: 10, state: 'B' })
    assert.equal(snapshotContext.mock.calls.length, 0)
    assert.equal(reconcileContext.mock.calls.length, 0)

    try {
      interpret(doneMachine, {
        hydrate: {
          context: { n: 10, state: 'A' as const },
          state: 'B',
        },
      })
      assert.fail('expected ContextStateMismatch')
    } catch (error) {
      assert.equal(isStateMachineError(error), true)
      assert.equal(
        isStateMachineErrorOfType(error as StateMachineError, 'ContextStateMismatch'),
        true,
      )
    }
  })

  it('keeps hydration behavior unchanged and does not invoke policy at startup', () => {
    const snapshotContext = vi.fn((context: { n: number }) => ({ ...context, copied: true }))
    const reconcileContext = vi.fn((_parentContext: { n: number }, nextContext: { n: number }) => ({
      ...nextContext,
      published: true,
    }))

    const machine = stateMachine()
      .state('A')
      .state('B')
      .initial('A')
      .action('STEP')
      .context(() => ({ n: 0 }))
      .transition('A', 'STEP', 'B', (context) => ({ n: context.n + 1 }))

    const service = interpret(machine.done({ reconcileContext, snapshotContext }), {
      hydrate: {
        context: { n: 10 },
        state: 'B',
      },
    })

    assert.deepEqual(service.context, { n: 10 })
    assert.equal(service.state, 'B')
    assert.equal(snapshotContext.mock.calls.length, 0)
    assert.equal(reconcileContext.mock.calls.length, 0)
  })

  it('keeps stale commit conflict behavior under custom policy', () => {
    const machine = stateMachine()
      .state('A')
      .state('B')
      .initial('A')
      .action('STEP')
      .context(() => ({ n: 0 }))
      .transition('A', 'STEP', 'B', (context) => ({ n: context.n + 1 }))

    const service = interpret(
      machine.done({
        reconcileContext: (_parentContext, nextContext) => ({ ...nextContext }),
        snapshotContext: (context) => ({ ...context }),
      }),
    )

    const left = service.draft()
    const right = service.draft()

    assert.equal(left.do('STEP'), true)
    left.commit()

    assert.equal(right.do('STEP'), true)

    try {
      right.commit()
      assert.fail('expected DraftCommitConflict')
    } catch (error) {
      assert.equal(isStateMachineError(error), true)
      assert.equal(
        isStateMachineErrorOfType(error as StateMachineError, 'DraftCommitConflict'),
        true,
      )
    }
  })

  it('ignores prototype-inherited done policy fields', () => {
    const doneOptions = Object.create({
      reconcileContext: () => ({ count: 999 }),
      snapshotContext: () => ({ count: 999 }),
    }) as {
      reconcileContext?: unknown
      snapshotContext?: unknown
    }

    const machine = stateMachine()
      .state('A')
      .state('B')
      .initial('A')
      .action('STEP')
      .context(() => ({ count: 0 }))
      .transition('A', 'STEP', 'B', (context) => ({ count: context.count + 1 }))

    const service = interpret(machine.done(doneOptions as never))
    const draft = service.draft()

    assert.deepEqual(draft.context, { count: 0 })
    assert.equal(draft.do('STEP'), true)
    draft.commit()
    assert.deepEqual(service.context, { count: 1 })
  })

  it('keeps no-reducer transitions unchanged under policy pipeline', () => {
    const reconcileContext = vi.fn(
      (_parentContext: { n: number }, nextContext: { n: number }) => nextContext,
    )

    const machine = stateMachine()
      .state('A')
      .state('B')
      .initial('A')
      .action('STEP')
      .context(() => ({ n: 0 }))
      .transition('A', 'STEP', 'B')

    const service = interpret(
      machine.done({
        reconcileContext,
        snapshotContext: (context) => ({ ...context }),
      }),
    )

    const draft = service.draft()
    assert.equal(draft.do('STEP'), true)
    draft.commit()

    assert.equal(service.state, 'B')
    assert.deepEqual(service.context, { n: 0 })
    assert.equal(reconcileContext.mock.calls.length, 0)
  })
})
