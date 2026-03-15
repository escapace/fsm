import { deepSignal } from 'alien-deepsignals'
import { assert, describe, it } from 'vitest'
import { isReactive, reactive } from 'vue'
import { reconcileContext, snapshotContext } from '../context-runtime'
import { isStateMachineError, isStateMachineErrorOfType, type StateMachineError } from '../index'

interface ObjectSurface {
  list: unknown[]
  nested: object
}

interface ObjectSurfaceCase {
  name: string
  createLive: <T extends object>(value: T) => T
  verifyLiveValue?: (value: ObjectSurface) => void
  verifySnapshotValue?: (value: ObjectSurface) => void
}

interface SelfReferentialRoot {
  nested: {
    count: number
  }
  self?: SelfReferentialRoot
}

const createRandom = (seed: number): (() => number) => {
  let state = seed >>> 0

  return () => {
    state += 1_831_565_813
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296
  }
}

const shuffle = <T>(values: readonly T[], random: () => number): T[] => {
  const result = [...values]

  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1))
    const current = result[index]
    result[index] = result[target]
    result[target] = current
  }

  return result
}

const buildObjectFromStringEntries = (
  entries: ReadonlyArray<readonly [string, unknown]>,
): Record<string, unknown> => {
  const result: Record<string, unknown> = {}

  for (const [key, value] of entries) {
    result[key] = value
  }

  return result
}

const buildObjectFromEntries = (
  entries: ReadonlyArray<readonly [PropertyKey, unknown]>,
): { [key: string]: unknown; [key: symbol]: unknown } => {
  const result: { [key: string]: unknown; [key: symbol]: unknown } = {}

  for (const [key, value] of entries) {
    result[key] = value
  }

  return result
}

const createSparseArray = <T>(
  entries: ReadonlyArray<readonly [number, T]>,
  length: number,
): Array<T | undefined> => {
  const result = new Array<T | undefined>(length)

  for (const [index, value] of entries) {
    result[index] = value
  }

  return result
}

const presentIndices = (value: readonly unknown[]): number[] => {
  const result: number[] = []

  for (let index = 0; index < value.length; index += 1) {
    if (index in value) {
      result.push(index)
    }
  }

  return result
}

const keyLabels = (value: object): string[] =>
  Reflect.ownKeys(value).map((key) =>
    typeof key === 'symbol' ? `symbol:${key.description ?? ''}` : key,
  )

const createPlainLive = <T extends object>(value: T): T => value

const createVueLive = <T extends object>(value: T): T => {
  const live: unknown = reactive(value)
  return live as T
}

const createDeepSignalLive = <T extends object>(value: T): T => {
  const live: unknown = deepSignal(value)
  return live as T
}

const objectSurfaceCases: ObjectSurfaceCase[] = [
  {
    createLive: createPlainLive,
    name: 'plain objects',
  },
  {
    createLive: createVueLive,
    name: 'vue reactive objects',
    verifyLiveValue: (value) => {
      assert.equal(isReactive(value), true)
      assert.equal(isReactive(value.nested), true)
      assert.equal(isReactive(value.list), true)
    },
    verifySnapshotValue: (value) => {
      assert.equal(isReactive(value), false)
      assert.equal(isReactive(value.nested), false)
      assert.equal(isReactive(value.list), false)
    },
  },
  {
    createLive: createDeepSignalLive,
    name: 'alien-deepsignals objects',
  },
]

const assertDraftContextCloneFailed = (function_: () => unknown) => {
  try {
    function_()
    assert.fail('Expected StateMachineError(DraftContextCloneFailed)')
  } catch (error) {
    assert.equal(isStateMachineError(error), true)
    assert.equal(
      isStateMachineErrorOfType(error as StateMachineError, 'DraftContextCloneFailed'),
      true,
    )
  }
}

