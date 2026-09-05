/* eslint-disable typescript/no-unused-vars */
import { describe, it } from 'vitest'
import { stateMachine, type InferStateMachineModel } from '../index'
import type {
  StateMachineContextAtState,
  StateMachinePredicate,
  StateMachineReducer,
} from '../types'

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
// eslint-disable-next-line typescript/no-empty-function
function check<_T extends true>() {}

// ── Discriminated union context ─────────────────────────────────────

type ApplicationContext = ErrorContext | LoadingContext | ReadyContext
interface ErrorContext {
  error: string
  state: 'Error'
}
interface LoadingContext {
  progress: number
  state: 'Loading'
}
interface ReadyContext {
  data: string[]
  state: 'Ready'
}

// ── Flat (non-union) context ────────────────────────────────────────

interface FlatContext {
  count: number
  label: string
}

// ── Machines ────────────────────────────────────────────────────────

const discriminatedMachine = stateMachine()
  .state('Loading')
  .state('Ready')
  .state('Error')
  .initial('Loading')
  .action<'Finish'>('Finish')
  .action<'Fail'>('Fail')
  .action<'Retry'>('Retry')
  .action<'Progress', number>('Progress')
  .context<ApplicationContext>(() => ({ progress: 0, state: 'Loading' as const }))
  .transition('Loading', 'Finish', 'Ready', (_context, _action) => ({
    data: ['done'],
    state: 'Ready' as const,
  }))
  .transition('Loading', 'Fail', 'Error', (_context, _action) => ({
    error: 'failed',
    state: 'Error' as const,
  }))
  .transition('Error', 'Retry', 'Loading', (_context, _action) => ({
    progress: 0,
    state: 'Loading' as const,
  }))
  .transition('Loading', 'Progress', 'Loading', (context, action) => ({
    ...context,
    progress: action.payload,
  }))

type DModel = InferStateMachineModel<typeof discriminatedMachine>

const flatMachine = stateMachine()
  .state('A')
  .state('B')
  .initial('A')
  .action<'Go'>('Go')
  .context<FlatContext>(() => ({ count: 0, label: '' }))
  .transition('A', 'Go', 'B')
  .transition('B', 'Go', 'A')

type FModel = InferStateMachineModel<typeof flatMachine>

// ── StateMachineContextAtState helper ────────────────────────────────────────────

describe('StateMachineContextAtState helper', () => {
  it('narrows discriminated union to source variant', () => {
    check<Equal<StateMachineContextAtState<ApplicationContext, 'Loading'>, LoadingContext>>()
    check<Equal<StateMachineContextAtState<ApplicationContext, 'Ready'>, ReadyContext>>()
    check<Equal<StateMachineContextAtState<ApplicationContext, 'Error'>, ErrorContext>>()
  })

  it('falls back to full type for flat context', () => {
    check<Equal<StateMachineContextAtState<FlatContext, 'A'>, FlatContext>>()
    check<Equal<StateMachineContextAtState<FlatContext, 'B'>, FlatContext>>()
  })

  it('falls back when union has no state discriminant', () => {
    type NoDisc = { a: number } | { b: string }
    check<Equal<StateMachineContextAtState<NoDisc, 'X'>, NoDisc>>()
  })

  it('rejects states missing from a discriminated context', () => {
    check<Equal<StateMachineContextAtState<ApplicationContext, 'Missing'>, never>>()
    check<Equal<StateMachineContextAtState<ApplicationContext, 'Loading' | 'Missing'>, never>>()
  })

  it('preserves broad and monomorphic discriminators within their declared states', () => {
    interface BroadContext {
      count: number
      state: string
    }
    interface MonomorphicContext {
      count: number
      state: 'A' | 'B'
    }
    check<Equal<StateMachineContextAtState<BroadContext, 'C'>, BroadContext>>()
    check<Equal<StateMachineContextAtState<MonomorphicContext, 'A'>, MonomorphicContext>>()
    check<Equal<StateMachineContextAtState<MonomorphicContext, 'A' | 'B'>, MonomorphicContext>>()
    check<Equal<StateMachineContextAtState<MonomorphicContext, 'C'>, never>>()
  })

  it('preserves contexts without a required discriminator', () => {
    interface OptionalContext {
      count: number
      state?: 'A'
    }
    check<Equal<StateMachineContextAtState<OptionalContext, 'B'>, OptionalContext>>()
    check<Equal<StateMachineContextAtState<number | undefined, 'A'>, number | undefined>>()
    check<Equal<StateMachineContextAtState<unknown, 'A'>, unknown>>()
    check<Equal<StateMachineContextAtState<never, 'A'>, never>>()
  })

  it('produces union for multi-source', () => {
    check<
      Equal<
        StateMachineContextAtState<ApplicationContext, 'Error' | 'Loading'>,
        ErrorContext | LoadingContext
      >
    >()
  })
})

