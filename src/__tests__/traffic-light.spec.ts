/**
 * Traffic Light State Machine Test Suite
 *
 * This test suite demonstrates the implementation of a traffic light control system
 * using finite state machines. Traffic lights are an excellent real-world example of state machines
 * because they have clearly defined states (Red, Yellow, Green) and predictable transitions based
 * on specific triggers (timer events, emergency signals).
 *
 * The tests illustrate several fundamental state machine concepts:
 *
 * 1. **State Management**: The traffic light system models three distinct states representing
 *    the colored lights. Each state has specific behaviors and valid transitions to other states.
 *
 * 2. **Deterministic Transitions**: The normal traffic light cycle follows a predictable sequence:
 *    Red → Green → Yellow → Red. This demonstrates how state machines enforce valid state changes
 *    and prevent invalid transitions (like going directly from Red to Yellow).
 *
 * 3. **Context Preservation**: The state machine maintains contextual data including cycle counts,
 *    emergency status, and timing information. This shows how state machines can carry persistent
 *    data across state transitions while ensuring data consistency.
 *
 * 4. **Action-Driven Transitions**: State changes are triggered by specific actions (TIMER, EMERGENCY, RESET)
 *    rather than occurring spontaneously. This demonstrates the event-driven nature of state machines.
 *
 * 5. **Multi-Source Transitions**: The emergency action can be triggered from any state, showing
 *    how state machines can handle global actions that override normal flow.
 *
 * 6. **Observable State Changes**: The subscription mechanism allows external systems to react
 *    to state transitions, demonstrating the observer pattern in state machine implementations.
 *
 * 7. **Real-World Timing Simulation**: The realistic timing test shows how state machines can
 *    integrate with external timing systems, modeling actual traffic light durations.
 *
 * 8. **Transition Guards and Effects**: Context update functions demonstrate how state transitions
 *    can perform side effects and conditional logic while maintaining state consistency.
 *
 * 9. **Invalid Transition Handling**: The final test shows how state machines naturally prevent
 *    invalid state changes by simply ignoring undefined transitions, maintaining system stability.
 *
 * These tests serve as both verification of the state machine implementation and educational
 * examples of how to model real-world systems using finite state machine principles. The traffic
 * light metaphor makes abstract state machine concepts concrete and understandable.
 */

import { afterEach, assert, beforeEach, describe, it, vi } from 'vitest'
import { interpret, stateMachine } from '../index'

enum TrafficLightState {
  Green = 'GREEN',
  Red = 'RED',
  Yellow = 'YELLOW',
}

enum TrafficLightAction {
  Emergency = 'EMERGENCY',
  Reset = 'RESET',
  Timer = 'TIMER',
}

interface TrafficLightContext {
  cycleCount: number
  emergencyActive: boolean
  lastTransition: number
}

