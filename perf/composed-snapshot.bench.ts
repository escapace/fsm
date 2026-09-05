import { bench, describe } from 'vitest'
import { interpret, stateMachine } from '../src/index'

const BATCH_SIZE = 100
const shared = { values: Array.from({ length: 64 }, (_, count) => ({ count })) }
const leaf = stateMachine()
  .state('Leaf')
  .initial('Leaf')
  .action('STEP')
  .context(() => ({ value: shared }))
  .done()
const middle = stateMachine()
  .state('Middle')
  .compose('leaf', leaf)
  .initial('Leaf')
  .action('MIDDLE')
  .context(() => ({ alias: shared }))
  .done()
const service = interpret(
  stateMachine()
    .state('Root')
    .compose('middle', middle)
    .initial('Leaf')
    .action('ROOT')
    .context(() => ({ alias: shared }))
    .done(),
)

// Aliases cross composition boundaries. Each draft is discarded so the service
// does not retain handles across benchmark iterations.
describe('composed default snapshots', () => {
  bench(`draft/discard x${BATCH_SIZE}`, () => {
    for (let index = 0; index < BATCH_SIZE; index++) {
      service.draft().discard()
    }
  })

  bench(`nested draft/discard x${BATCH_SIZE}`, () => {
    for (let index = 0; index < BATCH_SIZE; index++) {
      const draft = service.draft()
      draft.draft().discard()
      draft.discard()
    }
  })
})