// ── Guard narrowing ─────────────────────────────────────────────────

describe('guard context narrowing', () => {
  it('narrows guard context to source variant for discriminated union', () => {
    type Guard = StateMachinePredicate<DModel, 'Loading', 'Finish', 'Ready'>
    type GuardContext = Parameters<Guard>[0]
    check<Equal<GuardContext, Readonly<LoadingContext>>>()
  })

  it('guard context unchanged for flat context', () => {
    type Guard = StateMachinePredicate<FModel, 'A', 'Go', 'B'>
    type GuardContext = Parameters<Guard>[0]
    check<Equal<GuardContext, Readonly<FlatContext>>>()
  })

  it('multi-source guard gets union of source variants', () => {
    type Guard = StateMachinePredicate<DModel, 'Error' | 'Loading', 'Retry', 'Loading'>
    type GuardContext = Parameters<Guard>[0]
    check<Equal<GuardContext, Readonly<ErrorContext | LoadingContext>>>()
  })
})

// ── Reducer narrowing ───────────────────────────────────────────────

describe('reducer context narrowing', () => {
  it('narrows reducer input to source variant', () => {
    type Reducer = StateMachineReducer<DModel, 'Loading', 'Finish', 'Ready'>
    type ReducerInput = Parameters<Reducer>[0]
    check<Equal<ReducerInput, LoadingContext>>()
  })

  it('narrows reducer output to target variant', () => {
    type Reducer = StateMachineReducer<DModel, 'Loading', 'Finish', 'Ready'>
    type ReducerOutput = ReturnType<Reducer>
    check<Equal<ReducerOutput, ReadyContext>>()
  })

  it('self-transition: source and target are same variant', () => {
    type Reducer = StateMachineReducer<DModel, 'Loading', 'Progress', 'Loading'>
    type ReducerInput = Parameters<Reducer>[0]
    type ReducerOutput = ReturnType<Reducer>
    check<Equal<ReducerInput, LoadingContext>>()
    check<Equal<ReducerOutput, LoadingContext>>()
  })

  it('reducer unchanged for flat context', () => {
    type Reducer = StateMachineReducer<FModel, 'A', 'Go', 'B'>
    type ReducerInput = Parameters<Reducer>[0]
    type ReducerOutput = ReturnType<Reducer>
    check<Equal<ReducerInput, FlatContext>>()
    check<Equal<ReducerOutput, FlatContext>>()
  })
})

// ── ts-expect-error: wrong variant ──────────────────────────────────

describe('wrong variant produces type error', () => {
  it('rejects transitions to a missing context variant', () => {
    const builder = stateMachine()
      .state('Loading')
      .state('Ready')
      .state('Missing')
      .initial('Loading')
      .action('Finish')
      .context<ApplicationContext>(() => ({ progress: 0, state: 'Loading' }))

    // @ts-expect-error no context variant exists for Missing
    builder.transition('Loading', 'Finish', 'Missing', (context) => context)
    // @ts-expect-error omitting the reducer cannot establish a missing variant
    builder.transition('Loading', 'Finish', 'Missing')
    // @ts-expect-error every target needs a context variant, not just Ready
    builder.transition('Loading', 'Finish', ['Ready', 'Missing'], () => ({
      data: [],
      state: 'Ready',
    }))
  })

  it('LoadingCtx not assignable to reducer return type (ReadyCtx)', () => {
    type ReducerReturn = globalThis.ReturnType<
      StateMachineReducer<DModel, 'Loading', 'Finish', 'Ready'>
    >
    check<Equal<ReducerReturn, ReadyContext>>()

    // LoadingCtx is not assignable to ReadyCtx
    type WrongState = LoadingContext extends ReducerReturn ? true : false
    check<Equal<WrongState, false>>()
  })

  it('wrong shape not assignable to reducer return type', () => {
    type ReducerReturn = globalThis.ReturnType<
      StateMachineReducer<DModel, 'Loading', 'Finish', 'Ready'>
    >
    // { state: 'Ready', progress: 0 } missing 'data' — not assignable to ReadyCtx
    type WrongShape = { progress: number; state: 'Ready' } extends ReducerReturn ? true : false
    check<Equal<WrongShape, false>>()
  })

  it('ErrorCtx not assignable to reducer input type (LoadingCtx)', () => {
    type ReducerInput = Parameters<StateMachineReducer<DModel, 'Loading', 'Finish', 'Ready'>>[0]
    check<Equal<ReducerInput, LoadingContext>>()

    // ErrorCtx is not assignable to LoadingCtx
    type WrongInput = ErrorContext extends ReducerInput ? true : false
    check<Equal<WrongInput, false>>()
  })
})

