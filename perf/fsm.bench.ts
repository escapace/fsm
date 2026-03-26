import { szudzik } from 'coastal'
import { bench, describe } from 'vitest'
import { interpret, stateMachine } from '../src/index'

const BATCH_SIZE = 1000
const WARMUP_ITERATIONS = 50_000
interface CounterContext {
  count: number
}

const alwaysTrue = () => true
const noop = () => undefined

// Cheapest context policy for this benchmark shape (`{ count: number }`) while preserving draft isolation:
// - snapshotContext: one-field clone
// - reconcileContext: one-field in-place copy
const snapshotContextCheap = (context: CounterContext): CounterContext => ({ count: context.count })
const reconcileContextCheap = (
  parentContext: CounterContext,
  nextContext: CounterContext,
): CounterContext => {
  parentContext.count = nextContext.count
  return parentContext
}

const runBatch = (count: number, callback: () => void) => {
  for (let index = 0; index < count; index++) {
    callback()
  }
}

const warmup = (callback: () => void) => {
  runBatch(WARMUP_ITERATIONS, callback)
}

// ---------------------------------------------------------------------------
// Baseline infrastructure: models the irreducible work that any dispatch must
// do — Map lookups for action index, transition resolution, and next-state
// index, plus a szudzik pairing computation. This is the floor against which
// the FSM overhead is measured.
// ---------------------------------------------------------------------------

const baselineActionIndex = new Map<string, number>([['TOGGLE', 0]])

const baselineStateIndex = new Map<string, number>([
  ['active', 1],
  ['inactive', 0],
])

// Two transition entries keyed by szudzik(stateIdx, actionIndex).
// Each value is a minimal object with source/target identifiers and an empty
// predicates array, mirroring the structure that interpret.ts reads.
const baselineTransitions = new Map<
  number,
  Array<{ predicates: Array<() => boolean>; source: string; target: string }>
>([
  [szudzik(0, 0), [{ predicates: [], source: 'inactive', target: 'active' }]],
  [szudzik(1, 0), [{ predicates: [], source: 'active', target: 'inactive' }]],
])

let _baselineStateId = 'inactive'
let _baselineIndexState = 0

const interpretOnlyMachineBuilder = stateMachine()
  .state('inactive')
  .state('active')
  .initial('inactive')
  .action('TOGGLE')
  .transition('inactive', 'TOGGLE', 'active')
  .transition('active', 'TOGGLE', 'inactive')

const interpretOnlyMachine = interpretOnlyMachineBuilder.done()

const escapaceBare = interpret(interpretOnlyMachine)

const escapaceWithCallback = interpret(
  stateMachine()
    .state('inactive')
    .state('active')
    .initial('inactive')
    .action('TOGGLE')
    .transition('inactive', 'TOGGLE', 'active', noop)
    .transition('active', 'TOGGLE', 'inactive', noop)
    .done(),
)

const escapaceGuardedReducer = interpret(
  stateMachine()
    .state('inactive')
    .state('active')
    .initial('inactive')
    .action('TOGGLE')
    .context(() => ({ count: 0 }))
    .transition('inactive', ['TOGGLE', alwaysTrue], 'active', (context) => ({
      count: context.count + 1,
    }))
    .transition('active', ['TOGGLE', alwaysTrue], 'inactive', (context) => ({
      count: context.count + 1,
    }))
    .done(),
)

let baselineContext = { count: 0 }

// Baseline: bare transition — models the irreducible Map-lookup chain that
// interpret.ts performs on every dispatch (action index → szudzik → transition
// → candidate read → state-index lookup → state swap).
const baselineBare = () => {
  const actionIndex = baselineActionIndex.get('TOGGLE')!
  const key = szudzik(_baselineIndexState, actionIndex)
  const candidates = baselineTransitions.get(key)!
  const hit = candidates[0]
  _baselineStateId = hit.target
  _baselineIndexState = baselineStateIndex.get(_baselineStateId)!
}

// Baseline: callback cost — same lookup chain plus a noop reducer call.
const baselineWithCallback = () => {
  const actionIndex = baselineActionIndex.get('TOGGLE')!
  const key = szudzik(_baselineIndexState, actionIndex)
  const candidates = baselineTransitions.get(key)!
  const hit = candidates[0]
  noop()
  _baselineStateId = hit.target
  _baselineIndexState = baselineStateIndex.get(_baselineStateId)!
}

// Baseline: guard + immutable context update — lookup chain, predicate call,
// new-object allocation, and state swap.
const baselineGuardedReducer = () => {
  const actionIndex = baselineActionIndex.get('TOGGLE')!
  const key = szudzik(_baselineIndexState, actionIndex)
  const candidates = baselineTransitions.get(key)!
  const hit = candidates[0]

  if (alwaysTrue()) {
    baselineContext = { count: baselineContext.count + 1 }
    _baselineStateId = hit.target
    _baselineIndexState = baselineStateIndex.get(_baselineStateId)!
  }
}

