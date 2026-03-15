import type { StateMachineIdentifier } from './types'

export const STATE_MACHINE_ERROR_TYPES = [
  'ActionExists',
  'ActionOverlap',
  'ActionUnknown',
  'ContextFactoryRequired',
  'DraftClosed',
  'DraftContextCloneFailed',
  'DraftOutOfDate',
  'GroupExists',
  'NotStateMachine',
  'StateExists',
  'StateUnknown',
] as const

export type StateMachineErrorType = (typeof STATE_MACHINE_ERROR_TYPES)[number]

export interface StateMachineErrorMetadata {
  ActionExists: { identifier: StateMachineIdentifier }
  ActionOverlap: { identifier: StateMachineIdentifier }
  ActionUnknown: { identifier: StateMachineIdentifier }

  // eslint-disable-next-line typescript/no-empty-object-type
  ContextFactoryRequired: {}

  // eslint-disable-next-line typescript/no-empty-object-type
  DraftClosed: {}
  DraftContextCloneFailed: { message?: string }
  DraftOutOfDate: { actualCursor: number; expectedCursor: number }

  GroupExists: { identifier: StateMachineIdentifier }
  StateExists: { identifier: StateMachineIdentifier }
  StateUnknown: { identifier: StateMachineIdentifier }

  // eslint-disable-next-line typescript/no-empty-object-type
  NotStateMachine: {}
}

export type StateMachineErrorCause<T extends StateMachineErrorType = StateMachineErrorType> =
  T extends StateMachineErrorType ? { type: T } & StateMachineErrorMetadata[T] : never

function formatIdentifier(id: StateMachineIdentifier): string {
  return typeof id === 'symbol' ? String(id) : JSON.stringify(id)
}

function formatMessage(cause: StateMachineErrorCause): string {
  switch (cause.type) {
    case 'ActionExists':
      return `Action ${formatIdentifier(cause.identifier)} already exists.`
    case 'ActionOverlap':
      return `Action ${formatIdentifier(cause.identifier)} overlaps a previously composed child action.`
    case 'ActionUnknown':
      return `No such action ${formatIdentifier(cause.identifier)}.`
    case 'ContextFactoryRequired':
      return 'Context initializer must be a nullary function.'
    case 'DraftClosed':
      return 'Draft handle is closed.'
    case 'DraftContextCloneFailed':
      return cause.message ?? 'Failed to clone context for draft isolation.'
    case 'DraftOutOfDate':
      return `Draft is out of date (expected cursor ${cause.expectedCursor}, got ${cause.actualCursor}).`
    case 'GroupExists':
      return `Group ${formatIdentifier(cause.identifier)} already exists or conflicts with a declared state.`
    case 'NotStateMachine':
      return 'Parameter is not a state machine.'
    case 'StateExists':
      return `State ${formatIdentifier(cause.identifier)} already exists.`
    case 'StateUnknown':
      return `No such state ${formatIdentifier(cause.identifier)}.`
  }
}

export class StateMachineError<
  T extends StateMachineErrorType = StateMachineErrorType,
> extends Error {
  readonly cause: StateMachineErrorCause<T>
  readonly name = 'StateMachineError' as const

  constructor(cause: StateMachineErrorCause<T>) {
    super(formatMessage(cause))
    this.cause = cause
    Object.setPrototypeOf(this, StateMachineError.prototype)
  }
}

export function isStateMachineError(value: unknown): value is StateMachineError {
  return value instanceof StateMachineError
}

export function isStateMachineErrorOfType<T extends StateMachineErrorType>(
  error: StateMachineError,
  type: T,
): error is StateMachineError<T> {
  return error.cause.type === type
}
