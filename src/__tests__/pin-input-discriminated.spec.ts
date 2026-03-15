import { assert, describe, it } from 'vitest'
import {
  interpret,
  reconcileContext,
  stateMachine,
  type InferStateMachineModel,
  type StateMachineContextAtState,
  type StateMachinePredicate,
  type StateMachineReducer,
} from '../index'
import {
  createPinInput,
  createPinInputMachine,
  PinInputAction,
  PinInputState,
  type PinInputCompletedContext,
  type PinInputConfig,
  type PinInputContext,
  type PinInputErrorContext,
  type PinInputFocusedContext,
  type PinInputIdleContext,
} from '../../examples/pin-input-discriminated'

// ── Type-level helpers ──────────────────────────────────────────────

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
// eslint-disable-next-line typescript/no-empty-function
function check<_T extends true>() {}

type Model = InferStateMachineModel<ReturnType<typeof createPinInputMachine>>

// ── Type-level tests ────────────────────────────────────────────────

describe('pin-input-discriminated: type-level', () => {
  it('StateMachineContextAtState narrows to correct variant per state', () => {
    check<
      Equal<StateMachineContextAtState<PinInputContext, PinInputState.Idle>, PinInputIdleContext>
    >()
    check<
      Equal<
        StateMachineContextAtState<PinInputContext, PinInputState.Focused>,
        PinInputFocusedContext
      >
    >()
    check<
      Equal<
        StateMachineContextAtState<PinInputContext, PinInputState.Completed>,
        PinInputCompletedContext
      >
    >()
    check<
      Equal<StateMachineContextAtState<PinInputContext, PinInputState.Error>, PinInputErrorContext>
    >()
  })

  it('guard context narrows to source variant', () => {
    // Idle → Focused: guard sees IdleContext
    type IdleGuard = StateMachinePredicate<
      Model,
      PinInputState.Idle,
      PinInputAction.Focus,
      PinInputState.Focused
    >
    check<Equal<Parameters<IdleGuard>[0], Readonly<PinInputIdleContext>>>()

    // Focused → Error: guard sees FocusedContext
    type FocusedGuard = StateMachinePredicate<
      Model,
      PinInputState.Focused,
      PinInputAction.Input,
      PinInputState.Error
    >
    check<Equal<Parameters<FocusedGuard>[0], Readonly<PinInputFocusedContext>>>()
  })

  it('reducer input narrows to source, output narrows to target', () => {
    // Idle → Focused
    type IdleToFocused = StateMachineReducer<
      Model,
      PinInputState.Idle,
      PinInputAction.Focus,
      PinInputState.Focused
    >
    check<Equal<Parameters<IdleToFocused>[0], PinInputIdleContext>>()
    check<Equal<globalThis.ReturnType<IdleToFocused>, PinInputFocusedContext>>()

    // Focused → Error
    type FocusedToError = StateMachineReducer<
      Model,
      PinInputState.Focused,
      PinInputAction.Input,
      PinInputState.Error
    >
    check<Equal<Parameters<FocusedToError>[0], PinInputFocusedContext>>()
    check<Equal<globalThis.ReturnType<FocusedToError>, PinInputErrorContext>>()

    // Focused → Completed
    type FocusedToCompleted = StateMachineReducer<
      Model,
      PinInputState.Focused,
      PinInputAction.Input,
      PinInputState.Completed
    >
    check<Equal<Parameters<FocusedToCompleted>[0], PinInputFocusedContext>>()
    check<Equal<globalThis.ReturnType<FocusedToCompleted>, PinInputCompletedContext>>()
  })

  it('self-transition: source and target are the same variant', () => {
    type FocusedSelf = StateMachineReducer<
      Model,
      PinInputState.Focused,
      PinInputAction.Focus,
      PinInputState.Focused
    >
    check<Equal<Parameters<FocusedSelf>[0], PinInputFocusedContext>>()
    check<Equal<globalThis.ReturnType<FocusedSelf>, PinInputFocusedContext>>()
  })

  it('multi-source transition: context is union of source variants', () => {
    // [Focused, Error] → Idle (Blur)
    type BlurGuard = StateMachinePredicate<
      Model,
      PinInputState.Error | PinInputState.Focused,
      PinInputAction.Blur,
      PinInputState.Idle
    >
    check<
      Equal<Parameters<BlurGuard>[0], Readonly<PinInputErrorContext | PinInputFocusedContext>>
    >()

    // [Focused, Completed, Error] → Idle (Reset)
    type ResetReducer = StateMachineReducer<
      Model,
      PinInputState.Completed | PinInputState.Error | PinInputState.Focused,
      PinInputAction.Reset,
      PinInputState.Idle
    >
    check<
      Equal<
        Parameters<ResetReducer>[0],
        PinInputCompletedContext | PinInputErrorContext | PinInputFocusedContext
      >
    >()
    check<Equal<globalThis.ReturnType<ResetReducer>, PinInputIdleContext>>()
  })

  it('context.state discriminant type matches enum member', () => {
    // Verifying the enum member types are used, not string literals
    check<Equal<PinInputIdleContext['state'], PinInputState.Idle>>()
    check<Equal<PinInputFocusedContext['state'], PinInputState.Focused>>()
    check<Equal<PinInputCompletedContext['state'], PinInputState.Completed>>()
    check<Equal<PinInputErrorContext['state'], PinInputState.Error>>()
  })

  it('wrong variant return not assignable to reducer output', () => {
    type FocusedToCompleted = globalThis.ReturnType<
      StateMachineReducer<
        Model,
        PinInputState.Focused,
        PinInputAction.Input,
        PinInputState.Completed
      >
    >
    // PinInputFocusedContext is NOT assignable to PinInputCompletedContext
    type WrongReturn = PinInputFocusedContext extends FocusedToCompleted ? true : false
    check<Equal<WrongReturn, false>>()

    // PinInputErrorContext is NOT assignable to PinInputCompletedContext
    type AlsoWrong = PinInputErrorContext extends FocusedToCompleted ? true : false
    check<Equal<AlsoWrong, false>>()
  })

  it('transition target inference is anchored by target, not reducer return', () => {
    void stateMachine()
      .state(PinInputState.Idle)
      .state(PinInputState.Focused)
      .state(PinInputState.Completed)
      .state(PinInputState.Error)
      .initial(PinInputState.Idle)
      .action(PinInputAction.Reset)
      .context<PinInputContext>(() => ({
        config: {
          length: 4,
          type: 'numeric',
        },
        focusedIndex: -1 as const,
        state: PinInputState.Idle as const,
        values: new Array<string>(4).fill(''),
      }))
      .transition(
        [PinInputState.Focused, PinInputState.Completed, PinInputState.Error],
        PinInputAction.Reset,
        PinInputState.Idle,
        (context) =>
          // @ts-expect-error reducer for Idle target must return Idle context variant
          reconcileContext(context, {
            config: context.config,
            focusedIndex: -1 as const,
            state: PinInputState.Completed as const,
            values: new Array<string>(context.config.length).fill(''),
          }),
      )
  })

  it('subscription change narrows by state and action discriminants', () => {
    const service = interpret(
      createPinInputMachine({
        length: 4,
        type: 'numeric',
      }),
    )

    service.subscribe((change) => {
      if (change.state === PinInputState.Error) {
        check<Equal<typeof change.context, Readonly<PinInputErrorContext>>>()
        check<Equal<typeof change.action.target, PinInputState.Error>>()
      }

      if (change.action.type === PinInputAction.Reset) {
        check<Equal<typeof change.action.target, PinInputState.Idle>>()
        check<Equal<typeof change.action.payload, never>>()
      }
    })
  })

  it('service.do payload inference is anchored by action', () => {
    const service = interpret(
      createPinInputMachine({
        length: 4,
        type: 'numeric',
      }),
    )

    service.do(PinInputAction.Focus, { index: 0 })

    // @ts-expect-error Focus expects FocusPayload, not PastePayload
    service.do(PinInputAction.Focus, { content: '1234', startIndex: 0 })

    // @ts-expect-error Reset does not accept payload
    service.do(PinInputAction.Reset, { index: 0 })
  })
})

