import { isArrayBuffer, isDate, isMap, isSet, isTypedArray } from 'es-toolkit'
import { isObject } from './is-object'

const isDataView = (value: unknown): value is DataView => value instanceof DataView

const OBJECT_KIND_PLAIN = 0
const OBJECT_KIND_ARRAY = 1
const OBJECT_KIND_DATE = 2
const OBJECT_KIND_MAP = 3
const OBJECT_KIND_SET = 4
const OBJECT_KIND_ARRAY_BUFFER = 5
const OBJECT_KIND_DATA_VIEW = 6
const OBJECT_KIND_TYPED_ARRAY = 7

type ObjectKind =
  | typeof OBJECT_KIND_ARRAY
  | typeof OBJECT_KIND_ARRAY_BUFFER
  | typeof OBJECT_KIND_DATA_VIEW
  | typeof OBJECT_KIND_DATE
  | typeof OBJECT_KIND_MAP
  | typeof OBJECT_KIND_PLAIN
  | typeof OBJECT_KIND_SET
  | typeof OBJECT_KIND_TYPED_ARRAY

const objectKindOf = (value: object): ObjectKind => {
  if (Array.isArray(value)) {
    return OBJECT_KIND_ARRAY
  }

  if (isDate(value)) {
    return OBJECT_KIND_DATE
  }

  if (isMap(value)) {
    return OBJECT_KIND_MAP
  }

  if (isSet(value)) {
    return OBJECT_KIND_SET
  }

  if (isArrayBuffer(value)) {
    return OBJECT_KIND_ARRAY_BUFFER
  }

  if (isDataView(value)) {
    return OBJECT_KIND_DATA_VIEW
  }

  if (isTypedArray(value)) {
    return OBJECT_KIND_TYPED_ARRAY
  }

  return OBJECT_KIND_PLAIN
}

const replaceAndTrack = <T extends object>(
  nextObjectValue: object,
  replacement: T,
  nextToResult: WeakMap<object, object>,
): T => {
  nextToResult.set(nextObjectValue, replacement)
  return replacement
}

const cloneArrayBufferViewWithBuffer = <T extends ArrayBufferView>(
  value: T,
  buffer: ArrayBuffer,
): T => {
  if (value instanceof DataView) {
    return new DataView(buffer, value.byteOffset, value.byteLength) as unknown as T
  }

  const typedArray = value as unknown as {
    byteOffset: number
    constructor: new (buffer_: ArrayBuffer, byteOffset_: number, length_: number) => T
    length: number
  }

  return new typedArray.constructor(buffer, typedArray.byteOffset, typedArray.length)
}

/**
 * Creates a detached snapshot of a context value for draft execution.
 *
 * @remarks
 * The snapshot preserves observable structure from the source graph, including own-key order,
 * sparse-array holes, cycles, shared references, and object prototypes. Supported binary and
 * collection values are cloned into detached equivalents, including `Date`, `Map`, `Set`,
 * `ArrayBuffer`, `DataView`, and typed arrays. For binary values, the snapshot preserves aliasing
 * relationships between an `ArrayBuffer` and any `DataView` or typed-array views into that buffer,
 * as well as aliasing among multiple views that share the same buffer. Primitive values are
 * supported directly and are returned unchanged.
 *
 * Function values are preserved by reference (not cloned).
 *
 * @param value - Context value to snapshot.
 * @returns A detached snapshot that can be mutated without affecting the source value, or the
 * original primitive value when the input is non-object-like.
 */
