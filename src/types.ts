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
  Compose,
}

export type StateMachineIdentifier = number | string | symbol
export type StateMachineIdentifierAction<
  T extends StateMachineIdentifier = StateMachineIdentifier,
> = T
export type StateMachineIdentifierState<T extends StateMachineIdentifier = StateMachineIdentifier> =
  T

export interface StateMachineBuilderActionBase<
  TType extends StateMachineBuilderActionType,
  TPayload,
> {
  payload: TPayload
  type: TType
}

export type StateMachineBuilderActionTransition<
  A = StateMachineIdentifierState,
  B = StateMachineIdentifierAction,
  C = StateMachineIdentifierState,
> = StateMachineBuilderActionBase<
  StateMachineBuilderActionType.Transition,
  {
    action: B
    predicates: Array<(...arguments_: any[]) => boolean>
    reducer: ((...arguments_: any[]) => unknown) | undefined
    source: A
    target: C
  }
>

export type StateMachineBuilderActionContext<T = unknown> = StateMachineBuilderActionBase<
  StateMachineBuilderActionType.Context,
  { context: (() => T) | T }
>

export type StateMachineBuilderActionState<
  T extends StateMachineIdentifierState = StateMachineIdentifierState,
> = StateMachineBuilderActionBase<StateMachineBuilderActionType.State, { state: T }>

export type StateMachineBuilderActionAction<
  T extends StateMachineIdentifierAction = StateMachineIdentifierAction,
  _ = unknown,
> = StateMachineBuilderActionBase<StateMachineBuilderActionType.Action, { action: T }>

export type StateMachineBuilderActionInitialState<
  T extends StateMachineIdentifierState = StateMachineIdentifierState,
> = StateMachineBuilderActionBase<StateMachineBuilderActionType.InitialState, T>

export type StateMachineBuilderActionCompose<
  G extends StateMachineIdentifierState = StateMachineIdentifierState,
  M extends StateMachineInterface = StateMachineInterface,
> = StateMachineBuilderActionBase<StateMachineBuilderActionType.Compose, { group: G; machine: M }>

export type StateMachineBuilderAction =
  | StateMachineBuilderActionAction
  | StateMachineBuilderActionCompose
  | StateMachineBuilderActionContext
  | StateMachineBuilderActionInitialState
  | StateMachineBuilderActionState
  | StateMachineBuilderActionTransition

export interface StateMachineBuilderState {
  actions: StateMachineIdentifierAction[]
  compositions: Map<StateMachineIdentifierState, StateMachineInterface>
  context: (() => unknown) | unknown
  indiceActions: Map<StateMachineIdentifierAction, number>
  indiceStates: Map<StateMachineIdentifierState, number>
  states: StateMachineIdentifierState[]
  transitions: Map<number, Array<StateMachineBuilderActionTransition['payload']>>
  initial?: StateMachineIdentifierState
}

