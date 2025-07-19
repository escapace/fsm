import type { StateMachineIdentifier } from './types'

export const product = (
  a: StateMachineIdentifier[],
  b: StateMachineIdentifier[],
): Array<[StateMachineIdentifier, StateMachineIdentifier]> => {
  const total = a.length * b.length
  const product: Array<[StateMachineIdentifier, StateMachineIdentifier]> = []

  const factor = (a.length <= b.length ? Math.max : Math.min)(a.length, b.length)

  for (let index = 0; index < total; index++) {
    const row = Math.floor(index / factor)
    const column = index - row * factor

    product.push([a[row], b[column]])
  }

  return product
}
