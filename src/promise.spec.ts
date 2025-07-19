/**
 * Promise State Machine Test Suite
 *
 * This test suite demonstrates the implementation of a promise state tracking system
 * with cancellation functionality using finite state machines. The implementation separates
 * the synchronous state machine logic from asynchronous promise handling, ensuring that
 * the state machine definition contains no async code.
 *
 * Key features demonstrated:
 * 1. **Promise State Tracking**: Models the standard promise states (pending, fulfilled, rejected)
 *    plus an additional cancelled state for better control flow
 * 2. **Cancellation Support**: Provides a mechanism to cancel pending promises with callback support
 * 3. **External Promise Handling**: The state machine only tracks state; promise resolution/rejection
 *    is handled externally through the createPromise utility
 * 4. **Type Safety**: Full TypeScript support with proper typing for all states and payloads
 * 5. **Context Management**: Stores promise results, errors, and cancellation state in context
 */

import { assert, describe, it, vi } from 'vitest'

import { Deferred } from '@escapace/sequentialize'
import { interpret, stateMachine } from './index'
import type { Cast, StateMachineService } from './types'

enum PromiseMachineState {
  Cancelled,
  Cancelling,
  Fulfilled,
  Idle,
  Pending,
  Rejected,
}

enum PromiseMachineAction {
  Cancel,
  CancelComplete,
  Reject,
  Resolve,
  Setup,
}

interface PromiseMachineContext {
  deferred: Deferred<PromiseState>
  onCancelCallback?: () => Promise<void> | void
}

interface PromiseFulfilled<T = unknown> {
  type: 'fulfilled'
  value: T
}

interface PromiseRejected {
  type: 'rejected'
  value: unknown
}

interface PromiseCancelled {
  type: 'cancelled'
}

type PromiseState<T = unknown> = PromiseCancelled | PromiseFulfilled<T> | PromiseRejected

/**
 * Creates a promise state machine definition
 */
const promiseMachine = stateMachine()
  .state(PromiseMachineState.Idle)
  .state(PromiseMachineState.Pending)
  .state(PromiseMachineState.Fulfilled)
  .state(PromiseMachineState.Rejected)
  .state(PromiseMachineState.Cancelling)
  .state(PromiseMachineState.Cancelled)
  .initial(PromiseMachineState.Idle)
  .action<PromiseMachineAction.Setup, PromiseMachineContext['onCancelCallback']>(
    PromiseMachineAction.Setup,
  )
  .action<PromiseMachineAction.Resolve, unknown>(PromiseMachineAction.Resolve)
  .action<PromiseMachineAction.Reject, unknown>(PromiseMachineAction.Reject)
  .action<PromiseMachineAction.Cancel>(PromiseMachineAction.Cancel)
  .action<PromiseMachineAction.CancelComplete>(PromiseMachineAction.CancelComplete)
  .context<PromiseMachineContext>(() => ({ deferred: new Deferred<PromiseState>() }))
  .transition(
    PromiseMachineState.Idle,
    PromiseMachineAction.Setup,
    PromiseMachineState.Pending,
    (context, action) => ({
      ...context,
      onCancelCallback: action.payload,
    }),
  )
  .transition(
    PromiseMachineState.Pending,
    [PromiseMachineAction.Resolve, (context) => !context.deferred.isResolved()],
    PromiseMachineState.Fulfilled,
    (context, action) => {
      context.deferred.resolve({ type: 'fulfilled', value: action.payload })

      return context
    },
  )
  .transition(
    PromiseMachineState.Pending,
    [PromiseMachineAction.Reject, (context) => !context.deferred.isResolved()],
    PromiseMachineState.Rejected,
    (context, action) => {
      context.deferred.resolve({ type: 'rejected', value: action.payload })

      return context
    },
  )
  .transition(
    PromiseMachineState.Pending,
    [PromiseMachineAction.Cancel, (context) => !context.deferred.isResolved()],
    PromiseMachineState.Cancelling,
    (context) => context,
  )
  .transition(
    PromiseMachineState.Cancelling,
    PromiseMachineAction.CancelComplete,
    PromiseMachineState.Cancelled,
    (context) => {
      context.deferred.resolve({
        type: 'cancelled',
      })

      return context
    },
  )

type PromiseMachine = StateMachineService<Cast<typeof promiseMachine>>

const PROMISE_STATE_MACHINE_SERVICE = Symbol.for('promise-machine')

export interface CancellablePromise<T> extends Promise<PromiseState<T>> {
  cancel: () => Promise<void>
  [PROMISE_STATE_MACHINE_SERVICE]: PromiseMachine
}

/**
 * Creates a promise wrapper with state machine tracking and cancellation support.
 * The state machine itself contains no async code - all promise handling is external.
 */
