/* eslint-disable @typescript-eslint/no-explicit-any */

import $ from '@escapace/typelevel'
import type { Subscribable, InteropObservable } from 'rxjs-interop'

export const SYMBOL_LOG = Symbol.for('ESCAPACE-FSM-LOG')
export const SYMBOL_STATE = Symbol.for('ESCAPACE-FSM-STATE')

export enum TypeAction {
  Context,
  Action,
  InitialState,
  State,
  Transition
}

export type Placeholder = number | string | symbol

export type PlaceholderState<T extends Placeholder = Placeholder> = T

export type PlaceholderAction<T extends Placeholder = Placeholder> = T

export interface ActionTransition<
  A = PlaceholderState,
  B = PlaceholderAction,
  C = PlaceholderState
> {
  type: TypeAction.Transition
  payload: {
    source: A
    action: B
    target: C
    predicates: Array<(...args: any[]) => boolean>
    reducer: undefined | ((...args: any[]) => unknown)
  }
}

export interface ActionContext<T = unknown> {
  type: TypeAction.Context
  payload: {
    context: T | (() => T)
  }
}

export interface ActionState<T extends PlaceholderState = PlaceholderState> {
  type: TypeAction.State
  payload: {
    state: T
  }
}

export interface ActionAction<
  T extends PlaceholderAction = PlaceholderAction,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _ = unknown
> {
  type: TypeAction.Action
  payload: {
    action: T
  }
}

export interface ActionInitialState<
  T extends PlaceholderState = PlaceholderState
> {
  type: TypeAction.InitialState
  payload: T
}

export type StateMachineAction =
  | ActionContext
  | ActionAction
  | ActionInitialState
  | ActionState
  | ActionTransition

export interface StateMachineState {
  initial?: PlaceholderState
  states: PlaceholderState[]
  actions: PlaceholderAction[]
  transitions: Map<number, Array<ActionTransition['payload']>>
  context: unknown | (() => unknown)
}

export interface StateMachineInitialState {
  initial: undefined
  states: []
  actions: []
  transitions: Map<number, Array<ActionTransition['payload']>>
  context: unknown | (() => unknown)
}

export interface Model<
  T extends StateMachineAction[] = any[],
  U extends StateMachineState = StateMachineState
> {
  log: T
  state: U
}

export type Fluent<T, K extends string | number | symbol> = {
  [P in Extract<keyof T, K>]: T[P]
}

export type Payload<T extends StateMachineAction> = T['payload']

export type StateMachineReducer<
  T extends StateMachineState,
  U extends StateMachineAction
> = $.Cast<
  $.Assign<
    T,
    {
      [TypeAction.InitialState]: {
        initial: Payload<U>
      }
      [TypeAction.State]: {
        states: $.Cons<
          $.Cast<Payload<U>, ActionState['payload']>['state'],
          T['states']
        >
      }
      [TypeAction.Action]: {
        actions: $.Cons<
          $.Cast<Payload<U>, ActionAction['payload']>['action'],
          T['actions']
        >
      }
      [TypeAction.Context]: {
        context: U extends ActionContext<infer X> ? X : never
      }
      [TypeAction.Transition]: {}
    }[$.Cast<U['type'], TypeAction>]
  >,
  StateMachineState
>

export type Next<
  T extends Model = { log: []; state: StateMachineInitialState },
  U extends StateMachineAction = never
> = StateMachine<
  $.If<
    $.Is.Never<U>,
    T,
    Model<$.Cons<U, T['log']>, StateMachineReducer<T['state'], U>>
  >
>

export type States<T extends Model> = $.Values<T['state']['states']>
export type Actions<T extends Model> = $.Values<T['state']['actions']>

export type Input<T extends Model, U extends Actions<T>> = Extract<
  $.Values<T['log']>,
  ActionAction<U, any>
> extends ActionAction<U, infer E>
  ? E
  : never

export interface Change<T extends Model = Model> {
  state: States<T>
  context: Readonly<T['state']['context']>
  action: T['log'] extends ArrayLike<infer U1>
    ? U1 extends { type: TypeAction.Transition; payload: infer U2 }
      ? U2 extends { source: infer A; action: infer B; target: infer C }
        ? Action<
            T,
            $.Cast<A, States<T>>,
            $.Cast<B, Actions<T>>,
            $.Cast<C, States<T>>
          >
        : never
      : never
    : never
}

export interface StateMachineService<T extends Model = Model>
  extends Subscribable<Change<T>>,
    InteropObservable<Change<T>> {
  readonly state: States<T>
  readonly context: T['state']['context']
  do: <A extends Actions<T>, B extends Input<T, A>>(
    action: A,
    ...input: $.If<$.Is.Never<B>, never, [B]>
  ) => void
  // check: <A extends Event<T>>(event: A) => boolean
  // reset(): void
}

export type Cast<T extends InteropStateMachine> = T extends InteropStateMachine<
  Model<infer A, infer B>
>
  ? Model<A, B>
  : never

export type ReadonlyStateMachineService<T extends StateMachineService> =
  Readonly<Fluent<T, 'context' | 'state'>>

export interface Action<
  T extends Model = Model,
  A extends States<T> = States<T>,
  B extends Actions<T> = Actions<T>,
  C extends States<T> = States<T>
> {
  type: B
  payload: Input<T, B>
  source: A
  target: C
}

export type Predicate<
  T extends Model,
  A extends States<T> = States<T>,
  B extends Actions<T> = Actions<T>,
  C extends States<T> = States<T>
> = (
  context: Readonly<T['state']['context']>,
  action: Action<T, A, B, C>
) => boolean

export type Reducer<
  T extends Model,
  A extends States<T> = States<T>,
  B extends Actions<T> = Actions<T>,
  C extends States<T> = States<T>
> = (
  context: T['state']['context'],
  action: Action<T, A, B, C>
) => T['state']['context']

export interface InteropStateMachine<T extends Model = Model> {
  [SYMBOL_STATE]: T['state']
  [SYMBOL_LOG]: T['log']
}

export interface StateMachine<T extends Model> extends InteropStateMachine<T> {
  state: <U extends PlaceholderState>(
    state: Exclude<U, States<T>>
  ) => Fluent<Next<T, ActionState<U>>, 'initial' | 'state'>
  action: <U extends PlaceholderAction, C = never>(
    action: Exclude<U, Actions<T>>
    // ...context: $.If<$.Is.Never<C>, never, [C | (() => C)]>
  ) => Fluent<Next<T, ActionAction<U, C>>, 'action' | 'transition' | 'context'>
  context: <U = never>(
    context: U | (() => U)
  ) => Fluent<Next<T, ActionContext<U>>, 'transition'>
  initial: <U extends States<T>>(
    states: U
  ) => Fluent<Next<T, ActionInitialState<U>>, 'action'>
  transition: <A extends States<T>, B extends Actions<T>, C extends States<T>>(
    source: A | A[],
    action: B | [B, ...Array<Predicate<T, A, B, C>>],
    target: C | C[],
    reducer?: Reducer<T, A, B, C>
  ) => Fluent<
    Next<T, ActionTransition<A, B, C>>,
    'transition' | typeof SYMBOL_STATE | typeof SYMBOL_LOG
  >
}
