/**
 * PIN Input State Machine — Discriminated Union Context
 *
 * Same behavior as `pin-input.ts` but uses a discriminated union context to
 * take advantage of state-aware context narrowing. Each state has its own
 * context variant, so guards and reducers receive narrowed types: a reducer
 * handling `Focused → Error` knows its input is `PinInputFocusedContext` and
 * its output must be `PinInputErrorContext`. Wrong-variant returns are caught
 * at compile time.
 *
 * The `state` discriminant is injected by the machine after every transition,
 * keeping `context.state` in sync with `service.state` automatically.
 *
 * Important: when using string enums as state identifiers, the context variant's
 * `state` property must use the enum member type (e.g. `PinInputState.Focused`),
 * not the raw string literal (`'FOCUSED'`). TypeScript treats string enum members
 * as nominal subtypes of their string values — `Extract` only matches when both
 * sides use the same enum type.
 */

import { interpret, reconcileContext, stateMachine } from '../src/index'

// ── States and actions ──────────────────────────────────────────────

export enum PinInputState {
  Completed = 'COMPLETED',
  Error = 'ERROR',
  Focused = 'FOCUSED',
  Idle = 'IDLE',
}

export enum PinInputAction {
  Blur = 'BLUR',
  Clear = 'CLEAR',
  Focus = 'FOCUS',
  Input = 'INPUT',
  Navigate = 'NAVIGATE',
  Paste = 'PASTE',
  Reset = 'RESET',
  Submit = 'SUBMIT',
}

// ── Action payloads ─────────────────────────────────────────────────

export interface FocusPayload {
  index: number
}

export interface InputPayload {
  index: number
  value: string
}

export interface ClearPayload {
  index?: number
}

export interface PastePayload {
  content: string
  startIndex: number
}

export interface NavigatePayload {
  currentIndex: number
  direction: 'backspace' | 'left' | 'right'
}

// ── Configuration ───────────────────────────────────────────────────

export interface PinInputConfig {
  length: number
  type: 'alphanumeric' | 'numeric'
  masked?: boolean
}

// ── Discriminated context variants ──────────────────────────────────

/** Shared fields present in every variant. */
interface PinInputContextBase {
  config: PinInputConfig
  values: string[]
}

/** No field has focus — initial state and after blur/reset. */
export interface PinInputIdleContext extends PinInputContextBase {
  focusedIndex: -1
  state: PinInputState.Idle
}

/** A specific field is focused and ready for input or navigation. */
export interface PinInputFocusedContext extends PinInputContextBase {
  focusedIndex: number
  state: PinInputState.Focused
}

/** All fields contain valid values — ready for submission. */
export interface PinInputCompletedContext extends PinInputContextBase {
  focusedIndex: number
  state: PinInputState.Completed
}

/** Invalid input detected — requires correction before proceeding. */
export interface PinInputErrorContext extends PinInputContextBase {
  error: string
  focusedIndex: number
  state: PinInputState.Error
}

/** The discriminated union over all states. */
export type PinInputContext =
  | PinInputCompletedContext
  | PinInputErrorContext
  | PinInputFocusedContext
  | PinInputIdleContext

// ── Validation helpers ──────────────────────────────────────────────

function isValidInputCharacter(value: string, type: 'alphanumeric' | 'numeric'): boolean {
  if (value.length === 0) return true

  switch (type) {
    case 'alphanumeric':
      return /^[a-z0-9]+$/i.test(value)
    case 'numeric':
      return /^\d+$/.test(value)
    default:
      return false
  }
}

function isValidInput(value: string, type: 'alphanumeric' | 'numeric'): boolean {
  return value.length > 0 && isValidInputCharacter(value, type)
}

// ── Machine ─────────────────────────────────────────────────────────

/**
 * Creates a PIN input state machine with discriminated union context.
 *
 * Cross-variant reducers (e.g. Idle → Focused, Focused → Error) receive
 * narrowed context types automatically. Self-transition reducers
 * (e.g. Focused → Focused) use explicit annotations since TypeScript
 * cannot contextually type through optional rest parameters.
 *
 * @param config - Configuration specifying field count, input type, and display options
 * @returns Configured state machine ready for interpretation and use
 */
