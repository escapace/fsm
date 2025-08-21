/* eslint-disable typescript/prefer-includes, typescript/no-explicit-any */

import { ACTION_EXISTS, ACTION_UNKNOWN, STATE_EXISTS, STATE_UNKNOWN } from './error'
import { product } from './product'
import { szudzik } from 'coastal'
import {
  STATE_MACHINE_LOG,
  STATE_MACHINE_STATE,
  StateMachineBuilderActionType,
  type StateMachineBuilder,
  type StateMachineBuilderAction,
  type StateMachineBuilderModel,
  type StateMachineBuilderStage,
  type StateMachineIdentifier,
} from './types'

const reduce = (model: StateMachineBuilderModel, action: StateMachineBuilderAction) => {
  model.log.unshift(action)

  switch (action.type) {
    case StateMachineBuilderActionType.Action: {
      if (model.state.actions.indexOf(action.payload.action) !== -1) {
        return ACTION_EXISTS()
      }

      model.state.actions.push(action.payload.action)
      model.state.indiceActions.set(action.payload.action, model.state.actions.length - 1)

      break
    }
    case StateMachineBuilderActionType.Context: {
      model.state.context = action.payload.context

      break
    }
    case StateMachineBuilderActionType.InitialState: {
      if (model.state.states.indexOf(action.payload) === -1) {
        return STATE_UNKNOWN()
      }

      model.state.initial = action.payload
      break
    }
    case StateMachineBuilderActionType.State: {
      if (model.state.states.indexOf(action.payload.state) !== -1) {
        return STATE_EXISTS()
      }

      model.state.states.push(action.payload.state)
      model.state.indiceStates.set(action.payload.state, model.state.states.length - 1)
      break
    }
    case StateMachineBuilderActionType.Transition: {
      const indexAction = model.state.actions.indexOf(action.payload.action)
      const indexSource = model.state.states.indexOf(action.payload.source)
      const indexTarget = model.state.states.indexOf(action.payload.target)

      if (indexSource === -1 || indexTarget === -1 || indexAction === -1) {
        return STATE_UNKNOWN()
      }

      const indexTransition = szudzik(indexSource, indexAction)
      const query = model.state.transitions.get(indexTransition)

      if (query === undefined) {
        model.state.transitions.set(indexTransition, [action.payload])
      } else {
        if (query.indexOf(action.payload) === -1) {
          query.push(action.payload)
        }
      }

      break
    }
  }

  return model
}

const state = (model: StateMachineBuilderModel) => (argument: StateMachineIdentifier) => {
  const next = reduce(model, {
    payload: {
      state: argument,
    },
    type: StateMachineBuilderActionType.State,
  })

  return { initial: initial(next), state: state(next) }
}

const action = (model: StateMachineBuilderModel) => (argument: StateMachineIdentifier) => {
  const next = reduce(model, {
    payload: {
      action: argument,
    },
    type: StateMachineBuilderActionType.Action,
  })

  return {
    action: action(next),
    context: context(next),
    transition: transition(next),
  }
}

const context = (model: StateMachineBuilderModel) => (argument: unknown) => {
  const next = reduce(model, {
    payload: {
      context: argument,
    },
    type: StateMachineBuilderActionType.Context,
  })

  return { transition: transition(next) }
}

const transition =
  (model: StateMachineBuilderModel) =>
  (
    source: StateMachineIdentifier | StateMachineIdentifier[],
    action:
      | StateMachineIdentifier
      | [StateMachineIdentifier, ...Array<(...arguments_: any[]) => boolean>],
    target: StateMachineIdentifier | StateMachineIdentifier[],
    reducer?: (...arguments_: any[]) => unknown,
  ) => {
    const ap = Array.isArray(action)
      ? {
          action: action[0],
          predicates: action.slice(1) as Array<(...arguments_: any[]) => boolean>,
        }
      : { action, predicates: [] }

    if (model.state.actions.indexOf(ap.action) === -1) {
      return ACTION_UNKNOWN()
    }

    const next = product(
      Array.isArray(source) ? source : [source],
      Array.isArray(target) ? target : [target],
    ).reduce<StateMachineBuilderModel>(
      (accumulator, [source, target]) =>
        reduce(accumulator, {
          payload: {
            reducer,
            source,
            target,
            ...ap,
          },
          type: StateMachineBuilderActionType.Transition,
        }),
      model,
    )

    return {
      [STATE_MACHINE_LOG]: next.log,
      [STATE_MACHINE_STATE]: next.state,
      transition: transition(next),
    }
  }

const initial = (model: StateMachineBuilderModel) => (argument: StateMachineIdentifier) => {
  const next = reduce(model, {
    payload: argument,
    type: StateMachineBuilderActionType.InitialState,
  })

  return { action: action(next) }
}

/**
 * Creates a state machine definition using a fluent builder pattern.
 *
 * @param model - Internal model state, typically not provided by users
 * @returns A fluent builder interface for defining states, actions, and transitions
 */
export const stateMachine = (
  model: StateMachineBuilderModel = {
    log: [],
    state: {
      actions: [],
      context: undefined,
      indiceActions: new Map(),
      indiceStates: new Map(),
      initial: undefined,
      states: [],
      transitions: new Map(),
    },
  },
): StateMachineBuilder<StateMachineBuilderStage, 'state'> =>
  ({ state: state(model) }) as unknown as StateMachineBuilder<StateMachineBuilderStage, 'state'>
