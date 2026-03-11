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

type BaseContext<T> = T extends undefined ? {} : T extends object ? T : {}

export type CompoundContext<
  ParentContext,
  Group extends StateMachineIdentifierState,
  ChildContext,
> = $.Prettify<{ [K in Group]: ChildContext } & BaseContext<ParentContext>>

// Given an existing context T that may contain composed child slices,
// and the compositions map, extract child-keyed properties and leave the rest.
// T['compositions'] is not available at the type level, but the composed keys
// are those added by CompoundContext. We detect them: any key of T['context']
// whose value is an object that came from a compose step.
// Simpler: we just diff T['context'] keys with a fresh empty base.
// Since compose adds keys and context replaces the base, we preserve
// all keys from T['context'] that are NOT in X (the new own context).
type PreserveComposedSlices<ExistingContext, NewOwn> = ExistingContext extends object
  ? $.Prettify<NewOwn & Pick<ExistingContext, Exclude<keyof ExistingContext, keyof NewOwn>>>
  : NewOwn

type ChildModelOf<M extends StateMachineInterface> = InferStateMachineModel<M>

type ComposeEntries<P extends StateMachineBuilderModel> = Extract<
  $.Values<P['log']>,
  StateMachineBuilderActionCompose<any, any>
>

type ChildActionsOf<M extends StateMachineInterface> = StateMachineActions<ChildModelOf<M>>
type ChildStatesOf<M extends StateMachineInterface> = StateMachineStates<ChildModelOf<M>>

type ExistingGroups<P extends StateMachineBuilderModel> =
  ComposeEntries<P> extends infer U
    ? U extends StateMachineBuilderActionCompose<infer G>
      ? G
      : never
    : never

type StateActionPayloadMap<S> = S extends { __actionPayloads: infer M }
  ? $.Cast<M, Record<StateMachineIdentifierAction, unknown>>
  : {}

type ActionPayloadMap<T extends StateMachineBuilderModel> = StateActionPayloadMap<T['state']>

type ActionPayloadLookup<
  T extends StateMachineBuilderModel,
  U extends StateMachineIdentifierAction,
> = U extends keyof ActionPayloadMap<T> ? ActionPayloadMap<T>[U] : never

type OverlappingActions<
  P extends StateMachineBuilderModel,
  M extends StateMachineInterface,
> = Extract<StateMachineActions<P>, ChildActionsOf<M>>

type IncompatibleOverlappingActions<
  P extends StateMachineBuilderModel,
  M extends StateMachineInterface,
> = {
  [K in OverlappingActions<P, M>]: [StateMachineActionPayload<P, K>] extends [
    StateMachineActionPayload<ChildModelOf<M>, K>,
  ]
    ? [StateMachineActionPayload<ChildModelOf<M>, K>] extends [StateMachineActionPayload<P, K>]
      ? never
      : K
    : K
}[OverlappingActions<P, M>]

type HasStateConflict<P extends StateMachineBuilderModel, M extends StateMachineInterface> = [
  Extract<StateMachineStates<P>, ChildStatesOf<M>>,
] extends [never]
  ? false
  : true

export type ComposePrecondition<
  P extends StateMachineBuilderModel,
  G extends StateMachineIdentifierState,
  M extends StateMachineInterface,
> = G extends ExistingGroups<P> | StateMachineStates<P>
  ? never
  : HasStateConflict<P, M> extends true
    ? never
    : [IncompatibleOverlappingActions<P, M>] extends [never]
      ? unknown
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
            __actionPayloads: $.Prettify<$.Assign<StateActionPayloadMap<T>, { [K in A]: C }>>
            actions: $.Cons<A, T['actions']>
          }
        : never
      [StateMachineBuilderActionType.Compose]: U extends StateMachineBuilderActionCompose<
        infer G,
        infer M
      >
        ? {
            __actionPayloads: $.Prettify<
              $.Assign<StateActionPayloadMap<T>, StateActionPayloadMap<ChildModelOf<M>['state']>>
            >
            actions: $.Concat<T['actions'], ChildModelOf<M>['state']['actions']>
            context: CompoundContext<T['context'], G, ChildModelOf<M>['state']['context']>
            states: $.Concat<T['states'], ChildModelOf<M>['state']['states']>
          }
        : never
      [StateMachineBuilderActionType.Context]: {
        context: U extends StateMachineBuilderActionContext<infer X>
          ? PreserveComposedSlices<T['context'], X>
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
export type StateMachineGroups<T extends StateMachineBuilderModel> = ExistingGroups<T>
export type StateMachineStates<T extends StateMachineBuilderModel> = $.Values<T['state']['states']>

export type StateMachineActionPayload<
  T extends StateMachineBuilderModel,
  U extends StateMachineActions<T>,
> = ActionPayloadLookup<T, U>

type GroupInitialState<
  T extends StateMachineBuilderModel,
  G extends StateMachineIdentifierState,
> = [ComposeEntries<T>] extends [never]
  ? never
  : ComposeEntries<T> extends StateMachineBuilderActionCompose<G, infer M>
    ? ChildModelOf<M>['state']['initial']
    : never

type ResolveTransitionTarget<T extends StateMachineBuilderModel, C> =
  C extends ExistingGroups<T> ? GroupInitialState<T, C> : C

type OwnTransitionPayloads<T extends StateMachineBuilderModel> =
  Extract<$.Values<T['log']>, StateMachineBuilderActionTransition<any, any, any>> extends infer E
    ? E extends StateMachineBuilderActionTransition<infer A, infer B, infer C>
      ? {
          action: B
          source: A
          target: ResolveTransitionTarget<T, C>
        }
      : never
    : never

type ComposedTransitionPayloads<T extends StateMachineBuilderModel> = [ComposeEntries<T>] extends [
  never,
]
  ? never
  : ComposeEntries<T> extends StateMachineBuilderActionCompose<any, infer M>
    ? TransitionPayloads<ChildModelOf<M>>
    : never

type TransitionPayloads<T extends StateMachineBuilderModel> =
  | ComposedTransitionPayloads<T>
  | OwnTransitionPayloads<T>

export interface StateMachineChange<T extends StateMachineBuilderModel = StateMachineBuilderModel> {
  action: TransitionPayloads<T> extends infer U1
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
    group: ([ComposePrecondition<T, G, M>] extends [never] ? never : unknown) & G,
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