export function createPinInputMachine(config: PinInputConfig) {
  return (
    stateMachine()
      .state(PinInputState.Idle)
      .state(PinInputState.Focused)
      .state(PinInputState.Completed)
      .state(PinInputState.Error)
      .initial(PinInputState.Idle)
      .action<PinInputAction.Focus, FocusPayload>(PinInputAction.Focus)
      .action<PinInputAction.Input, InputPayload>(PinInputAction.Input)
      .action<PinInputAction.Clear, ClearPayload>(PinInputAction.Clear)
      .action<PinInputAction.Paste, PastePayload>(PinInputAction.Paste)
      .action<PinInputAction.Navigate, NavigatePayload>(PinInputAction.Navigate)
      .action(PinInputAction.Submit)
      .action(PinInputAction.Blur)
      .action(PinInputAction.Reset)
      .context<PinInputContext>(() => ({
        config,
        focusedIndex: -1 as const,
        state: PinInputState.Idle as const,
        values: new Array<string>(config.length).fill(''),
      }))

      // ── Focus transitions ───────────────────────────────────────

      // Idle → Focused: cross-variant, narrowing is automatic
      .transition(
        PinInputState.Idle,
        PinInputAction.Focus,
        PinInputState.Focused,
        (context, action) =>
          reconcileContext(context, {
            config: context.config,
            focusedIndex: Math.max(0, Math.min(action.payload.index, context.config.length - 1)),
            state: PinInputState.Focused as const,
            values: context.values,
          }),
      )

      // Focused → Focused: self-transition, narrowing automatic with enum types
      .transition(
        PinInputState.Focused,
        PinInputAction.Focus,
        PinInputState.Focused,
        (context, action) => ({
          ...context,
          focusedIndex: Math.max(0, Math.min(action.payload.index, context.config.length - 1)),
        }),
      )

      // ── Input transitions ───────────────────────────────────────

      // Focused → Completed: valid input fills the last empty field
      .transition(
        PinInputState.Focused,
        [
          PinInputAction.Input,
          (context, action) => {
            const { index, value } = action.payload
            if (!isValidInput(value, context.config.type)) return false

            const newValues = [...context.values]
            newValues[index] = value
            return newValues.every((v) => v !== '')
          },
        ],
        PinInputState.Completed,
        (context, action) => {
          const { index, value } = action.payload
          const newValues = [...context.values]
          newValues[index] = value

          return reconcileContext(context, {
            config: context.config,
            focusedIndex: index,
            state: PinInputState.Completed as const,
            values: newValues,
          })
        },
      )

      // Focused → Focused: valid input, still has empty fields
      .transition(
        PinInputState.Focused,
        [
          PinInputAction.Input,
          (context, action) => {
            const { index, value } = action.payload
            if (!isValidInput(value, context.config.type)) return false
            if (index < 0 || index >= context.config.length) return false

            const newValues = [...context.values]
            newValues[index] = value
            return !newValues.every((v) => v !== '')
          },
        ],
        PinInputState.Focused,
        (context, action) => {
          const { index, value } = action.payload
          const newValues = [...context.values]
          newValues[index] = value

          const isComplete = newValues.every((v) => v !== '')
          const nextIndex = isComplete || index === context.config.length - 1 ? index : index + 1

          return {
            ...context,
            focusedIndex: nextIndex,
            values: newValues,
          }
        },
      )

      // Focused → Error: invalid input, cross-variant
      .transition(
        PinInputState.Focused,
        [
          PinInputAction.Input,
          (context, action) => !isValidInput(action.payload.value, context.config.type),
        ],
        PinInputState.Error,
        (context, action) =>
          reconcileContext(context, {
            config: context.config,
            error: `Invalid ${context.config.type} input: "${action.payload.value}"`,
            focusedIndex: context.focusedIndex,
            state: PinInputState.Error as const,
            values: context.values,
          }),
      )

      // ── Clear transitions ───────────────────────────────────────

      // [Focused, Completed, Error] → Focused: cross-variant (union source)
      .transition(
        [PinInputState.Focused, PinInputState.Completed, PinInputState.Error],
        PinInputAction.Clear,
        PinInputState.Focused,
        (context, action) => {
          const { index } = action.payload
          let newValues = [...context.values]

          if (index !== undefined && index >= 0 && index < context.config.length) {
            newValues[index] = ''
          } else {
            newValues = new Array<string>(context.config.length).fill('')
          }

          return reconcileContext(context, {
            config: context.config,
            focusedIndex: index ?? 0,
            state: PinInputState.Focused as const,
            values: newValues,
          })
        },
      )

      // ── Paste transitions ───────────────────────────────────────

      // Idle → Focused: cross-variant
      .transition(
        PinInputState.Idle,
        [
          PinInputAction.Paste,
          (context, action) => {
            const { content, startIndex } = action.payload
            return (
              startIndex >= 0 &&
              startIndex < context.config.length &&
              content.length > 0 &&
              isValidInput(content, context.config.type)
            )
          },
        ],
        PinInputState.Focused,
        (context, action) => {
          const { content, startIndex } = action.payload
          const newValues = [...context.values]
          const chars = content.split('').slice(0, context.config.length - startIndex)

          for (const [index, char] of chars.entries()) {
            const targetIndex = startIndex + index
            if (targetIndex < context.config.length && isValidInput(char, context.config.type)) {
              newValues[targetIndex] = char
            }
          }

          const nextIndex = Math.min(startIndex + chars.length - 1, context.config.length - 1)

          return reconcileContext(context, {
            config: context.config,
            focusedIndex: nextIndex,
            state: PinInputState.Focused as const,
            values: newValues,
          })
        },
      )

      // Focused → Focused: self-transition
      .transition(
        PinInputState.Focused,
        [
          PinInputAction.Paste,
          (context, action) => {
            const { content, startIndex } = action.payload
            return (
              startIndex >= 0 &&
              startIndex < context.config.length &&
              content.length > 0 &&
              isValidInput(content, context.config.type)
            )
          },
        ],
        PinInputState.Focused,
        (context, action) => {
          const { content, startIndex } = action.payload
          const newValues = [...context.values]
          const chars = content.split('').slice(0, context.config.length - startIndex)

          for (const [index, char] of chars.entries()) {
            const targetIndex = startIndex + index
            if (targetIndex < context.config.length && isValidInput(char, context.config.type)) {
              newValues[targetIndex] = char
            }
          }

          const nextIndex = Math.min(startIndex + chars.length - 1, context.config.length - 1)

          return {
            ...context,
            focusedIndex: nextIndex,
            values: newValues,
          }
        },
      )

      // ── Navigation ──────────────────────────────────────────────

      // Focused → Focused: self-transition
      .transition(
        PinInputState.Focused,
        PinInputAction.Navigate,
        PinInputState.Focused,
        (context, action) => {
          const { currentIndex, direction } = action.payload
          let newIndex = currentIndex

          switch (direction) {
            case 'left':
              newIndex = Math.max(0, currentIndex - 1)
              break
            case 'right':
              newIndex = Math.min(context.config.length - 1, currentIndex + 1)
              break
            case 'backspace':
              if (context.values[currentIndex] === '' && currentIndex > 0) {
                newIndex = currentIndex - 1
                const newValues = [...context.values]
                newValues[newIndex] = ''
                return {
                  ...context,
                  focusedIndex: newIndex,
                  values: newValues,
                }
              } else {
                const newValues = [...context.values]
                newValues[currentIndex] = ''
                return {
                  ...context,
                  focusedIndex: currentIndex,
                  values: newValues,
                }
              }
          }

          return {
            ...context,
            focusedIndex: newIndex,
          }
        },
      )

      // ── Submit ──────────────────────────────────────────────────

      // Completed → Completed: self-transition
      .transition(
        PinInputState.Completed,
        PinInputAction.Submit,
        PinInputState.Completed,
        (context) => context,
      )

      // ── Blur transitions ────────────────────────────────────────

      // [Focused, Error] → Idle: cross-variant
      .transition(
        [PinInputState.Focused, PinInputState.Error],
        PinInputAction.Blur,
        PinInputState.Idle,
        (context) =>
          reconcileContext(context, {
            config: context.config,
            focusedIndex: -1 as const,
            state: PinInputState.Idle as const,
            values: context.values,
          }),
      )

      // ── Reset transitions ───────────────────────────────────────

      // [Focused, Completed, Error] → Idle: cross-variant
      .transition(
        [PinInputState.Focused, PinInputState.Completed, PinInputState.Error],
        PinInputAction.Reset,
        PinInputState.Idle,
        (context) => {
          const value = reconcileContext(context, {
            config: context.config,
            focusedIndex: -1 as const,
            state: PinInputState.Idle as const,
            values: new Array<string>(context.config.length).fill(''),
          })

          return value
        },
      )
  )
}

export function createPinInput(config: PinInputConfig) {
  return interpret(createPinInputMachine(config))
}
