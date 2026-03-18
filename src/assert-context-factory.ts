import { StateMachineError } from './error'

export function assertContextFactory(
  contextSource: unknown,
): asserts contextSource is () => unknown {
  if (typeof contextSource !== 'function') {
    throw new StateMachineError({ type: 'ContextInitializerExpected' })
  }
}
