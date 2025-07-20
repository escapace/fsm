/* eslint-disable typescript/no-empty-object-type */
/* eslint-disable typescript/no-redundant-type-constituents */
/* eslint-disable typescript/no-explicit-any */

import type $ from '@escapace/typelevel'

export const STATE_MACHINE_LOG = Symbol.for('@escapace/fsm/log')
export const STATE_MACHINE_STATE = Symbol.for('@escapace/fsm/state')

export enum StateMachineBuilderActionType {
  Context,
  Action,
  InitialState,
  State,
  Transition,
}

export type StateMachineIdentifier = number | string | symbol
export type StateMachineIdentifierAction<
  T extends StateMachineIdentifier = StateMachineIdentifier,
> = T
export type StateMachineIdentifierState<T extends StateMachineIdentifier = StateMachineIdentifier> =
  T

export interface StateMachineBuilderActionTransition<
  A = StateMachineIdentifierState,
  B = StateMachineIdentifierAction,
  C = StateMachineIdentifierState,
> {
  payload: {
    action: B
    predicates: Array<(...arguments_: any[]) => boolean>
    reducer: ((...arguments_: any[]) => unknown) | undefined
    source: A
    target: C
  }
  type: StateMachineBuilderActionType.Transition
}

export interface StateMachineBuilderActionContext<T = unknown> {
  payload: {
    context: (() => T) | T
  }
  type: StateMachineBuilderActionType.Context
}

export interface StateMachineBuilderActionState<
  T extends StateMachineIdentifierState = StateMachineIdentifierState,
> {
  payload: {
    state: T
  }
  type: StateMachineBuilderActionType.State
}

export interface StateMachineBuilderActionAction<
  T extends StateMachineIdentifierAction = StateMachineIdentifierAction,
  _ = unknown,
> {
  payload: {
    action: T
  }
  type: StateMachineBuilderActionType.Action
}

export interface StateMachineBuilderActionInitialState<
  T extends StateMachineIdentifierState = StateMachineIdentifierState,
> {
  payload: T
  type: StateMachineBuilderActionType.InitialState
}

export type StateMachineBuilderAction =
  | StateMachineBuilderActionAction
  | StateMachineBuilderActionContext
  | StateMachineBuilderActionInitialState
  | StateMachineBuilderActionState
  | StateMachineBuilderActionTransition

export interface StateMachineBuilderState {
  actions: StateMachineIdentifierAction[]
  context: (() => unknown) | unknown
  indiceActions: Map<StateMachineIdentifierAction, number>
  indiceStates: Map<StateMachineIdentifierState, number>
  states: StateMachineIdentifierState[]
  transitions: Map<number, Array<StateMachineBuilderActionTransition['payload']>>
  initial?: StateMachineIdentifierState
}

export interface StateMachineBuilderInitialState {
  actions: []
  context: (() => unknown) | unknown
  indiceActions: Map<StateMachineIdentifierAction, number>
  indiceStates: Map<StateMachineIdentifierState, number>
  initial: undefined
  states: []
  transitions: Map<number, Array<StateMachineBuilderActionTransition['payload']>>
}

export interface StateMachineBuilderModel<
  T extends StateMachineBuilderAction[] = any[],
  U extends StateMachineBuilderState = StateMachineBuilderState,
> {
  log: T
  state: U
}

export type StateMachineBuilder<T, K extends number | string | symbol> = {
  [P in Extract<keyof T, K>]: T[P]
}

export type StateMachineBuilderActionPayload<T extends StateMachineBuilderAction> = T['payload']

export type StateMachineBuilderReducer<
  T extends StateMachineBuilderState,
  U extends StateMachineBuilderAction,
> = $.Cast<
  $.Assign<
    T,
    {
      [StateMachineBuilderActionType.Action]: {
        actions: $.Cons<
          $.Cast<
            StateMachineBuilderActionPayload<U>,
            StateMachineBuilderActionAction['payload']
          >['action'],
          T['actions']
        >
      }
      [StateMachineBuilderActionType.Context]: {
        context: U extends StateMachineBuilderActionContext<infer X> ? X : never
      }
      [StateMachineBuilderActionType.InitialState]: {
        initial: StateMachineBuilderActionPayload<U>
      }
      [StateMachineBuilderActionType.State]: {
        states: $.Cons<
          $.Cast<
            StateMachineBuilderActionPayload<U>,
            StateMachineBuilderActionState['payload']
          >['state'],
          T['states']
        >
      }
      [StateMachineBuilderActionType.Transition]: {}
    }[$.Cast<U['type'], StateMachineBuilderActionType>]
  >,
  StateMachineBuilderState
>

export type StateMachineBuilderStage<
  T extends StateMachineBuilderModel = { log: []; state: StateMachineBuilderInitialState },
  U extends StateMachineBuilderAction = never,
> = StateMachine<
  $.If<
    $.Is.Never<U>,
    T,
    StateMachineBuilderModel<$.Cons<U, T['log']>, StateMachineBuilderReducer<T['state'], U>>
  >
>

export type StateMachineActions<T extends StateMachineBuilderModel> = $.Values<
  T['state']['actions']
>
export type StateMachineStates<T extends StateMachineBuilderModel> = $.Values<T['state']['states']>