// ── Conditional reducer requirement ─────────────────────────────────

describe('conditional reducer requirement', () => {
  it('cross-variant transition requires reducer', () => {
    stateMachine()
      .state('Loading')
      .state('Ready')
      .initial('Loading')
      .action<'Finish'>('Finish')
      .context<ApplicationContext>(() => ({ progress: 0, state: 'Loading' as const }))
      // @ts-expect-error — reducer required: LoadingCtx is not assignable to ReadyCtx
      .transition('Loading', 'Finish', 'Ready')
  })

  it('same-variant transition allows omitting reducer', () => {
    stateMachine()
      .state('Loading')
      .state('Ready')
      .initial('Loading')
      .action<'Progress'>('Progress')
      .context<ApplicationContext>(() => ({ progress: 0, state: 'Loading' as const }))
      // No reducer needed — source and target are both LoadingCtx
      .transition('Loading', 'Progress', 'Loading')
  })

  it('flat context always allows omitting reducer', () => {
    stateMachine()
      .state('A')
      .state('B')
      .initial('A')
      .action<'Go'>('Go')
      .context<FlatContext>(() => ({ count: 0, label: '' }))
      // No reducer needed — flat context, no variants
      .transition('A', 'Go', 'B')
  })
})

// ── Composition ─────────────────────────────────────────────────────

describe('composition narrowing', () => {
  const child = stateMachine()
    .state('On')
    .state('Off')
    .initial('On')
    .action<'Toggle'>('Toggle')
    .context(() => ({ toggles: 0 }))
    .transition('On', 'Toggle', 'Off', (context) => ({ toggles: context.toggles + 1 }))

  it('flat parent + flat child: no narrowing, no regression', () => {
    const parent = stateMachine()
      .state('Idle')
      .compose('power', child.done())
      .initial('Idle')
      .action<'Start'>('Start')
      .context(() => ({ starts: 0 }))
      .transition('Idle', 'Start', 'On')

    type M = InferStateMachineModel<typeof parent>
    type Guard = StateMachinePredicate<M, 'Idle', 'Start', 'On'>
    type GuardContext = Parameters<Guard>[0]

    // Compound context: { power: { toggles: number }, starts: number }
    check<Equal<GuardContext, Readonly<{ power: { toggles: number }; starts: number }>>>()
  })

  it('discriminated-union parent + flat child: parent narrows correctly', () => {
    interface ParentIdle {
      idleCount: number
      state: 'Idle'
    }
    interface ParentActive {
      activeCount: number
      state: 'On'
    }
    type ParentContext = ParentActive | ParentIdle

    type CompoundContext = { power: { toggles: number } } & ParentContext

    // StateMachineContextAtState on the compound context narrows the parent portion
    type NarrowedIdle = StateMachineContextAtState<CompoundContext, 'Idle'>
    check<Equal<NarrowedIdle, { power: { toggles: number } } & ParentIdle>>()
  })

  it('child state on compound context falls back (child uses projected context)', () => {
    // Child states like 'On'/'Off' don't appear as state discriminants on compound context
    interface CompoundContext {
      power: { toggles: number }
      starts: number
    }
    type R = StateMachineContextAtState<CompoundContext, 'On'>
    check<Equal<R, CompoundContext>>()
  })
})
