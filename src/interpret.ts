/* eslint-disable unicorn/prevent-abbreviations */

import { remove, szudzik, type DirectAddressTable } from 'coastal'
import { assertContextFactory } from './assert-context-factory'
import { STATE_MACHINE_STATE } from './constants'
import { reconcile, snapshot } from './context-runtime'
import { StateMachineError } from './error'
import { resolveOwnOption } from './internal-options'
import { CHILD_GROUP, type GroupScopedReducer } from './internal-policy'
import { isObject } from './is-object'
import type {
  InferStateMachineModel,
  StateMachineDraftStatus,
  StateMachineIdentifier,
  StateMachineInterface,
  StateMachineInterpretable,
  StateMachineInterpretOptions,
  StateMachineService,
} from './types'

interface InternalAction {
  payload: unknown
  source: StateMachineIdentifier
  target: StateMachineIdentifier
  type: StateMachineIdentifier
}

type InternalActionBuffer = {
  [K in keyof InternalAction]: InternalAction[K] | undefined
}

type InternalReducer = ((context: unknown, action: unknown) => unknown) | undefined

interface InternalSelectedStep {
  action: InternalAction
  reducer: InternalReducer
}

interface InternalChangeBuffer {
  action: unknown
  context: unknown
  state: unknown
}

const createChangeBuffer = (): InternalChangeBuffer => ({
  action: undefined,
  context: undefined,
  state: undefined,
})

const createActionBuffer = (): InternalActionBuffer => ({
  payload: undefined,
  source: undefined,
  target: undefined,
  type: undefined,
})

type InternalSubscription = (change: unknown) => void

type InternalReconcileContext = (parentContext: unknown, nextContext: unknown) => unknown
type InternalSnapshotContext = (context: unknown) => unknown

const DEFAULT_SNAPSHOT_CONTEXT: InternalSnapshotContext = snapshot
const DEFAULT_RECONCILE_CONTEXT: InternalReconcileContext = reconcile

type TransitionCandidates = Array<{
  predicates: Array<(...args: unknown[]) => boolean>
  reducer: InternalReducer
  source: StateMachineIdentifier
  target: StateMachineIdentifier
}>

type TransitionTable = DirectAddressTable<TransitionCandidates>

abstract class AbstractDispatcher {
  protected readonly actionBuffer = createActionBuffer()
  protected readonly changeBuffer = createChangeBuffer()
  context: unknown
  indexState: number
  readonly indiceActions: Record<StateMachineIdentifier, number>
  readonly indiceStates: Record<StateMachineIdentifier, number>
  readonly needsStateInjection: boolean
  readonly reconcileContext: InternalReconcileContext
  replayCursor: number
  readonly snapshotContext: InternalSnapshotContext
  state: StateMachineIdentifier
  protected readonly subscriptions: InternalSubscription[] = []
  readonly transitionMap: TransitionTable

  constructor(
    indiceActions: Record<StateMachineIdentifier, number>,
    indiceStates: Record<StateMachineIdentifier, number>,
    needsStateInjection: boolean,
    transitionMap: TransitionTable,
    reconcileContext: InternalReconcileContext,
    snapshotContext: InternalSnapshotContext,
    context: unknown,
    state: StateMachineIdentifier,
    indexState: number,
    replayCursor = 0,
  ) {
    this.indiceActions = indiceActions
    this.indiceStates = indiceStates
    this.needsStateInjection = needsStateInjection
    this.transitionMap = transitionMap
    this.reconcileContext = reconcileContext
    this.snapshotContext = snapshotContext
    this.context = context
    this.state = state
    this.indexState = indexState
    this.replayCursor = replayCursor
  }

  protected notifyChange(change: unknown): void {
    const subs = this.subscriptions
    for (let i = 0; i < subs.length; i++) {
      subs[i](change)
    }
  }

  subscribe(subscription: InternalSubscription): () => void {
    if (!this.subscriptions.includes(subscription)) {
      this.subscriptions.push(subscription)
    }

    return () => {
      remove(this.subscriptions, (value) => value === subscription)
    }
  }

