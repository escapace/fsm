import { deepSignal } from 'alien-deepsignals'
import { assert, describe, it, vi } from 'vitest'
import { isReactive, reactive } from 'vue'
import { interpret, stateMachine } from '../index'

interface ReactiveSurface {
  list: unknown[]
  nested: object
}

interface ReactiveContextCase {
  name: string
  createLive: <T extends object>(value: T) => T
  verifyDraftSnapshot?: (value: ReactiveSurface) => void
  verifyLiveValue?: (value: ReactiveSurface) => void
}

interface RootContext {
  keep: number
  list: number[]
  nested: {
    count: number
    flag: boolean
  }
  add?: number
  remove?: number
}

interface ChildContext {
  list: number[]
  nested: {
    count: number
  }
  value: number
  keep?: number
  remove?: number
}

interface ReactiveDiscriminatedIdleContext {
  list: number[]
  nested: {
    count: number
  }
  state: 'Idle'
}

interface ReactiveDiscriminatedDoneContext {
  done: true
  list: number[]
  nested: {
    count: number
  }
  state: 'Done'
}

type ReactiveDiscriminatedRootContext =
  | ReactiveDiscriminatedDoneContext
  | ReactiveDiscriminatedIdleContext

interface ReactiveDiscriminatedChildAContext {
  list: number[]
  nested: {
    count: number
  }
  state: 'ChildA'
}

interface ReactiveDiscriminatedChildBContext {
  list: number[]
  nested: {
    count: number
  }
  state: 'ChildB'
  value: number
}

type ReactiveDiscriminatedChildContext =
  | ReactiveDiscriminatedChildAContext
  | ReactiveDiscriminatedChildBContext

const toPlain = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((entry) => toPlain(entry))
  }

  if (value === null || typeof value !== 'object') {
    return value
  }

  return Object.fromEntries(
    Object.keys(value).map((key) => [key, toPlain((value as Record<string, unknown>)[key])]),
  )
}

const createVueLive = <T extends object>(value: T): T => {
  const live: unknown = reactive(value)
  return live as T
}

const createDeepSignalLive = <T extends object>(value: T): T => {
  const live: unknown = deepSignal(value)
  return live as T
}

const vueReactiveCase: ReactiveContextCase = {
  createLive: createVueLive,
  name: 'vue reactive',
  verifyDraftSnapshot: (value) => {
    assert.equal(isReactive(value), false)
    assert.equal(isReactive(value.nested), false)
    assert.equal(isReactive(value.list), false)
  },
  verifyLiveValue: (value) => {
    assert.equal(isReactive(value), true)
    assert.equal(isReactive(value.nested), true)
    assert.equal(isReactive(value.list), true)
  },
}

const alienDeepSignalsCase: ReactiveContextCase = {
  createLive: createDeepSignalLive,
  name: 'alien-deepsignals',
}

const createRootReplacingMachine = (createLive: ReactiveContextCase['createLive']) =>
  stateMachine()
    .state('Idle')
    .state('Done')
    .initial('Idle')
    .action('STEP')
    .context(() =>
      createLive<RootContext>({
        keep: 1,
        list: [1, 2],
        nested: { count: 0, flag: true },
        remove: 2,
      }),
    )
    .transition('Idle', 'STEP', 'Done', (context: RootContext) => ({
      add: 3,
      keep: 9,
      list: [...context.list, 3],
      nested: {
        count: context.nested.count + 1,
        flag: false,
      },
    }))

const createRootMutatingMachine = (createLive: ReactiveContextCase['createLive']) =>
  stateMachine()
    .state('Idle')
    .state('Done')
    .initial('Idle')
    .action('STEP')
    .context(() =>
      createLive<RootContext>({
        keep: 1,
        list: [1, 2],
        nested: { count: 0, flag: true },
        remove: 2,
      }),
    )
    .transition('Idle', 'STEP', 'Done', (context: RootContext) => {
      context.keep = 9
      context.add = 3
      context.list.push(3)
      context.nested.count += 1
      context.nested.flag = false
      delete context.remove

      return context
    })

const createComposedMachine = (
  createLive: ReactiveContextCase['createLive'],
  onGuard: () => void,
) => {
  const child = stateMachine()
    .state('ChildA')
    .state('ChildB')
    .initial('ChildA')
    .action('STEP')
    .context(() =>
      createLive<ChildContext>({
        list: [1],
        nested: { count: 0 },
        remove: 1,
        value: 0,
      }),
    )
    .transition(
      'ChildA',
      [
        'STEP',
        (context) => {
          const childContext = context as ChildContext

          onGuard()
          assert.deepEqual(toPlain(childContext), {
            list: [1],
            nested: { count: 0 },
            remove: 1,
            value: 0,
          })
          return true
        },
      ],
      'ChildB',
      (context: ChildContext) => ({
        keep: 9,
        list: [...context.list, 2],
        nested: {
          count: context.nested.count + 1,
        },
        value: context.value + 2,
      }),
    )

  return stateMachine()
    .state('Idle')
    .compose('child', child.done())
    .initial('Idle')
    .action('ENTER')
    .context(() => ({ parent: 41, sibling: { label: 'stay' } }))
    .transition('Idle', 'ENTER', 'ChildA')
}

