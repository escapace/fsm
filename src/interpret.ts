/* eslint-disable typescript/consistent-type-assertions, typescript/no-explicit-any */

import type $ from '@escapace/typelevel'
import { ACTION_UNKNOWN, NOT_STATE_MACHINE } from './error'
import { szudzik } from './szudzik'
import {
  SYMBOL_STATE,
  type Action,
  type Cast,
  type Change,
  type InteropStateMachine,
  type Placeholder,
  type StateMachineService,
  type Subscription,
} from './types'

const makeIndice = <T>(value: T[]) => new Map(value.map((value, index) => [value, index] as const))

export const interpret = <T extends InteropStateMachine>(
  stateMachine: T,
): StateMachineService<Cast<T>> => {
  if (typeof stateMachine[SYMBOL_STATE] !== 'object' || stateMachine[SYMBOL_STATE] === null) {
    return NOT_STATE_MACHINE()
  }

  const {
    actions,
    context: contextFactory,
    initial,
    states,
    transitions: transitionMap,
  } = stateMachine[SYMBOL_STATE]

  let context: unknown = typeof contextFactory === 'function' ? contextFactory() : contextFactory

  // TODO: move this under stateMachine
  const indiceActions = makeIndice(actions)
  const indiceStates = makeIndice(states)

  // eslint-disable-next-line typescript/no-non-null-assertion
  let state: Placeholder = initial!
  // eslint-disable-next-line typescript/no-non-null-assertion
  let indexState = indiceStates.get(state)!

  const subscriptions = new Set<Subscription>()

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
        return
      }

      const _action: Partial<Action> = {
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

        // const cond =
        //   candidate.predicates.length === 0
        //     ? true
        //     : candidate.predicates.reduce(
        //         (
        //           accumulator: boolean,
        //           function_: (...arguments_: any[]) => boolean
        //         ): boolean => {
        //           return !accumulator
        //             ? accumulator
        //             : function_(context, _action)
        //         },
        //         true
        //       )

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
        return
      }

      state = transition.target
      // eslint-disable-next-line typescript/no-non-null-assertion
      indexState = indiceStates.get(state)!

      if (transition.reducer !== undefined) {
        context = transition.reducer(context, _action)
      }

      for (const subscription of subscriptions) {
        subscription({ action: _action, context, state } as Change)
      }

      // subscriptions.forEach((subscription) =>
      //   subscription({ action: _action, context, state } as Change)
      // )

      return
    },
    get state() {
      return state
    },
    subscribe(subscription: Subscription) {
      subscriptions.add(subscription)

      return () => subscriptions.delete(subscription)
    },
  }

  // eslint-disable-next-line typescript/no-unsafe-return
  return instance as any
}
