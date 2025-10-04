import {
  interquartileRange,
  maxSorted,
  mean,
  medianSorted,
  minSorted,
  quantileSorted,
  standardDeviation,
} from 'simple-statistics'

const diff = (A, B) => A.map((value, index) => (B[index] - value) * 1000)

export const log = (A, B) => {
  const values = diff(A, B).sort((a, b) => a - b)

  console.log('Median', medianSorted(values))
  console.log('Mean', mean(values))
  console.log('p95', quantileSorted(values, 0.95))
  console.log('p99', quantileSorted(values, 0.99))
  console.log('Min', minSorted(values))
  console.log('Max', maxSorted(values))
  console.log('IQR', interquartileRange(values))
  console.log('SD', standardDeviation(values))
}
