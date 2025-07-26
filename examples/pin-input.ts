/**
 * PIN Input State Machine
 *
 * Demonstrates complex state management for multi-field input components like PIN entry,
 * verification codes, or credit card numbers. The state machine coordinates focus management,
 * input validation, keyboard navigation, and paste operations while maintaining type safety
 * and predictable state transitions.
 *
 * Key capabilities:
 * - Automatic focus advancement and backspace navigation
 * - Intelligent paste operations across multiple fields
 * - Input validation with error state handling
 * - Complete state coordination without external state management
 *
 * @example
 * ```typescript
 * import { createPinInput, PinInputAction } from './pin-input'
 *
 * // Create a 6-digit verification code input
 * const verificationInput = createPinInput({ length: 6, type: 'numeric' })
 *
 * // Handle user interactions with automatic state management
 * verificationInput.do(PinInputAction.Focus, { index: 0 })
 * verificationInput.do(PinInputAction.Input, { value: '1', index: 0 }) // Auto-advances to index 1
 *
 * // Paste "123456" starting at index 2 - automatically fills remaining fields
 * verificationInput.do(PinInputAction.Paste, { content: '123456', startIndex: 2 })
 *
 * // State machine handles completion detection
 * if (verificationInput.state === 'COMPLETED') {
 *   const code = verificationInput.context.values.join('') // "111234"
 *   await submitVerificationCode(code)
 * }
 * ```
 */

import { interpret, stateMachine } from '../src/index'

/**
 * PIN input component states
 *
 * The state machine uses four distinct states to coordinate user interactions
 * and provide clear boundaries for UI rendering and event handling.
 */
export enum PinInputState {
  /** No field has focus - initial state and after blur events */
  Idle = 'IDLE',
  /** A specific field is focused and ready for input or navigation */
  Focused = 'FOCUSED',
  /** All required fields contain valid values - ready for submission */
  Completed = 'COMPLETED',
  /** Invalid input detected - requires user correction before proceeding */
  Error = 'ERROR',
}

/**
 * PIN input component actions
 *
 * Actions represent all possible user interactions and programmatic operations.
 * Each action carries typed payload data for state transitions and updates.
 */
export enum PinInputAction {
  /** Focus a specific field - typically from click or programmatic control */
  Focus = 'FOCUS',
  /** Input a character into a field - triggers validation and auto-advance */
  Input = 'INPUT',
  /** Clear one field or reset all fields to empty state */
  Clear = 'CLEAR',
  /** Paste multi-character content across consecutive fields */
  Paste = 'PASTE',
  /** Navigate between fields using arrow keys or backspace */
  Navigate = 'NAVIGATE',
  /** Submit the completed PIN for processing */
  Submit = 'SUBMIT',
  /** Remove focus from all fields - typically from outside click */
  Blur = 'BLUR',
  /** Reset all fields and return to initial idle state */
  Reset = 'RESET',
}

/**
 * Focus action payload
 */
export interface FocusPayload {
  /** Index of the field to focus */
  index: number
}

/**
 * Input action payload
 */
export interface InputPayload {
  /** Value to input */
  value: string
  /** Index of the field being modified */
  index: number
}

/**
 * Clear action payload
 */
export interface ClearPayload {
  /** Index of the field to clear, or undefined to clear all */
  index?: number
}

/**
 * Paste action payload
 */
export interface PastePayload {
  /** Content to paste */
  content: string
  /** Starting index for paste operation */
  startIndex: number
}

/**
 * Navigate action payload
 */
export interface NavigatePayload {
  /** Direction to navigate */
  direction: 'backspace' | 'left' | 'right'
  /** Current field index */
  currentIndex: number
}

/**
 * Pin input configuration
 */
export interface PinInputConfig {
  /** Number of input fields */
  length: number
  /** Type of input allowed */
  type: 'alphanumeric' | 'numeric'
  /** Whether to mask input values */
  masked?: boolean
}

/**
 * Pin input component context
 */
export interface PinInputContext {
  /** Current values in each field */
  values: string[]
  /** Index of currently focused field */
  focusedIndex: number
  /** Configuration for the PIN input */
  config: PinInputConfig
  /** Whether the input is complete */
  isComplete: boolean
  /** Error message if any */
  error?: string
}

/**
 * Creates a PIN input state machine that coordinates multi-field input behavior
 *
 * Constructs a state machine with intelligent transition logic for common PIN input
 * scenarios. The machine handles focus management, input validation, automatic
 * field advancement, paste operations, and keyboard navigation without requiring
 * external state coordination.
 *
 * The state machine uses conditional transitions to implement complex behaviors:
 * - Input validation with immediate error feedback
 * - Automatic completion detection when all fields are filled
 * - Smart focus advancement that respects field boundaries
 * - Paste operations that distribute content across consecutive fields
 *
 * @param config - Configuration specifying field count, input type, and display options
 * @returns Configured state machine ready for interpretation and use
 */
