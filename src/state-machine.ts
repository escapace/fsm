/* eslint-disable typescript/prefer-includes, typescript/no-explicit-any */

import { ACTION_EXISTS, ACTION_UNKNOWN, STATE_EXISTS, STATE_UNKNOWN } from './error'
import { product } from './product'
import { szudzik } from './szudzik'
import {
  STATE_MACHINE_LOG,
  STATE_MACHINE_STATE,
  StateMachineBuilderActionType,
  type StateMachineBuilder,
  type StateMachineBuilderAction,
  type StateMachineBuilderActionTransition,
  type StateMachineBuilderModel,
  type StateMachineBuilderStage,
  type StateMachineIdentifier,
} from './types'

const reduce = (_model: StateMachineBuilderModel, action: StateMachineBuilderAction) => {
  const model = { ..._model }

  // eslint-disable-next-line typescript/no-unsafe-assignment
  model.log = [action, ...model.log]

  switch (action.type) {
    case StateMachineBuilderActionType.Action: {
      if (model.state.actions.indexOf(action.payload.action) !== -1) {
        return ACTION_EXISTS()
      }

      model.state = {
        ...model.state,
        actions: [...model.state.actions, action.payload.action],
      }

      break
    }
    case StateMachineBuilderActionType.Context: {
      model.state = {
        ...model.state,
        context: action.payload.context,
      }

      break
    }
    case StateMachineBuilderActionType.InitialState: {
      if (model.state.states.indexOf(action.payload) === -1) {
        return STATE_UNKNOWN()
      }

      model.state = { ...model.state, initial: action.payload }
      break
    }
    case StateMachineBuilderActionType.State: {
      if (model.state.states.indexOf(action.payload.state) !== -1) {
        return STATE_EXISTS()
      }

      model.state = {
        ...model.state,
        states: [...model.state.states, action.payload.state],
      }
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
      let transitions: Array<StateMachineBuilderActionTransition['payload']>

      model.state = {
        ...model.state,
        transitions: new Map(model.state.transitions),
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
      // eslint-disable-next-line typescript/no-unsafe-assignment
      [STATE_MACHINE_LOG]: [...next.log],
      [STATE_MACHINE_STATE]: { ...next.state },
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
      initial: undefined,
      states: [],
      transitions: new Map(),
    },
  },
): StateMachineBuilder<StateMachineBuilderStage, 'state'> =>
  ({ state: state(model) }) as unknown as StateMachineBuilder<StateMachineBuilderStage, 'state'>
