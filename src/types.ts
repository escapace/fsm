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

export interface StateMachineBuilderActionCompose<
  G extends StateMachineIdentifierState = StateMachineIdentifierState,
  M extends StateMachineInterface = StateMachineInterface,
> {
  payload: {
    group: G
    machine: M
  }
  type: StateMachineBuilderActionType.Compose
}

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

export interface StateMachineBuilderInitialState {
  actions: []
  compositions: Map<StateMachineIdentifierState, StateMachineInterface>
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

export type StateMachineBaseContext<T> = T extends undefined ? {} : T extends object ? T : {}

export type StateMachineCompoundContext<
  ParentContext,
  Group extends StateMachineIdentifierState,
  ChildContext,
> = $.Prettify<{ [K in Group]: ChildContext } & StateMachineBaseContext<ParentContext>>

export type CompoundContext<
  ParentContext,
  Group extends StateMachineIdentifierState,
  ChildContext,
> = StateMachineCompoundContext<ParentContext, Group, ChildContext>

// Given an existing context T that may contain composed child slices,
// and the compositions map, extract child-keyed properties and leave the rest.
// T['compositions'] is not available at the type level, but the composed keys
// are those added by StateMachineCompoundContext. We detect them: any key of T['context']
// whose value is an object that came from a compose step.
// Simpler: we just diff T['context'] keys with a fresh empty base.
// Since compose adds keys and context replaces the base, we preserve
// all keys from T['context'] that are NOT in X (the new own context).
export type StateMachinePreserveComposedSlices<ExistingContext, NewOwn> =
  ExistingContext extends object
    ? $.Prettify<NewOwn & Pick<ExistingContext, Exclude<keyof ExistingContext, keyof NewOwn>>>
    : NewOwn

export type StateMachineChildModelOf<M extends StateMachineInterface> = InferStateMachineModel<M>

export type StateMachineComposeEntries<P extends StateMachineBuilderModel> = Extract<
  $.Values<P['log']>,
  StateMachineBuilderActionCompose<any, any>
>

export type StateMachineChildActionsOf<M extends StateMachineInterface> = StateMachineActions<
  StateMachineChildModelOf<M>
>
export type StateMachineChildStatesOf<M extends StateMachineInterface> = StateMachineStates<
  StateMachineChildModelOf<M>
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

export type StateMachineActionPayloadMap<T extends StateMachineBuilderModel> =
  StateMachineActionPayloadMapFromState<T['state']>

export type StateMachineActionPayloadLookup<
  T extends StateMachineBuilderModel,
  U extends StateMachineIdentifierAction,
> = U extends keyof StateMachineActionPayloadMap<T> ? StateMachineActionPayloadMap<T>[U] : never

export type StateMachineOverlappingActions<
  P extends StateMachineBuilderModel,
  M extends StateMachineInterface,
> = Extract<StateMachineActions<P>, StateMachineChildActionsOf<M>>

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

export type StateMachineHasStateConflict<
  P extends StateMachineBuilderModel,
  M extends StateMachineInterface,
> = [Extract<StateMachineStates<P>, StateMachineChildStatesOf<M>>] extends [never] ? false : true

export type StateMachineComposePrecondition<
  P extends StateMachineBuilderModel,
  G extends StateMachineIdentifierState,
  M extends StateMachineInterface,
> = G extends StateMachineExistingGroups<P> | StateMachineStates<P>
  ? never
  : StateMachineHasStateConflict<P, M> extends true
    ? never
    : [StateMachineIncompatibleOverlappingActions<P, M>] extends [never]
      ? unknown
      : never

export type ComposePrecondition<
  P extends StateMachineBuilderModel,
  G extends StateMachineIdentifierState,
  M extends StateMachineInterface,
> = StateMachineComposePrecondition<P, G, M>

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
                StateMachineActionPayloadMapFromState<StateMachineChildModelOf<M>['state']>
              >
            >
            actions: $.Concat<T['actions'], StateMachineChildModelOf<M>['state']['actions']>
            context: StateMachineCompoundContext<
              T['context'],
              G,
              StateMachineChildModelOf<M>['state']['context']
            >
            states: $.Concat<T['states'], StateMachineChildModelOf<M>['state']['states']>
          }
        : never
      [StateMachineBuilderActionType.Context]: {
        context: U extends StateMachineBuilderActionContext<infer X>
          ? StateMachinePreserveComposedSlices<T['context'], X>
          : never
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
> = StateMachineActionPayloadLookup<T, U>

export type StateMachineGroupInitialState<
  T extends StateMachineBuilderModel,
  G extends StateMachineIdentifierState,
> = [StateMachineComposeEntries<T>] extends [never]
  ? never
  : StateMachineComposeEntries<T> extends StateMachineBuilderActionCompose<G, infer M>
    ? StateMachineChildModelOf<M>['state']['initial']
    : never

export type StateMachineResolveTransitionTarget<T extends StateMachineBuilderModel, C> =
  C extends StateMachineExistingGroups<T> ? StateMachineGroupInitialState<T, C> : C

export type StateMachineOwnTransitionPayloads<T extends StateMachineBuilderModel> =
  Extract<$.Values<T['log']>, StateMachineBuilderActionTransition<any, any, any>> extends infer E
    ? E extends StateMachineBuilderActionTransition<infer A, infer B, infer C>
      ? {
          action: B
          source: A
          target: StateMachineResolveTransitionTarget<T, C>
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
