/* eslint-disable typescript/no-unsafe-assignment */
/* eslint-disable typescript/prefer-for-of */
/* eslint-disable unicorn/prevent-abbreviations */
/* eslint-disable typescript/consistent-type-assertions, typescript/no-explicit-any */

import type $ from '@escapace/typelevel'
import { remove, szudzik } from 'coastal'
import { ACTION_UNKNOWN, NOT_STATE_MACHINE } from './error'
import {
  STATE_MACHINE_STATE,
  type InferStateMachineModel,
  type StateMachineAction,
  type StateMachineChange,
  type StateMachineIdentifier,
  type StateMachineInterface,
  type StateMachineService,
  type StateMachineSubscription,
} from './types'

/**
 * Creates a runnable service instance from a state machine definition.
 *
 * @param stateMachine - The state machine definition created by the `stateMachine` function
 * @returns A service that can execute actions, track state, and notify subscribers
 */
export const interpret = <T extends StateMachineInterface>(
  stateMachine: T,
): StateMachineService<InferStateMachineModel<T>> => {
  if (
    typeof stateMachine[STATE_MACHINE_STATE] !== 'object' ||
    stateMachine[STATE_MACHINE_STATE] === null
  ) {
    return NOT_STATE_MACHINE()
  }

  const {
    context: contextFactory,
    indiceActions,
    indiceStates,
    initial,
    transitions: transitionMap,
  } = stateMachine[STATE_MACHINE_STATE]

  // eslint-disable-next-line typescript/no-unsafe-call
  let context: unknown = typeof contextFactory === 'function' ? contextFactory() : contextFactory

  // eslint-disable-next-line typescript/no-non-null-assertion
  let state: StateMachineIdentifier = initial!
  // eslint-disable-next-line typescript/no-non-null-assertion
  let indexState = indiceStates.get(state)!

  const subscriptions: StateMachineSubscription[] = []

  // Pre-allocate action object to avoid repeated allocations
  const _action: StateMachineAction = {
    payload: undefined,
    source: undefined as any,
    target: undefined as any,
    type: undefined as any,
  }

  const instance: StateMachineService = {
    get context() {
      return context
    },
    // @ts-expect-error types
    do(action, payload) {
      const indexAction = indiceActions.get(action)

      if (indexAction === undefined) {
        return ACTION_UNKNOWN()
      }

      const transitions = transitionMap.get(szudzik(indexState, indexAction))

      if (transitions === undefined || transitions.length === 0) {
        // TODO: Strict mode? Silent mode?
        return false
      }

      // Reuse pre-allocated action object
      _action.payload = payload
      _action.type = action

      let transition: $.Values<typeof transitions> | undefined

      for (let i = 0; i < transitions.length; i++) {
        const candidate = transitions[i]

        _action.source = candidate.source
        _action.target = candidate.target

        let predicatesPass = true
        const predicates = candidate.predicates

        // Optimized predicate evaluation with for-loop
        for (let j = 0; j < predicates.length; j++) {
          if (!predicates[j](context, _action)) {
            predicatesPass = false
            break
          }
        }

        if (predicatesPass) {
          transition = candidate
          break
        }
      }

      if (transition === undefined) {
        return false
      }

      state = transition.target
      // eslint-disable-next-line typescript/no-non-null-assertion
      indexState = indiceStates.get(state)!

      if (transition.reducer !== undefined) {
        context = transition.reducer(context, _action)
      }

      // Early exit if no subscriptions to avoid object creation
      if (subscriptions.length > 0) {
        const change = { action: _action, context, state } as StateMachineChange
        for (let i = 0; i < subscriptions.length; i++) {
          subscriptions[i](change)
        }
      }

      return true
    },
    get state() {
      return state
    },
    subscribe(subscription: StateMachineSubscription) {
      if (!subscriptions.includes(subscription)) {
        subscriptions.push(subscription)
      }

      return () => {
        remove(subscriptions, (value) => value === subscription)
      }
    },
  }

  // eslint-disable-next-line typescript/no-unsafe-return
  return instance as any
}