export function createPinInputMachine(config: PinInputConfig) {
  const initialContext: PinInputContext = {
    config,
    focusedIndex: -1,
    isComplete: false,
    values: new Array<string>(config.length).fill(''),
  }

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
      .context<PinInputContext>(initialContext)
      // Focus transitions
      .transition(
        PinInputState.Idle,
        PinInputAction.Focus,
        PinInputState.Focused,
        (context, action) => ({
          ...context,
          focusedIndex: Math.max(0, Math.min(action.payload.index, context.config.length - 1)),
        }),
      )
      .transition(
        PinInputState.Focused,
        PinInputAction.Focus,
        PinInputState.Focused,
        (context, action) => ({
          ...context,
          focusedIndex: Math.max(0, Math.min(action.payload.index, context.config.length - 1)),
        }),
      )
      // Highest priority: transition to completed state when input fills the last empty field
      .transition(
        PinInputState.Focused,
        [
          PinInputAction.Input,
          (context, action) => {
            const { index, value } = action.payload
            if (!isValidInput(value, context.config.type)) return false

            const newValues = [...context.values]
            newValues[index] = value
            return newValues.every((v) => v !== '') // All fields now filled
          },
        ],
        PinInputState.Completed,
        (context, action) => {
          const { index, value } = action.payload
          const newValues = [...context.values]
          newValues[index] = value

          return {
            ...context,
            error: undefined,
            focusedIndex: index,
            isComplete: true,
            values: newValues,
          }
        },
      )
      // Standard input: valid input that doesn't complete all fields
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
            return !newValues.every((v) => v !== '') // Still has empty fields
          },
        ],
        PinInputState.Focused,
        (context, action) => {
          const { index, value } = action.payload
          const newValues = [...context.values]
          newValues[index] = value

          const isComplete = newValues.every((v) => v !== '')
          // Auto-advance to next field unless at the last field or already complete
          const nextIndex = isComplete || index === context.config.length - 1 ? index : index + 1

          return {
            ...context,
            error: undefined,
            focusedIndex: nextIndex,
            isComplete,
            values: newValues,
          }
        },
      )
      // Invalid input transitions to error state
      .transition(
        PinInputState.Focused,
        [
          PinInputAction.Input,
          (context, action) => !isValidInput(action.payload.value, context.config.type),
        ],
        PinInputState.Error,
        (context, action) => ({
          ...context,
          error: `Invalid ${context.config.type} input: "${action.payload.value}"`,
        }),
      )
      // Clear field transitions
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

          return {
            ...context,
            error: undefined,
            focusedIndex: index ?? 0,
            isComplete: false,
            values: newValues,
          }
        },
      )
      // Paste operation
      .transition(
        [PinInputState.Idle, PinInputState.Focused],
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

          chars.forEach((char, index) => {
            const targetIndex = startIndex + index
            if (targetIndex < context.config.length && isValidInput(char, context.config.type)) {
              newValues[targetIndex] = char
            }
          })

          const isComplete = newValues.every((v) => v !== '')
          const nextIndex = Math.min(startIndex + chars.length - 1, context.config.length - 1)

          return {
            ...context,
            error: undefined,
            focusedIndex: nextIndex,
            isComplete,
            values: newValues,
          }
        },
      )
      // Navigation between fields
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
                // Empty field: move to previous field and clear it (natural backspace behavior)
                newIndex = currentIndex - 1
                const newValues = [...context.values]
                newValues[newIndex] = ''
                return {
                  ...context,
                  focusedIndex: newIndex,
                  isComplete: false,
                  values: newValues,
                }
              } else {
                // Current field has content: clear it and stay focused here
                const newValues = [...context.values]
                newValues[currentIndex] = ''
                return {
                  ...context,
                  focusedIndex: currentIndex,
                  isComplete: false,
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
      // Submit completed PIN
      .transition(
        PinInputState.Completed,
        PinInputAction.Submit,
        PinInputState.Completed,
        (context) => context,
      )
      // Blur transitions
      .transition(
        [PinInputState.Focused, PinInputState.Error],
        PinInputAction.Blur,
        PinInputState.Idle,
        (context) => ({
          ...context,
          error: undefined,
          focusedIndex: -1,
        }),
      )
      // Reset transitions
      .transition(
        [PinInputState.Focused, PinInputState.Completed, PinInputState.Error],
        PinInputAction.Reset,
        PinInputState.Idle,
        (context) => ({
          ...context,
          error: undefined,
          focusedIndex: -1,
          isComplete: false,
          values: new Array<string>(context.config.length).fill(''),
        }),
      )
  )
}

/**
 * Validates character content without enforcing non-empty requirement
 *
 * Used for paste operations and clearing where empty strings are valid.
 * Checks that all characters in the input match the specified type.
 *
 * @param value - String to validate (may be empty)
 * @param type - Input type constraint
 * @returns True if empty or all characters are valid for the specified type
 */
function isValidInputCharacter(value: string, type: 'alphanumeric' | 'numeric'): boolean {
  if (value.length === 0) return true // Allow empty for clearing operations

  switch (type) {
    case 'alphanumeric':
      return /^[a-z0-9]+$/i.test(value)
    case 'numeric':
      return /^\d+$/.test(value)
    default:
      return false
  }
}

/**
 * Validates input for field entry operations
 *
 * Used by input transitions to ensure users can only enter valid, non-empty
 * characters. Rejects empty strings since field entry requires actual content.
 *
 * @param value - Value to validate for field entry
 * @param type - Input type constraint
 * @returns True only if input is non-empty and matches the specified type
 */
function isValidInput(value: string, type: 'alphanumeric' | 'numeric'): boolean {
  return value.length > 0 && isValidInputCharacter(value, type)
}

/**
 * Creates a ready-to-use PIN input service
 *
 * Convenience function that creates and immediately interprets a PIN input state machine.
 * The returned service is ready for immediate use with action dispatching and state observation.
 *
 * @param config - PIN input configuration specifying length, type, and options
 * @returns Active state machine service ready for user interactions
 */
export function createPinInput(config: PinInputConfig) {
  return interpret(createPinInputMachine(config))
}
