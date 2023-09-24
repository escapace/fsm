/* eslint-disable @typescript-eslint/consistent-type-assertions, @typescript-eslint/no-explicit-any */

import $ from '@escapace/typelevel'
import { ACTION_UNKNOWN, NOT_STATE_MACHINE } from './error'
import { szudzik } from './szudzik'
import {
  SYMBOL_STATE,
  Subscription,
  type Action,
  type Cast,
  type Change,
  type InteropStateMachine,
  type Placeholder,
  type StateMachineService
} from './types'

export const interpret = <T extends InteropStateMachine>(
  stateMachine: T
): StateMachineService<Cast<T>> => {
  if (
    typeof stateMachine[SYMBOL_STATE] !== 'object' ||
    stateMachine[SYMBOL_STATE] === null
  ) {
    return NOT_STATE_MACHINE()
  }

  const {
    initial,
    actions,
    states,
    transitions: transitionMap,
    context: contextFactory
  } = stateMachine[SYMBOL_STATE]

  let context: unknown =
    typeof contextFactory === 'function' ? contextFactory() : contextFactory

  let state: Placeholder = initial as Placeholder
  let indexState = states.indexOf(state)

  const subscriptions = new Set<Subscription>()

  const instance: StateMachineService = {
    get state() {
      return state
    },
    get context() {
      return context
    },
    // @ts-expect-error fixme
    do(action, payload) {
      const indexAction = actions.indexOf(action)

      if (indexAction === -1) {
        return ACTION_UNKNOWN()
      }

      const transitions = transitionMap.get(szudzik(indexState, indexAction))

      if (transitions === undefined || transitions.length === 0) {
        // TODO: Strict mode? Silent mode?
        return
      }

      const _action: Partial<Action> = {
        type: action,
        payload
      }

      let transitionIndex = 0
      let transition: $.Values<typeof transitions> | undefined

      while (transitionIndex < transitions.length) {
        const candidate = transitions[transitionIndex]

        _action.source = candidate.source
        _action.target = candidate.target

        const cond =
          candidate.predicates.length === 0
            ? true
            : candidate.predicates.reduce((acc, fn) => {
                return !acc ? acc : fn(context, _action)
              }, true)

        if (cond) {
          transition = candidate
          break
        }

        transitionIndex++
      }

      if (transition === undefined) {
        // TODO: Strict mode? Silent mode?
        return
      }

      state = transition.target
      indexState = states.indexOf(state)

      if (transition.reducer !== undefined) {
        context = transition.reducer(context, _action)
      }

      subscriptions.forEach((subscription) =>
        subscription({ state, context, action: _action } as Change)
      )

      return
    },
    subscribe(subscription: Subscription) {
      subscriptions.add(subscription)

      return () => subscriptions.delete(subscription)
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  return instance as any
}
