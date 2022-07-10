import {
  median,
  mean,
  min,
  max,
  standardDeviation
} from 'simple-statistics'

const diff = (A, B) => {
  return A.map((value, index) => {
    return (B[index] - value) * 1000
  })
}

export const log = (A, B) => {
  const values = diff(A, B)

  console.log('Median', median(values))
  console.log('Mean', mean(values))
  console.log('Min', min(values))
  console.log('Max', max(values))
  console.log('SD', standardDeviation(values))
}
