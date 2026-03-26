/* eslint-disable typescript/prefer-includes, typescript/no-explicit-any */

import { DirectAddressTable, szudzik } from 'coastal'
import { assertContextFactory } from './assert-context-factory'
import { CONTEXT_SOURCE_ORIGIN, STATE_MACHINE_STATE } from './constants'
import { reconcile, snapshot } from './context-runtime'
import { isObject } from './is-object'
import { StateMachineError } from './error'
import { resolveOwnFunctionOption } from './internal-options'
import { CHILD_GROUP, type GroupScopedReducer } from './internal-policy'
import { product } from './product'
import {
  StateMachineBuilderActionType,
  type StateMachineBuilder,
  type StateMachineBuilderAction,
  type StateMachineBuilderModel,
  type StateMachineBuilderStage,
  type StateMachineDefinitionState,
  type StateMachineDoneOptions,
  type StateMachineIdentifier,
  type StateMachineInterface,
  type StateMachineTransitionPayload,
} from './types'

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

const finalize = <T extends StateMachineBuilderModel>(
  model: T,
  options?: StateMachineDoneOptions<T>,
): StateMachineInterface<T> => {
  const transitionEntries: StateMachineTransitionPayload[] = []
  const transitionKeys: number[] = []
  const transitionValues: StateMachineTransitionPayload[][] = []

  for (const [key, value] of model.state.transitions) {
    const transitions = value.slice()

    transitionKeys.push(key)
    transitionValues.push(transitions)
    transitionEntries.push(...transitions)
  }

  const resolveSnapshot = resolveOwnFunctionOption(
    options,
    'snapshotContext',
    snapshot as (context: T['state']['context']) => T['state']['context'],
  )
  const resolveReconcile = resolveOwnFunctionOption(
    options,
    'reconcileContext',
    reconcile as (
      parentContext: T['state']['context'],
      nextContext: T['state']['context'],
    ) => T['state']['context'],
  )

  const composedSnapshotContext =
    model.state.compositions.size === 0
      ? resolveSnapshot
      : (context: T['state']['context']) => {
          const scoped = resolveSnapshot(context) as Record<StateMachineIdentifier, unknown>

          for (const [group, child] of model.state.compositions) {
            const childSnapshotContext = child[STATE_MACHINE_STATE].snapshotContext as (
              context: unknown,
            ) => unknown
            scoped[group] = childSnapshotContext(scoped[group])
          }

          return scoped as T['state']['context']
        }

  // eslint-disable-next-line typescript/consistent-type-assertions
  const finalizedState = {
    actions: [...model.state.actions],
    context: model.state.context,
    indiceActions: Object.fromEntries(model.state.indiceActions),
    indiceStates: Object.fromEntries(model.state.indiceStates),
    initial: model.state.initial,
    reconcileContext: resolveReconcile,
    snapshotContext: composedSnapshotContext,
    states: [...model.state.states],
    transitionEntries,
    transitions: new DirectAddressTable(
      transitionKeys.length === 0 ? [0] : transitionKeys,
      transitionKeys.length === 0 ? [undefined] : transitionValues,
    ),
  } as StateMachineDefinitionState<T['state']>

  return {
    [STATE_MACHINE_STATE]: finalizedState,
  }
}

const done =
  <T extends StateMachineBuilderModel>(model: T) =>
  (options?: StateMachineDoneOptions<T>): StateMachineInterface<T> =>
    finalize(model, options)

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
      for (const transition of childState.transitionEntries) {
        const predicates =
          transition.predicates.length === 0
            ? transition.predicates
            : transition.predicates.map(
                (predicate) => (context: Record<StateMachineIdentifier, unknown>, info: unknown) =>
                  predicate(context[group], info),
              )

        const injectChildState = (context: Record<StateMachineIdentifier, unknown>) => {
          const child = context[group]

          if (isObject(child) && 'state' in child) {
            ;(child as Record<string, unknown>).state = transition.target
          }
        }

        const childReconcileContext = childState.reconcileContext as (
          parentContext: unknown,
          nextContext: unknown,
        ) => unknown

        const reducer =
          transition.reducer === undefined
            ? // No child reducer, but still need to inject child state discriminant
              (context: Record<StateMachineIdentifier, unknown>) => {
                injectChildState(context)

                return context
              }
            : (context: Record<StateMachineIdentifier, unknown>, info: unknown) => {
                context[group] = childReconcileContext(
                  context[group],
                  transition.reducer!(context[group], info),
                )

                injectChildState(context)

                return context
              }

        ;(reducer as GroupScopedReducer)[CHILD_GROUP] = group

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

  return { compose: compose(next), done: done(next), initial: initial(next), state: state(next) }
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
    done: done(next),
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

  return { compose: compose(next), done: done(next), transition: transition(next) }
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
      done: done(next),
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
      done: done(next),
      transition: transition(next),
    }
  }

const initial = (model: StateMachineBuilderModel) => (argument: StateMachineIdentifier) => {
  const next = reduce(model, {
    payload: argument,
    type: StateMachineBuilderActionType.InitialState,
  })

  return { action: action(next), compose: compose(next), done: done(next) }
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
