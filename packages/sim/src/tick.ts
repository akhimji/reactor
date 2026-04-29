import type { FuelMix, InputCommand } from './actions.js';
import type { SimConfig } from './config.js';
import type { SimEvent } from './events.js';
import { next, type PRNGState } from './prng.js';
import type { SimState } from './state.js';
import type {
  AtomType,
  ControlRod,
  ControlRodId,
  FuelRod,
  FuelRodId,
  FuelRodReleaseEntry,
  Neutron,
  NeutronId,
  Vec2,
} from './types.js';

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

// §4.1.1 — apply player input commands to state.
// Per spec §10, invalid commands are dropped silently (no event, no state
// change). Per pre-decision: out-of-bounds neutron spawns are accepted; phase 3
// removes them on the next tick. Once a SCRAM has set state.ended, any further
// commands in the same tick are silently dropped — placing rods into an ended
// run would be wasted state churn.
function phaseProcessInputs(
  state: SimState,
  inputs: readonly InputCommand[],
  config: SimConfig,
): SimState {
  if (inputs.length === 0) return state;

  let s = state;
  for (const cmd of inputs) {
    if (s.ended !== null) break;
    s = applyCommand(s, cmd, config);
  }
  return s;
}

function applyCommand(state: SimState, cmd: InputCommand, config: SimConfig): SimState {
  switch (cmd.type) {
    case 'injectNeutron':
      return applyInjectNeutron(state, cmd.position, cmd.direction, config);
    case 'placeControlRod':
      return applyPlaceControlRod(state, cmd.position, config);
    case 'placeFuelRod':
      return applyPlaceFuelRod(state, cmd.position, cmd.fuelMix, config);
    case 'scram':
      return applyScram(state);
  }
}

function applyInjectNeutron(
  state: SimState,
  position: Vec2,
  direction: Vec2,
  config: SimConfig,
): SimState {
  if (state.tick < state.cooldowns.injectNeutron) return state;

  const mag = Math.hypot(direction.x, direction.y);
  if (mag === 0) return state;

  const speed = config.neutron.defaultSpeed;
  const vx = (direction.x / mag) * speed;
  const vy = (direction.y / mag) * speed;

  const id = state.nextEntityId as NeutronId;
  const neutron: Neutron = {
    id,
    position,
    velocity: { vx, vy },
    spawnedAt: state.tick,
    expiresAt: state.tick + config.neutron.lifetimeTicks,
  };

  const neutrons = new Map(state.neutrons);
  neutrons.set(id, neutron);

  return {
    ...state,
    neutrons,
    cooldowns: { ...state.cooldowns, injectNeutron: state.tick + config.actions.injectCooldown },
    nextEntityId: state.nextEntityId + 1,
    pendingEvents: [
      ...state.pendingEvents,
      { type: 'neutronSpawned', tick: state.tick, data: { id } },
    ],
  };
}

function applyPlaceControlRod(state: SimState, position: Vec2, config: SimConfig): SimState {
  if (state.inventory.controlRods <= 0) return state;

  const id = state.nextEntityId as ControlRodId;
  const rod: ControlRod = {
    id,
    position,
    radius: config.actions.controlRod.radius,
    placedAt: state.tick,
    durability: config.actions.controlRod.durability,
    absorbStrength: config.actions.controlRod.absorbStrength,
  };

  const controlRods = new Map(state.controlRods);
  controlRods.set(id, rod);

  return {
    ...state,
    controlRods,
    inventory: { ...state.inventory, controlRods: state.inventory.controlRods - 1 },
    nextEntityId: state.nextEntityId + 1,
    pendingEvents: [
      ...state.pendingEvents,
      { type: 'controlRodPlaced', tick: state.tick, data: { id } },
    ],
  };
}

