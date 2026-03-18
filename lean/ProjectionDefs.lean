/-
  Projection-layer core type definitions.

  This file contains only type definitions — no functions or theorems.
  It defines the projection layer that derives endpoint automata from
  a source protocol description, sitting before the boundary layer.

  Reuses ProtocolLabel, EndpointTransition, EndpointAutomaton from
  ProtocolDefs.lean. All identifier types are parameters.
-/
import ProtocolDefs

/-! ### Projection-layer identifier types

These are parameters, not concrete types. The semantic model requires
only decidable equality. -/

variable {RoleId MessageId InteractionId NodeId LabelId EndpointStateId EndpointTransitionId : Type}

/-! ### Message interaction -/

/-- A message interaction identifies one protocol-visible communication
    action in the source protocol. -/
structure MessageInteraction (RoleId MessageId InteractionId : Type) where
  /-- Stable interaction identifier. -/
  id : InteractionId
  /-- Sender role. -/
  sender : RoleId
  /-- Receiver role. -/
  receiver : RoleId
  /-- Protocol message identifier. -/
  message : MessageId

/-! ### Source protocol syntax -/

/-- Source protocol syntax node forms.

    The restricted first fragment supports:
    - `done` (terminal)
    - `interact` (one interaction followed by continuation)
    - `choice` (single-chooser branch point with ordered branches)
    - `loop` (finite recursion with a loop identifier and body)
    - `continueLoop` (back-edge to a named loop) -/
inductive ProtocolSyntax (RoleId MessageId InteractionId : Type) where
  | done
  | interact (interaction : MessageInteraction RoleId MessageId InteractionId)
             (next : ProtocolSyntax RoleId MessageId InteractionId)
  | choice (chooser : RoleId)
           (branches : List (MessageId × ProtocolSyntax RoleId MessageId InteractionId))
  | loop (loopId : InteractionId)
         (body : ProtocolSyntax RoleId MessageId InteractionId)
  | continueLoop (loopId : InteractionId)

/-- A source protocol description artifact. -/
structure SourceProtocol (RoleId MessageId InteractionId : Type) where
  /-- Protocol identifier (not used in projection logic, present for tracing). -/
  id : InteractionId
  /-- Finite ordered role set. -/
  roles : List RoleId
  /-- Protocol body. -/
  body : ProtocolSyntax RoleId MessageId InteractionId
  /-- Roles are non-empty. -/
  roles_nonempty : roles ≠ []
  /-- Role identifiers are distinct. -/
  roles_nodup : roles.Nodup

/-! ### Normalized global graph -/

/-- Edge label in the normalized global graph. -/
inductive EdgeLabel (RoleId MessageId InteractionId : Type) where
  /-- An interaction edge labeled by a message interaction. -/
  | interaction (i : MessageInteraction RoleId MessageId InteractionId)
  /-- A branch edge labeled by a branch label (message id used as discriminator). -/
  | branch (chooser : RoleId) (label : MessageId)

/-- A directed edge in the normalized global graph. -/
structure GraphEdge (NodeId RoleId MessageId InteractionId : Type) where
  /-- Source node. -/
  source : NodeId
  /-- Edge label. -/
  label : EdgeLabel RoleId MessageId InteractionId
  /-- Target node. -/
  target : NodeId

/-- A normalized global graph derived from a source protocol.

    Well-formedness constraints are bundled:
    - nodes are non-empty and distinct
    - initial node is declared
    - terminal nodes are a subset of nodes
    - all edge sources and targets are declared nodes -/
structure NormalizedGraph (NodeId RoleId MessageId InteractionId : Type)
    [DecidableEq NodeId] where
  /-- Finite ordered set of control-flow nodes. -/
  nodes : List NodeId
  /-- Initial node. -/
  initial : NodeId
  /-- Terminal nodes. -/
  terminals : List NodeId
  /-- Finite ordered set of directed edges. -/
  edges : List (GraphEdge NodeId RoleId MessageId InteractionId)
  /-- Nodes are non-empty. -/
  nodes_nonempty : nodes ≠ []
  /-- Nodes are distinct. -/
  nodes_nodup : nodes.Nodup
  /-- Initial node is declared. -/
  initial_mem : initial ∈ nodes
  /-- Terminal nodes are declared. -/
  terminals_sub : ∀ t ∈ terminals, t ∈ nodes
  /-- All edge sources and targets are declared. -/
  edges_wf : ∀ e ∈ edges, e.source ∈ nodes ∧ e.target ∈ nodes

/-! ### Role-local event alphabet -/

/-- A role-local event for a fixed role. -/
inductive LocalEvent (RoleId MessageId : Type) where
  | send (peer : RoleId) (message : MessageId)
  | receive (peer : RoleId) (message : MessageId)
  deriving DecidableEq

/-! ### Rejection classes -/

/-- Named rejection classes for the first projection semantics. -/
inductive ProjectionRejection where
  | parallelCompositionUnsupported
  | nonFiniteStateProtocol
  | nonProjectableChoice
  | nonSingleChooser
  | undeclaredRole
  | duplicateInteractionId
  deriving DecidableEq, Repr

/-! ### Projection result type -/

/-- Result of projecting a source protocol into endpoint automata.

    On success, yields an ordered family of (role, EndpointAutomaton) pairs.
    On rejection, yields a named rejection class. -/
inductive ProjectionResult
    (RoleId EndpointStateId EndpointTransitionId LabelId MessageId : Type)
    [DecidableEq EndpointStateId] where
  | success (endpoints : List (RoleId ×
      EndpointAutomaton EndpointStateId EndpointTransitionId LabelId RoleId MessageId))
  | rejection (reason : ProjectionRejection)
