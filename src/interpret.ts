/* eslint-disable unicorn/prevent-abbreviations */

import type $ from '@escapace/typelevel'
import { remove, szudzik } from 'coastal'
import { assertContextFactory } from './assert-context-factory'
import { reconcileContext, snapshotContext } from './context-runtime'
import { isObject } from './is-object'
import { StateMachineError } from './error'
import {
  STATE_MACHINE_STATE,
  type InferStateMachineModel,
  type StateMachineChange,
  type StateMachineDraft,
  type StateMachineIdentifier,
  type StateMachineInterface,
  type StateMachineService,
  type StateMachineSubscription,
} from './types'

interface InternalAction {
  payload: unknown
  source: StateMachineIdentifier
  target: StateMachineIdentifier
  type: StateMachineIdentifier
}

type InternalReducer = ((context: unknown, action: unknown) => unknown) | undefined

interface InternalActionBuffer {
  payload: unknown
  source: StateMachineIdentifier | undefined
  target: StateMachineIdentifier | undefined
  type: StateMachineIdentifier | undefined
}

interface InternalSelectedStep {
  action: InternalAction
  reducer: InternalReducer
}

type InternalSubscription = (change: unknown) => void

interface InternalDraftFrame {
  baseCursor: number
  children: Set<InternalDraftFrame> | undefined
  closed: boolean
  context: unknown
  indexState: number
  parent: InternalDraftFrame | undefined
  state: StateMachineIdentifier
  subscriptions: InternalSubscription[] | undefined
  trace: InternalSelectedStep[]
}

const draftHeadCursor = (draft: InternalDraftFrame): number => draft.baseCursor + draft.trace.length

const assertDraftOperational = (draft: InternalDraftFrame): void => {
  let cursor: InternalDraftFrame | undefined = draft

  while (cursor !== undefined) {
    if (cursor.closed) {
      throw new StateMachineError({ type: 'DraftClosed' })
    }

    cursor = cursor.parent
  }
}

const notifySubscribers = (
  subscriptions: InternalSubscription[] | undefined,
  change: unknown,
): void => {
  if (subscriptions === undefined) {
    return
  }

  for (let index = 0; index < subscriptions.length; index++) {
    subscriptions[index](change)
  }
}

const closeDraftFrame = (draft: InternalDraftFrame): void => {
  /* v8 ignore start -- defensive idempotence guard for internal close recursion */
  if (draft.closed) return
  /* v8 ignore stop */

  draft.closed = true

  const children = draft.children
  draft.children = undefined

  if (children !== undefined) {
    for (const child of children) {
      closeDraftFrame(child)
    }

    children.clear()
  }

  if (draft.subscriptions !== undefined) {
    draft.subscriptions.length = 0
    draft.subscriptions = undefined
  }

  draft.trace.length = 0

  const parent = draft.parent

  if (parent?.children !== undefined) {
    parent.children.delete(draft)

    if (parent.children.size === 0) {
      parent.children = undefined
    }
  }

  draft.parent = undefined
}

const registerSubscription = <T>(
  subscriptions: T[],
  subscription: T,
  onEmpty?: () => void,
): (() => void) => {
  if (!subscriptions.includes(subscription)) {
    subscriptions.push(subscription)
  }

  return () => {
    remove(subscriptions, (value) => value === subscription)

    if (subscriptions.length === 0) {
      onEmpty?.()
    }
  }
}

const subscribeDraft = (
  draft: InternalDraftFrame,
  subscription: InternalSubscription,
): (() => void) => {
  const subscriptions = draft.subscriptions ?? (draft.subscriptions = [])

  return registerSubscription(subscriptions, subscription)
}

/**
 * Creates a runnable service instance from a state machine definition.
 *
 * @param stateMachine - The state machine definition created by the `stateMachine` function
 * @returns A service that can execute actions, track state, and notify subscribers
 */