/** @internal */
export function snapshot(
  value: unknown,
  seen: WeakMap<object, object> = new WeakMap<object, object>(),
): unknown {
  if (!isObject(value)) {
    return value
  }

  const sharedResult = seen.get(value)

  if (sharedResult !== undefined) {
    return sharedResult
  }

  const kind = objectKindOf(value)

  switch (kind) {
    case OBJECT_KIND_ARRAY: {
      const sourceArray = value as unknown[]
      const replacement = new Array<unknown>(sourceArray.length)
      seen.set(value, replacement)

      for (let index = 0; index < sourceArray.length; index += 1) {
        if (index in sourceArray) {
          replacement[index] = snapshot(sourceArray[index], seen)
        }
      }

      return replacement
    }
    case OBJECT_KIND_ARRAY_BUFFER: {
      const replacement = (value as ArrayBuffer).slice(0)
      seen.set(value, replacement)
      return replacement
    }
    case OBJECT_KIND_DATA_VIEW:
    case OBJECT_KIND_TYPED_ARRAY: {
      const sourceView = value as ArrayBufferView
      const replacement = cloneArrayBufferViewWithBuffer(
        sourceView,
        snapshot(sourceView.buffer, seen) as ArrayBuffer,
      )
      seen.set(value, replacement)
      return replacement
    }
    case OBJECT_KIND_DATE: {
      const replacement = new Date((value as Date).getTime())
      seen.set(value, replacement)
      return replacement
    }
    case OBJECT_KIND_MAP: {
      const sourceMap = value as Map<unknown, unknown>
      const replacement = new Map<unknown, unknown>()
      seen.set(value, replacement)

      for (const [key, entry] of sourceMap.entries()) {
        replacement.set(snapshot(key, seen), snapshot(entry, seen))
      }

      return replacement
    }
    case OBJECT_KIND_PLAIN: {
      const sourceObject = value as Record<PropertyKey, unknown>
      // eslint-disable-next-line typescript/no-unsafe-argument
      const replacement = Object.create(Object.getPrototypeOf(sourceObject)) as Record<
        PropertyKey,
        unknown
      >
      const ownKeys = Reflect.ownKeys(sourceObject)
      seen.set(value, replacement)

      for (let index = 0; index < ownKeys.length; index += 1) {
        const key = ownKeys[index]
        replacement[key] = snapshot(sourceObject[key], seen)
      }

      return replacement
    }
    case OBJECT_KIND_SET: {
      const sourceSet = value as Set<unknown>
      const replacement = new Set<unknown>()
      seen.set(value, replacement)

      for (const entry of sourceSet.values()) {
        replacement.add(snapshot(entry, seen))
      }

      return replacement
    }
  }
}

const reconcileEntryValue = (
  currentEntry: unknown,
  nextEntry: unknown,
  currentToNext: WeakMap<object, object>,
  nextToResult: WeakMap<object, object>,
): unknown =>
  Object.is(currentEntry, nextEntry)
    ? isObject(nextEntry)
      ? reconcileSharedObjectValue(currentEntry as object, nextEntry, currentToNext, nextToResult)
      : currentEntry
    : reconcileValue(currentEntry, nextEntry, currentToNext, nextToResult)

const reconcileArrayValue = (
  currentValue: object,
  nextValue: object,
  currentToNext: WeakMap<object, object>,
  nextToResult: WeakMap<object, object>,
): unknown[] => {
  const currentArray = currentValue as unknown[]
  const nextArray = nextValue as unknown[]
  const nextLength = nextArray.length

  if (currentArray.length !== nextLength) {
    currentArray.length = nextLength
  }

  for (let index = 0; index < nextLength; index += 1) {
    if (index in nextArray) {
      const currentEntry = currentArray[index]
      const nextEntry = nextArray[index]
      const reconciledEntry = reconcileEntryValue(
        currentEntry,
        nextEntry,
        currentToNext,
        nextToResult,
      )

      if (!Object.is(reconciledEntry, currentEntry)) {
        currentArray[index] = reconciledEntry
      }
    } else if (index in currentArray) {
      Reflect.deleteProperty(currentArray, index)
    }
  }

  return currentArray
}

const reconcileDateValue = (currentValue: object, nextValue: object): Date => {
  const currentDate = currentValue as Date
  const nextDate = nextValue as Date

  currentDate.setTime(nextDate.getTime())
  return currentDate
}