const createNestedComposedMachine = (createLive: ReactiveContextCase['createLive']) => {
  const leaf = stateMachine()
    .state('LeafA')
    .state('LeafB')
    .initial('LeafA')
    .action('LEAF_STEP')
    .context(() =>
      createLive<ChildContext>({
        list: [1],
        nested: { count: 0 },
        remove: 1,
        value: 0,
      }),
    )
    .transition('LeafA', 'LEAF_STEP', 'LeafB', (context: ChildContext) => ({
      keep: 7,
      list: [...context.list, 2, 3],
      nested: { count: context.nested.count + 2 },
      value: context.value + 1,
    }))

  const middle = stateMachine()
    .state('MiddleIdle')
    .compose('leaf', leaf.done())
    .initial('MiddleIdle')
    .action('ENTER_LEAF')
    .context(() => ({ middleKeep: true }))
    .transition('MiddleIdle', 'ENTER_LEAF', 'LeafA')

  return stateMachine()
    .state('RootIdle')
    .compose('middle', middle.done())
    .initial('RootIdle')
    .action('ENTER_MIDDLE')
    .context(() => ({ rootKeep: 1 }))
    .transition('RootIdle', 'ENTER_MIDDLE', 'MiddleIdle')
}

const createDiscriminatedRootMachine = (createLive: ReactiveContextCase['createLive']) =>
  stateMachine()
    .state('Idle')
    .state('Done')
    .initial('Idle')
    .action('STEP')
    .context<ReactiveDiscriminatedRootContext>(() =>
      createLive({
        list: [1],
        nested: { count: 0 },
        state: 'Idle',
      }),
    )
    .transition('Idle', 'STEP', 'Done', (context: ReactiveDiscriminatedIdleContext) => ({
      done: true,
      list: [...context.list, 2],
      nested: { count: context.nested.count + 1 },
      state: 'Done' as const,
    }))

const createDiscriminatedComposedMachine = (createLive: ReactiveContextCase['createLive']) => {
  const child = stateMachine()
    .state('ChildA')
    .state('ChildB')
    .initial('ChildA')
    .action('STEP')
    .context<ReactiveDiscriminatedChildContext>(() =>
      createLive({
        list: [1],
        nested: { count: 0 },
        state: 'ChildA',
      }),
    )
    .transition('ChildA', 'STEP', 'ChildB', (context: ReactiveDiscriminatedChildAContext) => ({
      list: [...context.list, 2],
      nested: { count: context.nested.count + 1 },
      state: 'ChildB' as const,
      value: 2,
    }))

  return stateMachine()
    .state('Idle')
    .compose('child', child.done())
    .initial('Idle')
    .action('ENTER')
    .context(() => ({ parent: 41 }))
    .transition('Idle', 'ENTER', 'ChildA')
}

