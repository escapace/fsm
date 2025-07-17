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
 * 5. **Context Management**: Stores promise results, errors, and cancellation reasons in context
 */

import { assert, describe, it, vi } from 'vitest'
import { interpret, stateMachine } from './index'

enum PromiseState {
  Cancelled = 'CANCELLED',
  Fulfilled = 'FULFILLED',
  Idle = 'IDLE',
  Pending = 'PENDING',
  Rejected = 'REJECTED',
}

enum PromiseAction {
  Cancel = 'CANCEL',
  Reject = 'REJECT',
  Resolve = 'RESOLVE',
  Setup = 'SETUP',
}

interface PromiseContext {
  cancelled: boolean
  error?: unknown
  onCancelCallback?: () => void
  value?: unknown
}

/**
 * Creates a promise state machine definition
 */
const promiseMachine = stateMachine()
  .state(PromiseState.Idle)
  .state(PromiseState.Pending)
  .state(PromiseState.Fulfilled)
  .state(PromiseState.Rejected)
  .state(PromiseState.Cancelled)
  .initial(PromiseState.Idle)
  .action<PromiseAction.Setup, (() => void) | undefined>(PromiseAction.Setup)
  .action<PromiseAction.Resolve, unknown>(PromiseAction.Resolve)
  .action<PromiseAction.Reject, unknown>(PromiseAction.Reject)
  .action(PromiseAction.Cancel)
  .context<PromiseContext>(() => ({ cancelled: false }))
  .transition(PromiseState.Idle, PromiseAction.Setup, PromiseState.Pending, (context, action) => ({
    ...context,
    onCancelCallback: action.payload,
  }))
  .transition(
    PromiseState.Pending,
    [PromiseAction.Resolve, (context) => !context.cancelled],
    PromiseState.Fulfilled,
    (context, action) => ({
      ...context,
      value: action.payload,
    }),
  )
  .transition(
    PromiseState.Pending,
    [PromiseAction.Reject, (context) => !context.cancelled],
    PromiseState.Rejected,
    (context, action) => ({
      ...context,
      error: action.payload,
    }),
  )
  .transition(PromiseState.Pending, PromiseAction.Cancel, PromiseState.Cancelled, (context) => {
    // Run onCancel callback from context
    context.onCancelCallback?.()
    return {
      ...context,
      cancelled: true,
    }
  })

/**
 * Creates a promise wrapper with state machine tracking and cancellation support.
 * The state machine itself contains no async code - all promise handling is external.
 */
function createPromise<T = unknown>(
  promiseFactory: (onCancel: (cancelCallback: () => void) => void) => Promise<T>,
) {
  const service = interpret(promiseMachine)

  // Handle promise resolution/rejection externally
  const promise = promiseFactory((cancelCallback) => {
    // Setup the state machine with the callback
    service.do(PromiseAction.Setup, cancelCallback)
  })

  promise
    .then((value: unknown) => {
      service.do(PromiseAction.Resolve, value)
    })
    .catch((error: unknown) => {
      service.do(PromiseAction.Reject, error)
    })

  return {
    cancel: () => {
      service.do(PromiseAction.Cancel)
    },
    service,
  }
}

// eslint-disable-next-line typescript/no-empty-function
const noop = () => {}

