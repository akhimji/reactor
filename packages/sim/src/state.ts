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

// Populated by phase 8 (recompute criticality). Null until phase 8 first runs
// and writes the initial value (one tick after run start). Phase 9's k-based
// checks guard on null and skip when criticality has not yet been computed.
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
  readonly criticality: SimCriticality | null;
  // Fixed-length rolling buffer indexed by `tick % criticalityWindow`. Each
  // slot holds the count of neutrons produced by fission events on that tick
  // (sum of atomSplit.neutronsReleased per ADR-030). Phase 8 writes the
  // current tick's slot, then sums all slots to compute k (ADR-029).
  readonly fissionHistory: readonly number[];
  // Run-cumulative score. Incremented by phase 8 while the reactor is in the
  // nominal zone (ADR-032). Read by SCRAM and phase 9 to populate
  // runEnded.finalScore (ADR-033).
  readonly score: number;
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
    criticality: null,
    fissionHistory: new Array(config.criticalityWindow).fill(0),
    score: 0,
  };
}

export function drainEvents(state: SimState): readonly [readonly SimEvent[], SimState] {
  if (state.pendingEvents.length === 0) return [[], state];
  return [state.pendingEvents, { ...state, pendingEvents: [] }];
}
