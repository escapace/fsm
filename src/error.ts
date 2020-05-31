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

export function NOT_STATE_MACHINE(): never {
  throw new Error('Paremeter is not a state machine.')
}