describe('Promise State Machine', () => {
  it('tracks promise resolution', async () => {
    const promiseWrapper = createPromise(async (onCancel) => {
      onCancel(noop) // No-op callback for this test
      return await Promise.resolve('success')
    })

    assert.equal(promiseWrapper.service.state, PromiseState.Pending)
    assert.deepEqual(promiseWrapper.service.context, { cancelled: false, onCancelCallback: noop })

    // Wait for promise to resolve
    await new Promise<void>((resolve) => setTimeout(resolve, 0))

    assert.equal(promiseWrapper.service.state, PromiseState.Fulfilled)
    assert.equal(promiseWrapper.service.context.value, 'success')
  })

  it('tracks promise rejection', async () => {
    const error = new Error('test error')
    const promiseWrapper = createPromise(async (onCancel) => {
      onCancel(noop) // No-op callback for this test
      return await Promise.reject(error)
    })

    assert.equal(promiseWrapper.service.state, PromiseState.Pending)

    // Wait for promise to reject
    await new Promise<void>((resolve) => setTimeout(resolve, 0))

    assert.equal(promiseWrapper.service.state, PromiseState.Rejected)
    assert.equal(promiseWrapper.service.context.error, error)
  })

  it('handles promise cancellation', () => {
    const onCancelSpy = vi.fn(noop)
    const promiseWrapper = createPromise(async (onCancel) => {
      onCancel(onCancelSpy)
      return await new Promise<void>((resolve) => setTimeout(resolve, 100))
    })

    assert.equal(promiseWrapper.service.state, PromiseState.Pending)

    // Cancel the promise
    promiseWrapper.cancel()

    assert.equal(promiseWrapper.service.state, PromiseState.Cancelled)
    assert.equal(onCancelSpy.mock.calls.length, 1)
  })

  it('prevents cancellation of resolved promises', async () => {
    const onCancelSpy = vi.fn(noop)
    const promiseWrapper = createPromise(async (onCancel) => {
      onCancel(onCancelSpy)
      return await Promise.resolve('done')
    })

    // Wait for promise to resolve
    await new Promise<void>((resolve) => setTimeout(resolve, 0))

    assert.equal(promiseWrapper.service.state, PromiseState.Fulfilled)

    // Attempt to cancel resolved promise
    promiseWrapper.cancel()

    assert.equal(promiseWrapper.service.state, PromiseState.Fulfilled)
    assert.equal(onCancelSpy.mock.calls.length, 0)
  })

  it('prevents cancellation of rejected promises', async () => {
    const onCancelSpy = vi.fn(noop)
    const promiseWrapper = createPromise(async (onCancel) => {
      onCancel(onCancelSpy)
      return await Promise.reject(new Error('failed'))
    })

    // Wait for promise to reject
    await new Promise<void>((resolve) => setTimeout(resolve, 0))

    assert.equal(promiseWrapper.service.state, PromiseState.Rejected)

    // Attempt to cancel rejected promise
    promiseWrapper.cancel()

    assert.equal(promiseWrapper.service.state, PromiseState.Rejected)
    assert.equal(onCancelSpy.mock.calls.length, 0)
  })

  it('prevents double cancellation', () => {
    const onCancelSpy = vi.fn(noop)
    const promiseWrapper = createPromise(async (onCancel) => {
      onCancel(onCancelSpy)
      return await new Promise<void>((resolve) => setTimeout(resolve, 100))
    })

    // First cancellation
    promiseWrapper.cancel()
    assert.equal(promiseWrapper.service.state, PromiseState.Cancelled)
    assert.equal(onCancelSpy.mock.calls.length, 1)

    // Second cancellation attempt
    promiseWrapper.cancel()
    assert.equal(promiseWrapper.service.state, PromiseState.Cancelled)
    assert.equal(onCancelSpy.mock.calls.length, 1) // Should not call again
  })

  it('handles cancellation', () => {
    const onCancelSpy = vi.fn(noop)
    const promiseWrapper = createPromise(async (onCancel) => {
      onCancel(onCancelSpy)
      return await new Promise<void>((resolve) => setTimeout(resolve, 100))
    })

    promiseWrapper.cancel()

    assert.equal(promiseWrapper.service.state, PromiseState.Cancelled)
    assert.equal(onCancelSpy.mock.calls.length, 1)
  })

  it('works without onCancel callback', () => {
    const promiseWrapper = createPromise(async (onCancel) => {
      onCancel(noop) // No-op callback for this test
      return await new Promise<void>((resolve) => setTimeout(resolve, 100))
    })

    // Should not throw when cancelling without callback
    promiseWrapper.cancel()

    assert.equal(promiseWrapper.service.state, PromiseState.Cancelled)
  })

  it('tracks state transitions through subscriptions', async () => {
    const stateChanges: string[] = []
    const promiseWrapper = createPromise(async (onCancel) => {
      onCancel(noop) // No-op callback for this test
      return await Promise.resolve('result')
    })

    const unsubscribe = promiseWrapper.service.subscribe((change) => {
      stateChanges.push(`${change.action.source} → ${change.state}`)
    })

    // Wait for promise to resolve
    await new Promise<void>((resolve) => setTimeout(resolve, 0))

    assert.deepEqual(stateChanges, ['PENDING → FULFILLED'])

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

    const promiseWrapper = createPromise(async (onCancel) => {
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

    assert.equal(promiseWrapper.service.state, PromiseState.Pending)

    // Simulate user cancelling the request (e.g., clicking cancel button)
    promiseWrapper.cancel()
    promiseWrapper.cancel()
    promiseWrapper.cancel()

    assert.equal(promiseWrapper.service.state, PromiseState.Cancelled)
    assert.equal(onCancelSpy.mock.calls.length, 1)
    assert.equal(abortHandlerSpy.mock.calls.length, 1)

    // Even if the request would have completed, state should remain cancelled
    await new Promise<void>((resolve) => setTimeout(resolve, 150))

    assert.equal(promiseWrapper.service.state, PromiseState.Cancelled)
    assert.equal(promiseWrapper.service.context.value, undefined)
  })
})
