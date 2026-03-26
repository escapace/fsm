/**
 * Scenario harness for profile-draft-workflow.ts.
 *
 * Runs one of several scenarios in a tight loop for CPU profiling.
 * Invoked as a child process by the orchestrator.
 *
 * Usage: node [...flags] perf/profile-draft-harness.ts <scenario> <iterations> <warmup>
 */

import { interpret, stateMachine } from '../src/index'

const alwaysTrue = () => true

// Build the mutable builder once, then finalize once for interpret-only/runtime scenarios.
const machineBuilder = stateMachine()
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

const machine = machineBuilder.done()

// ---------------------------------------------------------------------------
// Scenario functions
// ---------------------------------------------------------------------------

function doneOnly(iterations: number): void {
  for (let index = 0; index < iterations; index++) {
    machineBuilder.done()
  }
}

function interpretOnly(iterations: number): void {
  for (let index = 0; index < iterations; index++) {
    interpret(machine)
  }
}

function directDispatch(service: ReturnType<typeof interpret>, iterations: number): void {
  for (let index = 0; index < iterations; index++) {
    service.do('TOGGLE')
  }
}

function draftCreateDiscard(service: ReturnType<typeof interpret>, iterations: number): void {
  for (let index = 0; index < iterations; index++) {
    const draft = service.draft()
    draft.discard()
  }
}

function draftCreateDoDiscard(service: ReturnType<typeof interpret>, iterations: number): void {
  for (let index = 0; index < iterations; index++) {
    const draft = service.draft()
    draft.do('TOGGLE')
    draft.discard()
  }
}

function draftCreateDoCommit(service: ReturnType<typeof interpret>, iterations: number): void {
  for (let index = 0; index < iterations; index++) {
    const draft = service.draft()
    draft.do('TOGGLE')
    draft.commit()
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const [scenario, iterationsArgument, warmupArgument] = process.argv.slice(2)
const iterations = Number(iterationsArgument)
const warmup = Number(warmupArgument)

if (
  scenario === undefined ||
  scenario === '' ||
  !Number.isFinite(iterations) ||
  !Number.isFinite(warmup)
) {
  console.error('Usage: profile-draft-harness.ts <scenario> <iterations> <warmup>')
  process.exit(1)
}

const service = interpret(machine)

const scenarioFunction =
  scenario === 'done-only'
    ? (iterations: number) => doneOnly(iterations)
    : scenario === 'interpret-only'
      ? (iterations: number) => interpretOnly(iterations)
      : scenario === 'direct-dispatch'
        ? (iterations: number) => directDispatch(service, iterations)
        : scenario === 'draft-create-discard'
          ? (iterations: number) => draftCreateDiscard(service, iterations)
          : scenario === 'draft-create-do-discard'
            ? (iterations: number) => draftCreateDoDiscard(service, iterations)
            : scenario === 'draft-create-do-commit'
              ? (iterations: number) => draftCreateDoCommit(service, iterations)
              : undefined

if (scenarioFunction === undefined) {
  console.error(`Unknown scenario: ${scenario}`)
  process.exit(1)
}

// Warmup phase (let V8 optimize)
scenarioFunction(warmup)

// Measured phase
scenarioFunction(iterations)
