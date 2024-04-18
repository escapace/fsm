/* eslint-disable @typescript-eslint/prefer-includes, @typescript-eslint/no-explicit-any */

import {
  ACTION_EXISTS,
  ACTION_UNKNOWN,
  STATE_EXISTS,
  STATE_UNKNOWN
} from './error'
import { product } from './product'
import { szudzik } from './szudzik'
import {
  SYMBOL_LOG,
  SYMBOL_STATE,
  TypeAction,
  type ActionTransition,
  type Fluent,
  type Model,
  type Next,
  type Placeholder,
  type StateMachineAction
} from './types'

const reduce = (_model: Model, action: StateMachineAction) => {
  const model = { ..._model }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
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

const state = (model: Model) => (argument: Placeholder) => {
  const next = reduce(model, {
    payload: {
      state: argument
    },
    type: TypeAction.State
  })

  return { initial: initial(next), state: state(next) }
}

const action = (model: Model) => (argument: Placeholder) => {
  const next = reduce(model, {
    payload: {
      action: argument
    },
    type: TypeAction.Action
  })

  return {
    action: action(next),
    context: context(next),
    transition: transition(next)
  }
}

const context = (model: Model) => (argument: unknown) => {
  const next = reduce(model, {
    payload: {
      context: argument
    },
    type: TypeAction.Context
  })

  return { transition: transition(next) }
}

const transition =
  (model: Model) =>
  (
    source: Placeholder | Placeholder[],
    action:
      | [Placeholder, ...Array<(...arguments_: any[]) => boolean>]
      | Placeholder,
    target: Placeholder | Placeholder[],
    reducer?: (...arguments_: any[]) => unknown
  ) => {
    const ap = Array.isArray(action)
      ? {
          action: action[0],
          predicates: action.slice(1) as Array<
            (...arguments_: any[]) => boolean
          >
        }
      : { action, predicates: [] }

    if (model.state.actions.indexOf(ap.action) === -1) {
      return ACTION_UNKNOWN()
    }

    const next = product(
      Array.isArray(source) ? source : [source],
      Array.isArray(target) ? target : [target]
    ).reduce<Model>((accumulator, [source, target]) => {
      return reduce(accumulator, {
        payload: {
          reducer,
          source,
          target,
          ...ap
        },
        type: TypeAction.Transition
      })
    }, model)

    return {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      [SYMBOL_LOG]: [...next.log],
      [SYMBOL_STATE]: { ...next.state },
      transition: transition(next)
    }
  }

const initial = (model: Model) => (argument: Placeholder) => {
  const next = reduce(model, {
    payload: argument,
    type: TypeAction.InitialState
  })

  return { action: action(next) }
}

export const stateMachine = (
  model: Model = {
    log: [],
    state: {
      actions: [],
      context: undefined,
      initial: undefined,
      states: [],
      transitions: new Map()
    }
  }
): Fluent<Next, 'state'> => {
  return { state: state(model) } as unknown as Fluent<Next, 'state'>
}
