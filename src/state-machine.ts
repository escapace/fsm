/* eslint-disable @typescript-eslint/prefer-includes, @typescript-eslint/consistent-type-assertions, @typescript-eslint/no-explicit-any */

import {
  ACTION_EXISTS,
  ACTION_UNKNOWN,
  STATE_EXISTS,
  STATE_UNKNOWN
} from './error'
import { product } from './product'
import { szudzik } from './szudzik'
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

const reduce = (_model: Model, action: StateMachineAction) => {
  const model = { ..._model }

  model.log = [action, ...model.log]

  switch (action.type) {
    case TypeAction.State: {
      if (model.state.states.indexOf(action.payload.state) !== -1) {
        return STATE_EXISTS()
      }

      model.state = {
        ...model.state,
        states: [...model.state.states, action.payload.state]
      }
      break
    }
    case TypeAction.Action: {
      if (model.state.actions.indexOf(action.payload.action) !== -1) {
        return ACTION_EXISTS()
      }

      model.state = {
        ...model.state,
        actions: [...model.state.actions, action.payload.action]
      }

      break
    }
    case TypeAction.Context: {
      model.state = {
        ...model.state,
        context: action.payload.context
      }

      break
    }
    case TypeAction.InitialState: {
      if (model.state.states.indexOf(action.payload) === -1) {
        return STATE_UNKNOWN()
      }

      model.state = { ...model.state, initial: action.payload }
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

      model.state = {
        ...model.state,
        transitions: new Map(model.state.transitions)
      }

      const query = model.state.transitions.get(indexTransition)

      if (query === undefined) {
        transitions = [action.payload]
      } else {
        transitions = [...query]

        if (transitions.indexOf(action.payload) === -1) {
          transitions.push(action.payload)
        }
      }

      model.state.transitions.set(indexTransition, transitions)

      break
    }
  }

  return model
}

const state = (model: Model) => (arg: Placeholder) => {
  const next = reduce(model, {
    type: TypeAction.State,
    payload: {
      state: arg
    }
  })

  return { state: state(next), initial: initial(next) }
}

const action = (model: Model) => (arg: Placeholder) => {
  const next = reduce(model, {
    type: TypeAction.Action,
    payload: {
      action: arg
    }
  })

  return {
    transition: transition(next),
    action: action(next),
    context: context(next)
  }
}

const context = (model: Model) => (arg: unknown) => {
  const next = reduce(model, {
    type: TypeAction.Context,
    payload: {
      context: arg
    }
  })

  return { transition: transition(next) }
}

const transition = (model: Model) => (
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

  const next = product(
    Array.isArray(source) ? source : [source],
    Array.isArray(target) ? target : [target]
  ).reduce<Model>((acc, [source, target]) => {
    return reduce(acc, {
      type: TypeAction.Transition,
      payload: {
        source,
        target,
        reducer,
        ...ap
      }
    })
  }, model)

  return {
    transition: transition(next),
    [SYMBOL_LOG]: [...next.log],
    [SYMBOL_STATE]: { ...next.state }
  }
}

const initial = (model: Model) => (arg: Placeholder) => {
  const next = reduce(model, {
    type: TypeAction.InitialState,
    payload: arg
  })

  return { action: action(next) }
}

export const stateMachine = (
  model: Model = {
    log: [],
    state: {
      initial: undefined,
      states: [],
      actions: [],
      context: undefined,
      transitions: new Map()
    }
  }
): Fluent<Next, 'state'> => {
  return ({ state: state(model) } as unknown) as Fluent<Next, 'state'>
}
