import { isObjectLike as isObjectLikeValue } from 'es-toolkit/compat'
import { isDate, isMap, isSet, isTypedArray } from 'es-toolkit/predicate'
import { StateMachineError } from './error'

interface ReconcileState {
  currentToNext: WeakMap<object, object>
  nextToResult: WeakMap<object, object>
}

const isArrayBuffer = (value: unknown): value is ArrayBuffer => value instanceof ArrayBuffer

const isDataView = (value: unknown): value is DataView => value instanceof DataView

const cloneArrayBufferView = <T extends ArrayBufferView>(value: T): T => {
  if (value instanceof DataView) {
    return new DataView(value.buffer.slice(0), value.byteOffset, value.byteLength) as unknown as T
  }

  const Constructor = value.constructor as new (value_: T) => T
  return new Constructor(value)
}

const sameOwnKeyOrder = (left: object, right: object): boolean => {
  const leftKeys = Reflect.ownKeys(left)
  const rightKeys = Reflect.ownKeys(right)

  /* v8 ignore start -- defensive guard; supported reconciliation paths normalize key counts before order check */
  if (leftKeys.length !== rightKeys.length) {
    return false
  }
  /* v8 ignore stop */

  for (let index = 0; index < leftKeys.length; index += 1) {
    if (leftKeys[index] !== rightKeys[index]) {
      return false
    }
  }

  return true
}

const reorderOwnKeys = (value: Record<PropertyKey, unknown>, order: PropertyKey[]): void => {
  const entries = order.map((key) => [key, Reflect.get(value, key)] as const)

  for (const key of Reflect.ownKeys(value)) {
    Reflect.deleteProperty(value, key)
  }

  for (const [key, entry] of entries) {
    Reflect.set(value, key, entry)
  }
}

const snapshotValue = (value: unknown, seen: WeakMap<object, unknown>): unknown => {
  if (typeof value === 'function') {
    throw new TypeError('Failed to snapshot context value.')
  }

  if (!isObjectLikeValue(value)) {
    return value
  }

  const objectValue = value as Record<PropertyKey, unknown>
  const seenValue = seen.get(objectValue)

  if (seenValue !== undefined) {
    return seenValue
  }

  if (Array.isArray(value)) {
    const snapshot = new Array(value.length)
    seen.set(value, snapshot)

    for (let index = 0; index < value.length; index++) {
      if (index in value) {
        snapshot[index] = snapshotValue(value[index], seen)
      }
    }

    return snapshot
  }

  if (isDate(value)) {
    const snapshot = new Date(value.getTime())
    seen.set(value, snapshot)
    return snapshot
  }

  if (isMap(value)) {
    const snapshot = new Map<unknown, unknown>()
    seen.set(value, snapshot)

    for (const [key, entry] of value.entries()) {
      snapshot.set(snapshotValue(key, seen), snapshotValue(entry, seen))
    }

    return snapshot
  }

  if (isSet(value)) {
    const snapshot = new Set<unknown>()
    seen.set(value, snapshot)

    for (const entry of value.values()) {
      snapshot.add(snapshotValue(entry, seen))
    }

    return snapshot
  }

  if (isArrayBuffer(value)) {
    const snapshot = value.slice(0)
    seen.set(value, snapshot)
    return snapshot
  }

  if (isDataView(value) || isTypedArray(value)) {
    const snapshot = cloneArrayBufferView(value)
    seen.set(value, snapshot)
    return snapshot
  }

  const prototype = Object.getPrototypeOf(objectValue) as object | null
  const snapshot = Object.create(prototype) as Record<PropertyKey, unknown>
  seen.set(objectValue, snapshot)

  for (const key of Reflect.ownKeys(objectValue)) {
    snapshot[key] = snapshotValue(Reflect.get(objectValue, key), seen)
  }

  return snapshot
}

