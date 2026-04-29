import type { InputCommand } from './actions.js';
import type { SimConfig } from './config.js';
import type { SimEvent } from './events.js';
import type { SimState } from './state.js';
import type { Neutron, NeutronId } from './types.js';

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

// §4.1.3 — neutrons travel in straight lines at fixed velocity (spec §2.2).
// One tick = one velocity-unit step (no dt multiplier; sim is fixed-rate per
// ADR-005). A neutron is removed when its lifetime is up OR when it leaves the
// playfield (ADR-013 bounds). When both conditions hold in the same tick,
// expiration takes priority: lifetime is the more deterministic property.
function phaseAdvanceNeutrons(state: SimState, config: SimConfig): SimState {
  if (state.neutrons.size === 0) return state;

  const bounds = config.playfield.bounds;
  const survivors = new Map<NeutronId, Neutron>();
  const expirationEvents: SimEvent[] = [];

  for (const [id, n] of state.neutrons) {
    if (state.tick >= n.expiresAt) {
      expirationEvents.push({
        type: 'neutronExpired',
        tick: state.tick,
        data: { id, reason: 'expired' },
      });
      continue;
    }

    const position = {
      x: n.position.x + n.velocity.vx,
      y: n.position.y + n.velocity.vy,
    };

    if (
      position.x < bounds.minX ||
      position.x > bounds.maxX ||
      position.y < bounds.minY ||
      position.y > bounds.maxY
    ) {
      expirationEvents.push({
        type: 'neutronExpired',
        tick: state.tick,
        data: { id, reason: 'out-of-bounds' },
      });
      continue;
    }

    survivors.set(id, { ...n, position });
  }

  return {
    ...state,
    neutrons: survivors,
    pendingEvents:
      expirationEvents.length > 0
        ? [...state.pendingEvents, ...expirationEvents]
        : state.pendingEvents,
  };
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
