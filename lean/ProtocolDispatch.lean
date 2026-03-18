/-
  Protocol-boundary dispatch functions and helper lemmas.

  Defines: endpointCandidates, deriveEffect (as a parameter),
  boundaryDispatch, and helper lemmas used by soundness proofs.

  Parallels Dispatch.lean for the EFSM layer.
-/
import ProtocolDefs

variable {State Action Ctx Payload : Type}
variable {LabelId PeerId MessageId EndpointStateId EndpointTransitionId : Type}
variable [DecidableEq EndpointStateId]
variable [DecidableEq LabelId] [DecidableEq PeerId] [DecidableEq MessageId]
variable [DecidableEq Direction]

/-! ### Endpoint candidate lookup -/

/-- Protocol label equality is decidable when all components have DecidableEq. -/
instance : DecidableEq (ProtocolLabel LabelId PeerId MessageId) :=
  fun a b =>
    match decEq a.id b.id, decEq a.direction b.direction,
          decEq a.peer b.peer, decEq a.message b.message with
    | .isTrue h1, .isTrue h2, .isTrue h3, .isTrue h4 =>
        .isTrue (by cases a; cases b; simp_all)
    | .isFalse h, _, _, _ => .isFalse (by intro heq; exact h (by cases heq; rfl))
    | _, .isFalse h, _, _ => .isFalse (by intro heq; exact h (by cases heq; rfl))
    | _, _, .isFalse h, _ => .isFalse (by intro heq; exact h (by cases heq; rfl))
    | _, _, _, .isFalse h => .isFalse (by intro heq; exact h (by cases heq; rfl))

/-- Endpoint candidate list: endpoint transitions matching the current
    endpoint state and protocol label, preserving declaration order.

    Parallels `candidates` in Dispatch.lean. -/
def endpointCandidates
    (transitions : List (EndpointTransition EndpointStateId EndpointTransitionId LabelId PeerId MessageId))
    (q : EndpointStateId) (ℓ : ProtocolLabel LabelId PeerId MessageId)
    : List (EndpointTransition EndpointStateId EndpointTransitionId LabelId PeerId MessageId) :=
  transitions.filter fun u => decide (u.source = q ∧ u.label = ℓ)

/-- Membership in endpointCandidates implies membership in transitions
    and matching source/label. -/
theorem mem_endpointCandidates
    {ts : List (EndpointTransition EndpointStateId EndpointTransitionId LabelId PeerId MessageId)}
    {q : EndpointStateId} {ℓ : ProtocolLabel LabelId PeerId MessageId}
    {u : EndpointTransition EndpointStateId EndpointTransitionId LabelId PeerId MessageId} :
    u ∈ endpointCandidates ts q ℓ ↔ u ∈ ts ∧ u.source = q ∧ u.label = ℓ := by
  simp [endpointCandidates, List.mem_filter]

/-- Every endpoint candidate belongs to the original transition list. -/
theorem endpointCandidates_sub
    {ts : List (EndpointTransition EndpointStateId EndpointTransitionId LabelId PeerId MessageId)}
    {q : EndpointStateId} {ℓ : ProtocolLabel LabelId PeerId MessageId}
    {u : EndpointTransition EndpointStateId EndpointTransitionId LabelId PeerId MessageId}
    (h : u ∈ endpointCandidates ts q ℓ) : u ∈ ts :=
  (mem_endpointCandidates.mp h).1

@[simp]
theorem endpointCandidates_nil
    (q : EndpointStateId) (ℓ : ProtocolLabel LabelId PeerId MessageId) :
    endpointCandidates ([] : List (EndpointTransition EndpointStateId EndpointTransitionId LabelId PeerId MessageId)) q ℓ = [] := by
  simp [endpointCandidates]

/-! ### Boundary dispatch

Boundary dispatch is parameterized by:
- a local machine `m`
- an endpoint automaton `e`
- a boundary snapshot `bsnap`
- a dispatched action `a` with payload `p`
- a protocol-effect derivation function `deriveEffect` -/

/-- Protocol effect resolution after local dispatch success.
    Separated from boundaryDispatch for proof ergonomics. -/
def resolveBoundaryEffect
    (e : EndpointAutomaton EndpointStateId EndpointTransitionId LabelId PeerId MessageId)
    (bsnap : BoundarySnapshot State Ctx EndpointStateId)
    (s' : State) (ctx' : Ctx)
    (rule : TransitionRule State Action Ctx Payload)
    (info : ActionInfo State Action Payload)
    (deriveEffect : SelectedStep State Action Ctx Payload →
      ProtocolEffect LabelId PeerId MessageId)
    : BoundaryDispatchResult State Action Ctx Payload EndpointStateId EndpointTransitionId LabelId PeerId MessageId :=
  match deriveEffect ⟨rule, info⟩ with
  | .none =>
    .success
      ⟨⟨s', ctx'⟩, bsnap.endpointState⟩
      ⟨⟨rule, info⟩, .localOnly, .none, .none⟩
  | .send ℓ =>
    match endpointCandidates e.transitions bsnap.endpointState ℓ with
    | [] => .protocolViolation
    | u :: _ =>
      .success
        ⟨⟨s', ctx'⟩, u.target⟩
        ⟨⟨rule, info⟩, .protocolSend, .some u, .some ℓ⟩

/-! ### Helper lemmas for boundary dispatch -/

