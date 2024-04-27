import { max, mean, median, min, standardDeviation } from 'simple-statistics'

const diff = (A, B) => A.map((value, index) => (B[index] - value) * 1000)

export const log = (A, B) => {
  const values = diff(A, B)

  console.log('Median', median(values))
  console.log('Mean', mean(values))
  console.log('Min', min(values))
  console.log('Max', max(values))
  console.log('SD', standardDeviation(values))
}