const reconcileValue = (
  currentValue: unknown,
  nextValue: unknown,
  state: ReconcileState,
): unknown => {
  if (Object.is(currentValue, nextValue)) {
    return currentValue
  }

  if (!isObjectLikeValue(currentValue) || !isObjectLikeValue(nextValue)) {
    return nextValue
  }

  const currentObjectValue = currentValue as Record<PropertyKey, unknown>
  const nextObjectValue = nextValue as Record<PropertyKey, unknown>
  const currentPair = state.currentToNext.get(currentObjectValue)

  if (currentPair === nextObjectValue) {
    return currentValue
  }

  const sharedResult = state.nextToResult.get(nextObjectValue)

  if (sharedResult !== undefined) {
    return sharedResult
  }

  state.currentToNext.set(currentObjectValue, nextObjectValue)
  state.nextToResult.set(nextObjectValue, currentObjectValue)

  if (Array.isArray(currentValue) && Array.isArray(nextValue)) {
    currentValue.length = nextValue.length

    for (let index = 0; index < nextValue.length; index += 1) {
      if (index in nextValue) {
        currentValue[index] = reconcileValue(currentValue[index], nextValue[index], state)
      } else {
        Reflect.deleteProperty(currentValue, index)
      }
    }

    return currentValue
  }

  if (isDate(currentValue) && isDate(nextValue)) {
    currentValue.setTime(nextValue.getTime())
    return currentValue
  }

  if (isMap(currentValue) && isMap(nextValue)) {
    currentValue.clear()

    for (const [key, entry] of nextValue.entries()) {
      currentValue.set(key, entry)
    }

    return currentValue
  }

  if (isSet(currentValue) && isSet(nextValue)) {
    currentValue.clear()

    for (const entry of nextValue.values()) {
      currentValue.add(entry)
    }

    return currentValue
  }

  if (isArrayBuffer(currentValue) && isArrayBuffer(nextValue)) {
    if (currentValue.byteLength !== nextValue.byteLength) {
      const replacement = nextValue.slice(0)
      state.nextToResult.set(nextObjectValue, replacement)
      return replacement
    }

    new Uint8Array(currentValue).set(new Uint8Array(nextValue))
    return currentValue
  }

  if (isDataView(currentValue) && isDataView(nextValue)) {
    if (currentValue.byteLength !== nextValue.byteLength) {
      const replacement = cloneArrayBufferView(nextValue)
      state.nextToResult.set(nextObjectValue, replacement)
      return replacement
    }

    new Uint8Array(currentValue.buffer, currentValue.byteOffset, currentValue.byteLength).set(
      new Uint8Array(nextValue.buffer, nextValue.byteOffset, nextValue.byteLength),
    )

    return currentValue
  }

  if (isTypedArray(currentValue) && isTypedArray(nextValue)) {
    if (currentValue.constructor !== nextValue.constructor) {
      const replacement = cloneArrayBufferView(nextValue)
      state.nextToResult.set(nextObjectValue, replacement)
      return replacement
    }

    if (currentValue.byteLength !== nextValue.byteLength) {
      const replacement = cloneArrayBufferView(nextValue)
      state.nextToResult.set(nextObjectValue, replacement)
      return replacement
    }

    new Uint8Array(currentValue.buffer, currentValue.byteOffset, currentValue.byteLength).set(
      new Uint8Array(nextValue.buffer, nextValue.byteOffset, nextValue.byteLength),
    )

    return currentValue
  }

  for (const key of Reflect.ownKeys(currentObjectValue)) {
    if (!Reflect.has(nextObjectValue, key)) {
      Reflect.deleteProperty(currentObjectValue, key)
    }
  }

  for (const key of Reflect.ownKeys(nextObjectValue)) {
    const currentEntry = Reflect.get(currentObjectValue, key)
    const nextEntry = Reflect.get(nextObjectValue, key)
    Reflect.set(currentObjectValue, key, reconcileValue(currentEntry, nextEntry, state))
  }

  if (!sameOwnKeyOrder(currentObjectValue, nextObjectValue)) {
    reorderOwnKeys(currentObjectValue, Reflect.ownKeys(nextObjectValue))
  }

  return currentValue
}

/**
 * Reconciles a next context graph into an existing context value.
 *
 * @remarks
 * This function preserves the `parentContext` reference when the current and next values can be
 * updated in place. For plain objects and arrays, reconciliation preserves the next graph's own-key
 * order, sparse-array holes, cycles, and shared-reference topology. For `Date`, `Map`, `Set`,
 * `ArrayBuffer`, `DataView`, and typed-array values, compatible instances are updated in place.
 *
 * When a subtree cannot be updated in place, the function replaces only that subtree and preserves
 * the surrounding parent object when possible. Replacement occurs for primitive or object-kind
 * changes and for incompatible binary views such as constructor or byte-length mismatches.
 * Primitive values are supported directly. When either side is not object-like, the function
 * returns `nextContext`.
 *
 * This function does not eagerly validate that the resulting graph remains snapshot-supported for
 * draft creation. Unsupported values can be published through reconciliation and may cause a later
 * call to `snapshotContext(...)` or `service.draft()` to fail with `DraftContextCloneFailed`.
 *
 * @param parentContext - Existing live context value to update.
 * @param nextContext - Next context graph to publish into the existing value.
 * @returns The reconciled context value. This is usually `parentContext` for compatible object-like
 * updates, but may be `nextContext` or a replacement subtree when in-place reconciliation is not
 * possible.
 */
const normalizeSnapshotError = (error: unknown): StateMachineError =>
  new StateMachineError({
    /* v8 ignore next -- internal snapshot traversal throws Error subclasses; non-Error values are defensive fallback only */
    message: error instanceof Error ? error.message : undefined,
    type: 'DraftContextCloneFailed',
  })

export const reconcileContext = (parentContext: unknown, nextContext: unknown): unknown =>
  reconcileValue(parentContext, nextContext, {
    currentToNext: new WeakMap(),
    nextToResult: new WeakMap(),
  })

/**
 * Creates a detached snapshot of a context value for draft execution.
 *
 * @remarks
 * The snapshot preserves observable structure from the source graph, including own-key order,
 * sparse-array holes, cycles, shared references, and object prototypes. Supported binary and
 * collection values are cloned into detached equivalents, including `Date`, `Map`, `Set`,
 * `ArrayBuffer`, `DataView`, and typed arrays. Primitive values are supported directly and are
 * returned unchanged.
 *
 * Values that cannot participate in draft snapshots, such as functions, cause the operation to
 * fail. Failures are normalized to `StateMachineError` with the `DraftContextCloneFailed` type.
 *
 * @param value - Context value to snapshot.
 * @returns A detached snapshot that can be mutated without affecting the source value, or the
 * original primitive value when the input is non-object-like.
 * @throws {@link StateMachineError} When the value contains unsupported members and the snapshot
 * cannot be created. The error cause type is `DraftContextCloneFailed`.
 */
export const snapshotContext = (value: unknown): unknown => {
  try {
    return snapshotValue(value, new WeakMap())
  } catch (error) {
    throw normalizeSnapshotError(error)
  }
}
