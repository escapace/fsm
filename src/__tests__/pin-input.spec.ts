/**
 * Pin Input State Machine Test Suite
 *
 * This test suite demonstrates comprehensive testing of a PIN input component
 * state machine implementation. It covers all major user interactions, edge cases,
 * and state transitions that occur in real-world PIN entry scenarios.
 */

import { assert, describe, it } from 'vitest'
import {
  type PinInputConfig,
  PinInputAction,
  PinInputState,
  createPinInput,
  createPinInputMachine,
} from '../../examples/pin-input'
import { interpret } from '../index'

describe('Pin Input State Machine', () => {
  const defaultConfig: PinInputConfig = {
    length: 4,
    type: 'numeric',
  }

  describe('Initial State', () => {
    it('starts in idle state with empty values', () => {
      const pinInput = createPinInput(defaultConfig)

      assert.equal(pinInput.state, PinInputState.Idle)
      assert.deepEqual(pinInput.context.values, ['', '', '', ''])
      assert.equal(pinInput.context.focusedIndex, -1)
      assert.equal(pinInput.context.isComplete, false)
      assert.equal(pinInput.context.config.length, 4)
      assert.equal(pinInput.context.config.type, 'numeric')
    })

    it('initializes with custom configuration', () => {
      const config: PinInputConfig = {
        length: 6,
        masked: true,
        type: 'alphanumeric',
      }
      const pinInput = createPinInput(config)

      assert.equal(pinInput.context.config.length, 6)
      assert.equal(pinInput.context.config.type, 'alphanumeric')
      assert.equal(pinInput.context.config.masked, true)
      assert.deepEqual(pinInput.context.values, ['', '', '', '', '', ''])
    })
  })

  describe('Focus Management', () => {
    it('transitions from idle to focused on focus action', () => {
      const pinInput = createPinInput(defaultConfig)

      const result = pinInput.do(PinInputAction.Focus, { index: 0 })

      assert.equal(result, true)
      assert.equal(pinInput.state, PinInputState.Focused)
      assert.equal(pinInput.context.focusedIndex, 0)
    })

    it('clamps focus index to valid range', () => {
      const pinInput = createPinInput(defaultConfig)

      pinInput.do(PinInputAction.Focus, { index: 10 })
      assert.equal(pinInput.context.focusedIndex, 3) // Clamped to length - 1

      pinInput.do(PinInputAction.Focus, { index: -5 })
      assert.equal(pinInput.context.focusedIndex, 0) // Clamped to 0
    })

    it('transitions to idle on blur action', () => {
      const pinInput = createPinInput(defaultConfig)

      pinInput.do(PinInputAction.Focus, { index: 1 })
      assert.equal(pinInput.state, PinInputState.Focused)

      pinInput.do(PinInputAction.Blur)
      assert.equal(pinInput.state, PinInputState.Idle)
      assert.equal(pinInput.context.focusedIndex, -1)
    })
  })

  describe('Input Handling', () => {
    it('accepts valid numeric input', () => {
      const pinInput = createPinInput(defaultConfig)

      pinInput.do(PinInputAction.Focus, { index: 0 })
      const result = pinInput.do(PinInputAction.Input, { index: 0, value: '1' })

      assert.equal(result, true)
      assert.equal(pinInput.context.values[0], '1')
      assert.equal(pinInput.context.focusedIndex, 1) // Auto-advance
    })

    it('rejects invalid input and transitions to error state', () => {
      const pinInput = createPinInput(defaultConfig)

      pinInput.do(PinInputAction.Focus, { index: 0 })
      const result = pinInput.do(PinInputAction.Input, { index: 0, value: 'a' })

      assert.equal(result, true)
      assert.equal(pinInput.state, PinInputState.Error)
      assert.equal(pinInput.context.error, 'Invalid numeric input: "a"')
      assert.equal(pinInput.context.values[0], '') // Value not set
    })

    it('accepts alphanumeric input when configured', () => {
      const config: PinInputConfig = { length: 4, type: 'alphanumeric' }
      const pinInput = createPinInput(config)

      pinInput.do(PinInputAction.Focus, { index: 0 })
      pinInput.do(PinInputAction.Input, { index: 0, value: 'A' })

      assert.equal(pinInput.state, PinInputState.Focused)
      assert.equal(pinInput.context.values[0], 'A')
    })

    it('rejects input at invalid index', () => {
      const pinInput = createPinInput(defaultConfig)

      pinInput.do(PinInputAction.Focus, { index: 0 })
      const result = pinInput.do(PinInputAction.Input, { index: 10, value: '1' })

      assert.equal(result, false) // Transition failed
      assert.equal(pinInput.context.values[0], '') // No change
    })

    it('transitions to completed state when all fields are filled', () => {
      const pinInput = createPinInput(defaultConfig)

      pinInput.do(PinInputAction.Focus, { index: 0 })
      pinInput.do(PinInputAction.Input, { index: 0, value: '1' })
      pinInput.do(PinInputAction.Input, { index: 1, value: '2' })
      pinInput.do(PinInputAction.Input, { index: 2, value: '3' })
      pinInput.do(PinInputAction.Input, { index: 3, value: '4' })

      assert.equal(pinInput.state, PinInputState.Completed)
      assert.equal(pinInput.context.isComplete, true)
      assert.deepEqual(pinInput.context.values, ['1', '2', '3', '4'])
    })
  })

  describe('Navigation', () => {
    it('navigates left between fields', () => {
      const pinInput = createPinInput(defaultConfig)

      pinInput.do(PinInputAction.Focus, { index: 2 })
      pinInput.do(PinInputAction.Navigate, {
        currentIndex: 2,
        direction: 'left',
      })

      assert.equal(pinInput.context.focusedIndex, 1)
    })

    it('navigates right between fields', () => {
      const pinInput = createPinInput(defaultConfig)

      pinInput.do(PinInputAction.Focus, { index: 1 })
      pinInput.do(PinInputAction.Navigate, {
        currentIndex: 1,
        direction: 'right',
      })

      assert.equal(pinInput.context.focusedIndex, 2)
    })

    it('handles backspace navigation and clearing', () => {
      const pinInput = createPinInput(defaultConfig)

      // Fill some values first
      pinInput.do(PinInputAction.Focus, { index: 0 })
      pinInput.do(PinInputAction.Input, { index: 0, value: '1' })
      pinInput.do(PinInputAction.Input, { index: 1, value: '2' })

      // After input, focus should be at index 2
      assert.equal(pinInput.context.focusedIndex, 2)

      // Check the values - field 2 should be empty
      assert.deepEqual(pinInput.context.values, ['1', '2', '', ''])

      // Backspace on empty field moves to previous and clears it
      pinInput.do(PinInputAction.Navigate, {
        currentIndex: 2,
        direction: 'backspace',
      })

      assert.equal(pinInput.context.values[1], '') // Previous field cleared
      assert.equal(pinInput.context.focusedIndex, 1) // Moved to previous field

      // Now add content to current field and test backspace on content
      pinInput.do(PinInputAction.Input, { index: 1, value: '3' })
      assert.equal(pinInput.context.focusedIndex, 2) // Auto-advance

      // Backspace on empty field 2 again
      pinInput.do(PinInputAction.Navigate, {
        currentIndex: 2,
        direction: 'backspace',
      })

      assert.equal(pinInput.context.values[1], '') // Previous field cleared again
      assert.equal(pinInput.context.focusedIndex, 1) // Moved to previous field
    })

    it('constrains navigation to valid indices', () => {
      const pinInput = createPinInput(defaultConfig)

      pinInput.do(PinInputAction.Focus, { index: 0 })

      // Try to navigate left from first field
      pinInput.do(PinInputAction.Navigate, {
        currentIndex: 0,
        direction: 'left',
      })
      assert.equal(pinInput.context.focusedIndex, 0) // Stays at 0

      // Navigate to last field
      pinInput.do(PinInputAction.Focus, { index: 3 })

      // Try to navigate right from last field
      pinInput.do(PinInputAction.Navigate, {
        currentIndex: 3,
        direction: 'right',
      })
      assert.equal(pinInput.context.focusedIndex, 3) // Stays at 3
    })
  })

  describe('Clear Operations', () => {
    it('clears specific field', () => {
      const pinInput = createPinInput(defaultConfig)

      // Fill some values
      pinInput.do(PinInputAction.Focus, { index: 0 })
      pinInput.do(PinInputAction.Input, { index: 0, value: '1' })
      pinInput.do(PinInputAction.Input, { index: 1, value: '2' })

      // Clear specific field
      pinInput.do(PinInputAction.Clear, { index: 0 })

      assert.equal(pinInput.context.values[0], '')
      assert.equal(pinInput.context.values[1], '2') // Other field unchanged
      assert.equal(pinInput.context.focusedIndex, 0) // Focus moves to cleared field
      assert.equal(pinInput.context.isComplete, false)
    })

    it('clears all fields when no index specified', () => {
      const pinInput = createPinInput(defaultConfig)

      // Fill some values
      pinInput.do(PinInputAction.Focus, { index: 0 })
      pinInput.do(PinInputAction.Input, { index: 0, value: '1' })
      pinInput.do(PinInputAction.Input, { index: 1, value: '2' })

      // Clear all fields
      pinInput.do(PinInputAction.Clear, {})

      assert.deepEqual(pinInput.context.values, ['', '', '', ''])
      assert.equal(pinInput.context.focusedIndex, 0)
      assert.equal(pinInput.context.isComplete, false)
    })

    it('clears from completed state', () => {
      const pinInput = createPinInput(defaultConfig)

      // Complete the PIN
      pinInput.do(PinInputAction.Focus, { index: 0 })
      pinInput.do(PinInputAction.Input, { index: 0, value: '1' })
      pinInput.do(PinInputAction.Input, { index: 1, value: '2' })
      pinInput.do(PinInputAction.Input, { index: 2, value: '3' })
      pinInput.do(PinInputAction.Input, { index: 3, value: '4' })

      assert.equal(pinInput.state, PinInputState.Completed)

      // Clear one field
      pinInput.do(PinInputAction.Clear, { index: 1 })

      assert.equal(pinInput.state, PinInputState.Focused)
      assert.equal(pinInput.context.values[1], '')
      assert.equal(pinInput.context.isComplete, false)
    })
  })

  describe('Paste Operations', () => {
    it('pastes valid content across multiple fields', () => {
      const pinInput = createPinInput(defaultConfig)

      pinInput.do(PinInputAction.Focus, { index: 0 })
      const result = pinInput.do(PinInputAction.Paste, {
        content: '1234',
        startIndex: 0,
      })

      assert.equal(result, true)
      assert.deepEqual(pinInput.context.values, ['1', '2', '3', '4'])
      assert.equal(pinInput.context.focusedIndex, 3)
      assert.equal(pinInput.context.isComplete, true)
    })

    it('pastes partial content starting from middle', () => {
      const pinInput = createPinInput(defaultConfig)

      pinInput.do(PinInputAction.Focus, { index: 1 })
      pinInput.do(PinInputAction.Paste, {
        content: '23',
        startIndex: 1,
      })

      assert.deepEqual(pinInput.context.values, ['', '2', '3', ''])
      assert.equal(pinInput.context.focusedIndex, 2)
      assert.equal(pinInput.context.isComplete, false)
    })

    it('truncates paste content that exceeds field count', () => {
      const pinInput = createPinInput(defaultConfig)

      pinInput.do(PinInputAction.Focus, { index: 2 })
      pinInput.do(PinInputAction.Paste, {
        content: '789012', // Only '78' should fit
        startIndex: 2,
      })

      assert.deepEqual(pinInput.context.values, ['', '', '7', '8'])
      assert.equal(pinInput.context.focusedIndex, 3)
    })

    it('rejects paste with invalid content', () => {
      const pinInput = createPinInput(defaultConfig)

      pinInput.do(PinInputAction.Focus, { index: 0 })
      const result = pinInput.do(PinInputAction.Paste, {
        content: 'abcd', // Invalid for numeric type
        startIndex: 0,
      })

      assert.equal(result, false) // Transition failed
      assert.deepEqual(pinInput.context.values, ['', '', '', '']) // No change
    })

    it('rejects paste at invalid start index', () => {
      const pinInput = createPinInput(defaultConfig)

      const result = pinInput.do(PinInputAction.Paste, {
        content: '1234',
        startIndex: 10, // Invalid index
      })

      assert.equal(result, false)
    })
  })

  describe('Submit Operations', () => {
    it('allows submit only from completed state', () => {
      const pinInput = createPinInput(defaultConfig)

      // Try to submit from non-completed state
      pinInput.do(PinInputAction.Focus, { index: 0 })
      const incompleteResult = pinInput.do(PinInputAction.Submit)
      assert.equal(incompleteResult, false)

      // Complete the PIN and submit
      pinInput.do(PinInputAction.Input, { index: 0, value: '1' })
      pinInput.do(PinInputAction.Input, { index: 1, value: '2' })
      pinInput.do(PinInputAction.Input, { index: 2, value: '3' })
      pinInput.do(PinInputAction.Input, { index: 3, value: '4' })

      const completeResult = pinInput.do(PinInputAction.Submit)
      assert.equal(completeResult, true)
      assert.equal(pinInput.state, PinInputState.Completed) // Stays in completed state
    })
  })

  describe('Reset Operations', () => {
    it('resets from any state to initial state', () => {
      const pinInput = createPinInput(defaultConfig)

      // Complete the PIN
      pinInput.do(PinInputAction.Focus, { index: 0 })
      pinInput.do(PinInputAction.Input, { index: 0, value: '1' })
      pinInput.do(PinInputAction.Input, { index: 1, value: '2' })
      pinInput.do(PinInputAction.Input, { index: 2, value: '3' })
      pinInput.do(PinInputAction.Input, { index: 3, value: '4' })

      assert.equal(pinInput.state, PinInputState.Completed)

      // Reset
      pinInput.do(PinInputAction.Reset)

      assert.equal(pinInput.state, PinInputState.Idle)
      assert.deepEqual(pinInput.context.values, ['', '', '', ''])
      assert.equal(pinInput.context.focusedIndex, -1)
      assert.equal(pinInput.context.isComplete, false)
      assert.equal(pinInput.context.error, undefined)
    })

    it('resets from error state', () => {
      const pinInput = createPinInput(defaultConfig)

      pinInput.do(PinInputAction.Focus, { index: 0 })
      pinInput.do(PinInputAction.Input, { index: 0, value: 'x' }) // Invalid input

      assert.equal(pinInput.state, PinInputState.Error)
      assert.equal(pinInput.context.error, 'Invalid numeric input: "x"')

      pinInput.do(PinInputAction.Reset)

      assert.equal(pinInput.state, PinInputState.Idle)
      assert.equal(pinInput.context.error, undefined)
    })
  })

  describe('State Change Subscriptions', () => {
    it('notifies subscribers of state changes', () => {
      const machine = createPinInputMachine(defaultConfig)
      const pinInput = interpret(machine.done())
      const changes: Array<{ action: string; from: string; to: string }> = []

      const unsubscribe = pinInput.subscribe((change) => {
        changes.push({
          action: change.action.type,
          from: change.action.source,
          to: change.state,
        })
      })

      pinInput.do(PinInputAction.Focus, { index: 0 })
      pinInput.do(PinInputAction.Input, { index: 0, value: '1' })
      pinInput.do(PinInputAction.Input, { index: 1, value: 'x' }) // Invalid input

      assert.equal(changes.length, 3)
      assert.deepEqual(changes[0], {
        action: PinInputAction.Focus,
        from: PinInputState.Idle,
        to: PinInputState.Focused,
      })
      assert.deepEqual(changes[1], {
        action: PinInputAction.Input,
        from: PinInputState.Focused,
        to: PinInputState.Focused,
      })
      assert.deepEqual(changes[2], {
        action: PinInputAction.Input,
        from: PinInputState.Focused,
        to: PinInputState.Error,
      })

      unsubscribe()

      // No more notifications after unsubscribe
      pinInput.do(PinInputAction.Reset)
      assert.equal(changes.length, 3)
    })
  })

  describe('Edge Cases', () => {
    it('handles empty paste content', () => {
      const pinInput = createPinInput(defaultConfig)

      pinInput.do(PinInputAction.Focus, { index: 0 })
      const result = pinInput.do(PinInputAction.Paste, {
        content: '',
        startIndex: 0,
      })

      assert.equal(result, false) // Should fail validation
    })

    it('maintains state consistency during invalid operations', () => {
      const pinInput = createPinInput(defaultConfig)
      const initialContext = { ...pinInput.context }

      // Try invalid transition
      const result = pinInput.do(PinInputAction.Submit) // Can't submit from idle

      assert.equal(result, false)
      assert.deepEqual(pinInput.context, initialContext) // Context unchanged
      assert.equal(pinInput.state, PinInputState.Idle) // State unchanged
    })

    it('handles single character length configuration', () => {
      const config: PinInputConfig = { length: 1, type: 'numeric' }
      const pinInput = createPinInput(config)

      pinInput.do(PinInputAction.Focus, { index: 0 })
      pinInput.do(PinInputAction.Input, { index: 0, value: '5' })

      assert.equal(pinInput.state, PinInputState.Completed)
      assert.equal(pinInput.context.isComplete, true)
      assert.deepEqual(pinInput.context.values, ['5'])
    })

    it('clears error state when valid input is provided', () => {
      const pinInput = createPinInput(defaultConfig)

      pinInput.do(PinInputAction.Focus, { index: 0 })
      pinInput.do(PinInputAction.Input, { index: 0, value: 'x' }) // Invalid

      assert.equal(pinInput.state, PinInputState.Error)

      pinInput.do(PinInputAction.Clear, { index: 0 })

      assert.equal(pinInput.state, PinInputState.Focused)
      assert.equal(pinInput.context.error, undefined)
    })
  })

  describe('Action Return Values', () => {
    it('returns true for successful transitions', () => {
      const pinInput = createPinInput(defaultConfig)

      const focusResult = pinInput.do(PinInputAction.Focus, { index: 0 })
      const inputResult = pinInput.do(PinInputAction.Input, { index: 0, value: '1' })

      assert.equal(focusResult, true)
      assert.equal(inputResult, true)
    })

    it('returns false for failed transitions', () => {
      const pinInput = createPinInput(defaultConfig)

      // Try to submit without being in completed state
      const submitResult = pinInput.do(PinInputAction.Submit)

      // Try invalid paste
      const pasteResult = pinInput.do(PinInputAction.Paste, {
        content: '1234',
        startIndex: -1,
      })

      assert.equal(submitResult, false)
      assert.equal(pasteResult, false)
    })
  })
})
