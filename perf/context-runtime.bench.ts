import { cloneDeep } from 'es-toolkit'
import { bench, describe } from 'vitest'
import { reconcileContext, snapshotContext } from '../src/context-runtime'

const BATCH_SIZE = 250
const INPUT_COUNT = 64
const WARMUP_BATCHES = 32

let sink: unknown

const keepAlive = (value: unknown): void => {
  sink = value
  void sink
}

interface SnapshotInput {
  binary: {
    buffer: ArrayBuffer
    typed: Uint16Array
    view: DataView
  }
  date: Date
  id: number
  list: Array<number | undefined>
  map: Map<string, { score: number; tags: string[] }>
  nested: {
    flags: {
      cold: boolean
      hot: boolean
    }
    order: Record<string, number>
    series: number[]
  }
  set: Set<string>
  sharedLeft: {
    label: string
    values: number[]
  }
  sharedRight: {
    label: string
    values: number[]
  }
  self?: SnapshotInput
}

interface ReconcileTarget {
  binary: {
    buffer: ArrayBuffer
    typed: Uint8Array
    view: DataView
  }
  date: Date
  id: number
  list: Array<number | undefined>
  map: Map<string, { score: number; tag: string }>
  nested: {
    flags: {
      hot: boolean
      warm: boolean
    }
    order: Record<string, number>
    stats: {
      count: number
      total: number
    }
  }
  set: Set<string>
  sharedLeft: {
    label: string
    values: number[]
  }
  sharedRight: {
    label: string
    values: number[]
  }
  add?: {
    code: string
    value: number
  }
  remove?: string
  self?: ReconcileTarget
}

interface ReconcileSlot {
  current: ReconcileTarget
  index: 0 | 1
  targets: readonly [ReconcileTarget, ReconcileTarget]
}

const runBatch = (count: number, callback: () => void) => {
  for (let index = 0; index < count; index += 1) {
    callback()
  }
}

const warmup = (callback: () => void) => {
  runBatch(WARMUP_BATCHES, callback)
}

const createSeries = (seed: number, length: number, stride: number): number[] => {
  const values = new Array<number>(length)

  for (let index = 0; index < length; index += 1) {
    values[index] = seed + index * stride
  }

  return values
}

const createSparseArray = (
  length: number,
  entries: ReadonlyArray<readonly [number, number]>,
): Array<number | undefined> => {
  const result = new Array<number | undefined>(length)

  for (const [index, value] of entries) {
    result[index] = value
  }

  return result
}

const createOrderedRecord = (
  entries: ReadonlyArray<readonly [string, number]>,
): Record<string, number> => {
  const result: Record<string, number> = {}

  for (const [key, value] of entries) {
    result[key] = value
  }

  return result
}

const createArrayBuffer = (seed: number, length: number, stride: number): ArrayBuffer => {
  const values = new Uint8Array(length)

  for (let index = 0; index < length; index += 1) {
    values[index] = (seed + index * stride) & 255
  }

  return values.buffer
}

const createSnapshotInput = (seed: number): SnapshotInput => {
  const shared = {
    label: `shared-${seed % 7}`,
    values: createSeries(seed, 4, 2),
  }
  const input: SnapshotInput = {
    binary: {
      buffer: createArrayBuffer(seed * 3 + 1, 24, 7),
      typed: new Uint16Array(createSeries(seed + 2, 8, 3)),
      view: new DataView(createArrayBuffer(seed * 5 + 2, 12, 11)),
    },
    date: new Date(Date.UTC(2024, seed % 12, (seed % 28) + 1, seed % 24, seed % 60, 0)),
    id: seed,
    list: createSparseArray(8, [
      [1, seed],
      [3, seed + 2],
      [6, seed + 5],
    ]),
    map: new Map<string, { score: number; tags: string[] }>([
      [
        `alpha-${seed % 5}`,
        {
          score: seed + 1,
          tags: [`hot-${seed % 3}`, `cold-${seed % 5}`],
        },
      ],
      [
        `beta-${seed % 7}`,
        {
          score: seed + 2,
          tags: [`warm-${seed % 4}`],
        },
      ],
    ]),
    nested: {
      flags: {
        cold: seed % 2 === 0,
        hot: seed % 3 === 0,
      },
      order: createOrderedRecord([
        ['delta', seed + 4],
        ['alpha', seed + 1],
        ['charlie', seed + 3],
        ['bravo', seed + 2],
      ]),
      series: createSeries(seed, 6, 1),
    },
    set: new Set([`group-${seed % 4}`, `kind-${seed % 3}`, `tag-${seed % 7}`]),
    sharedLeft: shared,
    sharedRight: shared,
  }

  input.self = input

  return input
}

