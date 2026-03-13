/-
  Draft handle definitions, service cursor, and draft operations.

  Provides the semantic building blocks for draft-based speculative execution
  over the existing flat EFSM dispatch model. No theorems — only definitions.
-/
import Replay

variable {State Action Ctx Payload : Type}

/-- Service state: current snapshot and monotonic cursor.
    The cursor starts at 0 and increments by one after every successful
    transition visible on the live service. -/
structure ServiceState (State Ctx : Type) where
  snapshot : Snapshot State Ctx
  cursor : Nat

/-- Draft handle: records the base cursor, base snapshot, and an
    append-only trace of selected steps. -/
structure DraftHandle (State Action Ctx Payload : Type) where
  baseCursor : Nat
  baseSnapshot : Snapshot State Ctx
  trace : List (SelectedStep State Action Ctx Payload)

/-- The current snapshot of a draft: replay the trace from the base snapshot. -/
def DraftHandle.currentSnapshot (d : DraftHandle State Action Ctx Payload)
    : Snapshot State Ctx :=
  replayTrace d.baseSnapshot d.trace

/-- The head cursor of a draft: base cursor plus trace length. -/
def DraftHandle.headCursor (d : DraftHandle State Action Ctx Payload) : Nat :=
  d.baseCursor + d.trace.length

/-- Create a root draft from the current service state. -/
def mkRootDraft (svc : ServiceState State Ctx)
    : DraftHandle State Action Ctx Payload :=
  { baseCursor := svc.cursor
  , baseSnapshot := svc.snapshot
  , trace := [] }

/-- Extend a draft's trace with a new selected step. -/
def DraftHandle.appendStep (d : DraftHandle State Action Ctx Payload)
    (step : SelectedStep State Action Ctx Payload)
    : DraftHandle State Action Ctx Payload :=
  { d with trace := d.trace ++ [step] }

/-- Result of committing a root draft. -/
inductive RootCommitResult (State Ctx : Type) where
  /-- Commit succeeded; carries the new service state. -/
  | success (newService : ServiceState State Ctx)
  /-- Service cursor has advanced since draft creation. -/
  | outOfDate

/-- Attempt to commit a root draft into the service.
    Replays the draft trace onto the service snapshot and advances the cursor.
    Fails with `outOfDate` when the service cursor has moved. -/
def commitRootDraft (svc : ServiceState State Ctx)
    (d : DraftHandle State Action Ctx Payload)
    : RootCommitResult State Ctx :=
  if svc.cursor = d.baseCursor then
    .success ⟨replayTrace svc.snapshot d.trace, svc.cursor + d.trace.length⟩
  else
    .outOfDate

/-! ### Basic lemmas -/

@[simp]
theorem mkRootDraft_baseCursor (svc : ServiceState State Ctx) :
    (mkRootDraft svc : DraftHandle State Action Ctx Payload).baseCursor = svc.cursor := rfl

@[simp]
theorem mkRootDraft_baseSnapshot (svc : ServiceState State Ctx) :
    (mkRootDraft svc : DraftHandle State Action Ctx Payload).baseSnapshot = svc.snapshot := rfl

@[simp]
theorem mkRootDraft_trace (svc : ServiceState State Ctx) :
    (mkRootDraft svc : DraftHandle State Action Ctx Payload).trace = [] := rfl

@[simp]
theorem mkRootDraft_currentSnapshot (svc : ServiceState State Ctx) :
    (mkRootDraft svc : DraftHandle State Action Ctx Payload).currentSnapshot = svc.snapshot := by
  simp [DraftHandle.currentSnapshot, mkRootDraft]

@[simp]
theorem mkRootDraft_headCursor (svc : ServiceState State Ctx) :
    (mkRootDraft svc : DraftHandle State Action Ctx Payload).headCursor = svc.cursor := by
  simp [DraftHandle.headCursor, mkRootDraft]

@[simp]
theorem appendStep_baseCursor (d : DraftHandle State Action Ctx Payload)
    (step : SelectedStep State Action Ctx Payload) :
    (d.appendStep step).baseCursor = d.baseCursor := rfl

@[simp]
theorem appendStep_baseSnapshot (d : DraftHandle State Action Ctx Payload)
    (step : SelectedStep State Action Ctx Payload) :
    (d.appendStep step).baseSnapshot = d.baseSnapshot := rfl

@[simp]
theorem appendStep_trace (d : DraftHandle State Action Ctx Payload)
    (step : SelectedStep State Action Ctx Payload) :
    (d.appendStep step).trace = d.trace ++ [step] := rfl
