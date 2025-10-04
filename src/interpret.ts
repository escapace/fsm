/* eslint-disable no-labels */
/* eslint-disable unicorn/prevent-abbreviations */
/* eslint-disable typescript/no-explicit-any */

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
  let state: StateMachineIdentifier = initial!
  let indexState = indiceStates.get(state)!
  const subscriptions: StateMachineSubscription[] = []

  // Pre-allocate action and change objects to avoid repeated allocations
  const _action = {
    payload: undefined,
    source: undefined,
    target: undefined,
    type: undefined,
  } as unknown as StateMachineAction

  type Change = StateMachineChange<InferStateMachineModel<T>>
  const _change = {
    action: undefined,
    context: undefined,
    state: undefined,
  } as unknown as Change

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

      if (transitions === undefined) {
        // TODO: Strict mode? Silent mode?
        return false
      }

      // Reuse pre-allocated action object
      _action.payload = payload
      _action.type = action

      let transition: $.Values<typeof transitions> | undefined

      candidateLoop: for (let i = 0; i < transitions.length; i++) {
        const candidate = transitions[i]

        _action.source = candidate.source
        _action.target = candidate.target

        const predicates = candidate.predicates

        // Optimized predicate evaluation with for-loop
        for (let j = 0; j < predicates.length; j++) {
          if (!predicates[j](context, _action)) {
            continue candidateLoop
          }
        }

        transition = candidate
        break
      }

      if (transition === undefined) {
        return false
      }

      state = transition.target
      indexState = indiceStates.get(state)!

      if (transition.reducer !== undefined) {
        context = transition.reducer(context, _action)
      }

      // Early exit if no subscriptions to avoid object updates
      _change.action = _action as (typeof _change)['action']
      _change.context = context as (typeof _change)['context']
      _change.state = state as (typeof _change)['state']
      for (let i = 0; i < subscriptions.length; i++) {
        subscriptions[i](_change)
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
