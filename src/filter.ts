/**
 * Filters an array in-place by removing elements that don't match the predicate.
 * Iterates backwards through the array to avoid index shifting issues when removing elements.
 * @param array - The array to filter (mutated in place)
 * @param predicate - Function that returns true for elements to keep
 */
export const filter = <T>(array: T[], predicate: (value: T) => boolean) => {
  for (let l = array.length - 1; l >= 0; l -= 1) {
    if (!predicate(array[l])) array.splice(l, 1)
  }
}