const reconcileMapValue = (
  currentValue: object,
  nextValue: object,
  currentToNext: WeakMap<object, object>,
  nextToResult: WeakMap<object, object>,
): Map<unknown, unknown> => {
  const currentMap = currentValue as Map<unknown, unknown>
  const nextMap = nextValue as Map<unknown, unknown>
  const currentEntries = currentMap.entries()
  const reconciledEntries = new Array<unknown>(nextMap.size * 2)
  let canReturnCurrent = currentMap.size === nextMap.size
  let index = 0

  for (const [nextKey, nextEntry] of nextMap.entries()) {
    const currentStep = currentEntries.next()
    const hasCurrentEntry = currentStep.done !== true
    const currentKey = hasCurrentEntry ? currentStep.value[0] : undefined
    const currentEntry = hasCurrentEntry ? currentStep.value[1] : undefined
    const reconciledKey = reconcileEntryValue(currentKey, nextKey, currentToNext, nextToResult)
    const reconciledEntry = reconcileEntryValue(
      currentEntry,
      nextEntry,
      currentToNext,
      nextToResult,
    )
    const entryOffset = index * 2

    reconciledEntries[entryOffset] = reconciledKey
    reconciledEntries[entryOffset + 1] = reconciledEntry

    if (
      canReturnCurrent &&
      (!hasCurrentEntry ||
        !Object.is(reconciledKey, currentKey) ||
        !Object.is(reconciledEntry, currentEntry))
    ) {
      canReturnCurrent = false
    }

    index += 1
  }

  if (canReturnCurrent) {
    return currentMap
  }

  currentMap.clear()

  for (let entryOffset = 0; entryOffset < reconciledEntries.length; entryOffset += 2) {
    currentMap.set(reconciledEntries[entryOffset], reconciledEntries[entryOffset + 1])
  }

  return currentMap
}

const reconcileSetValue = (
  currentValue: object,
  nextValue: object,
  currentToNext: WeakMap<object, object>,
  nextToResult: WeakMap<object, object>,
): Set<unknown> => {
  const currentSet = currentValue as Set<unknown>
  const nextSet = nextValue as Set<unknown>
  const currentEntries = currentSet.values()
  const reconciledEntries = new Array<unknown>(nextSet.size)
  let canReturnCurrent = currentSet.size === nextSet.size
  let index = 0

  for (const nextEntry of nextSet.values()) {
    const currentStep = currentEntries.next()
    const hasCurrentEntry = currentStep.done !== true
    const currentEntry = hasCurrentEntry ? currentStep.value : undefined
    const reconciledEntry = reconcileEntryValue(
      currentEntry,
      nextEntry,
      currentToNext,
      nextToResult,
    )

    reconciledEntries[index] = reconciledEntry

    if (canReturnCurrent && (!hasCurrentEntry || !Object.is(reconciledEntry, currentEntry))) {
      canReturnCurrent = false
    }

    index += 1
  }

  if (canReturnCurrent) {
    return currentSet
  }

  currentSet.clear()

  for (let entryIndex = 0; entryIndex < reconciledEntries.length; entryIndex += 1) {
    currentSet.add(reconciledEntries[entryIndex])
  }

  return currentSet
}

const reconcileArrayBufferValue = (
  currentValue: object,
  nextValue: object,
  nextToResult: WeakMap<object, object>,
): ArrayBuffer => {
  const currentBuffer = currentValue as ArrayBuffer
  const nextBuffer = nextValue as ArrayBuffer

  if (currentBuffer.byteLength !== nextBuffer.byteLength) {
    return replaceAndTrack(nextBuffer, nextBuffer.slice(0), nextToResult)
  }

  new Uint8Array(currentBuffer).set(new Uint8Array(nextBuffer))
  return currentBuffer
}

const reconcileBufferViewValue = (
  currentValue: object,
  nextValue: object,
  currentToNext: WeakMap<object, object>,
  nextToResult: WeakMap<object, object>,
): ArrayBufferView => {
  const currentView = currentValue as ArrayBufferView
  const nextView = nextValue as ArrayBufferView
  const reconciledBuffer = reconcileEntryValue(
    currentView.buffer,
    nextView.buffer,
    currentToNext,
    nextToResult,
  ) as ArrayBuffer

  if (
    currentView.buffer === reconciledBuffer &&
    currentView.constructor === nextView.constructor &&
    currentView.byteOffset === nextView.byteOffset &&
    currentView.byteLength === nextView.byteLength
  ) {
    return currentView
  }

  return replaceAndTrack(
    nextView,
    cloneArrayBufferViewWithBuffer(nextView, reconciledBuffer),
    nextToResult,
  )
}