function applyPlaceFuelRod(
  state: SimState,
  position: Vec2,
  fuelMix: FuelMix,
  config: SimConfig,
): SimState {
  if (state.inventory.fuelRods <= 0) return state;
  if (!hasAnyFuel(fuelMix)) return state;

  const { schedule, nextPrng } = generateReleaseSchedule(
    fuelMix,
    state.tick,
    config.actions.fuelRod.radius,
    config.actions.fuelRod.releaseDuration,
    state.prng,
  );

  if (schedule.length === 0) return state;

  const id = state.nextEntityId as FuelRodId;
  const rod: FuelRod = {
    id,
    position,
    placedAt: state.tick,
    releaseSchedule: schedule,
    exhausted: false,
  };

  const fuelRods = new Map(state.fuelRods);
  fuelRods.set(id, rod);

  return {
    ...state,
    fuelRods,
    inventory: { ...state.inventory, fuelRods: state.inventory.fuelRods - 1 },
    prng: nextPrng,
    nextEntityId: state.nextEntityId + 1,
    pendingEvents: [
      ...state.pendingEvents,
      { type: 'fuelRodPlaced', tick: state.tick, data: { id } },
    ],
  };
}

function applyScram(state: SimState): SimState {
  if (!state.inventory.scramAvailable) return state;

  return {
    ...state,
    inventory: { ...state.inventory, scramAvailable: false },
    ended: { reason: 'stabilized' },
    pendingEvents: [
      ...state.pendingEvents,
      { type: 'runEnded', tick: state.tick, data: { reason: 'stabilized' } },
    ],
  };
}

const ATOM_TYPE_ORDER: readonly AtomType[] = ['U235', 'U238', 'Pu239', 'B10'];

function hasAnyFuel(fuelMix: FuelMix): boolean {
  for (const t of ATOM_TYPE_ORDER) {
    const c = fuelMix[t];
    if (c !== undefined && c > 0) return true;
  }
  return false;
}

// Spec §2.4: a fuel rod's releaseSchedule describes when and where atoms appear.
// We expand fuelMix into a flat type list (fixed key order for determinism),
// distribute atoms evenly across [currentTick+1, currentTick+releaseDuration],
// and pick a uniform-disk offset for each via two PRNG draws (angle, radius).
function generateReleaseSchedule(
  fuelMix: FuelMix,
  currentTick: number,
  rodRadius: number,
  releaseDuration: number,
  prng: PRNGState,
): { schedule: FuelRodReleaseEntry[]; nextPrng: PRNGState } {
  const flatTypes: AtomType[] = [];
  for (const t of ATOM_TYPE_ORDER) {
    const count = fuelMix[t] ?? 0;
    for (let i = 0; i < count; i++) flatTypes.push(t);
  }

  const total = flatTypes.length;
  if (total === 0) return { schedule: [], nextPrng: prng };

  const schedule: FuelRodReleaseEntry[] = [];
  let p = prng;
  for (let i = 0; i < total; i++) {
    const atTick = currentTick + Math.max(1, Math.floor(((i + 1) * releaseDuration) / total));
    const [u1, p1] = next(p);
    const [u2, p2] = next(p1);
    const angle = u1 * 2 * Math.PI;
    const r = rodRadius * Math.sqrt(u2);
    schedule.push({
      atTick,
      atomType: flatTypes[i] as AtomType,
      offset: { x: r * Math.cos(angle), y: r * Math.sin(angle) },
    });
    p = p2;
  }
  return { schedule, nextPrng: p };
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
//
// Newly-spawned neutrons (spawnedAt === current tick) are not advanced this
// tick. They sit at the spawn position for one tick and start moving on the
// next. This gives the renderer a stable spawn frame and matches the
// pre-decision: phase 3 cleans up out-of-bounds spawns "the next tick."
function phaseAdvanceNeutrons(state: SimState, config: SimConfig): SimState {
  if (state.neutrons.size === 0) return state;

  const bounds = config.playfield.bounds;
  const survivors = new Map<NeutronId, Neutron>();
  const expirationEvents: SimEvent[] = [];

  for (const [id, n] of state.neutrons) {
    if (n.spawnedAt === state.tick) {
      survivors.set(id, n);
      continue;
    }

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
