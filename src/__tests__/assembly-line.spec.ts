/**
 * Assembly Line State Machine Test Suite
 *
 * This test demonstrates an industrial assembly line control system using finite state machines.
 * Manufacturing assembly lines are classic examples of sequential process control where each
 * station must complete its operation before the workpiece advances to the next stage.
 */

import { assert, describe, it } from 'vitest'
import { interpret, stateMachine } from '../index'

enum AssemblyState {
  Complete = 'COMPLETE',
  InspectionStation = 'INSPECTION_STATION',
  LoadingStation = 'LOADING_STATION',
  PackagingStation = 'PACKAGING_STATION',
  Rejected = 'REJECTED',
  WaitingForPart = 'WAITING_FOR_PART',
  WeldingStation = 'WELDING_STATION',
}

enum AssemblyAction {
  InspectionFail = 'INSPECTION_FAIL',
  InspectionPass = 'INSPECTION_PASS',
  LoadComplete = 'LOAD_COMPLETE',
  PackagingComplete = 'PACKAGING_COMPLETE',
  PartArrived = 'PART_ARRIVED',
  Reset = 'RESET',
  WeldComplete = 'WELD_COMPLETE',
}

interface AssemblyContext {
  completedStations: string[]
  cycleCount: number
  defectCode: string | null
  partId: string
}