const reconcilePlainObjectValue = (
  currentValue: object,
  nextValue: object,
  currentToNext: WeakMap<object, object>,
  nextToResult: WeakMap<object, object>,
): object => {
  const currentObjectValue = currentValue as Record<PropertyKey, unknown>
  const nextObjectValue = nextValue as Record<PropertyKey, unknown>
  const currentOwnKeys = Reflect.ownKeys(currentObjectValue)
  const nextOwnKeys = Reflect.ownKeys(nextObjectValue)
  let changedEntries: unknown[] | undefined
  let reconciledEntries: unknown[] | undefined
  let keysAligned = true

  for (let index = 0; index < nextOwnKeys.length; index += 1) {
    const key = nextOwnKeys[index]

    if (keysAligned && currentOwnKeys[index] !== key) {
      keysAligned = false
      reconciledEntries = new Array<unknown>(nextOwnKeys.length)
      let changedCursor = 0

      if (changedEntries === undefined) {
        for (let backfillIndex = 0; backfillIndex < index; backfillIndex += 1) {
          reconciledEntries[backfillIndex] = currentObjectValue[nextOwnKeys[backfillIndex]]
        }
      } else {
        for (let backfillIndex = 0; backfillIndex < index; backfillIndex += 1) {
          if (changedEntries[changedCursor] === backfillIndex) {
            reconciledEntries[backfillIndex] = changedEntries[changedCursor + 1]
            changedCursor += 2
          } else {
            reconciledEntries[backfillIndex] = currentObjectValue[nextOwnKeys[backfillIndex]]
          }
        }
      }
    }

    const currentEntry = currentObjectValue[key]
    const nextEntry = nextObjectValue[key]
    const reconciledEntry = reconcileEntryValue(
      currentEntry,
      nextEntry,
      currentToNext,
      nextToResult,
    )

    if (keysAligned) {
      if (!Object.is(reconciledEntry, currentEntry)) {
        changedEntries ??= []
        changedEntries.push(index, reconciledEntry)
      }
    } else {
      reconciledEntries![index] = reconciledEntry
    }
  }

  if (keysAligned) {
    if (changedEntries === undefined && currentOwnKeys.length === nextOwnKeys.length) {
      return currentValue
    }

    if (changedEntries !== undefined) {
      for (let index = 0; index < changedEntries.length; index += 2) {
        currentObjectValue[nextOwnKeys[changedEntries[index] as number]] = changedEntries[index + 1]
      }
    }

    for (let index = nextOwnKeys.length; index < currentOwnKeys.length; index += 1) {
      Reflect.deleteProperty(currentObjectValue, currentOwnKeys[index])
    }

    return currentValue
  }

  for (let index = 0; index < currentOwnKeys.length; index += 1) {
    Reflect.deleteProperty(currentObjectValue, currentOwnKeys[index])
  }

  for (let index = 0; index < nextOwnKeys.length; index += 1) {
    currentObjectValue[nextOwnKeys[index]] = reconciledEntries![index]
  }

  return currentValue
}

const reconcileObjectByKind = (
  kind: ObjectKind,
  currentValue: object,
  nextValue: object,
  currentToNext: WeakMap<object, object>,
  nextToResult: WeakMap<object, object>,
): unknown => {
  currentToNext.set(currentValue, nextValue)
  nextToResult.set(nextValue, currentValue)

  switch (kind) {
    case OBJECT_KIND_ARRAY:
      return reconcileArrayValue(currentValue, nextValue, currentToNext, nextToResult)
    case OBJECT_KIND_ARRAY_BUFFER:
      return reconcileArrayBufferValue(currentValue, nextValue, nextToResult)
    case OBJECT_KIND_DATA_VIEW:
    case OBJECT_KIND_TYPED_ARRAY:
      return reconcileBufferViewValue(currentValue, nextValue, currentToNext, nextToResult)
    case OBJECT_KIND_DATE:
      return reconcileDateValue(currentValue, nextValue)
    case OBJECT_KIND_MAP:
      return reconcileMapValue(currentValue, nextValue, currentToNext, nextToResult)
    case OBJECT_KIND_PLAIN:
      return reconcilePlainObjectValue(currentValue, nextValue, currentToNext, nextToResult)
    case OBJECT_KIND_SET:
      return reconcileSetValue(currentValue, nextValue, currentToNext, nextToResult)
  }
}