export type StateMachineActionPayload<
  T extends StateMachineBuilderModel,
  U extends StateMachineActions<T>,
> =
  Extract<
    $.Values<T['log']>,
    StateMachineBuilderActionAction<U, any>
  > extends StateMachineBuilderActionAction<U, infer E>
    ? E
    : never

export interface StateMachineChange<T extends StateMachineBuilderModel = StateMachineBuilderModel> {
  action: T['log'] extends ArrayLike<infer U1>
    ? U1 extends { payload: infer U2; type: StateMachineBuilderActionType.Transition }
      ? U2 extends { action: infer B; source: infer A; target: infer C }
        ? StateMachineAction<
            T,
            $.Cast<A, StateMachineStates<T>>,
            $.Cast<B, StateMachineActions<T>>,
            $.Cast<C, StateMachineStates<T>>
          >
        : never
      : never
    : never
  context: Readonly<T['state']['context']>
  state: StateMachineStates<T>
}

export type StateMachineSubscription<
  T extends StateMachineBuilderModel = StateMachineBuilderModel,
> = (change: StateMachineChange<T>) => void

export interface StateMachineService<
  T extends StateMachineBuilderModel = StateMachineBuilderModel,
> {
  readonly context: T['state']['context']
  do: <A extends StateMachineActions<T>, B extends StateMachineActionPayload<T, A>>(
    action: A,
    ...input: $.If<$.Is.Never<B>, [], [B]>
  ) => boolean
  readonly state: StateMachineStates<T>
  subscribe: (subscription: StateMachineSubscription<T>) => () => void
  // check: <A extends Event<T>>(event: A) => boolean
  // reset(): void
}

export type InferStateMachineModel<T extends StateMachineInterface> =
  T extends StateMachineInterface<StateMachineBuilderModel<infer A, infer B>>
    ? StateMachineBuilderModel<A, B>
    : never

export type InferStateMachineService<T extends StateMachineInterface> = StateMachineService<
  InferStateMachineModel<T>
>

// type ReadonlyStateMachineService<T extends StateMachineService> = Readonly<
//   Fluent<T, 'context' | 'state'>
// >

export interface StateMachineAction<
  T extends StateMachineBuilderModel = StateMachineBuilderModel,
  A extends StateMachineStates<T> = StateMachineStates<T>,
  B extends StateMachineActions<T> = StateMachineActions<T>,
  C extends StateMachineStates<T> = StateMachineStates<T>,
> {
  payload: StateMachineActionPayload<T, B>
  source: A
  target: C
  type: B
}

export type StateMachinePredicate<
  T extends StateMachineBuilderModel,
  A extends StateMachineStates<T> = StateMachineStates<T>,
  B extends StateMachineActions<T> = StateMachineActions<T>,
  C extends StateMachineStates<T> = StateMachineStates<T>,
> = (context: Readonly<T['state']['context']>, action: StateMachineAction<T, A, B, C>) => boolean

export type StateMachineReducer<
  T extends StateMachineBuilderModel,
  A extends StateMachineStates<T> = StateMachineStates<T>,
  B extends StateMachineActions<T> = StateMachineActions<T>,
  C extends StateMachineStates<T> = StateMachineStates<T>,
> = (
  context: T['state']['context'],
  action: StateMachineAction<T, A, B, C>,
) => T['state']['context']

export interface StateMachineInterface<
  T extends StateMachineBuilderModel = StateMachineBuilderModel,
> {
  [STATE_MACHINE_LOG]: T['log']
  [STATE_MACHINE_STATE]: T['state']
}

export interface StateMachine<T extends StateMachineBuilderModel> extends StateMachineInterface<T> {
  action: <U extends StateMachineIdentifierAction, C = never>(
    action: Exclude<U, StateMachineActions<T>>,
    // ...context: $.If<$.Is.Never<C>, never, [C | (() => C)]>
  ) => StateMachineBuilder<
    StateMachineBuilderStage<T, StateMachineBuilderActionAction<U, C>>,
    'action' | 'context' | 'transition'
  >
  context: <U = never>(
    context: (() => U) | U,
  ) => StateMachineBuilder<
    StateMachineBuilderStage<T, StateMachineBuilderActionContext<U>>,
    'transition'
  >
  initial: <U extends StateMachineStates<T>>(
    states: U,
  ) => StateMachineBuilder<
    StateMachineBuilderStage<T, StateMachineBuilderActionInitialState<U>>,
    'action'
  >
  state: <U extends StateMachineIdentifierState>(
    state: Exclude<U, StateMachineStates<T>>,
  ) => StateMachineBuilder<
    StateMachineBuilderStage<T, StateMachineBuilderActionState<U>>,
    'initial' | 'state'
  >
  transition: <
    A extends StateMachineStates<T>,
    B extends StateMachineActions<T>,
    C extends StateMachineStates<T>,
  >(
    source: A | A[],
    action: B | [B, ...Array<StateMachinePredicate<T, A, B, C>>],
    target: C | C[],
    reducer?: StateMachineReducer<T, A, B, C>,
  ) => StateMachineBuilder<
    StateMachineBuilderStage<T, StateMachineBuilderActionTransition<A, B, C>>,
    'transition' | typeof STATE_MACHINE_LOG | typeof STATE_MACHINE_STATE
  >
}