/-- resolveBoundaryEffect never returns unknownAction. -/
private theorem resolveBoundaryEffect_not_unknownAction
    {e : EndpointAutomaton EndpointStateId EndpointTransitionId LabelId PeerId MessageId}
    {bsnap : BoundarySnapshot State Ctx EndpointStateId}
    {s' : State} {ctx' : Ctx}
    {rule : TransitionRule State Action Ctx Payload}
    {info : ActionInfo State Action Payload}
    {deriveEffect : SelectedStep State Action Ctx Payload →
      ProtocolEffect LabelId PeerId MessageId} :
    resolveBoundaryEffect e bsnap s' ctx' rule info deriveEffect ≠ .unknownAction := by
  unfold resolveBoundaryEffect
  split <;> simp
  split <;> simp

/-- resolveBoundaryEffect never returns machineFailure. -/
private theorem resolveBoundaryEffect_not_machineFailure
    {e : EndpointAutomaton EndpointStateId EndpointTransitionId LabelId PeerId MessageId}
    {bsnap : BoundarySnapshot State Ctx EndpointStateId}
    {s' : State} {ctx' : Ctx}
    {rule : TransitionRule State Action Ctx Payload}
    {info : ActionInfo State Action Payload}
    {deriveEffect : SelectedStep State Action Ctx Payload →
      ProtocolEffect LabelId PeerId MessageId} :
    resolveBoundaryEffect e bsnap s' ctx' rule info deriveEffect ≠ .machineFailure := by
  unfold resolveBoundaryEffect
  split <;> simp
  split <;> simp

section

variable [DecidableEq State] [DecidableEq Action]

/-- Boundary dispatch: combines local EFSM dispatch with endpoint
    automaton validation.

    `deriveEffect` maps a successful local selected step to either
    no protocol effect or a send effect.

    The function first delegates to local dispatch. On local success,
    it checks the derived protocol effect:
    - `ProtocolEffect.none` → localOnly success, endpoint state unchanged
    - `ProtocolEffect.send ℓ` → check endpointCandidates; if non-empty,
      select the first candidate; if empty, return protocolViolation. -/
def boundaryDispatch
    (m : Machine State Action Ctx Payload)
    (e : EndpointAutomaton EndpointStateId EndpointTransitionId LabelId PeerId MessageId)
    (bsnap : BoundarySnapshot State Ctx EndpointStateId)
    (a : Action) (p : Payload)
    (deriveEffect : SelectedStep State Action Ctx Payload →
      ProtocolEffect LabelId PeerId MessageId)
    : BoundaryDispatchResult State Action Ctx Payload EndpointStateId EndpointTransitionId LabelId PeerId MessageId :=
  match dispatch m bsnap.machineSnapshot.state bsnap.machineSnapshot.context a p with
  | .unknownAction => .unknownAction
  | .failure => .machineFailure
  | .success s' ctx' rule info =>
    resolveBoundaryEffect e bsnap s' ctx' rule info deriveEffect

/-- If boundary dispatch returns unknownAction, local dispatch returned
    unknownAction. -/
theorem boundaryDispatch_unknownAction
    {m : Machine State Action Ctx Payload}
    {e : EndpointAutomaton EndpointStateId EndpointTransitionId LabelId PeerId MessageId}
    {bsnap : BoundarySnapshot State Ctx EndpointStateId}
    {a : Action} {p : Payload}
    {deriveEffect : SelectedStep State Action Ctx Payload →
      ProtocolEffect LabelId PeerId MessageId}
    (h : boundaryDispatch m e bsnap a p deriveEffect = .unknownAction) :
    dispatch m bsnap.machineSnapshot.state bsnap.machineSnapshot.context a p = .unknownAction := by
  unfold boundaryDispatch at h
  split at h
  · assumption
  · exact absurd h (by simp)
  · exact absurd h resolveBoundaryEffect_not_unknownAction

/-- If boundary dispatch returns machineFailure, local dispatch returned
    failure. -/
theorem boundaryDispatch_machineFailure
    {m : Machine State Action Ctx Payload}
    {e : EndpointAutomaton EndpointStateId EndpointTransitionId LabelId PeerId MessageId}
    {bsnap : BoundarySnapshot State Ctx EndpointStateId}
    {a : Action} {p : Payload}
    {deriveEffect : SelectedStep State Action Ctx Payload →
      ProtocolEffect LabelId PeerId MessageId}
    (h : boundaryDispatch m e bsnap a p deriveEffect = .machineFailure) :
    dispatch m bsnap.machineSnapshot.state bsnap.machineSnapshot.context a p = .failure := by
  unfold boundaryDispatch at h
  split at h
  · exact absurd h (by simp)
  · assumption
  · exact absurd h resolveBoundaryEffect_not_machineFailure

/-- Extract the local dispatch success from a boundary dispatch success. -/
theorem boundaryDispatch_success_local
    {m : Machine State Action Ctx Payload}
    {e : EndpointAutomaton EndpointStateId EndpointTransitionId LabelId PeerId MessageId}
    {bsnap : BoundarySnapshot State Ctx EndpointStateId}
    {a : Action} {p : Payload}
    {deriveEffect : SelectedStep State Action Ctx Payload →
      ProtocolEffect LabelId PeerId MessageId}
    {newSnap : BoundarySnapshot State Ctx EndpointStateId}
    {bstep : BoundarySelectedStep State Action Ctx Payload EndpointStateId EndpointTransitionId LabelId PeerId MessageId}
    (h : boundaryDispatch m e bsnap a p deriveEffect = .success newSnap bstep) :
    ∃ s' ctx' rule info,
      dispatch m bsnap.machineSnapshot.state bsnap.machineSnapshot.context a p
        = .success s' ctx' rule info := by
  unfold boundaryDispatch at h
  split at h
  · exact absurd h (by simp)
  · exact absurd h (by simp)
  · rename_i s' ctx' rule info heq
    exact ⟨s', ctx', rule, info, heq⟩

end