  protected resolveTransition(
    action: StateMachineIdentifier,
    payload: unknown,
  ): { reducer: InternalReducer; target: StateMachineIdentifier } | undefined {
    this.actionBuffer.payload = payload
    this.actionBuffer.source = undefined
    this.actionBuffer.target = undefined
    this.actionBuffer.type = action
    const indexAction = this.indiceActions[action]

    if (indexAction === undefined) {
      throw new StateMachineError({ identifier: action, type: 'ActionNotDeclared' })
    }

    const transitions = this.transitionMap.get(szudzik(this.indexState, indexAction))

    if (transitions === undefined) {
      return undefined
    }

    candidateLoop: for (let i = 0; i < transitions.length; i++) {
      const candidate = transitions[i]

      this.actionBuffer.source = candidate.source
      this.actionBuffer.target = candidate.target

      const predicates = candidate.predicates

      for (let j = 0; j < predicates.length; j++) {
        if (
          !(predicates[j] as (ctx: unknown, act: unknown) => boolean)(
            this.context,
            this.actionBuffer,
          )
        ) {
          continue candidateLoop
        }
      }

      return candidate
    }

    return undefined
  }

  protected applyTransitionAndAdvance(reducer: InternalReducer): void {
    if (reducer !== undefined) {
      this.context = reducer(this.context, this.actionBuffer)
    }

    const nextState = this.actionBuffer.target!
    this.state = nextState
    this.indexState = this.indiceStates[nextState]

    if (this.needsStateInjection) {
      ;(this.context as Record<string, unknown>).state = this.state
    }

    this.replayCursor += 1
  }

  protected applyCommitStep(step: InternalSelectedStep): void {
    const nextState = step.action.target

    if (step.reducer !== undefined) {
      const reducer = step.reducer as GroupScopedReducer
      const childGroup = reducer[CHILD_GROUP]
      const nextContext = reducer(this.context, step.action)

      if (childGroup === undefined) {
        this.context = this.reconcileContext(this.context, nextContext)
      } else {
        const childSlice = (nextContext as Record<StateMachineIdentifier, unknown>)[childGroup]
        const reconciledContext = this.reconcileContext(this.context, nextContext)

        ;(reconciledContext as Record<StateMachineIdentifier, unknown>)[childGroup] = childSlice
        this.context = reconciledContext
      }
    }

    this.state = nextState
    this.indexState = this.indiceStates[nextState]

    if (this.needsStateInjection) {
      ;(this.context as Record<string, unknown>).state = this.state
    }
  }

  protected assignSelfChange(action: unknown): void {
    this.changeBuffer.action = action
    this.changeBuffer.context = this.context
    this.changeBuffer.state = this.state
  }

  protected emitSelfChange(action: unknown): void {
    this.assignSelfChange(action)
    this.notifyChange(this.changeBuffer)
  }
}

class ServiceRuntime extends AbstractDispatcher {
  replayStep(step: InternalSelectedStep): void {
    this.applyCommitStep(step)
    this.replayCursor += 1
    this.emitSelfChange(step.action)
  }

  do(action: StateMachineIdentifier, payload: unknown): boolean {
    const transition = this.resolveTransition(action, payload)

    if (transition === undefined) {
      return false
    }

    this.applyTransitionAndAdvance(transition.reducer)

    this.emitSelfChange(this.actionBuffer)

    return true
  }

  draft(): DraftRuntime {
    return new DraftRuntime(this)
  }
}

class DraftRuntime extends AbstractDispatcher {
  private readonly baseCursor: number
  private children: Set<DraftRuntime> | undefined
  private closed = false
  private parent: DraftRuntime | ServiceRuntime | undefined
  private readonly service: ServiceRuntime
  private readonly trace: InternalSelectedStep[] = []

  constructor(parent: DraftRuntime | ServiceRuntime) {
    const baseCursor = parent.replayCursor

    super(
      parent.indiceActions,
      parent.indiceStates,
      parent.needsStateInjection,
      parent.transitionMap,
      parent.reconcileContext,
      parent.snapshotContext,
      parent.snapshotContext(parent.context),
      parent.state,
      parent.indexState,
      baseCursor,
    )

    this.parent = parent
    this.baseCursor = baseCursor

    if (parent instanceof ServiceRuntime) {
      this.service = parent
      return
    }

    this.service = parent.service
    ;(parent.children ?? (parent.children = new Set())).add(this)
  }

  replayStep(step: InternalSelectedStep): void {
    this.applyCommitStep(step)
    this.trace.push(step)
    this.replayCursor += 1
    this.emitSelfChange(step.action)
  }

  private assertOperational(): void {
    if (this.closed || this.parent === undefined) {
      throw new StateMachineError({ type: 'DraftClosed' })
    }
  }

  status(): StateMachineDraftStatus {
    const parent = this.parent

    if (this.closed || parent === undefined) {
      return 'closed'
    }

    return parent.replayCursor === this.baseCursor ? 'open' : 'stale'
  }

