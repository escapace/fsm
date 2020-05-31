const {
  median,
  mean,
  min,
  max,
  standardDeviation
} = require('../node_modules/simple-statistics/dist/simple-statistics.js')

const diff = (A, B) => {
  return A.map((value, index) => {
    return (B[index] - value) * 1000
  })
}

module.exports = (A, B) => {
  const values = diff(A, B)

  console.log('Median', median(values))
  console.log('Mean', mean(values))
  console.log('Min', min(values))
  console.log('Max', max(values))
  console.log('SD', standardDeviation(values))
}
