/* eslint-disable typescript/prefer-includes, typescript/no-explicit-any */

import { szudzik } from 'coastal'
import { assertContextFactory } from './assert-context-factory'
import { reconcileContext } from './context-runtime'
import { isObject } from './is-object'
import { StateMachineError } from './error'
import { product } from './product'
import {
  STATE_MACHINE_STATE,
  StateMachineBuilderActionType,
  type StateMachineBuilder,
  type StateMachineBuilderAction,
  type StateMachineBuilderModel,
  type StateMachineBuilderStage,
  type StateMachineIdentifier,
  type StateMachineInterface,
} from './types'

const CONTEXT_SOURCE_ORIGIN = Symbol.for('@escapace/fsm/context-own-factory')

type StateMachineContextSource = (() => unknown) & {
  [CONTEXT_SOURCE_ORIGIN]?: unknown
}

const unwrapContextSource = (contextSource: unknown): (() => unknown) | undefined => {
  if (contextSource === undefined) {
    return undefined
  }

  assertContextFactory(contextSource)

  return ((contextSource as StateMachineContextSource)[CONTEXT_SOURCE_ORIGIN] ??
    contextSource) as () => unknown
}

const composeContextSource = (
  ownContextSource: (() => unknown) | undefined,
  compositions: Map<StateMachineIdentifier, StateMachineInterface>,
): (() => unknown) => {
  const contextSource: StateMachineContextSource = () => {
    const own = ownContextSource === undefined ? undefined : ownContextSource()

    const compound: Record<StateMachineIdentifier, unknown> =
      own !== null && typeof own === 'object'
        ? (own as Record<StateMachineIdentifier, unknown>)
        : {}

    for (const group of compositions.keys()) {
      if (Object.hasOwn(compound, group)) {
        throw new StateMachineError({ identifier: group, type: 'ContextGroupConflict' })
      }
    }

    for (const [group, child] of compositions.entries()) {
      const childContextSource = child[STATE_MACHINE_STATE].context

      if (childContextSource !== undefined) {
        assertContextFactory(childContextSource)
      }

      compound[group] = childContextSource === undefined ? undefined : childContextSource()
    }

    return compound
  }

  Object.defineProperty(contextSource, CONTEXT_SOURCE_ORIGIN, {
    configurable: false,
    enumerable: false,
    value: ownContextSource,
    writable: false,
  })

  return contextSource
}

