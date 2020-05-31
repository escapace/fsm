/* eslint-disable @typescript-eslint/prefer-includes, @typescript-eslint/consistent-type-assertions, @typescript-eslint/no-explicit-any */

import {
  ActionTransition,
  Fluent,
  Model,
  Next,
  Placeholder,
  StateMachineAction,
  SYMBOL_LOG,
  SYMBOL_STATE,
  TypeAction
} from './types'
import { szudzik } from './szudzik'
import { product } from './product'
import {
  STATE_EXISTS,
  ACTION_EXISTS,
  STATE_UNKNOWN,
  ACTION_UNKNOWN
} from './error'

const reducerFactory = (model: Model) => (action: StateMachineAction) => {
  model.log.unshift(action)

  switch (action.type) {
    case TypeAction.State: {
      if (model.state.states.indexOf(action.payload.state) !== -1) {
        return STATE_EXISTS()
      }

      model.state.states.push(action.payload.state)
      break
    }
    case TypeAction.Action: {
      if (model.state.actions.indexOf(action.payload.action) !== -1) {
        return ACTION_EXISTS()
      }

      model.state.actions.push(action.payload.action)
      break
    }
    case TypeAction.Context: {
      model.state.context = action.payload.context
      break
    }
    case TypeAction.InitialState: {
      if (model.state.states.indexOf(action.payload) === -1) {
        return STATE_UNKNOWN()
      }

      model.state.initial = action.payload
      break
    }
    case TypeAction.Transition: {
      const indexAction = model.state.actions.indexOf(action.payload.action)
      const indexSource = model.state.states.indexOf(action.payload.source)
      const indexTarget = model.state.states.indexOf(action.payload.target)

      if (indexSource === -1 || indexTarget === -1 || indexAction === -1) {
        return STATE_UNKNOWN()
      }

      const indexTransition = szudzik(indexSource, indexAction)
      let transitions: Array<ActionTransition['payload']>
      const query = model.state.transitions.get(indexTransition)

      if (query === undefined) {
        transitions = [action.payload]
        model.state.transitions.set(indexTransition, transitions)
      } else {
        transitions = query

        if (transitions.indexOf(action.payload) === -1) {
          transitions.push(action.payload)
        }
      }

      break
    }
  }
}

export const stateMachine = (): Fluent<Next, 'state'> => {
  const model: Model = {
    log: [],
    state: {
      initial: undefined,
      states: [],
      actions: [],
      // contexts: {},
      context: undefined,
      transitions: new Map()
    }
  }

  const reduce = reducerFactory(model)

  const state = (arg: Placeholder) => {
    reduce({
      type: TypeAction.State,
      payload: {
        state: arg
      }
    })

    return { state, initial }
  }

  const action = (arg: Placeholder) => {
    reduce({
      type: TypeAction.Action,
      payload: {
        action: arg
      }
    })

    return { transition, action, context }
  }

  const context = (arg: unknown) => {
    reduce({
      type: TypeAction.Context,
      payload: {
        context: arg
      }
    })

    return { transition }
  }

  const transition = (
    source: Placeholder | Placeholder[],
    action: Placeholder | [Placeholder, ...Array<(...args: any[]) => boolean>],
    target: Placeholder | Placeholder[],
    reducer?: (...args: any[]) => unknown
  ) => {
    const ap = Array.isArray(action)
      ? {
          action: action[0],
          predicates: action.slice(1) as Array<(...args: any[]) => boolean>
        }
      : { action, predicates: [] }

    if (model.state.actions.indexOf(ap.action) === -1) {
      return ACTION_UNKNOWN()
    }

    product(
      Array.isArray(source) ? source : [source],
      Array.isArray(target) ? target : [target]
    ).forEach(([source, target]) =>
      reduce({
        type: TypeAction.Transition,
        payload: {
          source,
          target,
          reducer,
          ...ap
        }
      })
    )

    return {
      transition,
      [SYMBOL_LOG]: model.log,
      [SYMBOL_STATE]: model.state
    }
  }

  const initial = (arg: Placeholder) => {
    reduce({
      type: TypeAction.InitialState,
      payload: arg
    })

    return { action }
  }

  return ({ state } as unknown) as Fluent<Next, 'state'>
}