// ── Runtime tests ───────────────────────────────────────────────────

describe('pin-input-discriminated: runtime', () => {
  const defaultConfig: PinInputConfig = {
    length: 4,
    type: 'numeric',
  }

  describe('initial state and context.state injection', () => {
    it('starts in idle with context.state matching', () => {
      const svc = createPinInput(defaultConfig)
      assert.equal(svc.state, PinInputState.Idle)
      assert.equal(svc.context.state, PinInputState.Idle)
      assert.deepEqual(svc.context.values, ['', '', '', ''])
      assert.equal(svc.context.focusedIndex, -1)
    })

    it('context.state tracks service.state through all transitions', () => {
      const svc = createPinInput(defaultConfig)

      svc.do(PinInputAction.Focus, { index: 0 })
      assert.equal(svc.state, PinInputState.Focused)
      assert.equal(svc.context.state, PinInputState.Focused)

      svc.do(PinInputAction.Input, { index: 0, value: 'x' })
      assert.equal(svc.state, PinInputState.Error)
      assert.equal(svc.context.state, PinInputState.Error)

      svc.do(PinInputAction.Reset)
      assert.equal(svc.state, PinInputState.Idle)
      assert.equal(svc.context.state, PinInputState.Idle)
    })
  })

  describe('focus management', () => {
    it('Idle → Focused on focus action', () => {
      const svc = createPinInput(defaultConfig)
      svc.do(PinInputAction.Focus, { index: 0 })

      assert.equal(svc.state, PinInputState.Focused)
      assert.equal(svc.context.state, PinInputState.Focused)
      assert.equal(svc.context.focusedIndex, 0)
    })

    it('clamps focus index to valid range', () => {
      const svc = createPinInput(defaultConfig)

      svc.do(PinInputAction.Focus, { index: 10 })
      assert.equal(svc.context.focusedIndex, 3)

      svc.do(PinInputAction.Focus, { index: -5 })
      assert.equal(svc.context.focusedIndex, 0)
    })

    it('Focused → Idle on blur', () => {
      const svc = createPinInput(defaultConfig)
      svc.do(PinInputAction.Focus, { index: 1 })
      svc.do(PinInputAction.Blur)

      assert.equal(svc.state, PinInputState.Idle)
      assert.equal(svc.context.state, PinInputState.Idle)
      assert.equal(svc.context.focusedIndex, -1)
    })
  })

  describe('input handling', () => {
    it('accepts valid numeric input and auto-advances', () => {
      const svc = createPinInput(defaultConfig)
      svc.do(PinInputAction.Focus, { index: 0 })

      assert.ok(svc.do(PinInputAction.Input, { index: 0, value: '1' }))
      assert.equal(svc.context.values[0], '1')
      assert.equal(svc.context.focusedIndex, 1)
    })

    it('rejects invalid input → Error with error message', () => {
      const svc = createPinInput(defaultConfig)
      svc.do(PinInputAction.Focus, { index: 0 })
      svc.do(PinInputAction.Input, { index: 0, value: 'a' })

      assert.equal(svc.state, PinInputState.Error)
      assert.equal(svc.context.state, PinInputState.Error)
      assert.equal((svc.context as PinInputErrorContext).error, 'Invalid numeric input: "a"')
      assert.equal(svc.context.values[0], '')
    })

    it('transitions to Completed when all fields filled', () => {
      const svc = createPinInput(defaultConfig)
      svc.do(PinInputAction.Focus, { index: 0 })
      svc.do(PinInputAction.Input, { index: 0, value: '1' })
      svc.do(PinInputAction.Input, { index: 1, value: '2' })
      svc.do(PinInputAction.Input, { index: 2, value: '3' })
      svc.do(PinInputAction.Input, { index: 3, value: '4' })

      assert.equal(svc.state, PinInputState.Completed)
      assert.equal(svc.context.state, PinInputState.Completed)
      assert.deepEqual(svc.context.values, ['1', '2', '3', '4'])
    })

    it('rejects input at invalid index', () => {
      const svc = createPinInput(defaultConfig)
      svc.do(PinInputAction.Focus, { index: 0 })
      assert.equal(svc.do(PinInputAction.Input, { index: 10, value: '1' }), false)
    })
  })

  describe('navigation', () => {
    it('navigates left and right', () => {
      const svc = createPinInput(defaultConfig)
      svc.do(PinInputAction.Focus, { index: 2 })

      svc.do(PinInputAction.Navigate, { currentIndex: 2, direction: 'left' })
      assert.equal(svc.context.focusedIndex, 1)

      svc.do(PinInputAction.Navigate, { currentIndex: 1, direction: 'right' })
      assert.equal(svc.context.focusedIndex, 2)
    })

    it('constrains navigation to valid indices', () => {
      const svc = createPinInput(defaultConfig)
      svc.do(PinInputAction.Focus, { index: 0 })

      svc.do(PinInputAction.Navigate, { currentIndex: 0, direction: 'left' })
      assert.equal(svc.context.focusedIndex, 0)

      svc.do(PinInputAction.Focus, { index: 3 })
      svc.do(PinInputAction.Navigate, { currentIndex: 3, direction: 'right' })
      assert.equal(svc.context.focusedIndex, 3)
    })

    it('backspace on empty field moves to previous and clears', () => {
      const svc = createPinInput(defaultConfig)
      svc.do(PinInputAction.Focus, { index: 0 })
      svc.do(PinInputAction.Input, { index: 0, value: '1' })
      svc.do(PinInputAction.Input, { index: 1, value: '2' })

      svc.do(PinInputAction.Navigate, { currentIndex: 2, direction: 'backspace' })
      assert.equal(svc.context.values[1], '')
      assert.equal(svc.context.focusedIndex, 1)
    })
  })

  describe('clear operations', () => {
    it('clears specific field', () => {
      const svc = createPinInput(defaultConfig)
      svc.do(PinInputAction.Focus, { index: 0 })
      svc.do(PinInputAction.Input, { index: 0, value: '1' })
      svc.do(PinInputAction.Input, { index: 1, value: '2' })

      svc.do(PinInputAction.Clear, { index: 0 })
      assert.equal(svc.context.values[0], '')
      assert.equal(svc.context.values[1], '2')
      assert.equal(svc.context.focusedIndex, 0)
    })

    it('clears all fields when no index specified', () => {
      const svc = createPinInput(defaultConfig)
      svc.do(PinInputAction.Focus, { index: 0 })
      svc.do(PinInputAction.Input, { index: 0, value: '1' })
      svc.do(PinInputAction.Input, { index: 1, value: '2' })

      svc.do(PinInputAction.Clear, {})
      assert.deepEqual(svc.context.values, ['', '', '', ''])
    })

    it('clears from Completed state', () => {
      const svc = createPinInput(defaultConfig)
      svc.do(PinInputAction.Focus, { index: 0 })
      svc.do(PinInputAction.Input, { index: 0, value: '1' })
      svc.do(PinInputAction.Input, { index: 1, value: '2' })
      svc.do(PinInputAction.Input, { index: 2, value: '3' })
      svc.do(PinInputAction.Input, { index: 3, value: '4' })

      assert.equal(svc.state, PinInputState.Completed)
      svc.do(PinInputAction.Clear, { index: 1 })
      assert.equal(svc.state, PinInputState.Focused)
      assert.equal(svc.context.state, PinInputState.Focused)
    })
  })

  describe('paste operations', () => {
    it('pastes valid content across fields', () => {
      const svc = createPinInput(defaultConfig)
      svc.do(PinInputAction.Focus, { index: 0 })
      svc.do(PinInputAction.Paste, { content: '1234', startIndex: 0 })

      assert.deepEqual(svc.context.values, ['1', '2', '3', '4'])
      assert.equal(svc.context.focusedIndex, 3)
    })

    it('truncates paste exceeding field count', () => {
      const svc = createPinInput(defaultConfig)
      svc.do(PinInputAction.Focus, { index: 2 })
      svc.do(PinInputAction.Paste, { content: '789012', startIndex: 2 })

      assert.deepEqual(svc.context.values, ['', '', '7', '8'])
    })

    it('rejects paste with invalid content', () => {
      const svc = createPinInput(defaultConfig)
      svc.do(PinInputAction.Focus, { index: 0 })
      assert.equal(svc.do(PinInputAction.Paste, { content: 'abcd', startIndex: 0 }), false)
    })

    it('pastes from idle state', () => {
      const svc = createPinInput(defaultConfig)
      assert.ok(svc.do(PinInputAction.Paste, { content: '12', startIndex: 0 }))
      assert.equal(svc.state, PinInputState.Focused)
      assert.equal(svc.context.state, PinInputState.Focused)
      assert.deepEqual(svc.context.values, ['1', '2', '', ''])
    })
  })

  describe('submit', () => {
    it('submit only from Completed state', () => {
      const svc = createPinInput(defaultConfig)
      svc.do(PinInputAction.Focus, { index: 0 })
      assert.equal(svc.do(PinInputAction.Submit), false)

      svc.do(PinInputAction.Input, { index: 0, value: '1' })
      svc.do(PinInputAction.Input, { index: 1, value: '2' })
      svc.do(PinInputAction.Input, { index: 2, value: '3' })
      svc.do(PinInputAction.Input, { index: 3, value: '4' })

      assert.ok(svc.do(PinInputAction.Submit))
      assert.equal(svc.state, PinInputState.Completed)
      assert.equal(svc.context.state, PinInputState.Completed)
    })
  })

  describe('reset', () => {
    it('resets from Completed to Idle', () => {
      const svc = createPinInput(defaultConfig)
      svc.do(PinInputAction.Focus, { index: 0 })
      svc.do(PinInputAction.Input, { index: 0, value: '1' })
      svc.do(PinInputAction.Input, { index: 1, value: '2' })
      svc.do(PinInputAction.Input, { index: 2, value: '3' })
      svc.do(PinInputAction.Input, { index: 3, value: '4' })

      svc.do(PinInputAction.Reset)
      assert.equal(svc.state, PinInputState.Idle)
      assert.equal(svc.context.state, PinInputState.Idle)
      assert.deepEqual(svc.context.values, ['', '', '', ''])
      assert.equal(svc.context.focusedIndex, -1)
    })

    it('resets from Error to Idle', () => {
      const svc = createPinInput(defaultConfig)
      svc.do(PinInputAction.Focus, { index: 0 })
      svc.do(PinInputAction.Input, { index: 0, value: 'x' })
      assert.equal(svc.state, PinInputState.Error)

      svc.do(PinInputAction.Reset)
      assert.equal(svc.state, PinInputState.Idle)
      assert.equal(svc.context.state, PinInputState.Idle)
    })
  })

  describe('subscriptions', () => {
    it('notifies subscribers with correct context.state', () => {
      const svc = interpret(createPinInputMachine(defaultConfig))
      const seen: Array<{ contextState: PinInputState; state: PinInputState }> = []

      svc.subscribe((change) => {
        seen.push({
          contextState: change.context.state,
          state: change.state as PinInputState,
        })
      })

      svc.do(PinInputAction.Focus, { index: 0 })
      svc.do(PinInputAction.Input, { index: 0, value: '1' })
      svc.do(PinInputAction.Input, { index: 1, value: 'x' })

      assert.equal(seen.length, 3)
      for (const entry of seen) {
        assert.equal(entry.state, entry.contextState)
      }
    })
  })

  describe('draft', () => {
    it('draft context.state stays in sync', () => {
      const svc = createPinInput(defaultConfig)
      const draft = svc.draft()

      draft.do(PinInputAction.Focus, { index: 0 })
      assert.equal(draft.state, PinInputState.Focused)
      assert.equal(draft.context.state, PinInputState.Focused)

      // Service unchanged
      assert.equal(svc.state, PinInputState.Idle)
      assert.equal(svc.context.state, PinInputState.Idle)

      draft.commit()
      assert.equal(svc.state, PinInputState.Focused)
      assert.equal(svc.context.state, PinInputState.Focused)
    })
  })

  describe('edge cases', () => {
    it('single-field completion', () => {
      const svc = createPinInput({ length: 1, type: 'numeric' })
      svc.do(PinInputAction.Focus, { index: 0 })
      svc.do(PinInputAction.Input, { index: 0, value: '5' })

      assert.equal(svc.state, PinInputState.Completed)
      assert.equal(svc.context.state, PinInputState.Completed)
      assert.deepEqual(svc.context.values, ['5'])
    })

    it('alphanumeric input type', () => {
      const svc = createPinInput({ length: 4, type: 'alphanumeric' })
      svc.do(PinInputAction.Focus, { index: 0 })
      svc.do(PinInputAction.Input, { index: 0, value: 'A' })

      assert.equal(svc.state, PinInputState.Focused)
      assert.equal(svc.context.values[0], 'A')
    })

    it('Error → Focused via clear', () => {
      const svc = createPinInput(defaultConfig)
      svc.do(PinInputAction.Focus, { index: 0 })
      svc.do(PinInputAction.Input, { index: 0, value: 'x' })
      assert.equal(svc.state, PinInputState.Error)

      svc.do(PinInputAction.Clear, { index: 0 })
      assert.equal(svc.state, PinInputState.Focused)
      assert.equal(svc.context.state, PinInputState.Focused)
    })
  })
})