describe('Assembly Line State Machine', () => {
  it('processes part through complete manufacturing cycle', () => {
    const machine = stateMachine()
      .state(AssemblyState.WaitingForPart)
      .state(AssemblyState.LoadingStation)
      .state(AssemblyState.WeldingStation)
      .state(AssemblyState.InspectionStation)
      .state(AssemblyState.PackagingStation)
      .state(AssemblyState.Complete)
      .initial(AssemblyState.WaitingForPart)
      .action(AssemblyAction.PartArrived)
      .action(AssemblyAction.LoadComplete)
      .action(AssemblyAction.WeldComplete)
      .action(AssemblyAction.InspectionPass)
      .action(AssemblyAction.PackagingComplete)
      .action(AssemblyAction.Reset)
      .context<AssemblyContext>({
        completedStations: [],
        cycleCount: 0,
        defectCode: null,
        partId: '',
      })
      .transition(
        AssemblyState.WaitingForPart,
        AssemblyAction.PartArrived,
        AssemblyState.LoadingStation,
        (context) => ({
          ...context,
          completedStations: [],
          defectCode: null,
          partId: `PART-${Date.now()}`,
        }),
      )
      .transition(
        AssemblyState.LoadingStation,
        AssemblyAction.LoadComplete,
        AssemblyState.WeldingStation,
        (context) => ({
          ...context,
          completedStations: [...context.completedStations, 'LOADING'],
        }),
      )
      .transition(
        AssemblyState.WeldingStation,
        AssemblyAction.WeldComplete,
        AssemblyState.InspectionStation,
        (context) => ({
          ...context,
          completedStations: [...context.completedStations, 'WELDING'],
        }),
      )
      .transition(
        AssemblyState.InspectionStation,
        AssemblyAction.InspectionPass,
        AssemblyState.PackagingStation,
        (context) => ({
          ...context,
          completedStations: [...context.completedStations, 'INSPECTION'],
        }),
      )
      .transition(
        AssemblyState.PackagingStation,
        AssemblyAction.PackagingComplete,
        AssemblyState.Complete,
        (context) => ({
          ...context,
          completedStations: [...context.completedStations, 'PACKAGING'],
          cycleCount: context.cycleCount + 1,
        }),
      )
      .transition(
        AssemblyState.Complete,
        AssemblyAction.Reset,
        AssemblyState.WaitingForPart,
        (context) => ({
          ...context,
          completedStations: [],
          partId: '',
        }),
      )

    const assemblyLine = interpret(machine)

    // Line starts waiting for parts
    assert.equal(assemblyLine.state, AssemblyState.WaitingForPart)
    assert.equal(assemblyLine.context.partId, '')

    // Part arrives and gets loaded
    assemblyLine.do(AssemblyAction.PartArrived)
    assert.equal(assemblyLine.state, AssemblyState.LoadingStation)
    assert.isNotEmpty(assemblyLine.context.partId)

    // Complete loading
    assemblyLine.do(AssemblyAction.LoadComplete)
    assert.equal(assemblyLine.state, AssemblyState.WeldingStation)
    assert.include(assemblyLine.context.completedStations, 'LOADING')

    // Complete welding
    assemblyLine.do(AssemblyAction.WeldComplete)
    assert.equal(assemblyLine.state, AssemblyState.InspectionStation)
    assert.include(assemblyLine.context.completedStations, 'WELDING')

    // Pass inspection
    assemblyLine.do(AssemblyAction.InspectionPass)
    assert.equal(assemblyLine.state, AssemblyState.PackagingStation)
    assert.include(assemblyLine.context.completedStations, 'INSPECTION')

    // Complete packaging
    assemblyLine.do(AssemblyAction.PackagingComplete)
    assert.equal(assemblyLine.state, AssemblyState.Complete)
    assert.include(assemblyLine.context.completedStations, 'PACKAGING')
    assert.equal(assemblyLine.context.cycleCount, 1)

    // Reset for next part
    assemblyLine.do(AssemblyAction.Reset)
    assert.equal(assemblyLine.state, AssemblyState.WaitingForPart)
    assert.equal(assemblyLine.context.partId, '')
    assert.isEmpty(assemblyLine.context.completedStations)
  })

  it('handles quality control rejection during inspection', () => {
    const machine = stateMachine()
      .state(AssemblyState.WaitingForPart)
      .state(AssemblyState.LoadingStation)
      .state(AssemblyState.WeldingStation)
      .state(AssemblyState.InspectionStation)
      .state(AssemblyState.Rejected)
      .initial(AssemblyState.WaitingForPart)
      .action(AssemblyAction.PartArrived)
      .action(AssemblyAction.LoadComplete)
      .action(AssemblyAction.WeldComplete)
      .action(AssemblyAction.InspectionFail)
      .action(AssemblyAction.Reset)
      .context<AssemblyContext>({
        completedStations: [],
        cycleCount: 0,
        defectCode: null,
        partId: '',
      })
      .transition(
        AssemblyState.WaitingForPart,
        AssemblyAction.PartArrived,
        AssemblyState.LoadingStation,
        (context) => ({
          ...context,
          partId: `PART-${Date.now()}`,
        }),
      )
      .transition(
        AssemblyState.LoadingStation,
        AssemblyAction.LoadComplete,
        AssemblyState.WeldingStation,
      )
      .transition(
        AssemblyState.WeldingStation,
        AssemblyAction.WeldComplete,
        AssemblyState.InspectionStation,
      )
      .transition(
        AssemblyState.InspectionStation,
        AssemblyAction.InspectionFail,
        AssemblyState.Rejected,
        (context) => ({
          ...context,
          defectCode: 'WELD_QUALITY_FAIL',
        }),
      )
      .transition(
        AssemblyState.Rejected,
        AssemblyAction.Reset,
        AssemblyState.WaitingForPart,
        (context) => ({
          ...context,
          completedStations: [],
          defectCode: null,
          partId: '',
        }),
      )

    const assemblyLine = interpret(machine)

    // Process part through first three stations
    assemblyLine.do(AssemblyAction.PartArrived)
    assemblyLine.do(AssemblyAction.LoadComplete)
    assemblyLine.do(AssemblyAction.WeldComplete)
    assert.equal(assemblyLine.state, AssemblyState.InspectionStation)

    // Fail inspection
    assemblyLine.do(AssemblyAction.InspectionFail)
    assert.equal(assemblyLine.state, AssemblyState.Rejected)
    assert.equal(assemblyLine.context.defectCode, 'WELD_QUALITY_FAIL')

    // Reset and start fresh
    assemblyLine.do(AssemblyAction.Reset)
    assert.equal(assemblyLine.state, AssemblyState.WaitingForPart)
    assert.isNull(assemblyLine.context.defectCode)
  })

  it('prevents skipping manufacturing steps', () => {
    const machine = stateMachine()
      .state(AssemblyState.WaitingForPart)
      .state(AssemblyState.LoadingStation)
      .state(AssemblyState.WeldingStation)
      .initial(AssemblyState.WaitingForPart)
      .action(AssemblyAction.PartArrived)
      .action(AssemblyAction.LoadComplete)
      .action(AssemblyAction.WeldComplete)
      .context<AssemblyContext>({
        completedStations: [],
        cycleCount: 0,
        defectCode: null,
        partId: '',
      })
      .transition(
        AssemblyState.WaitingForPart,
        AssemblyAction.PartArrived,
        AssemblyState.LoadingStation,
      )
      .transition(
        AssemblyState.LoadingStation,
        AssemblyAction.LoadComplete,
        AssemblyState.WeldingStation,
      )
    // No direct transition from LoadingStation to WeldComplete

    const assemblyLine = interpret(machine)

    // Part arrives
    assemblyLine.do(AssemblyAction.PartArrived)
    assert.equal(assemblyLine.state, AssemblyState.LoadingStation)

    // Try to skip loading step - should stay in LoadingStation
    assemblyLine.do(AssemblyAction.WeldComplete)
    assert.equal(assemblyLine.state, AssemblyState.LoadingStation)

    // Must complete loading first
    assemblyLine.do(AssemblyAction.LoadComplete)
    assert.equal(assemblyLine.state, AssemblyState.WeldingStation)
  })
})