const createReconcileTarget = (seed: number, variant: 0 | 1): ReconcileTarget => {
  const shared = {
    label: variant === 0 ? `shared-a-${seed}` : `shared-b-${seed}`,
    values: createSeries(seed + variant, 5, variant === 0 ? 2 : 3),
  }
  const target: ReconcileTarget = {
    ...(variant === 0
      ? { remove: `remove-${seed}` }
      : { add: { code: `add-${seed}`, value: seed * 10 + variant } }),
    binary: {
      buffer: createArrayBuffer(seed * 7 + variant, 24, variant === 0 ? 5 : 9),
      typed: new Uint8Array(createSeries(seed + variant + 1, 16, variant === 0 ? 2 : 4)),
      view: new DataView(createArrayBuffer(seed * 11 + variant, 12, variant === 0 ? 3 : 7)),
    },
    date: new Date(Date.UTC(2025, (seed + variant) % 12, (seed % 28) + 1, variant, seed % 60, 0)),
    id: seed,
    list:
      variant === 0
        ? createSparseArray(8, [
            [1, seed + 1],
            [4, seed + 4],
            [6, seed + 6],
          ])
        : createSparseArray(9, [
            [0, seed + 2],
            [3, seed + 5],
            [7, seed + 8],
          ]),
    map: new Map<string, { score: number; tag: string }>(
      variant === 0
        ? [
            ['alpha', { score: seed + 1, tag: 'cold' }],
            ['beta', { score: seed + 2, tag: 'keep' }],
          ]
        : [
            ['beta', { score: seed + 3, tag: 'keep' }],
            ['gamma', { score: seed + 4, tag: 'hot' }],
          ],
    ),
    nested: {
      flags: {
        hot: variant === 1,
        warm: seed % 2 === 0,
      },
      order:
        variant === 0
          ? createOrderedRecord([
              ['delta', seed + 4],
              ['alpha', seed + 1],
              ['charlie', seed + 3],
              ['bravo', seed + 2],
            ])
          : createOrderedRecord([
              ['bravo', seed + 12],
              ['charlie', seed + 13],
              ['alpha', seed + 11],
              ['delta', seed + 14],
            ]),
      stats: {
        count: seed + variant,
        total: seed * 2 + variant,
      },
    },
    set:
      variant === 0
        ? new Set([`cold-${seed % 3}`, `keep-${seed % 5}`])
        : new Set([`fresh-${seed % 6}`, `hot-${seed % 4}`, `keep-${seed % 5}`]),
    sharedLeft: shared,
    sharedRight: shared,
  }

  target.self = target

  return target
}

const createReconcileSlots = (): ReconcileSlot[] =>
  Array.from({ length: INPUT_COUNT }, (_, index) => {
    const seed = index + 1
    const targetA = createReconcileTarget(seed, 0)
    const targetB = createReconcileTarget(seed, 1)

    return {
      current: cloneDeep(targetA),
      index: 0,
      targets: [targetA, targetB] as const,
    }
  })

const createSnapshotBatchRunner = (
  cloneValue: (value: SnapshotInput) => unknown,
  inputs: readonly SnapshotInput[],
): (() => void) => {
  let cursor = 0

  return () => {
    for (let index = 0; index < BATCH_SIZE; index += 1) {
      keepAlive(cloneValue(inputs[cursor]))
      cursor = (cursor + 1) % inputs.length
    }
  }
}

const createReconcileBatchRunner = (
  reconcileValue: (current: ReconcileTarget, next: ReconcileTarget) => ReconcileTarget,
  slots: ReconcileSlot[],
): (() => void) => {
  let cursor = 0

  return () => {
    for (let index = 0; index < BATCH_SIZE; index += 1) {
      const slot = slots[cursor]
      const nextIndex = slot.index === 0 ? 1 : 0
      const result = reconcileValue(slot.current, slot.targets[nextIndex])

      slot.current = result
      slot.index = nextIndex
      keepAlive(result)
      cursor = (cursor + 1) % slots.length
    }
  }
}

const snapshotInputs = Array.from({ length: INPUT_COUNT }, (_, index) =>
  createSnapshotInput(index + 1),
)

const baselineSnapshotBatch = createSnapshotBatchRunner(structuredClone, snapshotInputs)
const runtimeSnapshotBatch = createSnapshotBatchRunner(snapshotContext, snapshotInputs)
const baselineReconcileBatch = createReconcileBatchRunner(
  (_current, next) => cloneDeep(next),
  createReconcileSlots(),
)
const runtimeReconcileBatch = createReconcileBatchRunner(
  (current, next) => reconcileContext(current, next) as ReconcileTarget,
  createReconcileSlots(),
)

warmup(baselineSnapshotBatch)
warmup(runtimeSnapshotBatch)
warmup(baselineReconcileBatch)
warmup(runtimeReconcileBatch)

describe('context runtime throughput - snapshotContext', () => {
  bench(`baseline structuredClone x${BATCH_SIZE}`, baselineSnapshotBatch, { iterations: 1000 })
  bench(`snapshotContext x${BATCH_SIZE}`, runtimeSnapshotBatch, { iterations: 1000 })
})

describe('context runtime throughput - reconcileContext', () => {
  bench(`baseline cloneDeep(next) x${BATCH_SIZE}`, baselineReconcileBatch, { iterations: 1000 })
  bench(`reconcileContext x${BATCH_SIZE}`, runtimeReconcileBatch, { iterations: 1000 })
})
