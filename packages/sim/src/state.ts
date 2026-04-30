import type { SimConfig } from './config.js';
import type { SimEvent } from './events.js';
import { createPRNG, type PRNGState } from './prng.js';
import type {
  Atom,
  AtomId,
  ControlRod,
  ControlRodId,
  CriticalityZone,
  FuelRod,
  FuelRodId,
  Neutron,
  NeutronId,
  RunEndReason,
} from './types.js';

export type SimCooldowns = {
  // Tick at which the cooldown expires; cooldown is active while state.tick < value.
  // 0 means available immediately.
  readonly injectNeutron: number;
};

export type SimInventory = {
  readonly controlRods: number;
  readonly fuelRods: number;
  readonly scramAvailable: boolean;
};

// Populated by phase 8 (recompute criticality). Optional today because phase 8
// is not yet implemented; phase 9 (end conditions) skips k-based checks when
// this field is absent so existing tests and integration runs that span more
// than `extinctionGracePeriod` ticks don't trip a false extinction.
export type SimCriticality = {
  readonly k: number;
  readonly zone: CriticalityZone;
};

export type SimState = {
  readonly tick: number;
  readonly atoms: ReadonlyMap<AtomId, Atom>;
  readonly neutrons: ReadonlyMap<NeutronId, Neutron>;
  readonly controlRods: ReadonlyMap<ControlRodId, ControlRod>;
  readonly fuelRods: ReadonlyMap<FuelRodId, FuelRod>;
  readonly cooldowns: SimCooldowns;
  readonly inventory: SimInventory;
  readonly prng: PRNGState;
  readonly ended: { readonly reason: RunEndReason } | null;
  readonly pendingEvents: readonly SimEvent[];
  readonly nextEntityId: number;
  // Phase 9 grace-period counter for extinction (§7.1). Increments each tick
  // criticality is below threshold; resets to 0 on rebound.
  readonly ticksBelowExtinction: number;
  readonly criticality?: SimCriticality;
};

export function createSimState(seed: number, config: SimConfig): SimState {
  return {
    tick: 0,
    atoms: new Map(),
    neutrons: new Map(),
    controlRods: new Map(),
    fuelRods: new Map(),
    cooldowns: { injectNeutron: 0 },
    inventory: {
      controlRods: config.actions.controlRod.inventoryDefault,
      fuelRods: config.actions.fuelRod.inventoryDefault,
      scramAvailable: config.actions.scram.availableDefault,
    },
    prng: createPRNG(seed),
    ended: null,
    pendingEvents: [],
    nextEntityId: 1,
    ticksBelowExtinction: 0,
  };
}

export function drainEvents(state: SimState): readonly [readonly SimEvent[], SimState] {
  if (state.pendingEvents.length === 0) return [[], state];
  return [state.pendingEvents, { ...state, pendingEvents: [] }];
}
