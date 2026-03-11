/-
  Core type definitions for the flat EFSM semantic model.

  This file contains only type definitions — no functions or theorems.
  All types are parameterized by State, Action, Ctx (context), and Payload.
-/

/-- Action information record passed to guards and reducers during dispatch.
    Constructed separately for each candidate transition during guard evaluation. -/
structure ActionInfo (State Action Payload : Type) where
  /-- The dispatched action identifier. -/
  type : Action
  /-- The action payload. -/
  payload : Payload
  /-- Source state of the candidate transition. -/
  source : State
  /-- Target state of the candidate transition. -/
  target : State

/-- A transition rule in a flat EFSM. -/
structure TransitionRule (State Action Ctx Payload : Type) where
  /-- Source state from which this transition may fire. -/
  source : State
  /-- Action that triggers this transition. -/
  action : Action
  /-- Target state the machine enters if this transition fires. -/
  target : State
  /-- Ordered list of guard functions; all must return true for the transition to fire. -/
  guards : List (Ctx → ActionInfo State Action Payload → Bool)
  /-- Optional context reducer applied after transition selection. -/
  reducer : Option (Ctx → ActionInfo State Action Payload → Ctx)

/-- A well-formed flat EFSM machine definition.
    Bundles the declared state/action sets, initial state, transition rules,
    and the basic well-formedness invariants needed by the semantics. -/
structure Machine (State Action Ctx Payload : Type)
    [DecidableEq State] [DecidableEq Action] where
  /-- Finite ordered set of declared state identifiers. -/
  states : List State
  /-- Finite ordered set of declared action identifiers. -/
  actions : List Action
  /-- The initial state (must be a member of states). -/
  initial : State
  /-- Ordered list of transition rules. -/
  transitions : List (TransitionRule State Action Ctx Payload)
  /-- States list is non-empty. -/
  states_nonempty : states ≠ []
  /-- Actions list is non-empty. -/
  actions_nonempty : actions ≠ []
  /-- State identifiers are distinct. -/
  states_nodup : states.Nodup
  /-- Action identifiers are distinct. -/
  actions_nodup : actions.Nodup
  /-- Initial state is declared. -/
  initial_mem : initial ∈ states
  /-- All transition sources, actions, and targets are declared. -/
  transitions_wf : ∀ t ∈ transitions,
    t.source ∈ states ∧ t.action ∈ actions ∧ t.target ∈ states

/-- Result of a dispatch operation. -/
inductive DispatchResult (State Action Ctx Payload : Type) where
  /-- Transition executed successfully. -/
  | success
      (newState : State)
      (newCtx : Ctx)
      (rule : TransitionRule State Action Ctx Payload)
      (info : ActionInfo State Action Payload)
  /-- No valid transition found — returns false at runtime. -/
  | failure
  /-- Action not declared in the machine — throws at runtime. -/
  | unknownAction