const runReactiveContextCompliance = (testCase: ReactiveContextCase) => {
  it('replaces the live root when a root reducer returns a fresh object', () => {
    const service = interpret(createRootReplacingMachine(testCase.createLive).done())
    const rootReference = service.context
    const nestedReference = rootReference.nested
    const listReference = rootReference.list

    testCase.verifyLiveValue?.(rootReference)

    assert.equal(service.do('STEP'), true)
    assert.equal(service.state, 'Done')
    assert.notEqual(service.context, rootReference)
    assert.notEqual(service.context.nested, nestedReference)
    assert.notEqual(service.context.list, listReference)
    assert.deepEqual(toPlain(service.context), {
      add: 3,
      keep: 9,
      list: [1, 2, 3],
      nested: { count: 1, flag: false },
    })
    assert.equal('remove' in service.context, false)
  })

  it('preserves the live root when a root reducer mutates in place', () => {
    const service = interpret(createRootMutatingMachine(testCase.createLive).done())
    const rootReference = service.context
    const nestedReference = rootReference.nested
    const listReference = rootReference.list

    testCase.verifyLiveValue?.(rootReference)

    assert.equal(service.do('STEP'), true)
    assert.equal(service.state, 'Done')
    assert.equal(service.context, rootReference)
    assert.equal(service.context.nested, nestedReference)
    assert.equal(service.context.list, listReference)
    testCase.verifyLiveValue?.(service.context)
    assert.deepEqual(toPlain(service.context), {
      add: 3,
      keep: 9,
      list: [1, 2, 3],
      nested: { count: 1, flag: false },
    })
    assert.equal('remove' in service.context, false)
  })

  it('uses a detached draft snapshot and commits back into the same live root', () => {
    const service = interpret(createRootReplacingMachine(testCase.createLive).done())
    const rootReference = service.context
    const nestedReference = rootReference.nested
    const listReference = rootReference.list
    const draft = service.draft()
    const draftContext = draft.context

    assert.notEqual(draftContext, rootReference)
    assert.notEqual(draftContext.nested, nestedReference)
    assert.notEqual(draftContext.list, listReference)
    testCase.verifyDraftSnapshot?.(draftContext)
    assert.deepEqual(toPlain(draftContext), {
      keep: 1,
      list: [1, 2],
      nested: { count: 0, flag: true },
      remove: 2,
    })

    assert.equal(draft.do('STEP'), true)
    assert.equal(service.state, 'Idle')
    assert.equal(service.context, rootReference)
    assert.deepEqual(toPlain(service.context), {
      keep: 1,
      list: [1, 2],
      nested: { count: 0, flag: true },
      remove: 2,
    })

    draft.commit()

    assert.equal(service.state, 'Done')
    assert.equal(service.context, rootReference)
    assert.equal(service.context.nested, nestedReference)
    assert.equal(service.context.list, listReference)
    testCase.verifyLiveValue?.(service.context)
    assert.deepEqual(toPlain(service.context), {
      add: 3,
      keep: 9,
      list: [1, 2, 3],
      nested: { count: 1, flag: false },
    })
    assert.equal('remove' in service.context, false)
  })

  it('updates only the reactive child slice during live composed dispatch', () => {
    const onGuard = vi.fn(() => undefined)
    const service = interpret(createComposedMachine(testCase.createLive, onGuard).done())

    assert.equal(service.do('ENTER'), true)
    assert.equal(service.state, 'ChildA')

    const rootReference = service.context
    const childReference = rootReference.child
    const childNestedReference = childReference.nested
    const childListReference = childReference.list
    const siblingReference = rootReference.sibling

    testCase.verifyLiveValue?.(childReference)

    assert.equal(service.do('STEP'), true)
    assert.equal(service.state, 'ChildB')
    assert.equal(onGuard.mock.calls.length, 1)
    assert.equal(service.context, rootReference)
    assert.equal(service.context.child, childReference)
    assert.equal(service.context.child.nested, childNestedReference)
    assert.equal(service.context.child.list, childListReference)
    assert.equal(service.context.sibling, siblingReference)
    testCase.verifyLiveValue?.(service.context.child)
    assert.deepEqual(toPlain(service.context), {
      child: {
        keep: 9,
        list: [1, 2],
        nested: { count: 1 },
        value: 2,
      },
      parent: 41,
      sibling: { label: 'stay' },
    })
    assert.equal('remove' in service.context.child, false)
  })

  it('commits composed child draft results into the same live child slice', () => {
    const onGuard = vi.fn(() => undefined)
    const service = interpret(createComposedMachine(testCase.createLive, onGuard).done())

    assert.equal(service.do('ENTER'), true)

    const rootReference = service.context
    const childReference = rootReference.child
    const childNestedReference = childReference.nested
    const childListReference = childReference.list
    const siblingReference = rootReference.sibling
    const draft = service.draft()
    const draftContext = draft.context

    assert.notEqual(draftContext, rootReference)
    assert.notEqual(draftContext.child, childReference)
    assert.notEqual(draftContext.child.nested, childNestedReference)
    assert.notEqual(draftContext.child.list, childListReference)
    testCase.verifyDraftSnapshot?.(draftContext.child)
    assert.deepEqual(toPlain(draftContext), {
      child: {
        list: [1],
        nested: { count: 0 },
        remove: 1,
        value: 0,
      },
      parent: 41,
      sibling: { label: 'stay' },
    })

    assert.equal(draft.do('STEP'), true)
    assert.equal(service.state, 'ChildA')
    assert.deepEqual(toPlain(service.context), {
      child: {
        list: [1],
        nested: { count: 0 },
        remove: 1,
        value: 0,
      },
      parent: 41,
      sibling: { label: 'stay' },
    })

    draft.commit()

    assert.equal(service.state, 'ChildB')
    assert.equal(onGuard.mock.calls.length, 1)
    assert.equal(service.context, rootReference)
    assert.equal(service.context.child, childReference)
    assert.equal(service.context.child.nested, childNestedReference)
    assert.equal(service.context.child.list, childListReference)
    assert.equal(service.context.sibling, siblingReference)
    testCase.verifyLiveValue?.(service.context.child)
    assert.deepEqual(toPlain(service.context), {
      child: {
        keep: 9,
        list: [1, 2],
        nested: { count: 1 },
        value: 2,
      },
      parent: 41,
      sibling: { label: 'stay' },
    })
    assert.equal('remove' in service.context.child, false)
  })

  it('publishes recursively through nested composed child slices', () => {
    const service = interpret(createNestedComposedMachine(testCase.createLive).done())

    assert.equal(service.do('ENTER_MIDDLE'), true)
    assert.equal(service.state, 'MiddleIdle')
    assert.equal(service.do('ENTER_LEAF'), true)
    assert.equal(service.state, 'LeafA')

    const rootReference = service.context
    const middleReference = rootReference.middle
    const leafReference = middleReference.leaf
    const leafNestedReference = leafReference.nested
    const leafListReference = leafReference.list

    testCase.verifyLiveValue?.(leafReference)

    assert.equal(service.do('LEAF_STEP'), true)
    assert.equal(service.state, 'LeafB')
    assert.equal(service.context, rootReference)
    assert.equal(service.context.middle, middleReference)
    assert.equal(service.context.middle.leaf, leafReference)
    assert.equal(service.context.middle.leaf.nested, leafNestedReference)
    assert.equal(service.context.middle.leaf.list, leafListReference)
    testCase.verifyLiveValue?.(service.context.middle.leaf)
    assert.deepEqual(toPlain(service.context), {
      middle: {
        leaf: {
          keep: 7,
          list: [1, 2, 3],
          nested: { count: 2 },
          value: 1,
        },
        middleKeep: true,
      },
      rootKeep: 1,
    })
    assert.equal('remove' in service.context.middle.leaf, false)
  })

  it('keeps discriminated-union root context aligned through reactive draft commit', () => {
    const service = interpret(createDiscriminatedRootMachine(testCase.createLive).done())
    const rootReference = service.context
    const nestedReference = rootReference.nested
    const listReference = rootReference.list
    const seen: Array<{ contextState: string; state: string }> = []

    service.subscribe((change) => {
      seen.push({
        contextState: (change.context as { state: string }).state,
        state: String(change.state),
      })
    })

    testCase.verifyLiveValue?.(rootReference)
    assert.equal(service.state, 'Idle')
    assert.equal(service.context.state, 'Idle')

    const draft = service.draft()
    const draftContext = draft.context

    assert.notEqual(draftContext, rootReference)
    assert.notEqual(draftContext.nested, nestedReference)
    assert.notEqual(draftContext.list, listReference)
    testCase.verifyDraftSnapshot?.(draftContext)

    assert.equal(draft.do('STEP'), true)
    assert.equal(draft.state, 'Done')
    assert.equal(draft.context.state, 'Done')
    assert.equal(service.state, 'Idle')
    assert.equal(service.context.state, 'Idle')

    draft.commit()

    assert.equal(service.state, 'Done')
    assert.equal(service.context.state, 'Done')
    assert.equal(service.context, rootReference)
    assert.equal(service.context.nested, nestedReference)
    assert.equal(service.context.list, listReference)
    testCase.verifyLiveValue?.(service.context)
    assert.deepEqual(toPlain(service.context), {
      done: true,
      list: [1, 2],
      nested: { count: 1 },
      state: 'Done',
    })
    assert.deepEqual(seen, [{ contextState: 'Done', state: 'Done' }])
  })

  it('keeps discriminated-union child context aligned on reactive composed dispatch', () => {
    const service = interpret(createDiscriminatedComposedMachine(testCase.createLive).done())

    assert.equal(service.do('ENTER'), true)
    assert.equal(service.state, 'ChildA')
    assert.equal(service.context.child.state, 'ChildA')

    const rootReference = service.context
    const childReference = rootReference.child
    const childNestedReference = childReference.nested
    const childListReference = childReference.list
    const seen: Array<{ childState: string; state: string }> = []

    service.subscribe((change) => {
      seen.push({
        childState: (change.context as { child: { state: string } }).child.state,
        state: String(change.state),
      })
    })

    testCase.verifyLiveValue?.(childReference)

    assert.equal(service.do('STEP'), true)
    assert.equal(service.state, 'ChildB')
    assert.equal(service.context, rootReference)
    assert.equal(service.context.child, childReference)
    assert.equal(service.context.child.state, 'ChildB')
    assert.equal(service.context.child.nested, childNestedReference)
    assert.equal(service.context.child.list, childListReference)
    testCase.verifyLiveValue?.(service.context.child)
    assert.deepEqual(toPlain(service.context), {
      child: {
        list: [1, 2],
        nested: { count: 1 },
        state: 'ChildB',
        value: 2,
      },
      parent: 41,
    })
    assert.deepEqual(seen, [{ childState: 'ChildB', state: 'ChildB' }])
  })
}

describe('reactive context integration', () => {
  describe.each([vueReactiveCase, alienDeepSignalsCase])('$name', (testCase) => {
    runReactiveContextCompliance(testCase)
  })
})