// ---------------------------------------------------------------------------
// Draft lifecycle: create → do → commit measured against the same guarded-
// reducer baseline used for direct dispatch. The ratio between the two FSM
// entries (direct vs draft) isolates the marginal cost of snapshot, trace
// bookkeeping, and reconcile-on-commit.
// ---------------------------------------------------------------------------

const escapaceDraftGuardedReducer = interpret(
  stateMachine()
    .state('inactive')
    .state('active')
    .initial('inactive')
    .action('TOGGLE')
    .context(() => ({ count: 0 }))
    .transition('inactive', ['TOGGLE', alwaysTrue], 'active', (context) => ({
      count: context.count + 1,
    }))
    .transition('active', ['TOGGLE', alwaysTrue], 'inactive', (context) => ({
      count: context.count + 1,
    }))
    .done(),
)

const escapaceDraftGuardedReducerCheapestPolicy = interpret(
  stateMachine()
    .state('inactive')
    .state('active')
    .initial('inactive')
    .action('TOGGLE')
    .context(() => ({ count: 0 }))
    .transition('inactive', ['TOGGLE', alwaysTrue], 'active', (context) => ({
      count: context.count + 1,
    }))
    .transition('active', ['TOGGLE', alwaysTrue], 'inactive', (context) => ({
      count: context.count + 1,
    }))
    .done({
      reconcileContext: reconcileContextCheap,
      snapshotContext: snapshotContextCheap,
    }),
)

warmup(() => {
  const draft = escapaceDraftGuardedReducer.draft()
  draft.do('TOGGLE')
  draft.commit()
})

warmup(() => {
  const draft = escapaceDraftGuardedReducerCheapestPolicy.draft()
  draft.do('TOGGLE')
  draft.commit()
})

warmup(() => interpretOnlyMachineBuilder.done())
warmup(() => interpret(interpretOnlyMachine))

warmup(baselineBare)
warmup(() => escapaceBare.do('TOGGLE'))
warmup(baselineWithCallback)
warmup(() => escapaceWithCallback.do('TOGGLE'))

warmup(baselineGuardedReducer)
warmup(() => escapaceGuardedReducer.do('TOGGLE'))

describe('fsm throughput - finalization and interpretation', () => {
  bench(`escapace/fsm x${BATCH_SIZE} (done only)`, () => {
    runBatch(BATCH_SIZE, () => interpretOnlyMachineBuilder.done())
  })

  bench(`escapace/fsm x${BATCH_SIZE} (interpret finalized machine)`, () => {
    runBatch(BATCH_SIZE, () => interpret(interpretOnlyMachine))
  })
})

describe('fsm throughput - bare transitions', () => {
  bench(`baseline x${BATCH_SIZE}`, () => {
    runBatch(BATCH_SIZE, baselineBare)
  })

  bench(`escapace/fsm x${BATCH_SIZE} (do string)`, () => {
    runBatch(BATCH_SIZE, () => escapaceBare.do('TOGGLE'))
  })
})

describe('fsm throughput - transition callback cost', () => {
  bench(`baseline x${BATCH_SIZE}`, () => {
    runBatch(BATCH_SIZE, baselineWithCallback)
  })

  bench(`escapace/fsm x${BATCH_SIZE} (reducer noop)`, () => {
    runBatch(BATCH_SIZE, () => escapaceWithCallback.do('TOGGLE'))
  })
})

describe('fsm throughput - guard + immutable context update', () => {
  bench(`baseline x${BATCH_SIZE}`, () => {
    runBatch(BATCH_SIZE, baselineGuardedReducer)
  })

  bench(`escapace/fsm x${BATCH_SIZE} (predicate + reducer)`, () => {
    runBatch(BATCH_SIZE, () => escapaceGuardedReducer.do('TOGGLE'))
  })

  bench(`escapace/fsm x${BATCH_SIZE} (draft create+do+commit)`, () => {
    runBatch(BATCH_SIZE, () => {
      const draft = escapaceDraftGuardedReducer.draft()
      draft.do('TOGGLE')
      draft.commit()
    })
  })

  bench(`escapace/fsm x${BATCH_SIZE} (draft create+do+commit, cheapest context policy)`, () => {
    runBatch(BATCH_SIZE, () => {
      const draft = escapaceDraftGuardedReducerCheapestPolicy.draft()
      draft.do('TOGGLE')
      draft.commit()
    })
  })
})
