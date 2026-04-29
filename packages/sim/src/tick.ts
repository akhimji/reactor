import type { InputCommand } from './actions.js';
import type { SimConfig } from './config.js';
import type { SimState } from './state.js';

// Phase order is locked by sim spec §4.1. Determinism rests on this order.
// Do not reorder phases without a new ADR.
//
// Per-phase reassignment allocates a new state object each phase.
// Acceptable for v1; revisit alongside the typed-array neutron refactor.
// See dev-log.md planned-milestones.
export function advanceTick(
  state: SimState,
  inputs: readonly InputCommand[],
  config: SimConfig,
): SimState {
  if (state.ended !== null) return state;

  let s: SimState = { ...state, tick: state.tick + 1 };
  s = phaseProcessInputs(s, inputs, config);
  s = phaseAdvanceFuelRods(s, config);
  s = phaseAdvanceNeutrons(s, config);
  s = phaseResolveCollisions(s, config);
  s = phaseApplyCollisions(s, config);
  s = phaseAdvanceAtomStates(s, config);
  s = phaseAutoDecay(s, config);
  s = phaseRecomputeCriticality(s, config);
  s = phaseCheckEndConditions(s, config);
  s = phaseEmitEvents(s, config);
  return s;
}

// §4.1.1
function phaseProcessInputs(
  state: SimState,
  _inputs: readonly InputCommand[],
  _config: SimConfig,
): SimState {
  return state;
}

// §4.1.2
function phaseAdvanceFuelRods(state: SimState, _config: SimConfig): SimState {
  return state;
}

// §4.1.3
function phaseAdvanceNeutrons(state: SimState, _config: SimConfig): SimState {
  return state;
}

// §4.1.4
function phaseResolveCollisions(state: SimState, _config: SimConfig): SimState {
  return state;
}

// §4.1.5
function phaseApplyCollisions(state: SimState, _config: SimConfig): SimState {
  return state;
}

// §4.1.6
function phaseAdvanceAtomStates(state: SimState, _config: SimConfig): SimState {
  return state;
}

// §4.1.7
function phaseAutoDecay(state: SimState, _config: SimConfig): SimState {
  return state;
}

// §4.1.8
function phaseRecomputeCriticality(state: SimState, _config: SimConfig): SimState {
  return state;
}

// §4.1.9
function phaseCheckEndConditions(state: SimState, _config: SimConfig): SimState {
  return state;
}

// §4.1.10
function phaseEmitEvents(state: SimState, _config: SimConfig): SimState {
  return state;
}