// eslint-disable-next-line typescript/promise-function-async
export function createCancellablePromise<T = unknown>(
  promiseFactory: (onCancel: (cancelCallback: () => Promise<void> | void) => void) => Promise<T>,
): CancellablePromise<T> {
  const service: PromiseMachine = interpret(promiseMachine)

  // Handle promise resolution/rejection externally
  void promiseFactory((cancelCallback) => {
    // Setup the state machine with the callback
    service.do(
      PromiseMachineAction.Setup,
      cancelCallback as PromiseMachineContext['onCancelCallback'],
    )
  })
    .then((value: unknown) => {
      service.do(PromiseMachineAction.Resolve, value)
    })
    .catch((error: unknown) => {
      service.do(PromiseMachineAction.Reject, error)
    })

  const { promise } = service.context.deferred

  const cancel = async () => {
    if (service.do(PromiseMachineAction.Cancel)) {
      // Execute the cancellation callback and wait for it to complete
      const cancelCallback = service.context.onCancelCallback

      if (cancelCallback !== undefined) {
        try {
          await Promise.resolve(cancelCallback())
        } catch {
          // Ignore cancellation callback errors
        }
      }

      // Signal that cancellation is complete
      service.do(PromiseMachineAction.CancelComplete)
    } else if (service.state === PromiseMachineState.Cancelling) {
      await promise
    }

    return
  }

  return new Proxy(promise, {
    get(object, property) {
      if (property === 'cancel') {
        return cancel
      }

      if (property === PROMISE_STATE_MACHINE_SERVICE) {
        return service
      }

      // if ('asyncDispose' in Symbol && property === Symbol.asyncDispose) {
      //   return dispose
      // }

      return object[property as keyof typeof object]
    },
  }) as CancellablePromise<T>
}

// eslint-disable-next-line typescript/no-empty-function
const noop = (..._value: unknown[]) => {}

