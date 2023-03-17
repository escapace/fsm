import { type Placeholder } from './types'

export const product = (
  a: Placeholder[],
  b: Placeholder[]
): Array<[Placeholder, Placeholder]> => {
  const total = a.length * b.length
  const product: Array<[Placeholder, Placeholder]> = []

  const factor = (a.length <= b.length ? Math.max : Math.min)(
    a.length,
    b.length
  )

  for (let i = 0; i < total; i++) {
    const row = Math.floor(i / factor)
    const column = i - row * factor

    product.push([a[row], b[column]])
  }

  return product
}