const reduce = (model: StateMachineBuilderModel, action: StateMachineBuilderAction) => {
  switch (action.type) {
    case StateMachineBuilderActionType.Action: {
      if (model.state.actions.indexOf(action.payload.action) !== -1) {
        throw new StateMachineError({
          identifier: action.payload.action,
          type: 'ActionAlreadyDeclared',
        })
      }

      model.state.actions.push(action.payload.action)
      model.state.indiceActions.set(action.payload.action, model.state.actions.length - 1)

      break
    }
    case StateMachineBuilderActionType.Compose: {
      const child = action.payload.machine

      const childState = child[STATE_MACHINE_STATE]

      if (childState === undefined || childState === null || typeof childState !== 'object') {
        throw new StateMachineError({ type: 'StateMachineExpected' })
      }

      if (
        model.state.compositions.has(action.payload.group) ||
        model.state.states.indexOf(action.payload.group) !== -1
      ) {
        throw new StateMachineError({ identifier: action.payload.group, type: 'GroupNameConflict' })
      }

      for (const childStateIdentifier of childState.states) {
        if (childStateIdentifier === action.payload.group) {
          throw new StateMachineError({
            identifier: action.payload.group,
            type: 'GroupNameConflict',
          })
        }

        if (model.state.states.indexOf(childStateIdentifier) !== -1) {
          throw new StateMachineError({
            identifier: childStateIdentifier,
            type: 'StateAlreadyDeclared',
          })
        }
      }

      // States must be globally unique across parent + all composed children.
      for (const childStateIdentifier of childState.states) {
        model.state.states.push(childStateIdentifier)
        model.state.indiceStates.set(childStateIdentifier, model.state.states.length - 1)
      }

      // Actions must be disjoint across composed siblings. Parent-declared
      // actions that overlap a child's actions are deduplicated on merge.
      for (const childActionIdentifier of childState.actions) {
        for (const [, sibling] of model.state.compositions) {
          if (sibling[STATE_MACHINE_STATE].actions.indexOf(childActionIdentifier) !== -1) {
            throw new StateMachineError({
              identifier: childActionIdentifier,
              type: 'ActionConflict',
            })
          }
        }

        if (model.state.actions.indexOf(childActionIdentifier) === -1) {
          model.state.actions.push(childActionIdentifier)
          model.state.indiceActions.set(childActionIdentifier, model.state.actions.length - 1)
        }
      }

      const group = action.payload.group

      model.state.compositions.set(group, child)
      model.state.context = composeContextSource(
        unwrapContextSource(model.state.context),
        model.state.compositions,
      )

      // Merge child transitions, wrapping guards/reducers to project/inject
      // through the group's context slice.
      for (const [, transitions] of childState.transitions.entries()) {
        for (const transition of transitions) {
          const predicates =
            transition.predicates.length === 0
              ? transition.predicates
              : transition.predicates.map(
                  (predicate) =>
                    (context: Record<StateMachineIdentifier, unknown>, info: unknown) =>
                      predicate(context[group], info),
                )

          const injectChildState = (context: Record<StateMachineIdentifier, unknown>) => {
            const child = context[group]

            if (isObject(child) && 'state' in child) {
              ;(child as Record<string, unknown>).state = transition.target
            }
          }

          const reducer =
            transition.reducer === undefined
              ? // No child reducer, but still need to inject child state discriminant
                (context: Record<StateMachineIdentifier, unknown>) => {
                  injectChildState(context)

                  return context
                }
              : (context: Record<StateMachineIdentifier, unknown>, info: unknown) => {
                  context[group] = reconcileContext(
                    context[group],
                    transition.reducer!(context[group], info),
                  )

                  injectChildState(context)

                  return context
                }

          const lifted = {
            action: transition.action,
            predicates,
            reducer,
            source: transition.source,
            target: transition.target,
          }

          const indexAction = model.state.actions.indexOf(lifted.action)

          /* v8 ignore start -- defensive: builder guarantees child actions/states are merged */
          if (indexAction === -1) {
            throw new StateMachineError({ identifier: lifted.action, type: 'ActionNotDeclared' })
          }

          const indexSource = model.state.states.indexOf(lifted.source)
          const indexTarget = model.state.states.indexOf(lifted.target)

          if (indexSource === -1) {
            throw new StateMachineError({ identifier: lifted.source, type: 'StateNotDeclared' })
          }

          if (indexTarget === -1) {
            throw new StateMachineError({ identifier: lifted.target, type: 'StateNotDeclared' })
          }
          /* v8 ignore stop */

          const indexTransition = szudzik(indexSource, indexAction)
          const query = model.state.transitions.get(indexTransition)

          if (query === undefined) {
            model.state.transitions.set(indexTransition, [lifted])
          } else {
            query.push(lifted)
          }
        }
      }

      break
    }
    case StateMachineBuilderActionType.Context: {
      assertContextFactory(action.payload.context)

      model.state.context =
        model.state.compositions.size === 0
          ? action.payload.context
          : composeContextSource(
              unwrapContextSource(action.payload.context),
              model.state.compositions,
            )

      break
    }
    case StateMachineBuilderActionType.InitialState: {
      if (model.state.states.indexOf(action.payload) === -1) {
        throw new StateMachineError({ identifier: action.payload, type: 'StateNotDeclared' })
      }

      model.state.initial = action.payload
      break
    }
    case StateMachineBuilderActionType.State: {
      if (model.state.states.indexOf(action.payload.state) !== -1) {
        throw new StateMachineError({
          identifier: action.payload.state,
          type: 'StateAlreadyDeclared',
        })
      }

      model.state.states.push(action.payload.state)
      model.state.indiceStates.set(action.payload.state, model.state.states.length - 1)
      break
    }
    case StateMachineBuilderActionType.Transition: {
      const indexAction = model.state.actions.indexOf(action.payload.action)
      const indexSource = model.state.states.indexOf(action.payload.source)
      const indexTarget = model.state.states.indexOf(action.payload.target)

      /* v8 ignore start -- defensive: transition() builder pre-checks action */
      if (indexAction === -1) {
        throw new StateMachineError({
          identifier: action.payload.action,
          type: 'ActionNotDeclared',
        })
      }
      /* v8 ignore stop */

      if (indexSource === -1) {
        throw new StateMachineError({ identifier: action.payload.source, type: 'StateNotDeclared' })
      }

      if (indexTarget === -1) {
        throw new StateMachineError({ identifier: action.payload.target, type: 'StateNotDeclared' })
      }

      const indexTransition = szudzik(indexSource, indexAction)
      const query = model.state.transitions.get(indexTransition)

      if (query === undefined) {
        model.state.transitions.set(indexTransition, [action.payload])
      } else {
        query.push(action.payload)
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

  return { compose: compose(next), initial: initial(next), state: state(next) }
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
    compose: compose(next),
    context: context(next),
    transition: transition(next),
  }
}

const context = (model: StateMachineBuilderModel) => (argument: () => unknown) => {
  const next = reduce(model, {
    payload: {
      context: argument,
    },
    type: StateMachineBuilderActionType.Context,
  })

  return { compose: compose(next), transition: transition(next) }
}

const compose =
  (model: StateMachineBuilderModel) =>
  (group: StateMachineIdentifier, machine: StateMachineInterface) => {
    const next = reduce(model, {
      payload: {
        group,
        machine,
      },
      type: StateMachineBuilderActionType.Compose,
    })

    return {
      action: action(next),
      compose: compose(next),
      context: context(next),
      initial: initial(next),
      state: state(next),
      transition: transition(next),
    }
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
      throw new StateMachineError({ identifier: ap.action, type: 'ActionNotDeclared' })
    }

    const next = product(
      Array.isArray(source) ? source : [source],
      Array.isArray(target) ? target : [target],
    ).reduce<StateMachineBuilderModel>(
      (accumulator, [source, target]) =>
        reduce(accumulator, {
          payload: {
            action: ap.action,
            predicates: ap.predicates,
            reducer,
            source,
            target,
          },
          type: StateMachineBuilderActionType.Transition,
        }),
      model,
    )

    return {
      compose: compose(next),
      [STATE_MACHINE_STATE]: next.state,
      transition: transition(next),
    }
  }

const initial = (model: StateMachineBuilderModel) => (argument: StateMachineIdentifier) => {
  const next = reduce(model, {
    payload: argument,
    type: StateMachineBuilderActionType.InitialState,
  })

  return { action: action(next), compose: compose(next) }
}

/**
 * Creates a state machine definition using a fluent builder pattern.
 *
 * @param model - Internal model state, typically not provided by users
 * @returns A fluent builder interface for defining states, actions, and transitions
 */
export const stateMachine = (
  model: StateMachineBuilderModel = {
    state: {
      actions: [],
      compositions: new Map(),
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