describe('Promise State Machine', () => {
  it('tracks promise resolution', async () => {
    const promiseWrapper = createCancellablePromise(async (onCancel) => {
      onCancel(noop) // No-op callback for this test
      return await Promise.resolve('success')
    })

    assert.equal(promiseWrapper[PROMISE_STATE_MACHINE_SERVICE].state, PromiseMachineState.Pending)
    assert.ok(promiseWrapper[PROMISE_STATE_MACHINE_SERVICE].context.onCancelCallback === noop)

    // Wait for promise to resolve
    await new Promise<void>((resolve) => setTimeout(resolve, 0))

    assert.equal(promiseWrapper[PROMISE_STATE_MACHINE_SERVICE].state, PromiseMachineState.Fulfilled)
    const result = await promiseWrapper[PROMISE_STATE_MACHINE_SERVICE].context.deferred.promise
    assert.deepEqual(result, { type: 'fulfilled', value: 'success' })
  })

  it('tracks promise rejection', async () => {
    const error = new Error('test error')
    const promiseWrapper = createCancellablePromise(async (onCancel) => {
      onCancel(noop) // No-op callback for this test
      return await Promise.reject(error)
    })

    assert.equal(promiseWrapper[PROMISE_STATE_MACHINE_SERVICE].state, PromiseMachineState.Pending)

    // Wait for promise to reject
    await new Promise<void>((resolve) => setTimeout(resolve, 0))

    assert.equal(promiseWrapper[PROMISE_STATE_MACHINE_SERVICE].state, PromiseMachineState.Rejected)
    const result = await promiseWrapper[PROMISE_STATE_MACHINE_SERVICE].context.deferred.promise
    assert.deepEqual(result, { type: 'rejected', value: error })
  })

  it('handles promise cancellation', async () => {
    const onCancelSpy = vi.fn(noop)
    const promiseWrapper = createCancellablePromise(async (onCancel) => {
      onCancel(onCancelSpy)
      return await new Promise<void>((resolve) => setTimeout(resolve, 100))
    })

    assert.equal(promiseWrapper[PROMISE_STATE_MACHINE_SERVICE].state, PromiseMachineState.Pending)

    // Cancel the promise
    const cancelPromise = promiseWrapper.cancel()

    // Should immediately be in Cancelling state
    assert.equal(
      promiseWrapper[PROMISE_STATE_MACHINE_SERVICE].state,
      PromiseMachineState.Cancelling,
    )

    // Wait for cancellation to complete
    await cancelPromise

    // Should now be in Cancelled state
    assert.equal(promiseWrapper[PROMISE_STATE_MACHINE_SERVICE].state, PromiseMachineState.Cancelled)
    assert.equal(onCancelSpy.mock.calls.length, 1)

    // Check that the onCancel callback was called
    assert.equal(onCancelSpy.mock.calls[0][0], undefined)

    // Check that the cancellation is stored in the deferred promise result
    const result = await promiseWrapper[PROMISE_STATE_MACHINE_SERVICE].context.deferred.promise
    assert.deepEqual(result.type, 'cancelled')
  })

  it('prevents cancellation of resolved promises', async () => {
    const onCancelSpy = vi.fn(noop)
    const promiseWrapper = createCancellablePromise(async (onCancel) => {
      onCancel(onCancelSpy)
      return await Promise.resolve('done')
    })

    // Wait for promise to resolve
    await new Promise<void>((resolve) => setTimeout(resolve, 0))

    assert.equal(promiseWrapper[PROMISE_STATE_MACHINE_SERVICE].state, PromiseMachineState.Fulfilled)

    // Attempt to cancel resolved promise - should return immediately
    const startTime = Date.now()
    await promiseWrapper.cancel()
    const endTime = Date.now()

    // Should return very quickly since no state transition occurs
    assert.ok(endTime - startTime < 50, 'cancel() on Fulfilled should return immediately')
    assert.equal(promiseWrapper[PROMISE_STATE_MACHINE_SERVICE].state, PromiseMachineState.Fulfilled)
    assert.equal(onCancelSpy.mock.calls.length, 0)
  })

  it('prevents cancellation of rejected promises', async () => {
    const onCancelSpy = vi.fn(noop)
    const promiseWrapper = createCancellablePromise(async (onCancel) => {
      onCancel(onCancelSpy)
      return await Promise.reject(new Error('failed'))
    })

    // Wait for promise to reject
    await new Promise<void>((resolve) => setTimeout(resolve, 0))

    assert.equal(promiseWrapper[PROMISE_STATE_MACHINE_SERVICE].state, PromiseMachineState.Rejected)

    // Attempt to cancel rejected promise - should return immediately
    const startTime = Date.now()
    await promiseWrapper.cancel()
    const endTime = Date.now()

    // Should return very quickly since no state transition occurs
    assert.ok(endTime - startTime < 50, 'cancel() on Rejected should return immediately')
    assert.equal(promiseWrapper[PROMISE_STATE_MACHINE_SERVICE].state, PromiseMachineState.Rejected)
    assert.equal(onCancelSpy.mock.calls.length, 0)
  })

  it('prevents double cancellation', async () => {
    const onCancelSpy = vi.fn(noop)
    const promiseWrapper = createCancellablePromise(async (onCancel) => {
      onCancel(onCancelSpy)
      return await new Promise<void>((resolve) => setTimeout(resolve, 100))
    })

    // First cancellation - should execute cancellation logic
    const firstCancel = promiseWrapper.cancel()
    assert.equal(
      promiseWrapper[PROMISE_STATE_MACHINE_SERVICE].state,
      PromiseMachineState.Cancelling,
    )

    // Second cancellation attempt while cancelling - should return immediately as no-op
    const secondCancel = promiseWrapper.cancel()
    assert.equal(
      promiseWrapper[PROMISE_STATE_MACHINE_SERVICE].state,
      PromiseMachineState.Cancelling,
    )

    // Both cancel() calls should return valid promises that resolve
    assert.ok(firstCancel instanceof Promise, 'First cancel should return a Promise')
    assert.ok(secondCancel instanceof Promise, 'Second cancel should return a Promise')

    // Wait for both promises to resolve
    await firstCancel
    await secondCancel

    // Final state should be Cancelled
    assert.equal(promiseWrapper[PROMISE_STATE_MACHINE_SERVICE].state, PromiseMachineState.Cancelled)

    // Cancellation callback should only be called once (by first cancel call)
    assert.equal(onCancelSpy.mock.calls.length, 1)
  })

  it('handles cancellation', async () => {
    const onCancelSpy = vi.fn(noop)
    const promiseWrapper = createCancellablePromise(async (onCancel) => {
      onCancel(onCancelSpy)
      return await new Promise<void>((resolve) => setTimeout(resolve, 100))
    })

    const cancelPromise = promiseWrapper.cancel()

    assert.equal(
      promiseWrapper[PROMISE_STATE_MACHINE_SERVICE].state,
      PromiseMachineState.Cancelling,
    )

    await cancelPromise

    assert.equal(promiseWrapper[PROMISE_STATE_MACHINE_SERVICE].state, PromiseMachineState.Cancelled)
    assert.equal(onCancelSpy.mock.calls.length, 1)
  })

  it('works without onCancel callback', async () => {
    const promiseWrapper = createCancellablePromise(async (onCancel) => {
      onCancel(noop) // No-op callback for this test
      return await new Promise<void>((resolve) => setTimeout(resolve, 100))
    })

    // Should not throw when cancelled without callback
    const cancelPromise = promiseWrapper.cancel()

    assert.equal(
      promiseWrapper[PROMISE_STATE_MACHINE_SERVICE].state,
      PromiseMachineState.Cancelling,
    )

    await cancelPromise

    assert.equal(promiseWrapper[PROMISE_STATE_MACHINE_SERVICE].state, PromiseMachineState.Cancelled)
  })

  it('tracks state transitions through subscriptions', async () => {
    const stateChanges: string[] = []
    const promiseWrapper = createCancellablePromise(async (onCancel) => {
      onCancel(noop) // No-op callback for this test
      return await Promise.resolve('result')
    })

    const unsubscribe = promiseWrapper[PROMISE_STATE_MACHINE_SERVICE].subscribe((change) => {
      stateChanges.push(`${change.action.source} → ${change.state}`)
    })

    // Wait for promise to resolve
    await new Promise<void>((resolve) => setTimeout(resolve, 0))

    assert.deepEqual(stateChanges, [
      `${PromiseMachineState.Pending} → ${PromiseMachineState.Fulfilled}`,
    ])

    unsubscribe()
  })

  it('integrates with AbortController for fetch-like request cancellation', async () => {
    const onCancelSpy = vi.fn(noop)
    const abortHandlerSpy = vi.fn()

    /**
     * Mock fetch function that simulates network requests with AbortSignal support
     */
    async function mockFetch(url: string, options: { signal?: AbortSignal } = {}): Promise<string> {
      return await new Promise((resolve, reject) => {
        const { signal } = options

        // Simulate network delay
        const timeoutId = setTimeout(() => {
          resolve(`Response from ${url}`)
        }, 100)

        // Handle abort signal
        const abortHandler = () => {
          abortHandlerSpy() // Spy to test that this is called
          clearTimeout(timeoutId)
          reject(new Error('AbortError: The operation was aborted'))
        }

        signal?.addEventListener('abort', abortHandler, { once: true })
      })
    }

    const promiseWrapper = createCancellablePromise(async (onCancel) => {
      const controller = new AbortController()
      // Register our cancel callback that triggers the abort controller
      onCancel(() => {
        onCancelSpy()
        if (!controller.signal.aborted) {
          controller.abort()
        }
      })

      return await mockFetch('https://api.example.com/users', {
        signal: controller.signal,
      })
    })

    assert.equal(promiseWrapper[PROMISE_STATE_MACHINE_SERVICE].state, PromiseMachineState.Pending)

    // Simulate user cancelling the request (e.g., clicking cancel button)
    const cancelPromise1 = promiseWrapper.cancel() // First call - executes cancellation
    const cancelPromise2 = promiseWrapper.cancel() // Second call - returns immediately
    const cancelPromise3 = promiseWrapper.cancel() // Third call - returns immediately

    // Should immediately be in Cancelling state after first call
    assert.equal(
      promiseWrapper[PROMISE_STATE_MACHINE_SERVICE].state,
      PromiseMachineState.Cancelling,
    )

    // All cancel() calls should return valid promises
    assert.ok(cancelPromise1 instanceof Promise, 'First cancel should return a Promise')
    assert.ok(cancelPromise2 instanceof Promise, 'Second cancel should return a Promise')
    assert.ok(cancelPromise3 instanceof Promise, 'Third cancel should return a Promise')

    // Wait for all cancellation promises to complete
    await Promise.all([cancelPromise1, cancelPromise2, cancelPromise3])

    assert.equal(promiseWrapper[PROMISE_STATE_MACHINE_SERVICE].state, PromiseMachineState.Cancelled)
    // Only first cancel() call should execute the callback
    assert.equal(onCancelSpy.mock.calls.length, 1)
    assert.equal(abortHandlerSpy.mock.calls.length, 1)

    // Even if the request would have completed, state should remain cancelled
    await new Promise<void>((resolve) => setTimeout(resolve, 150))

    assert.equal(promiseWrapper[PROMISE_STATE_MACHINE_SERVICE].state, PromiseMachineState.Cancelled)
    const result = await promiseWrapper[PROMISE_STATE_MACHINE_SERVICE].context.deferred.promise
    assert.deepEqual(result.type, 'cancelled')
  })

  it('handles async cancellation callbacks', async () => {
    let resolveCancellation: (() => void) | undefined
    const cancellationPromise = new Promise<void>((resolve) => {
      resolveCancellation = resolve
    })

    const promiseWrapper = createCancellablePromise(async (onCancel) => {
      onCancel(async () => {
        await cancellationPromise
      })
      return await new Promise<void>((resolve) => setTimeout(resolve, 1000))
    })

    assert.equal(promiseWrapper[PROMISE_STATE_MACHINE_SERVICE].state, PromiseMachineState.Pending)

    // Start cancellation
    const cancelPromise = promiseWrapper.cancel()

    // Should immediately be in Cancelling state
    assert.equal(
      promiseWrapper[PROMISE_STATE_MACHINE_SERVICE].state,
      PromiseMachineState.Cancelling,
    )

    // Resolve the cancellation callback
    // eslint-disable-next-line typescript/no-non-null-assertion
    resolveCancellation!()

    // Wait for cancellation to complete
    await cancelPromise

    // Should now be in Cancelled state
    assert.equal(promiseWrapper[PROMISE_STATE_MACHINE_SERVICE].state, PromiseMachineState.Cancelled)
  })

  it('handles sync cancellation callbacks', async () => {
    const onCancelSpy = vi.fn()

    const promiseWrapper = createCancellablePromise(async (onCancel) => {
      onCancel(() => {
        onCancelSpy()
      })
      return await new Promise<void>((resolve) => setTimeout(resolve, 1000))
    })

    assert.equal(promiseWrapper[PROMISE_STATE_MACHINE_SERVICE].state, PromiseMachineState.Pending)

    // Start cancellation
    const cancelPromise = promiseWrapper.cancel()

    // Should immediately be in Cancelling state
    assert.equal(
      promiseWrapper[PROMISE_STATE_MACHINE_SERVICE].state,
      PromiseMachineState.Cancelling,
    )

    // Wait for cancellation to complete
    await cancelPromise

    // Should now be in Cancelled state
    assert.equal(promiseWrapper[PROMISE_STATE_MACHINE_SERVICE].state, PromiseMachineState.Cancelled)
    assert.equal(onCancelSpy.mock.calls.length, 1)
  })

  it('handles cancellation callback errors gracefully', async () => {
    const promiseWrapper = createCancellablePromise(async (onCancel) => {
      onCancel(() => {
        throw new Error('Cancellation error')
      })
      return await new Promise<void>((resolve) => setTimeout(resolve, 1000))
    })

    assert.equal(promiseWrapper[PROMISE_STATE_MACHINE_SERVICE].state, PromiseMachineState.Pending)

    // Start cancellation
    const cancelPromise = promiseWrapper.cancel()

    // Should immediately be in Cancelled state
    assert.equal(promiseWrapper[PROMISE_STATE_MACHINE_SERVICE].state, PromiseMachineState.Cancelled)

    // Wait for cancellation to complete (should not throw even though callback errored)
    await cancelPromise

    // Should still transition to Cancelled state despite error
    assert.equal(promiseWrapper[PROMISE_STATE_MACHINE_SERVICE].state, PromiseMachineState.Cancelled)
  })

  it('cancel() on Cancelling state returns immediately', async () => {
    let resolveCancellation: (() => void) | undefined
    const cancellationPromise = new Promise<void>((resolve) => {
      resolveCancellation = resolve
    })

    const onCancelSpy = vi.fn(async () => {
      // Wait for external control to resolve
      await cancellationPromise
    })

    const promiseWrapper = createCancellablePromise(async (onCancel) => {
      onCancel(onCancelSpy)
      return await new Promise<void>((resolve) => setTimeout(resolve, 1000))
    })

    // Start cancellation - this will transition to Cancelling and wait for cancellationPromise
    const firstCancel = promiseWrapper.cancel()

    // Verify we're in Cancelling state
    assert.equal(
      promiseWrapper[PROMISE_STATE_MACHINE_SERVICE].state,
      PromiseMachineState.Cancelling,
    )

    // Call cancel() again while in Cancelling state - should return immediately
    const secondCancel = promiseWrapper.cancel()

    // Should still be in Cancelling state
    assert.equal(
      promiseWrapper[PROMISE_STATE_MACHINE_SERVICE].state,
      PromiseMachineState.Cancelling,
    )

    // Second cancel should return a valid promise
    assert.ok(secondCancel instanceof Promise, 'Second cancel should return a Promise')

    // Resolve the cancellation callback to complete first cancellation
    // eslint-disable-next-line typescript/no-non-null-assertion
    resolveCancellation!()

    // Wait for both cancel promises to resolve
    await firstCancel
    await secondCancel

    // Should now be in Cancelled state
    assert.equal(promiseWrapper[PROMISE_STATE_MACHINE_SERVICE].state, PromiseMachineState.Cancelled)

    // Cancellation callback should only be called once
    assert.equal(onCancelSpy.mock.calls.length, 1)
  })

  it('cancel() on Cancelled state returns immediately', async () => {
    const onCancelSpy = vi.fn(noop)

    const promiseWrapper = createCancellablePromise(async (onCancel) => {
      onCancel(onCancelSpy)
      return await new Promise<void>((resolve) => setTimeout(resolve, 50))
    })

    // First cancellation - should complete normally
    const firstCancel = promiseWrapper.cancel()

    // Wait for cancellation to complete
    await firstCancel

    // Verify we're in Cancelled state
    assert.equal(promiseWrapper[PROMISE_STATE_MACHINE_SERVICE].state, PromiseMachineState.Cancelled)

    // Call cancel() again when already Cancelled - should return immediately
    const secondCancel = promiseWrapper.cancel()

    // Should still be in Cancelled state
    assert.equal(promiseWrapper[PROMISE_STATE_MACHINE_SERVICE].state, PromiseMachineState.Cancelled)

    // Second cancel should return a valid promise that resolves immediately
    assert.ok(secondCancel instanceof Promise, 'Second cancel should return a Promise')

    // Should resolve immediately since no work needs to be done
    await secondCancel

    // Should remain in Cancelled state
    assert.equal(promiseWrapper[PROMISE_STATE_MACHINE_SERVICE].state, PromiseMachineState.Cancelled)

    // Cancellation callback should still only be called once (from first cancellation)
    assert.equal(onCancelSpy.mock.calls.length, 1)
  })

  it('cancel() returns valid promises across all states', async () => {
    // Test cancel() on Pending state (should execute cancellation)
    const pendingWrapper = createCancellablePromise(async (onCancel) => {
      onCancel(noop)
      return await new Promise<void>((resolve) => setTimeout(resolve, 50))
    })

    assert.equal(pendingWrapper[PROMISE_STATE_MACHINE_SERVICE].state, PromiseMachineState.Pending)
    const pendingCancel = pendingWrapper.cancel()
    assert.ok(pendingCancel instanceof Promise, 'cancel() on Pending should return Promise')
    await pendingCancel

    // Test cancel() on Fulfilled state (should return immediately)
    const fulfilledWrapper = createCancellablePromise(async (onCancel) => {
      onCancel(noop)
      return await Promise.resolve('success')
    })

    await new Promise<void>((resolve) => setTimeout(resolve, 0)) // Let it resolve
    assert.equal(
      fulfilledWrapper[PROMISE_STATE_MACHINE_SERVICE].state,
      PromiseMachineState.Fulfilled,
    )
    const fulfilledCancel = fulfilledWrapper.cancel()
    assert.ok(fulfilledCancel instanceof Promise, 'cancel() on Fulfilled should return Promise')
    await fulfilledCancel

    // Test cancel() on Rejected state (should return immediately)
    const rejectedWrapper = createCancellablePromise(async (onCancel) => {
      onCancel(noop)
      return await Promise.reject(new Error('test error'))
    })

    await new Promise<void>((resolve) => setTimeout(resolve, 0)) // Let it reject
    assert.equal(rejectedWrapper[PROMISE_STATE_MACHINE_SERVICE].state, PromiseMachineState.Rejected)
    const rejectedCancel = rejectedWrapper.cancel()
    assert.ok(rejectedCancel instanceof Promise, 'cancel() on Rejected should return Promise')
    await rejectedCancel

    // Test cancel() on Cancelled state (should return immediately)
    const cancelledWrapper = createCancellablePromise(async (onCancel) => {
      onCancel(noop)
      return await new Promise<void>((resolve) => setTimeout(resolve, 50))
    })

    await cancelledWrapper.cancel() // First cancellation
    assert.equal(
      cancelledWrapper[PROMISE_STATE_MACHINE_SERVICE].state,
      PromiseMachineState.Cancelled,
    )
    const cancelledCancel = cancelledWrapper.cancel()
    assert.ok(cancelledCancel instanceof Promise, 'cancel() on Cancelled should return Promise')
    await cancelledCancel
  })

  it('cancel() promise resolution timing', async () => {
    // Test that cancel() on Pending state resolves after cancellation completes
    let cancellationCallbackResolved = false
    const cancellationDelay = 100

    const pendingWrapper = createCancellablePromise(async (onCancel) => {
      onCancel(async () => {
        await new Promise<void>((resolve) => setTimeout(resolve, cancellationDelay))
        cancellationCallbackResolved = true
      })
      return await new Promise<void>((resolve) => setTimeout(resolve, 1000))
    })

    const startTime = Date.now()
    const cancelPromise = pendingWrapper.cancel()

    // Should be in Cancelling state immediately
    assert.equal(
      pendingWrapper[PROMISE_STATE_MACHINE_SERVICE].state,
      PromiseMachineState.Cancelling,
    )
    assert.equal(
      cancellationCallbackResolved,
      false,
      'Cancellation callback should not have resolved yet',
    )

    // Wait for cancel promise to resolve
    await cancelPromise
    const endTime = Date.now()

    // Should have taken at least most of the cancellation callback time (allowing for timing variance)
    assert.ok(
      endTime - startTime >= cancellationDelay * 0.8,
      'cancel() should wait for cancellation callback',
    )
    assert.equal(cancellationCallbackResolved, true, 'Cancellation callback should have resolved')
    assert.equal(pendingWrapper[PROMISE_STATE_MACHINE_SERVICE].state, PromiseMachineState.Cancelled)

    // Test that cancel() on Fulfilled state resolves immediately (new behavior)
    const fulfilledWrapper = createCancellablePromise(async (onCancel) => {
      onCancel(noop)
      return await Promise.resolve('success')
    })

    await new Promise<void>((resolve) => setTimeout(resolve, 0)) // Let it resolve
    assert.equal(
      fulfilledWrapper[PROMISE_STATE_MACHINE_SERVICE].state,
      PromiseMachineState.Fulfilled,
    )

    const fulfilledStartTime = Date.now()
    await fulfilledWrapper.cancel()
    const fulfilledEndTime = Date.now()

    // Should resolve immediately since no state transition occurs
    assert.ok(
      fulfilledEndTime - fulfilledStartTime < 50,
      'cancel() on Fulfilled should resolve immediately',
    )

    // Test that cancel() on Rejected state resolves immediately (new behavior)
    const rejectedWrapper = createCancellablePromise(async (onCancel) => {
      onCancel(noop)
      return await Promise.reject(new Error('test'))
    })

    await new Promise<void>((resolve) => setTimeout(resolve, 0)) // Let it reject
    assert.equal(rejectedWrapper[PROMISE_STATE_MACHINE_SERVICE].state, PromiseMachineState.Rejected)

    const rejectedStartTime = Date.now()
    await rejectedWrapper.cancel()
    const rejectedEndTime = Date.now()

    // Should resolve immediately since no state transition occurs
    assert.ok(
      rejectedEndTime - rejectedStartTime < 50,
      'cancel() on Rejected should resolve immediately',
    )

    // Test that cancel() on Cancelled state resolves immediately (new behavior)
    const cancelledWrapper = createCancellablePromise(async (onCancel) => {
      onCancel(noop)
      return await new Promise<void>((resolve) => setTimeout(resolve, 50))
    })

    await cancelledWrapper.cancel() // First cancellation
    assert.equal(
      cancelledWrapper[PROMISE_STATE_MACHINE_SERVICE].state,
      PromiseMachineState.Cancelled,
    )

    const cancelledStartTime = Date.now()
    await cancelledWrapper.cancel()
    const cancelledEndTime = Date.now()

    // Should resolve immediately since no state transition occurs
    assert.ok(
      cancelledEndTime - cancelledStartTime < 50,
      'cancel() on Cancelled should resolve immediately',
    )
  })

  it('rapid multiple cancel() calls (race conditions)', async () => {
    const onCancelSpy = vi.fn(async () => {
      // Simulate some async work in cancellation callback
      await new Promise<void>((resolve) => setTimeout(resolve, 50))
    })

    const promiseWrapper = createCancellablePromise(async (onCancel) => {
      onCancel(onCancelSpy)
      return await new Promise<void>((resolve) => setTimeout(resolve, 1000))
    })

    // Rapidly call cancel() multiple times
    const cancelPromises = []
    for (let index = 0; index < 10; index++) {
      cancelPromises.push(promiseWrapper.cancel())
    }

    // All calls should return valid promises
    for (let index = 0; index < cancelPromises.length; index++) {
      assert.ok(
        cancelPromises[index] instanceof Promise,
        `cancel() call ${index} should return Promise`,
      )
    }

    // Should be in Cancelling state after first call
    assert.equal(
      promiseWrapper[PROMISE_STATE_MACHINE_SERVICE].state,
      PromiseMachineState.Cancelling,
    )

    // Wait for all cancel promises to resolve
    await Promise.all(cancelPromises)

    // Should end up in Cancelled state
    assert.equal(promiseWrapper[PROMISE_STATE_MACHINE_SERVICE].state, PromiseMachineState.Cancelled)

    // Cancellation callback should only be called once despite 10 cancel() calls
    assert.equal(onCancelSpy.mock.calls.length, 1)
  })

  it('cancel() interface contract verification', async () => {
    const promiseWrapper = createCancellablePromise(async (onCancel) => {
      onCancel(noop)
      return await new Promise<void>((resolve) => setTimeout(resolve, 50))
    })

    // Verify cancel is a function
    assert.equal(typeof promiseWrapper.cancel, 'function', 'cancel should be a function')

    // Verify cancel() always returns a Promise<void>
    const cancelResult = promiseWrapper.cancel()
    assert.ok(cancelResult instanceof Promise, 'cancel() should return a Promise')

    // Verify the promise resolves to undefined (Promise<void>)
    const resolvedValue = await cancelResult
    assert.equal(resolvedValue, undefined, 'cancel() promise should resolve to undefined')

    // Verify cancel() never throws synchronously across all states
    const testStates = [
      // Fulfilled state
      createCancellablePromise(async (onCancel) => {
        onCancel(noop)
        return await Promise.resolve('test')
      }),
      // Rejected state
      createCancellablePromise(async (onCancel) => {
        onCancel(noop)
        return await Promise.reject(new Error('test'))
      }),
      // State with synchronous throw in cancel callback
      createCancellablePromise(async (onCancel) => {
        onCancel(() => {
          throw new Error('sync throw test')
        })
        return await Promise.resolve('test')
      }),
    ]

    // Wait for promises to reach their final states
    await new Promise<void>((resolve) => setTimeout(resolve, 0))

    for (const wrapper of testStates) {
      assert.doesNotThrow(() => {
        // eslint-disable-next-line typescript/no-floating-promises
        wrapper.cancel()
      }, 'cancel() should never throw synchronously')
    }
  })

  it('cancel() behavior correlates with service.do() return values', async () => {
    const callbackSpy = vi.fn(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 25))
    })

    // Test case 1: Pending state - service.do() returns true, cancel() executes callback
    const pendingWrapper = createCancellablePromise(async (onCancel) => {
      onCancel(callbackSpy)
      return await new Promise<void>((resolve) => setTimeout(resolve, 1000))
    })

    assert.equal(pendingWrapper[PROMISE_STATE_MACHINE_SERVICE].state, PromiseMachineState.Pending)

    // Capture initial callback count
    const initialCallCount = callbackSpy.mock.calls.length

    // Call cancel() and verify it correlates with service.do() success
    await pendingWrapper.cancel()

    // Verify callback was executed (because service.do() returned true)
    assert.equal(
      callbackSpy.mock.calls.length,
      initialCallCount + 1,
      'Callback should execute when service.do() returns true',
    )
    assert.equal(pendingWrapper[PROMISE_STATE_MACHINE_SERVICE].state, PromiseMachineState.Cancelled)

    // Test case 2: Fulfilled state - service.do() returns false, cancel() doesn't execute callback
    const fulfilledWrapper = createCancellablePromise(async (onCancel) => {
      onCancel(callbackSpy)
      return await Promise.resolve('success')
    })

    await new Promise<void>((resolve) => setTimeout(resolve, 0)) // Let it resolve
    assert.equal(
      fulfilledWrapper[PROMISE_STATE_MACHINE_SERVICE].state,
      PromiseMachineState.Fulfilled,
    )

    const fulfilledCallCount = callbackSpy.mock.calls.length

    // Verify service.do() returns false for Fulfilled state
    const fulfilledResult = fulfilledWrapper[PROMISE_STATE_MACHINE_SERVICE].do(
      PromiseMachineAction.Cancel,
    )
    assert.equal(fulfilledResult, false, 'service.do() should return false from Fulfilled state')

    // cancel() should return immediately without executing callback
    const startTime = Date.now()
    await fulfilledWrapper.cancel()
    const endTime = Date.now()

    assert.ok(
      endTime - startTime < 25,
      'cancel() should return immediately when service.do() returns false',
    )
    assert.equal(
      callbackSpy.mock.calls.length,
      fulfilledCallCount,
      'Callback should not execute when service.do() returns false',
    )

    // Test case 3: Multiple cancel() calls - only first should trigger callback
    const multiWrapper = createCancellablePromise(async (onCancel) => {
      onCancel(callbackSpy)
      return await new Promise<void>((resolve) => setTimeout(resolve, 1000))
    })

    const multiCallCount = callbackSpy.mock.calls.length

    // First call should trigger callback
    const firstCancel = multiWrapper.cancel()
    assert.equal(multiWrapper[PROMISE_STATE_MACHINE_SERVICE].state, PromiseMachineState.Cancelling)

    // Second call should not trigger callback (service.do() returns false from Cancelling state)
    const secondCancel = multiWrapper.cancel()

    await Promise.all([firstCancel, secondCancel])

    // Only one additional callback execution
    assert.equal(
      callbackSpy.mock.calls.length,
      multiCallCount + 1,
      'Only first cancel() should execute callback',
    )
  })

  it('edge cases for boolean-based cancel behavior', async () => {
    // Edge case 1: Extremely rapid cancel() calls (race condition)
    const rapidCallbackSpy = vi.fn()
    const rapidWrapper = createCancellablePromise(async (onCancel) => {
      onCancel(rapidCallbackSpy)
      return await new Promise<void>((resolve) => setTimeout(resolve, 100))
    })

    // Fire 5 cancel() calls in tight succession
    const rapidPromises = []
    for (let index = 0; index < 5; index++) {
      rapidPromises.push(rapidWrapper.cancel())
    }

    // All should return valid promises
    for (const promise of rapidPromises) {
      assert.ok(promise instanceof Promise, 'All rapid cancel() calls should return Promises')
    }

    // Wait for all to complete
    await Promise.all(rapidPromises)

    // Only one callback execution despite 5 calls
    assert.equal(
      rapidCallbackSpy.mock.calls.length,
      1,
      'Rapid cancel() calls should only execute callback once',
    )
    assert.equal(rapidWrapper[PROMISE_STATE_MACHINE_SERVICE].state, PromiseMachineState.Cancelled)

    // Edge case 2: cancel() during state transitions
    const transitionWrapper = createCancellablePromise(async (onCancel) => {
      onCancel(noop)
      return await new Promise<void>((resolve) => setTimeout(resolve, 50))
    })

    // Trigger initial promise resolution concurrently with cancellation
    const cancelBeforeResolve = transitionWrapper.cancel()

    // Should be in Cancelling state
    assert.equal(
      transitionWrapper[PROMISE_STATE_MACHINE_SERVICE].state,
      PromiseMachineState.Cancelling,
    )

    // Try to cancel again while resolving
    const cancelWhileCancelling = transitionWrapper.cancel()

    await Promise.all([cancelBeforeResolve, cancelWhileCancelling])
    assert.equal(
      transitionWrapper[PROMISE_STATE_MACHINE_SERVICE].state,
      PromiseMachineState.Cancelled,
    )

    // Edge case 3: Verify service.do() boolean consistency across rapid calls
    const booleanWrapper = createCancellablePromise(async (onCancel) => {
      onCancel(noop)
      return await new Promise<void>((resolve) => setTimeout(resolve, 100))
    })

    // First direct service.do() call should return true
    const firstDo = booleanWrapper[PROMISE_STATE_MACHINE_SERVICE].do(PromiseMachineAction.Cancel)
    assert.equal(firstDo, true, 'First service.do(Cancel) should return true')
    assert.equal(
      booleanWrapper[PROMISE_STATE_MACHINE_SERVICE].state,
      PromiseMachineState.Cancelling,
    )

    // Subsequent service.do() calls should return false
    const secondDo = booleanWrapper[PROMISE_STATE_MACHINE_SERVICE].do(PromiseMachineAction.Cancel)
    const thirdDo = booleanWrapper[PROMISE_STATE_MACHINE_SERVICE].do(PromiseMachineAction.Cancel)
    assert.equal(secondDo, false, 'Second service.do(Cancel) should return false')
    assert.equal(thirdDo, false, 'Third service.do(Cancel) should return false')

    // Complete cancellation
    booleanWrapper[PROMISE_STATE_MACHINE_SERVICE].do(PromiseMachineAction.CancelComplete)

    // After cancellation, service.do() should still return false
    const afterCancellation = booleanWrapper[PROMISE_STATE_MACHINE_SERVICE].do(
      PromiseMachineAction.Cancel,
    )
    assert.equal(
      afterCancellation,
      false,
      'service.do(Cancel) after cancellation should return false',
    )
    assert.equal(booleanWrapper[PROMISE_STATE_MACHINE_SERVICE].state, PromiseMachineState.Cancelled)
  })
})
