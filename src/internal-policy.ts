import { CHILD_GROUP } from './constants'
import type { StateMachineIdentifier } from './types'

export { CHILD_GROUP }

export type GroupScopedReducer = ((context: unknown, action: unknown) => unknown) & {
  [CHILD_GROUP]?: StateMachineIdentifier
}