describe('Traffic Light State Machine', () => {
  let timers: number[]

  beforeEach(() => {
    timers = []
    vi.useFakeTimers()
  })

  afterEach(() => {
    timers.forEach(clearTimeout)
    vi.useRealTimers()
  })

  it('follows normal traffic light cycle', () => {
    const machine = stateMachine()
      .state(TrafficLightState.Red)
      .state(TrafficLightState.Yellow)
      .state(TrafficLightState.Green)
      .initial(TrafficLightState.Red)
      .action(TrafficLightAction.Timer)
      .action(TrafficLightAction.Emergency)
      .action(TrafficLightAction.Reset)
      .context<TrafficLightContext>(() => ({
        cycleCount: 0,
        emergencyActive: false,
        lastTransition: 0,
      }))
      .transition(
        TrafficLightState.Red,
        TrafficLightAction.Timer,
        TrafficLightState.Green,
        (context) => ({
          ...context,
          cycleCount: context.cycleCount + 1,
          lastTransition: Date.now(),
        }),
      )
      .transition(
        TrafficLightState.Green,
        TrafficLightAction.Timer,
        TrafficLightState.Yellow,
        (context) => ({
          ...context,
          lastTransition: Date.now(),
        }),
      )
      .transition(
        TrafficLightState.Yellow,
        TrafficLightAction.Timer,
        TrafficLightState.Red,
        (context) => ({
          ...context,
          lastTransition: Date.now(),
        }),
      )

    const trafficLight = interpret(machine)

    // Initial state
    assert.equal(trafficLight.state, TrafficLightState.Red)
    assert.equal(trafficLight.context.cycleCount, 0)

    // Red → Green
    trafficLight.do(TrafficLightAction.Timer)
    assert.equal(trafficLight.state, TrafficLightState.Green)
    assert.equal(trafficLight.context.cycleCount, 1)

    // Green → Yellow
    trafficLight.do(TrafficLightAction.Timer)
    assert.equal(trafficLight.state, TrafficLightState.Yellow)
    assert.equal(trafficLight.context.cycleCount, 1)

    // Yellow → Red
    trafficLight.do(TrafficLightAction.Timer)
    assert.equal(trafficLight.state, TrafficLightState.Red)
    assert.equal(trafficLight.context.cycleCount, 1)

    // Complete another cycle
    trafficLight.do(TrafficLightAction.Timer) // Red → Green
    assert.equal(trafficLight.state, TrafficLightState.Green)
    assert.equal(trafficLight.context.cycleCount, 2)
  })

  it('handles emergency override from any state', () => {
    const machine = stateMachine()
      .state(TrafficLightState.Red)
      .state(TrafficLightState.Yellow)
      .state(TrafficLightState.Green)
      .initial(TrafficLightState.Green)
      .action(TrafficLightAction.Timer)
      .action(TrafficLightAction.Emergency)
      .action(TrafficLightAction.Reset)
      .context<TrafficLightContext>(() => ({
        cycleCount: 0,
        emergencyActive: false,
        lastTransition: 0,
      }))
      .transition(
        [TrafficLightState.Red, TrafficLightState.Yellow, TrafficLightState.Green],
        TrafficLightAction.Emergency,
        TrafficLightState.Red,
        (context) => ({
          ...context,
          emergencyActive: true,
          lastTransition: Date.now(),
        }),
      )
      .transition(
        TrafficLightState.Red,
        TrafficLightAction.Reset,
        TrafficLightState.Red,
        (context) => ({
          ...context,
          cycleCount: 0,
          emergencyActive: false,
        }),
      )

    const trafficLight = interpret(machine)

    // Start in Green
    assert.equal(trafficLight.state, TrafficLightState.Green)
    assert.equal(trafficLight.context.emergencyActive, false)

    // Emergency from Green → Red
    trafficLight.do(TrafficLightAction.Emergency)
    assert.equal(trafficLight.state, TrafficLightState.Red)
    assert.equal(trafficLight.context.emergencyActive, true)

    // Reset emergency
    trafficLight.do(TrafficLightAction.Reset)
    assert.equal(trafficLight.state, TrafficLightState.Red)
    assert.equal(trafficLight.context.emergencyActive, false)
    assert.equal(trafficLight.context.cycleCount, 0)
  })

  it('tracks state changes through subscriptions', () => {
    const stateChanges: string[] = []

    const machine = stateMachine()
      .state(TrafficLightState.Red)
      .state(TrafficLightState.Yellow)
      .state(TrafficLightState.Green)
      .initial(TrafficLightState.Red)
      .action(TrafficLightAction.Timer)
      .context<TrafficLightContext>(() => ({
        cycleCount: 0,
        emergencyActive: false,
        lastTransition: 0,
      }))
      .transition(TrafficLightState.Red, TrafficLightAction.Timer, TrafficLightState.Green)
      .transition(TrafficLightState.Green, TrafficLightAction.Timer, TrafficLightState.Yellow)
      .transition(TrafficLightState.Yellow, TrafficLightAction.Timer, TrafficLightState.Red)

    const trafficLight = interpret(machine)

    const unsubscribe = trafficLight.subscribe((change) => {
      stateChanges.push(`${change.action.source} → ${change.state}`)
    })

    // Execute a full cycle
    trafficLight.do(TrafficLightAction.Timer) // Red → Green
    trafficLight.do(TrafficLightAction.Timer) // Green → Yellow
    trafficLight.do(TrafficLightAction.Timer) // Yellow → Red

    assert.deepEqual(stateChanges, ['RED → GREEN', 'GREEN → YELLOW', 'YELLOW → RED'])

    unsubscribe()

    // No more changes tracked after unsubscribe
    trafficLight.do(TrafficLightAction.Timer)
    assert.equal(stateChanges.length, 3)
  })

  it('simulates realistic traffic light timing', () => {
    const machine = stateMachine()
      .state(TrafficLightState.Red)
      .state(TrafficLightState.Yellow)
      .state(TrafficLightState.Green)
      .initial(TrafficLightState.Red)
      .action(TrafficLightAction.Timer)
      .context<TrafficLightContext>(() => ({
        cycleCount: 0,
        emergencyActive: false,
        lastTransition: Date.now(),
      }))
      .transition(
        TrafficLightState.Red,
        TrafficLightAction.Timer,
        TrafficLightState.Green,
        (context) => ({
          ...context,
          cycleCount: context.cycleCount + 1,
          lastTransition: Date.now(),
        }),
      )
      .transition(
        TrafficLightState.Green,
        TrafficLightAction.Timer,
        TrafficLightState.Yellow,
        (context) => ({
          ...context,
          lastTransition: Date.now(),
        }),
      )
      .transition(
        TrafficLightState.Yellow,
        TrafficLightAction.Timer,
        TrafficLightState.Red,
        (context) => ({
          ...context,
          lastTransition: Date.now(),
        }),
      )

    const trafficLight = interpret(machine)

    // Simulate automatic timing
    const scheduleTransition = (delay: number) => {
      const timer = setTimeout(() => {
        trafficLight.do(TrafficLightAction.Timer)
      }, delay) as unknown as number
      timers.push(timer)
      return timer
    }

    // Red light: 30 seconds
    assert.equal(trafficLight.state, TrafficLightState.Red)
    scheduleTransition(30_000)

    vi.advanceTimersByTime(30_000)
    assert.equal(trafficLight.state, TrafficLightState.Green)

    // Green light: 25 seconds
    scheduleTransition(25_000)
    vi.advanceTimersByTime(25_000)
    assert.equal(trafficLight.state, TrafficLightState.Yellow)

    // Yellow light: 5 seconds
    scheduleTransition(5000)
    vi.advanceTimersByTime(5000)
    assert.equal(trafficLight.state, TrafficLightState.Red)

    assert.equal(trafficLight.context.cycleCount, 1)
  })

  it('prevents invalid transitions', () => {
    const machine = stateMachine()
      .state(TrafficLightState.Red)
      .state(TrafficLightState.Green)
      .initial(TrafficLightState.Red)
      .action(TrafficLightAction.Timer)
      .transition(TrafficLightState.Red, TrafficLightAction.Timer, TrafficLightState.Green)
    // Note: No transition from Green back to Red

    const trafficLight = interpret(machine)

    assert.equal(trafficLight.state, TrafficLightState.Red)

    // Valid transition
    trafficLight.do(TrafficLightAction.Timer)
    assert.equal(trafficLight.state, TrafficLightState.Green)

    // Invalid transition - should stay in Green
    trafficLight.do(TrafficLightAction.Timer)
    assert.equal(trafficLight.state, TrafficLightState.Green)
  })
})
