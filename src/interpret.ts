/* eslint-disable typescript/consistent-type-assertions, typescript/no-explicit-any */

import type $ from '@escapace/typelevel'
import { ACTION_UNKNOWN, NOT_STATE_MACHINE } from './error'
import { szudzik } from './szudzik'
import {
  STATE_MACHINE_STATE,
  type StateMachineAction,
  type InferStateMachineModel,
  type StateMachineChange,
  type StateMachineInterface,
  type StateMachineIdentifier,
  type StateMachineService,
  type StateMachineSubscription,
} from './types'

const makeIndice = <T>(value: T[]) => new Map(value.map((value, index) => [value, index] as const))

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
    actions,
    context: contextFactory,
    initial,
    states,
    transitions: transitionMap,
  } = stateMachine[STATE_MACHINE_STATE]

  // eslint-disable-next-line typescript/no-unsafe-call
  let context: unknown = typeof contextFactory === 'function' ? contextFactory() : contextFactory

  // TODO: move this under stateMachine
  const indiceActions = makeIndice(actions)
  const indiceStates = makeIndice(states)

  // eslint-disable-next-line typescript/no-non-null-assertion
  let state: StateMachineIdentifier = initial!
  // eslint-disable-next-line typescript/no-non-null-assertion
  let indexState = indiceStates.get(state)!

  const subscriptions = new Set<StateMachineSubscription>()

  const instance: StateMachineService = {
    get context() {
      return context
    },
    // @ts-expect-error fixme
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

      const _action: Partial<StateMachineAction> = {
        payload,
        source: undefined,
        target: undefined,
        type: action,
      }

      let transitionIndex = 0
      let transition: $.Values<typeof transitions> | undefined

      while (transitionIndex < transitions.length) {
        const candidate = transitions[transitionIndex]

        _action.source = candidate.source
        _action.target = candidate.target

        let accumulator = true

        let length = candidate.predicates.length

        while (length > 0) {
          if (!accumulator) {
            break
          }

          accumulator = candidate.predicates[candidate.predicates.length - length](context, _action)

          length--
        }

        if (accumulator) {
          transition = candidate
          break
        }

        transitionIndex++
      }

      if (transition === undefined) {
        // TODO: Strict mode? Silent mode?
        return false
      }

      state = transition.target
      // eslint-disable-next-line typescript/no-non-null-assertion
      indexState = indiceStates.get(state)!

      if (transition.reducer !== undefined) {
        context = transition.reducer(context, _action)
      }

      for (const subscription of subscriptions) {
        subscription({ action: _action, context, state } as StateMachineChange)
      }

      // subscriptions.forEach((subscription) =>
      //   subscription({ action: _action, context, state } as Change)
      // )

      return true
    },
    get state() {
      return state
    },
    subscribe(subscription: StateMachineSubscription) {
      subscriptions.add(subscription)

      return () => subscriptions.delete(subscription)
    },
  }

  // eslint-disable-next-line typescript/no-unsafe-return
  return instance as any
}
