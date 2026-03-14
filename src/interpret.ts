/* eslint-disable unicorn/prevent-abbreviations */
/* eslint-disable typescript/no-explicit-any */

import type $ from '@escapace/typelevel'
import { remove, szudzik } from 'coastal'
import { reconcileContext, snapshotContext } from './context-runtime'
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

interface InternalDraftFrame {
  baseCursor: number
  closed: boolean
  context: unknown
  indexState: number
  parent: InternalDraftFrame | undefined
  state: StateMachineIdentifier
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

/**
 * Creates a runnable service instance from a state machine definition.
 *
 * @param stateMachine - The state machine definition created by the `stateMachine` function
 * @returns A service that can execute actions, track state, and notify subscribers
 */
export const interpret = <T extends StateMachineInterface>(
  stateMachine: T,
): StateMachineService<InferStateMachineModel<T>> => {
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

  // eslint-disable-next-line typescript/no-unsafe-call
  let context: unknown = typeof contextFactory === 'function' ? contextFactory() : contextFactory
  let state: StateMachineIdentifier = initial!
  let indexState = indiceStates.get(state)!
  let commitCursor = 0
  const subscriptions: StateMachineSubscription[] = []

  // Pre-allocated mutable buffers for action/change dispatch — loosely typed
  // to avoid deep generic resolution on every assignment.
  const _action: InternalActionBuffer = {
    payload: undefined,
    source: undefined,
    target: undefined,
    type: undefined,
  }

  type Change = StateMachineChange<InferStateMachineModel<T>>
  const _change = {
    action: undefined,
    context: undefined,
    state: undefined,
  } as unknown as Change

  const createDraft = (
    parent: InternalDraftFrame | undefined,
    baseCursor: number,
  ): StateMachineDraft => {
    const frame: InternalDraftFrame = {
      baseCursor,
      closed: false,
      context: snapshotContext(parent === undefined ? context : parent.context),
      indexState: parent === undefined ? indexState : parent.indexState,
      parent,
      state: parent === undefined ? state : parent.state,
      trace: [],
    }

    const draft: StateMachineDraft = {
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
            frame.closed = true
            return
          }

          for (let i = 0; i < frame.trace.length; i++) {
            const step = frame.trace[i]

            state = step.action.target
            indexState = indiceStates.get(state)!

            if (step.reducer !== undefined) {
              context = reconcileContext(context, step.reducer(context, step.action))
            }

            commitCursor += 1

            _change.action = step.action as (typeof _change)['action']
            _change.context = context as (typeof _change)['context']
            _change.state = state as (typeof _change)['state']

            for (let j = 0; j < subscriptions.length; j++) {
              ;(subscriptions[j] as (change: unknown) => void)(_change)
            }
          }

          frame.closed = true
          return
        }

        const parentHead = draftHeadCursor(frame.parent)

        if (parentHead !== frame.baseCursor) {
          throw new StateMachineError({
            actualCursor: parentHead,
            expectedCursor: frame.baseCursor,
            type: 'DraftOutOfDate',
          })
        }

        if (frame.trace.length === 0) {
          frame.closed = true
          return
        }

        frame.parent.trace.push(...frame.trace)
        frame.parent.state = frame.state
        frame.parent.indexState = frame.indexState
        frame.parent.context = reconcileContext(frame.parent.context, frame.context)

        frame.closed = true
      },
      get context() {
        return frame.context
      },
      discard() {
        assertDraftOperational(frame)
        frame.closed = true
      },
      // @ts-expect-error types
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

        frame.state = transition.target
        frame.indexState = indiceStates.get(frame.state)!

        if (transition.reducer !== undefined) {
          frame.context = transition.reducer(frame.context, actionInfo)
        }

        frame.trace.push({
          action: {
            payload,
            source: actionInfo.source!,
            target: actionInfo.target!,
            type: action,
          },
          reducer: transition.reducer,
        })

        return true
      },
      draft() {
        assertDraftOperational(frame)
        return createDraft(frame, draftHeadCursor(frame))
      },
      get state() {
        return frame.state
      },
    }

    return draft
  }

  const instance: StateMachineService = {
    get context() {
      return context
    },
    // @ts-expect-error types
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

      state = transition.target
      indexState = indiceStates.get(state)!

      if (transition.reducer !== undefined) {
        context = transition.reducer(context, _action)
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
      return state
    },
    subscribe(subscription: StateMachineSubscription) {
      if (!subscriptions.includes(subscription)) {
        subscriptions.push(subscription)
      }

      return () => {
        remove(subscriptions, (value) => value === subscription)
      }
    },
  }

  // eslint-disable-next-line typescript/no-unsafe-return
  return instance as any
}