export const interpret = <T extends StateMachineInterface>(
  stateMachine: T,
): StateMachineService<InferStateMachineModel<T>> => {
  type Model = InferStateMachineModel<T>
  if (
    typeof stateMachine[STATE_MACHINE_STATE] !== 'object' ||
    stateMachine[STATE_MACHINE_STATE] === null
  ) {
    throw new StateMachineError({ type: 'NotStateMachine' })
  }

  const {
    context: contextFactory,
    indiceActions,
    indiceStates,
    initial,
    transitions: transitionMap,
  } = stateMachine[STATE_MACHINE_STATE]

  let context: unknown =
    contextFactory === undefined
      ? undefined
      : (assertContextFactory(contextFactory), contextFactory())
  let state: StateMachineIdentifier = initial!

  // Whether context carries a `state` discriminant. Invariant for the machine's
  // lifetime: if the initial context has `state`, every reducer return must too
  // (enforced by the type system). Computed once, used on every dispatch.
  const needsStateInjection = isObject(context) && 'state' in context

  // Validate that the context factory's state discriminant matches the initial state.
  if (needsStateInjection) {
    const ctxState = (context as Record<string, unknown>).state

    if (ctxState !== state) {
      throw new StateMachineError({
        actual: ctxState,
        expected: state,
        type: 'ContextFactoryStateInvalid',
      })
    }
  }
  let indexState = indiceStates.get(state)!
  let commitCursor = 0
  const subscriptions: Array<StateMachineSubscription<Model>> = []

  // Pre-allocated mutable buffers for action/change dispatch — loosely typed
  // to avoid deep generic resolution on every assignment.
  const _action: InternalActionBuffer = {
    payload: undefined,
    source: undefined,
    target: undefined,
    type: undefined,
  }

  type Change = StateMachineChange<Model>
  const _change = {
    action: undefined,
    context: undefined,
    state: undefined,
  } as unknown as Change

  const createDraft = (
    parent: InternalDraftFrame | undefined,
    baseCursor: number,
  ): StateMachineDraft<Model> => {
    const frame: InternalDraftFrame = {
      baseCursor,
      children: undefined,
      closed: false,
      context: snapshotContext(parent === undefined ? context : parent.context),
      indexState: parent === undefined ? indexState : parent.indexState,
      parent,
      state: parent === undefined ? state : parent.state,
      subscriptions: undefined,
      trace: [],
    }

    if (parent !== undefined) {
      ;(parent.children ?? (parent.children = new Set())).add(frame)
    }

    const draft: StateMachineDraft<Model> = {
      commit() {
        assertDraftOperational(frame)

        if (frame.parent === undefined) {
          if (commitCursor !== frame.baseCursor) {
            throw new StateMachineError({
              actualCursor: commitCursor,
              expectedCursor: frame.baseCursor,
              type: 'DraftOutOfDate',
            })
          }

          if (frame.trace.length === 0) {
            closeDraftFrame(frame)
            return
          }

          for (let i = 0; i < frame.trace.length; i++) {
            const step = frame.trace[i]
            const nextState = step.action.target

            if (step.reducer !== undefined) {
              context = reconcileContext(context, step.reducer(context, step.action))
            }

            state = nextState
            indexState = indiceStates.get(state)!

            // Inject state discriminant after replayed transition
            if (needsStateInjection) {
              ;(context as Record<string, unknown>).state = state
            }

            commitCursor += 1

            _change.action = step.action as (typeof _change)['action']
            _change.context = context as (typeof _change)['context']
            _change.state = state as (typeof _change)['state']

            for (let j = 0; j < subscriptions.length; j++) {
              ;(subscriptions[j] as (change: unknown) => void)(_change)
            }
          }

          closeDraftFrame(frame)
          return
        }

        const parent = frame.parent
        const parentHead = draftHeadCursor(parent)

        if (parentHead !== frame.baseCursor) {
          throw new StateMachineError({
            actualCursor: parentHead,
            expectedCursor: frame.baseCursor,
            type: 'DraftOutOfDate',
          })
        }

        if (frame.trace.length === 0) {
          closeDraftFrame(frame)
          return
        }

        const _parentChange = {
          action: undefined,
          context: undefined,
          state: undefined,
        } as unknown as Change

        for (let i = 0; i < frame.trace.length; i++) {
          const step = frame.trace[i]
          const nextState = step.action.target

          if (step.reducer !== undefined) {
            parent.context = reconcileContext(
              parent.context,
              step.reducer(parent.context, step.action),
            )
          }

          parent.state = nextState
          parent.indexState = indiceStates.get(parent.state)!

          if (needsStateInjection) {
            ;(parent.context as Record<string, unknown>).state = parent.state
          }

          parent.trace.push(step)

          _parentChange.action = step.action as (typeof _parentChange)['action']
          _parentChange.context = parent.context as (typeof _parentChange)['context']
          _parentChange.state = parent.state as (typeof _parentChange)['state']

          notifySubscribers(parent.subscriptions, _parentChange)
        }

        closeDraftFrame(frame)
      },
      get context() {
        return frame.context as StateMachineDraft<Model>['context']
      },
      discard() {
        assertDraftOperational(frame)
        closeDraftFrame(frame)
      },
      // @ts-expect-error runtime hot path keeps direct payload parameter shape
      do(action, payload) {
        assertDraftOperational(frame)

        const indexAction = indiceActions.get(action)

        if (indexAction === undefined) {
          throw new StateMachineError({ identifier: action, type: 'ActionUnknown' })
        }

        const transitions = transitionMap.get(szudzik(frame.indexState, indexAction))

        if (transitions === undefined) {
          return false
        }

        const actionInfo: InternalActionBuffer = {
          payload,
          source: undefined,
          target: undefined,
          type: action,
        }

        let transition: $.Values<typeof transitions> | undefined

        candidateLoop: for (let i = 0; i < transitions.length; i++) {
          const candidate = transitions[i]

          actionInfo.source = candidate.source
          actionInfo.target = candidate.target

          const predicates = candidate.predicates

          for (let j = 0; j < predicates.length; j++) {
            if (!predicates[j](frame.context, actionInfo)) {
              continue candidateLoop
            }
          }

          transition = candidate
          break
        }

        if (transition === undefined) {
          return false
        }

        const nextState = transition.target

        if (transition.reducer !== undefined) {
          frame.context = transition.reducer(frame.context, actionInfo)
        }

        frame.state = nextState
        frame.indexState = indiceStates.get(frame.state)!

        // Inject state discriminant after transition
        if (needsStateInjection) {
          ;(frame.context as Record<string, unknown>).state = frame.state
        }

        const selectedStep: InternalSelectedStep = {
          action: {
            payload,
            source: actionInfo.source!,
            target: actionInfo.target!,
            type: action,
          },
          reducer: transition.reducer,
        }

        frame.trace.push(selectedStep)

        const _draftChange = {
          action: selectedStep.action,
          context: frame.context,
          state: frame.state,
        } as unknown as Change

        notifySubscribers(frame.subscriptions, _draftChange)

        return true
      },
      draft() {
        assertDraftOperational(frame)
        return createDraft(frame, draftHeadCursor(frame))
      },
      get state() {
        return frame.state as StateMachineDraft<Model>['state']
      },
      subscribe(subscription: StateMachineSubscription<Model>) {
        assertDraftOperational(frame)
        return subscribeDraft(frame, subscription as InternalSubscription)
      },
    }

    return draft
  }

  const instance: StateMachineService<Model> = {
    get context() {
      return context as StateMachineService<Model>['context']
    },
    // @ts-expect-error runtime hot path keeps direct payload parameter shape
    do(action, payload) {
      const indexAction = indiceActions.get(action)

      if (indexAction === undefined) {
        throw new StateMachineError({ identifier: action, type: 'ActionUnknown' })
      }

      const transitions = transitionMap.get(szudzik(indexState, indexAction))

      if (transitions === undefined) {
        return false
      }

      // Reuse pre-allocated action object
      _action.payload = payload
      _action.type = action

      let transition: $.Values<typeof transitions> | undefined

      candidateLoop: for (let i = 0; i < transitions.length; i++) {
        const candidate = transitions[i]

        _action.source = candidate.source
        _action.target = candidate.target

        const predicates = candidate.predicates

        // Optimized predicate evaluation with for-loop
        for (let j = 0; j < predicates.length; j++) {
          if (!predicates[j](context, _action)) {
            continue candidateLoop
          }
        }

        transition = candidate
        break
      }

      if (transition === undefined) {
        return false
      }

      const nextState = transition.target

      if (transition.reducer !== undefined) {
        context = transition.reducer(context, _action)
      }

      state = nextState
      indexState = indiceStates.get(state)!

      // Inject state discriminant after transition
      if (needsStateInjection) {
        ;(context as Record<string, unknown>).state = state
      }

      commitCursor += 1

      // Early exit if no subscriptions to avoid object updates
      _change.action = _action as (typeof _change)['action']
      _change.context = context as (typeof _change)['context']
      _change.state = state as (typeof _change)['state']
      for (let i = 0; i < subscriptions.length; i++) {
        ;(subscriptions[i] as (change: unknown) => void)(_change)
      }

      return true
    },
    draft() {
      return createDraft(undefined, commitCursor)
    },
    get state() {
      return state as StateMachineService<Model>['state']
    },
    subscribe(subscription: StateMachineSubscription<Model>) {
      return registerSubscription(subscriptions, subscription)
    },
  }

  return instance
}
