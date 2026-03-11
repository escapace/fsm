/-
  Recursive flattening associativity for the flat EFSM semantic model.

  Defines lens composition and proves that lifting with a composed lens
  equals double lifting. This justifies nested composition: flattening
  a machine that contains an already-flattened child produces the same
  result as flattening the entire tree at once.
-/
import Compose

variable {State Action Payload : Type}
variable {A B C : Type}

/-- Compose two context lenses. The outer lens projects from A to B,
    the inner lens projects from B to C. The composed lens projects
    from A directly to C. -/
def composeLens (outer : CtxLens A B) (inner : CtxLens B C) : CtxLens A C where
  get := inner.get ∘ outer.get
  set := fun a c => outer.set a (inner.set (outer.get a) c)
  get_set := by
    intro a c
    simp [Function.comp, inner.get_set, outer.get_set]
  set_get := by
    intro a
    simp [Function.comp, inner.set_get, outer.set_get]

/-! ### Lifting with composed lens equals double lifting -/

/-- Lifting a guard twice (inner then outer) equals lifting once
    with the composed lens. -/
theorem liftGuard_compose (outer : CtxLens A B) (inner : CtxLens B C)
    (g : C → ActionInfo State Action Payload → Bool) :
    liftGuard outer (liftGuard inner g) = liftGuard (composeLens outer inner) g := by
  ext ctx info
  simp [liftGuard, composeLens, Function.comp]

/-- Lifting a guard list twice equals lifting once with the composed lens. -/
theorem liftGuards_compose (outer : CtxLens A B) (inner : CtxLens B C)
    (gs : List (C → ActionInfo State Action Payload → Bool)) :
    liftGuards outer (liftGuards inner gs) = liftGuards (composeLens outer inner) gs := by
  simp [liftGuards, List.map_map, liftGuard_compose]

/-- Lifting a reducer twice equals lifting once with the composed lens. -/
theorem liftReducer_compose (outer : CtxLens A B) (inner : CtxLens B C)
    (r : C → ActionInfo State Action Payload → C) :
    liftReducer outer (liftReducer inner r) = liftReducer (composeLens outer inner) r := by
  ext ctx info
  simp [liftReducer, composeLens, Function.comp]

/-- Lifting an optional reducer twice equals lifting once with the composed lens. -/
theorem liftOptReducer_compose (outer : CtxLens A B) (inner : CtxLens B C)
    (r : Option (C → ActionInfo State Action Payload → C)) :
    liftOptReducer outer (liftOptReducer inner r) = liftOptReducer (composeLens outer inner) r := by
  cases r with
  | none => rfl
  | some r => simp [liftOptReducer, Option.map, liftReducer_compose]

/-- Lifting a transition twice equals lifting once with the composed lens. -/
theorem liftTransition_compose (outer : CtxLens A B) (inner : CtxLens B C)
    (t : TransitionRule State Action C Payload) :
    liftTransition outer (liftTransition inner t) =
    liftTransition (composeLens outer inner) t := by
  simp only [liftTransition, liftGuards_compose, liftOptReducer_compose]

/-- Lifting a transition list twice equals lifting once with the composed lens. -/
theorem liftTransitions_compose (outer : CtxLens A B) (inner : CtxLens B C)
    (ts : List (TransitionRule State Action C Payload)) :
    liftTransitions outer (liftTransitions inner ts) =
    liftTransitions (composeLens outer inner) ts := by
  simp [liftTransitions, List.map_map, liftTransition_compose]

/-! ### Merge associativity -/

/-- Merging parent with child, where the child already contains merged
    grandchild transitions, equals merging all three levels at once.

    Given:
    - parentTs: parent's own transitions (context A)
    - childOwnTs: child's own transitions (context B)
    - grandchildTs: grandchild's transitions (context C)
    - outerLens: A → B projection
    - innerLens: B → C projection

    Merging childOwnTs with lifted grandchildTs, then lifting everything
    into A, equals lifting childOwnTs and grandchildTs separately. -/
theorem mergeTransitions_assoc (outer : CtxLens A B) (inner : CtxLens B C)
    (parentTs : List (TransitionRule State Action A Payload))
    (childOwnTs : List (TransitionRule State Action B Payload))
    (grandchildTs : List (TransitionRule State Action C Payload)) :
    mergeTransitions outer parentTs (mergeTransitions inner childOwnTs grandchildTs) =
    parentTs ++ liftTransitions outer childOwnTs ++
      liftTransitions (composeLens outer inner) grandchildTs := by
  have hcomp : liftTransition outer ∘ liftTransition inner =
      (liftTransition (composeLens outer inner) :
        TransitionRule State Action C Payload →
        TransitionRule State Action A Payload) :=
    funext (liftTransition_compose outer inner)
  simp only [mergeTransitions, liftTransitions, List.map_append, List.append_assoc,
    List.map_map, hcomp]