const reconcileSharedObjectValue = (
  currentValue: object,
  nextValue: object,
  currentToNext: WeakMap<object, object>,
  nextToResult: WeakMap<object, object>,
): object => {
  const sharedResult = nextToResult.get(nextValue)

  if (sharedResult !== undefined) {
    return sharedResult
  }

  if (currentToNext.get(currentValue) !== undefined) {
    return snapshot(nextValue, nextToResult) as object
  }

  currentToNext.set(currentValue, nextValue)
  nextToResult.set(nextValue, currentValue)
  return currentValue
}

const reconcileValue = (
  currentValue: unknown,
  nextValue: unknown,
  currentToNext: WeakMap<object, object>,
  nextToResult: WeakMap<object, object>,
): unknown => {
  if (!isObject(nextValue)) {
    return nextValue
  }

  const sharedResult = nextToResult.get(nextValue)

  if (sharedResult !== undefined) {
    return sharedResult
  }

  if (!isObject(currentValue)) {
    return snapshot(nextValue, nextToResult)
  }

  if (currentToNext.get(currentValue) !== undefined) {
    // This path means the current node was already consumed by a different next node.
    // Reuse would collapse distinct next topology, so clone from next instead.
    return snapshot(nextValue, nextToResult)
  }

  const currentKind = objectKindOf(currentValue)
  const nextKind = objectKindOf(nextValue)

  if (currentKind !== nextKind) {
    return snapshot(nextValue, nextToResult)
  }

  return reconcileObjectByKind(currentKind, currentValue, nextValue, currentToNext, nextToResult)
}

/**
 * Reconciles a next context graph into an existing context value.
 *
 * @remarks
 * This function preserves the `parentContext` reference when the current and next values can be
 * updated in place. Reconciliation uses one canonical graph walk: arrays reconcile by index, and
 * plain objects reconcile by enumerating current and next own keys and recursively reconciling
 * next-key values. When plain-object key order remains aligned, reconciliation updates only changed
 * properties and removes trailing extra current keys. When key order diverges, the current object is
 * rebuilt in next-key order. This preserves the next graph's own-key order, sparse-array holes,
 * cycles, and shared-reference topology. For `Date`, `Map`, `Set`, `ArrayBuffer`, `DataView`, and
 * typed-array values, compatible instances are updated in place.
 *
 * The supported plain-object surface is ordinary mutable object state. Plain-object reconciliation
 * preserves keys, values, key order, and graph topology, but does not guarantee preservation of
 * arbitrary property-descriptor semantics across all reconciliation paths, such as accessors or
 * non-configurable retained properties.
 *
 * When a subtree cannot be updated in place, the function replaces only that subtree and preserves
 * the surrounding parent object when possible. Replacement occurs for primitive or object-kind
 * changes and for incompatible binary views such as constructor or byte-length mismatches.
 * Primitive values are supported directly. When either side is not object-like, the function
 * returns `nextContext`.
 *
 * This function does not eagerly validate context value kinds for draft snapshot suitability.
 * Values such as functions are preserved by reference during snapshot traversal.
 *
 * @param parentContext - Existing live context value to update.
 * @param nextContext - Next context graph to publish into the existing value.
 * @returns The reconciled context value. This is usually `parentContext` for compatible object-like
 * updates, but may be `nextContext` or a replacement subtree when in-place reconciliation is not
 * possible.
 */
export function reconcile<T extends object>(parentContext: object, nextContext: T): T
export function reconcile<T>(parentContext: unknown, nextContext: T): T
export function reconcile(parentContext: unknown, nextContext: unknown): unknown {
  if (Object.is(parentContext, nextContext)) {
    return parentContext
  }

  if (!isObject(parentContext) || !isObject(nextContext)) {
    return nextContext
  }

  const rootKind = objectKindOf(parentContext)

  if (rootKind !== objectKindOf(nextContext)) {
    return nextContext
  }

  return reconcileObjectByKind(
    rootKind,
    parentContext,
    nextContext,
    new WeakMap<object, object>(),
    new WeakMap<object, object>(),
  )
}