  commit(): void {
    this.assertOperational()
    this.replayCommitTrace()
    this.close()
  }

  private replayCommitTrace(): void {
    const parent = this.parent!
    const trace = this.trace
    const traceLength = trace.length

    const actualCursor = parent.replayCursor

    if (actualCursor !== this.baseCursor) {
      throw new StateMachineError({
        actualCursor,
        expectedCursor: this.baseCursor,
        type: 'DraftCommitConflict',
      })
    }

    for (let i = 0; i < traceLength; i++) {
      parent.replayStep(trace[i])
    }
  }

  discard(): void {
    this.assertOperational()
    this.close()
  }

  private close(): void {
    /* v8 ignore start -- defensive idempotence guard for internal close recursion */
    if (this.closed) return
    /* v8 ignore stop */

    this.closed = true

    const children = this.children
    this.children = undefined

    if (children !== undefined) {
      for (const child of children) {
        child.close()
      }

      children.clear()
    }

    if (this.subscriptions.length > 0) this.subscriptions.length = 0

    const parent = this.parent

    if (parent instanceof DraftRuntime && parent.children !== undefined) {
      parent.children.delete(this)

      if (parent.children.size === 0) {
        parent.children = undefined
      }
    }

    this.parent = undefined
  }

  do(action: StateMachineIdentifier, payload: unknown): boolean {
    this.assertOperational()

    const transition = this.resolveTransition(action, payload)

    if (transition === undefined) {
      return false
    }

    this.applyTransitionAndAdvance(transition.reducer)

    const selectedStep: InternalSelectedStep = {
      action: {
        payload,
        source: this.actionBuffer.source!,
        target: this.actionBuffer.target!,
        type: action,
      },
      reducer: transition.reducer,
    }

    this.trace.push(selectedStep)

    this.emitSelfChange(selectedStep.action)

    return true
  }

  draft(): DraftRuntime {
    this.assertOperational()
    return new DraftRuntime(this)
  }

  override subscribe(subscription: InternalSubscription): () => void {
    this.assertOperational()
    return super.subscribe(subscription)
  }
}

/**
 * Creates a runnable service instance from a state machine definition.
 *
 * @param stateMachine - The state machine definition created by the `stateMachine` function
 * @param options - Optional hydration snapshot for startup
 * @returns A service that can execute actions, track state, and notify subscribers
 */
export const interpret = <T extends StateMachineInterface>(
  stateMachine: StateMachineInterpretable<T>,
  options?: StateMachineInterpretOptions<T>,
): StateMachineService<InferStateMachineModel<T>> => {
  const machineState = stateMachine[STATE_MACHINE_STATE]

  if (!isObject(machineState)) {
    throw new StateMachineError({ type: 'StateMachineExpected' })
  }

  const {
    context: contextFactory,
    indiceActions,
    indiceStates,
    initial,
    reconcileContext = DEFAULT_RECONCILE_CONTEXT,
    snapshotContext = DEFAULT_SNAPSHOT_CONTEXT,
    transitions: transitionMap,
  } = machineState

  const hydrate = resolveOwnOption(options, 'hydrate')

  let context: unknown
  let state: StateMachineIdentifier

  if (hydrate !== undefined) {
    if (
      !isObject(hydrate) ||
      !Object.hasOwn(hydrate, 'state') ||
      !Object.hasOwn(hydrate, 'context')
    ) {
      throw new StateMachineError({ type: 'HydrationShapeMismatch' })
    }

    context = (hydrate as { context: unknown }).context
    state = (hydrate as { state: StateMachineIdentifier }).state
  } else {
    context =
      contextFactory === undefined
        ? undefined
        : (assertContextFactory(contextFactory), contextFactory())
    state = initial!
  }

  const hydratedIndexState = indiceStates[state]

  if (hydratedIndexState === undefined) {
    throw new StateMachineError({ identifier: state, type: 'StateNotDeclared' })
  }

  const needsStateInjection = isObject(context) && 'state' in context

  if (needsStateInjection) {
    const ctxState = (context as Record<string, unknown>).state

    if (ctxState !== state) {
      throw new StateMachineError({
        actual: ctxState,
        expected: state,
        type: 'ContextStateMismatch',
      })
    }
  }

  return new ServiceRuntime(
    indiceActions,
    indiceStates,
    needsStateInjection,
    transitionMap,
    reconcileContext,
    snapshotContext,
    context,
    state,
    hydratedIndexState,
  ) as unknown as StateMachineService<InferStateMachineModel<T>>
}
