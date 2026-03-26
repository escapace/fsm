import type { StateMachineIdentifier } from './types'

export const STATE_MACHINE_ERROR_TYPES = [
  'ActionAlreadyDeclared',
  'ActionConflict',
  'ActionNotDeclared',
  'ContextInitializerExpected',
  'ContextStateMismatch',
  'ContextGroupConflict',
  'DraftClosed',
  'DraftCommitConflict',
  'GroupNameConflict',
  'HydrationShapeMismatch',
  'StateMachineExpected',
  'StateAlreadyDeclared',
  'StateNotDeclared',
] as const

export type StateMachineErrorType = (typeof STATE_MACHINE_ERROR_TYPES)[number]

export interface StateMachineErrorMetadata {
  ActionAlreadyDeclared: { identifier: StateMachineIdentifier }
  ActionConflict: { identifier: StateMachineIdentifier }
  ActionNotDeclared: { identifier: StateMachineIdentifier }

  ContextGroupConflict: { identifier: StateMachineIdentifier }
  // eslint-disable-next-line typescript/no-empty-object-type
  ContextInitializerExpected: {}
  ContextStateMismatch: { actual: unknown; expected: StateMachineIdentifier }

  // eslint-disable-next-line typescript/no-empty-object-type
  DraftClosed: {}
  DraftCommitConflict: { actualCursor: number; expectedCursor: number }

  GroupNameConflict: { identifier: StateMachineIdentifier }

  // eslint-disable-next-line typescript/no-empty-object-type
  HydrationShapeMismatch: {}

  StateAlreadyDeclared: { identifier: StateMachineIdentifier }
  StateNotDeclared: { identifier: StateMachineIdentifier }

  // eslint-disable-next-line typescript/no-empty-object-type
  StateMachineExpected: {}
}

export type StateMachineErrorCause<T extends StateMachineErrorType = StateMachineErrorType> =
  T extends StateMachineErrorType ? { type: T } & StateMachineErrorMetadata[T] : never

function formatIdentifier(id: StateMachineIdentifier): string {
  return typeof id === 'symbol' ? String(id) : JSON.stringify(id)
}

function formatMessage(cause: StateMachineErrorCause): string {
  switch (cause.type) {
    case 'ActionAlreadyDeclared':
      return `Action ${formatIdentifier(cause.identifier)} is already declared.`
    case 'ActionConflict':
      return `Action ${formatIdentifier(cause.identifier)} conflicts with an action from a previously composed sibling machine.`
    case 'ActionNotDeclared':
      return `Action ${formatIdentifier(cause.identifier)} is not declared in this state machine.`
    case 'ContextGroupConflict':
      return `Context key ${formatIdentifier(cause.identifier)} conflicts with a composed group name.`
    case 'ContextInitializerExpected':
      return 'Context initializer must be a function with no arguments.'
    case 'ContextStateMismatch':
      return `Context state discriminant ${formatIdentifier(cause.actual as StateMachineIdentifier)} does not match startup state ${formatIdentifier(cause.expected)}.`
    case 'DraftClosed':
      return 'Draft is closed or has a closed ancestor.'
    case 'DraftCommitConflict':
      return `Draft commit failed because the parent runtime advanced since draft creation (expected cursor ${cause.expectedCursor}, got ${cause.actualCursor}).`
    case 'GroupNameConflict':
      return `Group name ${formatIdentifier(cause.identifier)} conflicts with an existing group or declared state.`
    case 'HydrationShapeMismatch':
      return 'Hydration payload must be an object with "state" and "context" keys.'
    case 'StateAlreadyDeclared':
      return `State ${formatIdentifier(cause.identifier)} is already declared.`
    case 'StateMachineExpected':
      return 'Expected a state machine definition.'
    case 'StateNotDeclared':
      return `State ${formatIdentifier(cause.identifier)} is not declared in this state machine.`
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
