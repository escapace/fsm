export function STATE_EXISTS(): never {
  throw new Error('State already exists.')
}

export function STATE_UNKNOWN(): never {
  throw new Error('No such state.')
}

export function ACTION_EXISTS(): never {
  throw new Error('Action already exists.')
}

export function ACTION_UNKNOWN(): never {
  throw new Error('No such action.')
}

export function GROUP_EXISTS(): never {
  throw new Error('Group already exists or conflicts with a declared state.')
}

export function COMPOSE_CHILD_INITIAL_REQUIRED(): never {
  throw new Error('Composed machine must declare an initial state.')
}

export function NOT_STATE_MACHINE(): never {
  throw new Error('Parameter is not a state machine.')
}
