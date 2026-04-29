import type { SimConfig } from './config.js';
import type { SimEvent } from './events.js';
import { createPRNG, type PRNGState } from './prng.js';
import type {
  Atom,
  AtomId,
  ControlRod,
  ControlRodId,
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
  };
}

export function drainEvents(state: SimState): readonly [readonly SimEvent[], SimState] {
  if (state.pendingEvents.length === 0) return [[], state];
  return [state.pendingEvents, { ...state, pendingEvents: [] }];
}
