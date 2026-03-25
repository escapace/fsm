/* eslint-disable typescript/no-empty-object-type */
/* eslint-disable typescript/no-redundant-type-constituents */
/* eslint-disable typescript/no-explicit-any */

import type $ from '@escapace/typelevel'

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
  { context: () => T }
>

export type StateMachineBuilderActionState<
  T extends StateMachineIdentifierState = StateMachineIdentifierState,
> = StateMachineBuilderActionBase<StateMachineBuilderActionType.State, { state: T }>

export type StateMachineBuilderActionDeclareAction<
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
  | StateMachineBuilderActionCompose
  | StateMachineBuilderActionContext
  | StateMachineBuilderActionDeclareAction
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
  __compositions?: Array<{ group: StateMachineIdentifierState; machine: StateMachineInterface }>
  __transitions?: Array<{
    action: StateMachineIdentifierAction
    source: StateMachineIdentifierState
    target: StateMachineIdentifierState
  }>
  initial?: StateMachineIdentifierState
}

export interface StateMachineBuilderInitialState extends StateMachineBuilderState {
  actions: []
  initial: undefined
  states: []
}

export interface StateMachineBuilderModel<
  U extends StateMachineBuilderState = StateMachineBuilderState,
> {
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

export type StateMachineContextGroupConflicts<P extends StateMachineBuilderModel, U> = Extract<
  keyof StateMachineBaseContext<U>,
  StateMachineGroups<P>
>

type StateMachineCompositionsAtState<T> = T extends {
  __compositions: infer C extends Array<{
    group: StateMachineIdentifierState
    machine: StateMachineInterface
  }>
}
  ? $.Values<C>
  : never

export type StateMachineGroups<P extends StateMachineBuilderModel> =
  StateMachineCompositionsAtState<P['state']> extends infer U
    ? U extends { group: infer G }
      ? G
      : never
    : never

export type StateMachineActionPayloadsAtState<S> = S extends { __actionPayloads: infer M }
  ? $.Cast<M, Record<StateMachineIdentifierAction, unknown>>
  : {}

export type StateMachineComposedChildActions<P extends StateMachineBuilderModel> =
  StateMachineCompositionsAtState<P['state']> extends infer U
    ? U extends { machine: infer M extends StateMachineInterface }
      ? StateMachineActions<InferStateMachineModel<M>>
      : never
    : never

// Actions declared by the parent (not introduced by previously composed children)
// that share a name with an action in the new child.
export type StateMachineComposeSharedActions<
  P extends StateMachineBuilderModel,
  M extends StateMachineInterface,
> = Exclude<
  Extract<StateMachineActions<P>, StateMachineActions<InferStateMachineModel<M>>>,
  StateMachineComposedChildActions<P>
>

// Among parent/child overlapping actions, find those with incompatible payload types.
export type StateMachineComposePayloadConflict<
  P extends StateMachineBuilderModel,
  M extends StateMachineInterface,
> = {
  [K in StateMachineComposeSharedActions<P, M>]: [StateMachineActionPayload<P, K>] extends [
    StateMachineActionPayload<InferStateMachineModel<M>, K>,
  ]
    ? [StateMachineActionPayload<InferStateMachineModel<M>, K>] extends [
        StateMachineActionPayload<P, K>,
      ]
      ? never
      : K
    : K
}[StateMachineComposeSharedActions<P, M>]

export type StateMachineComposePrecondition<
  P extends StateMachineBuilderModel,
  G extends StateMachineIdentifierState,
  M extends StateMachineInterface,
> = G extends StateMachineGroups<P> | StateMachineStates<P>
  ? never
  : [G extends keyof StateMachineBaseContext<P['state']['context']> ? G : never] extends [never]
    ? [Extract<StateMachineStates<P>, StateMachineStates<InferStateMachineModel<M>>>] extends [
        never,
      ]
      ? // Reject if child actions overlap any previously composed sibling's actions
        [
          Extract<
            StateMachineComposedChildActions<P>,
            StateMachineActions<InferStateMachineModel<M>>
          >,
        ] extends [never]
        ? // Reject if parent/child overlapping actions have incompatible payloads
          [StateMachineComposePayloadConflict<P, M>] extends [never]
          ? unknown
          : never
        : never
      : never
    : never

export type StateMachineBuilderReducer<
  T extends StateMachineBuilderState,
  U extends StateMachineBuilderAction,
> = $.Cast<
  $.Assign<
    T,
    {
      [StateMachineBuilderActionType.Action]: U extends StateMachineBuilderActionDeclareAction<
        infer A,
        infer C
      >
        ? {
            __actionPayloads: $.Assign<StateMachineActionPayloadsAtState<T>, { [K in A]: C }>
            actions: $.Cons<A, T['actions']>
          }
        : never
      [StateMachineBuilderActionType.Compose]: U extends StateMachineBuilderActionCompose<
        infer G,
        infer M
      >
        ? {
            __actionPayloads: $.Assign<
              StateMachineActionPayloadsAtState<T>,
              StateMachineActionPayloadsAtState<InferStateMachineModel<M>['state']>
            >
            __compositions: $.Cons<
              { group: G; machine: M },
              T extends { __compositions: infer C extends any[] } ? C : []
            >
            actions: $.Concat<T['actions'], InferStateMachineModel<M>['state']['actions']>
            context: StateMachineCompoundContext<
              T['context'],
              G,
              InferStateMachineModel<M>['state']['context']
            >
            states: $.Concat<T['states'], InferStateMachineModel<M>['state']['states']>
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
      [StateMachineBuilderActionType.Transition]: U extends StateMachineBuilderActionTransition<
        infer A,
        infer B,
        infer C
      >
        ? {
            __transitions: $.Cons<
              { action: B; source: A; target: C },
              T extends { __transitions: infer Tr extends any[] } ? Tr : []
            >
          }
        : never
    }[$.Cast<U['type'], StateMachineBuilderActionType>]
  >,
  {
    __actionPayloads?: Record<StateMachineIdentifierAction, unknown>
    __compositions?: Array<{ group: StateMachineIdentifierState; machine: StateMachineInterface }>
    __transitions?: Array<{
      action: StateMachineIdentifierAction
      source: StateMachineIdentifierState
      target: StateMachineIdentifierState
    }>
  } & StateMachineBuilderState
>

export type StateMachineBuilderStage<
  T extends StateMachineBuilderModel = { state: StateMachineBuilderInitialState },
  U extends StateMachineBuilderAction = never,
> = StateMachine<
  $.If<$.Is.Never<U>, T, StateMachineBuilderModel<StateMachineBuilderReducer<T['state'], U>>>
>

export type StateMachineActions<T extends StateMachineBuilderModel> = $.Values<
  T['state']['actions']
>
export type StateMachineStates<T extends StateMachineBuilderModel> = $.Values<T['state']['states']>

export type StateMachineActionPayload<
  T extends StateMachineBuilderModel,
  U extends StateMachineActions<T>,
> =
  StateMachineActionPayloadsAtState<T['state']> extends infer AP
    ? U extends keyof AP
      ? AP[U]
      : never
    : never

type StateMachineTransitionsAtState<T> = T extends {
  __transitions: infer Tr extends Array<{
    action: StateMachineIdentifierAction
    source: StateMachineIdentifierState
    target: StateMachineIdentifierState
  }>
}
  ? $.Values<Tr>
  : never

export type StateMachineTransitionPayloads<T extends StateMachineBuilderModel> =
  | (StateMachineCompositionsAtState<T['state']> extends infer E
      ? [E] extends [never]
        ? never
        : E extends { machine: infer M extends StateMachineInterface }
          ? StateMachineTransitionPayloads<InferStateMachineModel<M>>
          : never
      : never)
  | StateMachineTransitionsAtState<T['state']>

export interface StateMachineChangeByTransition<
  T extends StateMachineBuilderModel,
  A extends StateMachineStates<T>,
  B extends StateMachineActions<T>,
  C extends StateMachineStates<T>,
> {
  action: StateMachineAction<T, A, B, C>
  context: Readonly<StateMachineContextAtState<T['state']['context'], C>>
  state: C
}

export type StateMachineChangeEntries<T extends StateMachineBuilderModel> =
  StateMachineTransitionPayloads<T> extends infer U1
    ? U1 extends { action: infer B; source: infer A; target: infer C }
      ? StateMachineChangeByTransition<
          T,
          $.Cast<A, StateMachineStates<T>>,
          $.Cast<B, StateMachineActions<T>>,
          $.Cast<C, StateMachineStates<T>>
        >
      : never
    : never

export type StateMachineChange<T extends StateMachineBuilderModel = StateMachineBuilderModel> = [
  StateMachineChangeEntries<T>,
] extends [never]
  ? {
      action: StateMachineAction<T>
      context: Readonly<T['state']['context']>
      state: StateMachineStates<T>
    }
  : StateMachineChangeEntries<T>

export type StateMachineSubscription<
  T extends StateMachineBuilderModel = StateMachineBuilderModel,
> = (change: Readonly<StateMachineChange<T>>) => void

export type StateMachineDo<T extends StateMachineBuilderModel = StateMachineBuilderModel> = <
  A extends StateMachineActions<T>,
>(
  action: A,
  ...input: $.If<
    $.Is.Never<StateMachineActionPayload<T, NoInfer<A>>>,
    [],
    [StateMachineActionPayload<T, NoInfer<A>>]
  >
) => boolean

export interface StateMachineReadable<
  T extends StateMachineBuilderModel = StateMachineBuilderModel,
> {
  readonly context: T['state']['context']
  readonly state: StateMachineStates<T>
}

export type StateMachineDraftStatus = 'closed' | 'open' | 'stale'

export interface StateMachineDraft<
  T extends StateMachineBuilderModel = StateMachineBuilderModel,
> extends StateMachineReadable<T> {
  do: StateMachineDo<T>
  commit: () => void
  discard: () => void
  draft: () => StateMachineDraft<T>
  status: () => StateMachineDraftStatus
  subscribe: (subscription: StateMachineSubscription<T>) => () => void
}

export interface StateMachineService<
  T extends StateMachineBuilderModel = StateMachineBuilderModel,
> extends StateMachineReadable<T> {
  do: StateMachineDo<T>
  draft: () => StateMachineDraft<T>
  subscribe: (subscription: StateMachineSubscription<T>) => () => void
}

export type InferStateMachineModel<T extends StateMachineInterface> =
  T extends StateMachineInterface<StateMachineBuilderModel<infer U>>
    ? StateMachineBuilderModel<U>
    : never

export type InferStateMachineService<T extends StateMachineInterface> = StateMachineService<
  InferStateMachineModel<T>
>

export interface StateMachineInterpretHydration<
  T extends StateMachineInterface = StateMachineInterface,
> {
  context: InferStateMachineModel<T>['state']['context']
  state: StateMachineStates<InferStateMachineModel<T>>
}

export interface StateMachineInterpretOptions<
  T extends StateMachineInterface = StateMachineInterface,
> {
  hydrate?: StateMachineInterpretHydration<T>
}

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

export type StateMachineContextAtState<Context, State> =
  Extract<Context, { state: State }> extends infer E ? ([E] extends [never] ? Context : E) : never

export type StateMachinePredicate<
  T extends StateMachineBuilderModel,
  A extends StateMachineStates<T> = StateMachineStates<T>,
  B extends StateMachineActions<T> = StateMachineActions<T>,
  C extends StateMachineStates<T> = StateMachineStates<T>,
> = (
  context: Readonly<StateMachineContextAtState<T['state']['context'], A>>,
  action: StateMachineAction<T, A, B, C>,
) => boolean

export type StateMachineReducer<
  T extends StateMachineBuilderModel,
  A extends StateMachineStates<T> = StateMachineStates<T>,
  B extends StateMachineActions<T> = StateMachineActions<T>,
  C extends StateMachineStates<T> = StateMachineStates<T>,
> = (
  context: StateMachineContextAtState<T['state']['context'], A>,
  action: StateMachineAction<T, A, B, C>,
) => StateMachineContextAtState<T['state']['context'], C>

export interface StateMachineInterface<
  T extends StateMachineBuilderModel = StateMachineBuilderModel,
> {
  [STATE_MACHINE_STATE]: T['state']
}

export interface StateMachine<T extends StateMachineBuilderModel> extends StateMachineInterface<T> {
  action: <U extends StateMachineIdentifierAction, C = never>(
    action: Exclude<U, StateMachineActions<T>>,
  ) => StateMachineBuilder<
    StateMachineBuilderStage<T, StateMachineBuilderActionDeclareAction<U, C>>,
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
    context: (() => U) &
      ([StateMachineContextGroupConflicts<T, U>] extends [never] ? unknown : never),
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
    action: B | [B, ...Array<StateMachinePredicate<T, NoInfer<A>, NoInfer<B>, NoInfer<C>>>],
    target: C | C[],
    ...reducer: StateMachineContextAtState<
      T['state']['context'],
      NoInfer<A>
    > extends StateMachineContextAtState<T['state']['context'], NoInfer<C>>
      ? StateMachineContextAtState<
          T['state']['context'],
          NoInfer<C>
        > extends StateMachineContextAtState<T['state']['context'], NoInfer<A>>
        ? [reducer?: StateMachineReducer<T, NoInfer<A>, NoInfer<B>, NoInfer<C>>]
        : [reducer: StateMachineReducer<T, NoInfer<A>, NoInfer<B>, NoInfer<C>>]
      : [reducer: StateMachineReducer<T, NoInfer<A>, NoInfer<B>, NoInfer<C>>]
  ) => StateMachineBuilder<
    StateMachineBuilderStage<T, StateMachineBuilderActionTransition<A, B, C>>,
    'compose' | 'transition' | typeof STATE_MACHINE_STATE
  >
}
