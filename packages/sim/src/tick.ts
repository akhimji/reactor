import type { FuelMix, InputCommand } from './actions.js';
import { findNeutronAtomCollisions, type CollisionPair } from './collisions.js';
import type { SimConfig } from './config.js';
import type { SimEvent } from './events.js';
import { next, type PRNGState } from './prng.js';
import type { SimState } from './state.js';
import type {
  Atom,
  AtomId,
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
      {
        type: 'neutronSpawned',
        tick: state.tick,
        data: { neutronId: id, position, velocity: { vx, vy } },
      },
    ],
  };
}

function applyPlaceControlRod(state: SimState, position: Vec2, config: SimConfig): SimState {
  if (state.inventory.controlRods <= 0) return state;

  const id = state.nextEntityId as ControlRodId;
  const radius = config.actions.controlRod.radius;
  const rod: ControlRod = {
    id,
    position,
    radius,
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
      {
        type: 'controlRodPlaced',
        tick: state.tick,
        data: { controlRodId: id, position, radius },
      },
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

  const radius = config.actions.fuelRod.radius;
  const { schedule, nextPrng } = generateReleaseSchedule(
    fuelMix,
    state.tick,
    radius,
    config.actions.fuelRod.releaseDuration,
    state.prng,
  );

  if (schedule.length === 0) return state;

  const id = state.nextEntityId as FuelRodId;
  const rod: FuelRod = {
    id,
    position,
    radius,
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
      {
        type: 'fuelRodPlaced',
        tick: state.tick,
        data: { fuelRodId: id, position, radius },
      },
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
      {
        type: 'runEnded',
        tick: state.tick,
        data: { outcome: 'stabilized', finalTick: state.tick, finalScore: 0 },
      },
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

// §4.1.2 — release scheduled atoms from each fuel rod whose entries fire this
// tick. If a release would violate `minAtomSpacing`, try up to 8 evenly-spaced
// offset candidates at distance `minAtomSpacing` (rotation seeded from the
// PRNG for determinism). If none lands in a valid spot inside the rod radius,
// skip the release silently per spec §10. Rods are marked exhausted once all
// schedule entries have fired (or were skipped) — exhausted rods remain in
// state until phase 7 cleanup (out of scope for this session).
function phaseAdvanceFuelRods(state: SimState, config: SimConfig): SimState {
  if (state.fuelRods.size === 0) return state;

  const minSpacing = config.minAtomSpacing;

  let atoms: ReadonlyMap<AtomId, Atom> = state.atoms;
  let prng = state.prng;
  let nextEntityId = state.nextEntityId;
  const newEvents: SimEvent[] = [];
  const updatedRods = new Map<FuelRodId, FuelRod>();
  let mutated = false;

  for (const [rodId, rod] of state.fuelRods) {
    if (rod.exhausted) {
      updatedRods.set(rodId, rod);
      continue;
    }

    let rodAtomsAdded = 0;

    for (const entry of rod.releaseSchedule) {
      if (entry.atTick !== state.tick) continue;

      const desired: Vec2 = {
        x: rod.position.x + entry.offset.x,
        y: rod.position.y + entry.offset.y,
      };

      let position: Vec2 | null = null;
      if (!violatesSpacing(desired, atoms, minSpacing)) {
        position = desired;
      } else {
        const [angleSeed, p1] = next(prng);
        prng = p1;
        const baseAngle = angleSeed * 2 * Math.PI;
        for (let i = 0; i < 8; i++) {
          const a = baseAngle + (i * Math.PI * 2) / 8;
          const candidate: Vec2 = {
            x: desired.x + Math.cos(a) * minSpacing,
            y: desired.y + Math.sin(a) * minSpacing,
          };
          const dx = candidate.x - rod.position.x;
          const dy = candidate.y - rod.position.y;
          if (Math.hypot(dx, dy) > rod.radius) continue;
          if (!violatesSpacing(candidate, atoms, minSpacing)) {
            position = candidate;
            break;
          }
        }
      }

      if (position === null) continue;

      const atomId = nextEntityId as AtomId;
      nextEntityId += 1;
      const decayTicks = config.atoms[entry.atomType].decayTicks;
      const atom: Atom = {
        id: atomId,
        position,
        type: entry.atomType,
        state: 'intact',
        excitedSince: null,
        decaysAt: decayTicks === null ? null : state.tick + decayTicks,
        collisionRadius: config.atom.collisionRadius,
      };
      const nextAtoms = new Map(atoms);
      nextAtoms.set(atomId, atom);
      atoms = nextAtoms;
      rodAtomsAdded += 1;
      newEvents.push({
        type: 'atomSpawned',
        tick: state.tick,
        data: { atomId, type: entry.atomType, position },
      });
    }

    const allReleased = rod.releaseSchedule.every((e) => e.atTick <= state.tick);
    if (allReleased && !rod.exhausted) {
      updatedRods.set(rodId, { ...rod, exhausted: true });
      newEvents.push({
        type: 'fuelRodExhausted',
        tick: state.tick,
        data: { fuelRodId: rodId, position: rod.position },
      });
      mutated = true;
    } else if (rodAtomsAdded > 0) {
      updatedRods.set(rodId, rod);
      mutated = true;
    } else {
      updatedRods.set(rodId, rod);
    }
  }

  if (!mutated && newEvents.length === 0) return state;

  return {
    ...state,
    atoms,
    fuelRods: updatedRods,
    prng,
    nextEntityId,
    pendingEvents:
      newEvents.length > 0 ? [...state.pendingEvents, ...newEvents] : state.pendingEvents,
  };
}

function violatesSpacing(
  position: Vec2,
  atoms: ReadonlyMap<AtomId, Atom>,
  minSpacing: number,
): boolean {
  for (const a of atoms.values()) {
    const dx = a.position.x - position.x;
    const dy = a.position.y - position.y;
    if (Math.hypot(dx, dy) < minSpacing) return true;
  }
  return false;
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
        data: { neutronId: id, reason: 'expired' },
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
        data: { neutronId: id, reason: 'out-of-bounds' },
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

// §4.1.4 — resolve neutron-atom and neutron-controlRod collisions for the tick.
//
// This is the most allocation-heavy phase of the tick: it builds a per-tick
// collision pair list, sorts it, walks it under a per-tick exclusion set, and
// rebuilds atoms / neutrons / controlRods maps as it mutates them. Per-phase
// allocation is acceptable for v1 (ADR-008 / typed-array refactor planned
// milestone); revisit alongside the neutron storage refactor.
//
// Order of operations:
// 1. Build all neutron-atom collision pairs (collisions.ts; ADR-024).
// 2. Sort by neutron spawn order (spawnedAt asc, then neutronId asc as
//    tiebreak; neutron ids are issued sequentially so this is stable and
//    deterministic).
// 3. Resolve each pair under a per-tick "atom already hit" set (ADR-020):
//    pass-through losers are not consumed and emit no events; the winner
//    splits or absorbs per ADR-022.
// 4. Process control rod absorption against surviving neutrons. Per ADR-021
//    this is a per-tick Bernoulli trial. Newly-spawned neutrons are skipped
//    per ADR-016.
//
// All randomness threads through state.prng (ADR-005). One PRNG draw per
// resolved atom collision, plus one extra draw for the neutron count when
// the outcome is `split`. One PRNG draw per neutron-rod inside-radius check.
function phaseResolveCollisions(state: SimState, config: SimConfig): SimState {
  const allPairs = findNeutronAtomCollisions(
    state.neutrons,
    state.atoms,
    state.tick,
    config,
  );

  let atoms = state.atoms;
  let neutrons = state.neutrons;
  let prng = state.prng;
  const newEvents: SimEvent[] = [];
  let mutated = false;

  if (allPairs.length > 0) {
    const pairs = sortPairsBySpawnOrder(allPairs, state.neutrons);
    const hitAtoms = new Set<AtomId>();

    for (const pair of pairs) {
      if (hitAtoms.has(pair.atomId)) continue;

      const atom = atoms.get(pair.atomId);
      const neutron = neutrons.get(pair.neutronId);
      if (atom === undefined || neutron === undefined) continue;

      const behavior = config.atoms[atom.type];
      const [roll, p1] = next(prng);
      prng = p1;

      if (roll < behavior.splitChance) {
        // Split: atom enters excited; record neutronsReleased for phase 5.
        const minN = behavior.neutronsPerSplit.min;
        const maxN = behavior.neutronsPerSplit.max;
        const [u, p2] = next(prng);
        prng = p2;
        const neutronsReleased =
          minN + Math.floor(u * (maxN - minN + 1));

        const updatedAtom: Atom = {
          ...atom,
          state: 'excited',
          excitedSince: state.tick,
          pendingNeutrons: neutronsReleased,
        };
        const nextAtoms = new Map(atoms);
        nextAtoms.set(atom.id, updatedAtom);
        atoms = nextAtoms;

        const nextNeutrons = new Map(neutrons);
        nextNeutrons.delete(neutron.id);
        neutrons = nextNeutrons;

        hitAtoms.add(atom.id);
        mutated = true;

        newEvents.push({
          type: 'atomSplit',
          tick: state.tick,
          data: {
            atomId: atom.id,
            position: atom.position,
            neutronsReleased,
          },
        });
        newEvents.push({
          type: 'neutronAbsorbed',
          tick: state.tick,
          data: {
            neutronId: neutron.id,
            absorbedBy: 'atom',
            targetId: atom.id,
            position: neutron.position,
          },
        });
        newEvents.push({
          type: 'neutronExpired',
          tick: state.tick,
          data: { neutronId: neutron.id, reason: 'absorbed' },
        });
      } else if (roll < behavior.splitChance + behavior.absorbChance) {
        // Absorb: atom transitions to spent (except B10 — immortal per ADR-022).
        const isImmortal = atom.type === 'B10';

        if (!isImmortal) {
          const updatedAtom: Atom = { ...atom, state: 'spent' };
          const nextAtoms = new Map(atoms);
          nextAtoms.set(atom.id, updatedAtom);
          atoms = nextAtoms;
          newEvents.push({
            type: 'atomSpent',
            tick: state.tick,
            data: { atomId: atom.id, position: atom.position },
          });
        }

        const nextNeutrons = new Map(neutrons);
        nextNeutrons.delete(neutron.id);
        neutrons = nextNeutrons;

        hitAtoms.add(atom.id);
        mutated = true;

        newEvents.push({
          type: 'neutronAbsorbed',
          tick: state.tick,
          data: {
            neutronId: neutron.id,
            absorbedBy: 'atom',
            targetId: atom.id,
            position: neutron.position,
          },
        });
        newEvents.push({
          type: 'neutronExpired',
          tick: state.tick,
          data: { neutronId: neutron.id, reason: 'absorbed' },
        });
      }
      // else: pass-through. No state change, no event, no hitAtoms entry.
    }
  }

  // Control rod absorption (ADR-021): position-only check against each rod
  // radius; the rod is static so no swept geometry is needed.
  let controlRods = state.controlRods;
  if (controlRods.size > 0 && neutrons.size > 0) {
    const survivingNeutrons = new Map(neutrons);
    const updatedRods = new Map<ControlRodId, ControlRod>();
    const removedRods = new Set<ControlRodId>();
    let rodsMutated = false;

    for (const [rodId, rod] of controlRods) {
      let workingRod = rod;
      const r2 = rod.radius * rod.radius;

      for (const [nId, n] of survivingNeutrons) {
        if (n.spawnedAt === state.tick) continue;
        const dx = n.position.x - rod.position.x;
        const dy = n.position.y - rod.position.y;
        if (dx * dx + dy * dy > r2) continue;

        const [roll, p1] = next(prng);
        prng = p1;
        if (roll >= workingRod.absorbStrength) continue;

        survivingNeutrons.delete(nId);
        workingRod = { ...workingRod, durability: workingRod.durability - 1 };
        rodsMutated = true;

        newEvents.push({
          type: 'neutronAbsorbed',
          tick: state.tick,
          data: {
            neutronId: nId,
            absorbedBy: 'controlRod',
            targetId: rodId,
            position: n.position,
          },
        });
        newEvents.push({
          type: 'neutronExpired',
          tick: state.tick,
          data: { neutronId: nId, reason: 'absorbed' },
        });

        if (workingRod.durability <= 0) {
          removedRods.add(rodId);
          newEvents.push({
            type: 'controlRodDepleted',
            tick: state.tick,
            data: { controlRodId: rodId, position: rod.position },
          });
          break;
        }
      }

      if (!removedRods.has(rodId)) updatedRods.set(rodId, workingRod);
    }

    if (rodsMutated) {
      neutrons = survivingNeutrons;
      controlRods = updatedRods;
      mutated = true;
    }
  }

  if (!mutated && newEvents.length === 0) return state;

  return {
    ...state,
    atoms,
    neutrons,
    controlRods,
    prng,
    pendingEvents:
      newEvents.length > 0 ? [...state.pendingEvents, ...newEvents] : state.pendingEvents,
  };
}

function sortPairsBySpawnOrder(
  pairs: readonly CollisionPair[],
  neutrons: ReadonlyMap<NeutronId, Neutron>,
): CollisionPair[] {
  const copy = [...pairs];
  copy.sort((a, b) => {
    const na = neutrons.get(a.neutronId);
    const nb = neutrons.get(b.neutronId);
    const sa = na?.spawnedAt ?? 0;
    const sb = nb?.spawnedAt ?? 0;
    if (sa !== sb) return sa - sb;
    return (a.neutronId as unknown as number) - (b.neutronId as unknown as number);
  });
  return copy;
}

// §4.1.5 — apply collision results.
//
// For every atom in `excited` state (set by phase 4 on a split outcome): spawn
// `pendingNeutrons` neutrons at angles computed by ADR-025's
// evenly-distributed-with-jitter algorithm, position-offset from the parent's
// center per ADR-026, then transition the atom to `splitting` and record
// `splittingStartedAt` for phase 6 to consume.
//
// Same-tick deferral: atoms that became `excited` in the current tick (i.e.
// `excitedSince === state.tick`) are skipped. They will be processed by
// phase 5 on the next tick. This matches ADR-023's "Duration in excited is
// exactly 1 tick" — the atom is observable in `excited` state for one tick
// (the tick phase 4 set it) so the renderer can play a buildup animation
// before particles spawn. Same family of rule as ADR-016 for neutrons.
//
// Determinism contract (ADR-025): exactly N+1 PRNG draws per split where N is
// pendingNeutrons. The first draw seeds the rotation of the even pattern;
// each subsequent draw perturbs one neutron's angle.
//
// Phase 5 does not emit `atomSplit` — that fired in phase 4 when the split
// was committed. Phase 5 is the mechanical follow-through.
function phaseApplyCollisions(state: SimState, config: SimConfig): SimState {
  let hasReady = false;
  for (const atom of state.atoms.values()) {
    if (atom.state === 'excited' && atom.excitedSince !== null && atom.excitedSince < state.tick) {
      hasReady = true;
      break;
    }
  }
  if (!hasReady) return state;

  const speed = config.neutron.defaultSpeed;
  const lifetime = config.neutron.lifetimeTicks;
  const jitter = config.physics.neutronReleaseJitter;

  let atoms = state.atoms;
  let neutrons = state.neutrons;
  let prng = state.prng;
  let nextEntityId = state.nextEntityId;
  const newEvents: SimEvent[] = [];

  // Map iteration is insertion-order (atoms inserted in deterministic order
  // by phase 2), so this loop is deterministic.
  for (const [atomId, atom] of state.atoms) {
    if (atom.state !== 'excited') continue;
    if (atom.excitedSince === null || atom.excitedSince >= state.tick) continue;

    const n = atom.pendingNeutrons ?? 0;

    // Single PRNG draw for the rotation seed regardless of N. Per ADR-025 the
    // budget is N + 1 draws; this is the +1.
    const [u0, p0] = next(prng);
    prng = p0;
    const baseOffset = u0 * 2 * Math.PI;

    const nextNeutrons = new Map(neutrons);
    for (let i = 0; i < n; i++) {
      const evenAngle = baseOffset + ((i / n) * 2 * Math.PI);
      const [uj, pj] = next(prng);
      prng = pj;
      const angle = evenAngle + (uj - 0.5) * jitter;

      const dx = Math.cos(angle);
      const dy = Math.sin(angle);
      const offset = atom.collisionRadius + 0.01;
      const position: Vec2 = {
        x: atom.position.x + dx * offset,
        y: atom.position.y + dy * offset,
      };
      const velocity = { vx: dx * speed, vy: dy * speed };

      const id = nextEntityId as NeutronId;
      nextEntityId += 1;
      const neutron: Neutron = {
        id,
        position,
        velocity,
        spawnedAt: state.tick,
        expiresAt: state.tick + lifetime,
      };
      nextNeutrons.set(id, neutron);

      newEvents.push({
        type: 'neutronSpawned',
        tick: state.tick,
        data: { neutronId: id, position, velocity },
      });
    }
    neutrons = nextNeutrons;

    // Spread without `pendingNeutrons` to drop it (exactOptionalPropertyTypes
    // forbids assigning `undefined` to an optional `number?`). Same below for
    // `splittingStartedAt` in phase 6.
    const { pendingNeutrons: _drop, ...rest } = atom;
    void _drop;
    const updatedAtom: Atom = {
      ...rest,
      state: 'splitting',
      splittingStartedAt: state.tick,
    };
    const nextAtoms = new Map(atoms);
    nextAtoms.set(atomId, updatedAtom);
    atoms = nextAtoms;
  }

  return {
    ...state,
    atoms,
    neutrons,
    prng,
    nextEntityId,
    pendingEvents:
      newEvents.length > 0 ? [...state.pendingEvents, ...newEvents] : state.pendingEvents,
  };
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