const runObjectSurfaceContract = (testCase: ObjectSurfaceCase) => {
  it('snapshotContext preserves input key order across permutations and detaches nested state', () => {
    const entries = [
      ['delta', 4],
      ['alpha', 1],
      ['charlie', 3],
      ['bravo', 2],
    ] as const
    const random = createRandom(424_242)

    for (let index = 0; index < 16; index += 1) {
      const candidateEntries = shuffle(entries, random)
      const live = testCase.createLive({
        list: [1, 2],
        nested: buildObjectFromStringEntries(candidateEntries),
      })
      const snapshot = snapshotContext(live) as {
        list: number[]
        nested: Record<string, unknown>
      }

      assert.notEqual(snapshot, live)
      assert.notEqual(snapshot.nested, live.nested)
      assert.notEqual(snapshot.list, live.list)
      testCase.verifySnapshotValue?.(snapshot)
      assert.deepEqual(
        Object.keys(snapshot.nested),
        candidateEntries.map(([key]) => key),
      )
    }
  })

  it('snapshotContext preserves sparse array holes and exact length', () => {
    const live = testCase.createLive({
      list: createSparseArray(
        [
          [1, 20],
          [3, 40],
        ],
        5,
      ),
      nested: { keep: true },
    })
    const snapshot = snapshotContext(live) as {
      list: Array<number | undefined>
      nested: {
        keep: boolean
      }
    }

    assert.equal(snapshot.list.length, 5)
    assert.deepEqual(presentIndices(snapshot.list), [1, 3])
    assert.equal(0 in snapshot.list, false)
    assert.equal(2 in snapshot.list, false)
    assert.equal(4 in snapshot.list, false)
    assert.deepEqual(snapshot.nested, { keep: true })
  })

  it('reconcileContext preserves compatible root and subtree identities', () => {
    const live = testCase.createLive<{
      keep: number
      list: number[]
      nested: {
        count: number
        flag: boolean
      }
      add?: number
      remove?: number
    }>({
      keep: 1,
      list: [1, 2],
      nested: { count: 0, flag: true },
      remove: 2,
    })
    const listReference = live.list
    const nestedReference = live.nested

    testCase.verifyLiveValue?.(live)

    const result = reconcileContext(live, {
      add: 3,
      keep: 9,
      list: [1, 2, 3],
      nested: { count: 1, flag: false },
    }) as typeof live

    assert.equal(result, live)
    assert.equal(result.list, listReference)
    assert.equal(result.nested, nestedReference)
    testCase.verifyLiveValue?.(result)
    assert.deepEqual(result, {
      add: 3,
      keep: 9,
      list: [1, 2, 3],
      nested: { count: 1, flag: false },
    })
    assert.equal('remove' in result, false)
  })

  it('reconcileContext preserves next key order instead of retaining previous object order', () => {
    const entries = [
      ['delta', 4],
      ['alpha', 1],
      ['charlie', 3],
      ['bravo', 2],
    ] as const
    const random = createRandom(20_260_217)

    for (let index = 0; index < 16; index += 1) {
      const candidateEntries = shuffle(entries, random)
      const current = testCase.createLive(buildObjectFromStringEntries(entries))
      const next = buildObjectFromStringEntries(candidateEntries)
      const result = reconcileContext(current, next)

      assert.equal(result, current)
      assert.deepEqual(
        Object.keys(result),
        candidateEntries.map(([key]) => key),
      )
    }
  })

  it('reconcileContext preserves sparse array holes instead of materializing undefined entries', () => {
    const current = testCase.createLive({
      list: [10, 20, 30],
      nested: { keep: true },
    })
    const listReference = current.list
    const nextList = createSparseArray(
      [
        [1, 20],
        [4, 50],
      ],
      5,
    )

    const result = reconcileContext(current, {
      list: nextList,
      nested: { keep: true },
    }) as typeof current

    assert.equal(result, current)
    assert.equal(result.list, listReference)
    assert.equal(result.list.length, 5)
    assert.deepEqual(presentIndices(result.list), [1, 4])
    assert.equal(0 in result.list, false)
    assert.equal(2 in result.list, false)
    assert.equal(3 in result.list, false)
    assert.equal(result.list[1], 20)
    assert.equal(result.list[4], 50)
  })

  it('reconcileContext preserves shared references from the next graph', () => {
    const current = testCase.createLive({
      left: { note: 'left', value: 0 },
      nested: { count: 0 },
      right: { note: 'right', value: 0 },
    })
    const shared = { note: 'shared', value: 2 }

    const result = reconcileContext(current, {
      left: shared,
      nested: { count: 1 },
      right: shared,
    }) as typeof current

    assert.equal(result, current)
    assert.equal(result.left, result.right)
    assert.deepEqual(result.left, { note: 'shared', value: 2 })
    assert.deepEqual(result.nested, { count: 1 })
  })
}