export interface StateMachineBuilderInitialState extends StateMachineBuilderState {
  actions: []
  initial: undefined
  states: []
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

export type StateMachineBaseContext<T> = T extends undefined ? {} : T extends object ? T : {}

export type StateMachineCompoundContext<
  ParentContext,
  Group extends StateMachineIdentifierState,
  ChildContext,
> = $.Prettify<{ [K in Group]: ChildContext } & StateMachineBaseContext<ParentContext>>

// Preserve composed child slices when `.context(...)` replaces the parent-own context.
// New own keys override existing keys; all other existing keys are retained.
export type StateMachineChildModelOf<M extends StateMachineInterface> = InferStateMachineModel<M>
export type StateMachineChildStateOf<M extends StateMachineInterface> =
  StateMachineChildModelOf<M>['state']

export type StateMachineComposeEntries<P extends StateMachineBuilderModel> = Extract<
  $.Values<P['log']>,
  StateMachineBuilderActionCompose<any, any>
>

export type StateMachineExistingGroups<P extends StateMachineBuilderModel> =
  StateMachineComposeEntries<P> extends infer U
    ? U extends StateMachineBuilderActionCompose<infer G>
      ? G
      : never
    : never

export type StateMachineActionPayloadMapFromState<S> = S extends { __actionPayloads: infer M }
  ? $.Cast<M, Record<StateMachineIdentifierAction, unknown>>
  : {}

export type StateMachineOverlappingActions<
  P extends StateMachineBuilderModel,
  M extends StateMachineInterface,
> = Extract<StateMachineActions<P>, StateMachineActions<StateMachineChildModelOf<M>>>

export type StateMachineIncompatibleOverlappingActions<
  P extends StateMachineBuilderModel,
  M extends StateMachineInterface,
> = {
  [K in StateMachineOverlappingActions<P, M>]: [StateMachineActionPayload<P, K>] extends [
    StateMachineActionPayload<StateMachineChildModelOf<M>, K>,
  ]
    ? [StateMachineActionPayload<StateMachineChildModelOf<M>, K>] extends [
        StateMachineActionPayload<P, K>,
      ]
      ? never
      : K
    : K
}[StateMachineOverlappingActions<P, M>]

export type StateMachineComposePrecondition<
  P extends StateMachineBuilderModel,
  G extends StateMachineIdentifierState,
  M extends StateMachineInterface,
> = G extends StateMachineExistingGroups<P> | StateMachineStates<P>
  ? never
  : [Extract<StateMachineStates<P>, StateMachineStates<StateMachineChildModelOf<M>>>] extends [
        never,
      ]
    ? [StateMachineIncompatibleOverlappingActions<P, M>] extends [never]
      ? unknown
      : never
    : never

export type StateMachineBuilderReducer<
  T extends StateMachineBuilderState,
  U extends StateMachineBuilderAction,
> = $.Cast<
  $.Assign<
    T,
    {
      [StateMachineBuilderActionType.Action]: U extends StateMachineBuilderActionAction<
        infer A,
        infer C
      >
        ? {
            __actionPayloads: $.Prettify<
              $.Assign<StateMachineActionPayloadMapFromState<T>, { [K in A]: C }>
            >
            actions: $.Cons<A, T['actions']>
          }
        : never
      [StateMachineBuilderActionType.Compose]: U extends StateMachineBuilderActionCompose<
        infer G,
        infer M
      >
        ? {
            __actionPayloads: $.Prettify<
              $.Assign<
                StateMachineActionPayloadMapFromState<T>,
                StateMachineActionPayloadMapFromState<StateMachineChildStateOf<M>>
              >
            >
            actions: $.Concat<T['actions'], StateMachineChildStateOf<M>['actions']>
            context: StateMachineCompoundContext<
              T['context'],
              G,
              StateMachineChildStateOf<M>['context']
            >
            states: $.Concat<T['states'], StateMachineChildStateOf<M>['states']>
          }
        : never
      [StateMachineBuilderActionType.Context]: {
        context: U extends StateMachineBuilderActionContext<infer X>
          ? T['context'] extends object
            ? $.Prettify<Pick<T['context'], Exclude<keyof T['context'], keyof X>> & X>
            : X
          : never
      }
      [StateMachineBuilderActionType.InitialState]: U extends StateMachineBuilderActionInitialState<
        infer S
      >
        ? { initial: S }
        : never
      [StateMachineBuilderActionType.State]: U extends StateMachineBuilderActionState<infer S>
        ? { states: $.Cons<S, T['states']> }
        : never
      [StateMachineBuilderActionType.Transition]: {}
    }[$.Cast<U['type'], StateMachineBuilderActionType>]
  >,
  { __actionPayloads?: Record<StateMachineIdentifierAction, unknown> } & StateMachineBuilderState
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
export type StateMachineGroups<T extends StateMachineBuilderModel> = StateMachineExistingGroups<T>
export type StateMachineStates<T extends StateMachineBuilderModel> = $.Values<T['state']['states']>

export type StateMachineActionPayload<
  T extends StateMachineBuilderModel,
  U extends StateMachineActions<T>,
> = U extends keyof StateMachineActionPayloadMapFromState<T['state']>
  ? StateMachineActionPayloadMapFromState<T['state']>[U]
  : never

export type StateMachineOwnTransitionPayloads<T extends StateMachineBuilderModel> =
  Extract<$.Values<T['log']>, StateMachineBuilderActionTransition<any, any, any>> extends infer E
    ? E extends StateMachineBuilderActionTransition<infer A, infer B, infer C>
      ? {
          action: B
          source: A
          target: C extends StateMachineExistingGroups<T>
            ? StateMachineComposeEntries<T> extends StateMachineBuilderActionCompose<C, infer M>
              ? StateMachineChildStateOf<M>['initial']
              : never
            : C
        }
      : never
    : never

export type StateMachineComposedTransitionPayloads<T extends StateMachineBuilderModel> = [
  StateMachineComposeEntries<T>,
] extends [never]
  ? never
  : StateMachineComposeEntries<T> extends StateMachineBuilderActionCompose<any, infer M>
    ? StateMachineTransitionPayloads<StateMachineChildModelOf<M>>
    : never

export type StateMachineTransitionPayloads<T extends StateMachineBuilderModel> =
  | StateMachineComposedTransitionPayloads<T>
  | StateMachineOwnTransitionPayloads<T>

export interface StateMachineChange<T extends StateMachineBuilderModel = StateMachineBuilderModel> {
  action: StateMachineTransitionPayloads<T> extends infer U1
    ? U1 extends { action: infer B; source: infer A; target: infer C }
      ? StateMachineAction<
          T,
          $.Cast<A, StateMachineStates<T>>,
          $.Cast<B, StateMachineActions<T>>,
          $.Cast<C, StateMachineStates<T>>
        >
      : never
    : never
  context: Readonly<T['state']['context']>
  state: StateMachineStates<T>
}

export type StateMachineSubscription<
  T extends StateMachineBuilderModel = StateMachineBuilderModel,
> = (change: Readonly<StateMachineChange<T>>) => void

export interface StateMachineService<
  T extends StateMachineBuilderModel = StateMachineBuilderModel,
> {
  readonly context: T['state']['context']
  readonly state: StateMachineStates<T>
  do: <A extends StateMachineActions<T>, B extends StateMachineActionPayload<T, A>>(
    action: A,
    ...input: $.If<$.Is.Never<B>, [], [B]>
  ) => boolean
  subscribe: (subscription: StateMachineSubscription<T>) => () => void
}

export type InferStateMachineModel<T extends StateMachineInterface> =
  T extends StateMachineInterface<StateMachineBuilderModel<infer A, infer B>>
    ? StateMachineBuilderModel<A, B>
    : never

export type InferStateMachineService<T extends StateMachineInterface> = StateMachineService<
  InferStateMachineModel<T>
>

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
  ) => StateMachineBuilder<
    StateMachineBuilderStage<T, StateMachineBuilderActionAction<U, C>>,
    'action' | 'compose' | 'context' | 'transition'
  >
  compose: <G extends StateMachineIdentifierState, M extends StateMachineInterface>(
    group: ([StateMachineComposePrecondition<T, G, M>] extends [never] ? never : unknown) & G,
    machine: M,
  ) => StateMachineBuilder<
    StateMachineBuilderStage<T, StateMachineBuilderActionCompose<G, M>>,
    'action' | 'compose' | 'context' | 'initial' | 'state' | 'transition'
  >
  context: <U = never>(
    context: (() => U) | U,
  ) => StateMachineBuilder<
    StateMachineBuilderStage<T, StateMachineBuilderActionContext<U>>,
    'compose' | 'transition'
  >
  initial: <U extends StateMachineStates<T>>(
    states: U,
  ) => StateMachineBuilder<
    StateMachineBuilderStage<T, StateMachineBuilderActionInitialState<U>>,
    'action' | 'compose'
  >
  state: <U extends StateMachineIdentifierState>(
    state: Exclude<U, StateMachineStates<T>>,
  ) => StateMachineBuilder<
    StateMachineBuilderStage<T, StateMachineBuilderActionState<U>>,
    'compose' | 'initial' | 'state'
  >
  transition: <
    A extends StateMachineStates<T>,
    B extends StateMachineActions<T>,
    C extends StateMachineStates<T>,
  >(
    source: A | A[],
    action: B | [B, ...Array<StateMachinePredicate<T, A, B, C>>],
    target: Array<C | StateMachineGroups<T>> | (C | StateMachineGroups<T>),
    reducer?: StateMachineReducer<T, A, B, C>,
  ) => StateMachineBuilder<
    StateMachineBuilderStage<T, StateMachineBuilderActionTransition<A, B, C>>,
    'compose' | 'transition' | typeof STATE_MACHINE_LOG | typeof STATE_MACHINE_STATE
  >
}