describe('context runtime direct contracts', () => {
  describe('primitive values', () => {
    it('snapshotContext returns primitive values unchanged', () => {
      assert.equal(snapshotContext(1), 1)
      assert.equal(snapshotContext('x'), 'x')
      assert.equal(snapshotContext(true), true)
      assert.equal(snapshotContext(null), null)
    })

    it('reconcileContext returns nextContext across primitive boundaries', () => {
      assert.equal(reconcileContext(1, 2), 2)
      assert.equal(reconcileContext('left', 'right'), 'right')
      assert.equal(reconcileContext(null, false), false)
      assert.equal(reconcileContext({ keep: true }, 2), 2)

      const nextObject = { keep: true }
      assert.equal(reconcileContext(1, nextObject), nextObject)
      assert.equal(reconcileContext(null, nextObject), nextObject)
    })
  })

  describe.each(objectSurfaceCases)('$name', (testCase) => {
    runObjectSurfaceContract(testCase)
  })

  describe('plain-object exotic shapes', () => {
    it('snapshotContext preserves cycles, shared references, prototype, and symbol-key order', () => {
      const first = Symbol('first')
      const second = Symbol('second')
      const prototype = { marker: true }
      const shared = { count: 1 }
      const live = Object.create(prototype) as {
        alpha: number
        [first]: string
        left: {
          count: number
        }
        omega: number
        right: {
          count: number
        }
        [second]: string
        self: unknown
      }

      live.omega = 1
      live.alpha = 2
      live[first] = 'first'
      live[second] = 'second'
      live.left = shared
      live.right = shared
      live.self = live

      const snapshot = snapshotContext(live) as typeof live

      assert.notEqual(snapshot, live)
      assert.equal(Object.getPrototypeOf(snapshot), prototype)
      assert.equal(snapshot.left, snapshot.right)
      assert.equal(snapshot.self, snapshot)
      assert.deepEqual(keyLabels(snapshot), keyLabels(live))
    })

    it('snapshotContext clones dates, maps, sets, buffers, typed arrays, and data views', () => {
      const typed = new Uint8Array([1, 2, 3])
      const viewBuffer = new Uint8Array([4, 5, 6]).buffer
      const mapEntries = [
        ['beta', { value: 2 }],
        ['alpha', { value: 1 }],
      ] as const
      const setValues = ['beta', 'alpha'] as const
      const live = {
        buffer: typed.buffer.slice(0),
        date: new Date('2024-01-02T03:04:05.000Z'),
        map: new Map<unknown, unknown>(mapEntries),
        set: new Set(setValues),
        typed: new Uint16Array([7, 8, 9]),
        view: new DataView(viewBuffer),
      }

      const snapshot = snapshotContext(live) as typeof live

      assert.notEqual(snapshot.date, live.date)
      assert.equal(snapshot.date.getTime(), live.date.getTime())
      assert.notEqual(snapshot.map, live.map)
      assert.deepEqual([...snapshot.map.keys()], ['beta', 'alpha'])
      assert.notEqual(snapshot.set, live.set)
      assert.deepEqual([...snapshot.set.values()], ['beta', 'alpha'])
      assert.notEqual(snapshot.buffer, live.buffer)
      assert.deepEqual(
        Array.from(new Uint8Array(snapshot.buffer)),
        Array.from(new Uint8Array(live.buffer)),
      )
      assert.notEqual(snapshot.typed, live.typed)
      assert.equal(snapshot.typed.constructor, Uint16Array)
      assert.deepEqual(Array.from(snapshot.typed), [7, 8, 9])
      assert.notEqual(snapshot.view, live.view)
      assert.deepEqual(
        Array.from(
          new Uint8Array(snapshot.view.buffer, snapshot.view.byteOffset, snapshot.view.byteLength),
        ),
        [4, 5, 6],
      )
    })

    it('snapshotContext rejects unsupported values with DraftContextCloneFailed', () => {
      assertDraftContextCloneFailed(() => {
        snapshotContext({ bad: () => 1 })
      })
    })

    it('reconcileContext can publish unsupported values that fail later snapshot creation', () => {
      const current: {
        keep?: boolean
        bad?: () => number
      } = { keep: true }
      const published = reconcileContext(current, { bad: () => 1 }) as typeof current

      assert.equal(published, current)
      assert.equal(typeof published.bad, 'function')

      assertDraftContextCloneFailed(() => {
        snapshotContext(published)
      })
    })

    it('reconcileContext preserves self cycles while keeping the root identity', () => {
      const current: SelfReferentialRoot = {
        nested: { count: 0 },
      }
      current.self = current

      const next: SelfReferentialRoot = {
        nested: { count: 1 },
      }
      next.self = next

      const result = reconcileContext(current, next)

      assert.equal(result, current)
      assert.equal(result.self, result)
      assert.deepEqual(result.nested, { count: 1 })
    })

    it('reconcileContext updates supported exotic subtrees in place when possible', () => {
      const typedReference = new Uint8Array([1, 2])
      const bufferReference = new Uint8Array([3, 4]).buffer
      const viewReference = new DataView(new Uint8Array([5, 6]).buffer)
      const current = {
        buffer: bufferReference,
        date: new Date('2024-01-01T00:00:00.000Z'),
        map: new Map<string, unknown>([['alpha', { value: 0 }]]),
        set: new Set<number>([1, 2]),
        typed: typedReference,
        view: viewReference,
      }
      const dateReference = current.date
      const mapReference = current.map
      const setReference = current.set

      const next = {
        buffer: new Uint8Array([7, 8]).buffer,
        date: new Date('2024-01-03T00:00:00.000Z'),
        map: new Map<string, unknown>([
          ['alpha', { value: 1 }],
          ['beta', { value: 2 }],
        ]),
        set: new Set<number>([1, 3]),
        typed: new Uint8Array([9, 10]),
        view: new DataView(new Uint8Array([11, 12]).buffer),
      }

      const result = reconcileContext(current, next) as typeof current

      assert.equal(result, current)
      assert.equal(result.date, dateReference)
      assert.equal(result.map, mapReference)
      assert.equal(result.set, setReference)
      assert.equal(result.buffer, bufferReference)
      assert.equal(result.typed, typedReference)
      assert.equal(result.view, viewReference)
      assert.equal(result.date.getTime(), next.date.getTime())
      assert.deepEqual([...result.map.keys()], ['alpha', 'beta'])
      assert.deepEqual([...result.set.values()], [1, 3])
      assert.deepEqual(Array.from(new Uint8Array(result.buffer)), [7, 8])
      assert.deepEqual(Array.from(result.typed), [9, 10])
      assert.deepEqual(
        Array.from(
          new Uint8Array(result.view.buffer, result.view.byteOffset, result.view.byteLength),
        ),
        [11, 12],
      )
    })

    it('reconcileContext replaces only incompatible binary subtrees while preserving the parent object', () => {
      const current = {
        buffer: new Uint8Array([1, 2]).buffer,
        typed: new Uint8Array([3, 4]),
      }
      const parentReference = current
      const bufferReference = current.buffer
      const typedReference = current.typed

      const result = reconcileContext(current, {
        buffer: new Uint8Array([5, 6, 7, 8]).buffer,
        typed: new Uint16Array([9, 10]),
      }) as {
        buffer: ArrayBuffer
        typed: Uint16Array | Uint8Array
      }

      assert.equal(result, parentReference)
      assert.notEqual(result.buffer, bufferReference)
      assert.notEqual(result.typed, typedReference)
      assert.equal(result.typed.constructor, Uint16Array)
      assert.equal(result.buffer.byteLength, 4)
      assert.deepEqual(Array.from(new Uint8Array(result.buffer)), [5, 6, 7, 8])
      assert.deepEqual(Array.from(result.typed), [9, 10])
    })

    it('reconcileContext replaces incompatible binary views when byte lengths change', () => {
      const current = {
        typed: new Uint8Array([1, 2]),
        view: new DataView(new Uint8Array([3, 4]).buffer),
      }
      const parentReference = current
      const typedReference = current.typed
      const viewReference = current.view

      const result = reconcileContext(current, {
        typed: new Uint8Array([5, 6, 7]),
        view: new DataView(new Uint8Array([8, 9, 10]).buffer),
      }) as {
        typed: Uint8Array
        view: DataView
      }

      assert.equal(result, parentReference)
      assert.notEqual(result.typed, typedReference)
      assert.notEqual(result.view, viewReference)
      assert.equal(result.typed.constructor, Uint8Array)
      assert.equal(result.view.byteLength, 3)
      assert.deepEqual(Array.from(result.typed), [5, 6, 7])
      assert.deepEqual(
        Array.from(
          new Uint8Array(result.view.buffer, result.view.byteOffset, result.view.byteLength),
        ),
        [8, 9, 10],
      )
    })

    it('reconcileContext preserves key order for string and symbol keys', () => {
      const first = Symbol('first')
      const second = Symbol('second')
      const current = buildObjectFromEntries([
        ['alpha', 1],
        ['omega', 2],
        [first, 'first'],
        [second, 'second'],
      ])
      const next = buildObjectFromEntries([
        ['omega', 2],
        ['alpha', 1],
        [second, 'second'],
        [first, 'first'],
      ])

      const result = reconcileContext(current, next)

      assert.equal(result, current)
      assert.deepEqual(keyLabels(result), keyLabels(next))
    })

    it.fails('reconcileContext preserves non-enumerable descriptors for retained keys', () => {
      const current = {}
      Object.defineProperty(current, 'hidden', {
        configurable: true,
        enumerable: false,
        value: 1,
        writable: true,
      })

      const result = reconcileContext(current, { hidden: 2 }) as typeof current
      const descriptor = Object.getOwnPropertyDescriptor(result, 'hidden')

      assert.equal(result, current)
      assert.deepEqual(descriptor, {
        configurable: true,
        enumerable: false,
        value: 2,
        writable: true,
      })
    })

    it.fails('reconcileContext removes non-configurable keys absent from the next object', () => {
      const current = {}
      Object.defineProperty(current, 'fixed', {
        configurable: false,
        enumerable: true,
        value: 1,
        writable: true,
      })

      const result = reconcileContext(current, {}) as typeof current

      assert.equal(result, current)
      assert.equal('fixed' in result, false)
    })
  })
})
