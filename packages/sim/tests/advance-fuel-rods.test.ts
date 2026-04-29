import { describe, expect, it } from 'vitest';
import defaultConfig from '../configs/default.json' with { type: 'json' };
import {
  advanceTick,
  createSimState,
  drainEvents,
  loadConfig,
  type Atom,
  type AtomId,
  type FuelRod,
  type FuelRodId,
  type FuelRodReleaseEntry,
  type InputCommand,
  type SimEvent,
  type SimState,
} from '../src/index.js';

const config = loadConfig(defaultConfig);

const aid = (n: number): AtomId => n as unknown as AtomId;
const fidT = (n: number): FuelRodId => n as unknown as FuelRodId;

function withAtoms(state: SimState, atoms: readonly Atom[]): SimState {
  const m = new Map<AtomId, Atom>();
  for (const a of atoms) m.set(a.id, a);
  return { ...state, atoms: m };
}

function withFuelRods(state: SimState, rods: readonly FuelRod[]): SimState {
  const m = new Map<FuelRodId, FuelRod>();
  for (const r of rods) m.set(r.id, r);
  return { ...state, fuelRods: m };
}

function makeAtom(id: number, x: number, y: number): Atom {
  return {
    id: aid(id),
    position: { x, y },
    type: 'U235',
    state: 'intact',
    excitedSince: null,
    decaysAt: null,
  };
}

function makeRod(
  id: number,
  schedule: readonly FuelRodReleaseEntry[],
  position = { x: 0, y: 0 },
): FuelRod {
  return {
    id: fidT(id),
    position,
    placedAt: 0,
    releaseSchedule: schedule,
    exhausted: false,
  };
}

function findAll<T extends SimEvent['type']>(
  events: readonly SimEvent[],
  type: T,
): Extract<SimEvent, { type: T }>[] {
  return events.filter((e): e is Extract<SimEvent, { type: T }> => e.type === type);
}

describe('phase 2: advance fuel rods', () => {
  it('releases a single atom whose atTick matches the current tick', () => {
    const rod = makeRod(1, [{ atTick: 1, atomType: 'U235', offset: { x: 2, y: 0 } }]);
    const initial = withFuelRods(createSimState(1, config), [rod]);

    const s1 = advanceTick(initial, [], config);
    expect(s1.atoms.size).toBe(1);
    const atom = [...s1.atoms.values()][0]!;
    expect(atom.type).toBe('U235');
    expect(atom.position).toEqual({ x: 2, y: 0 });
    expect(atom.state).toBe('intact');

    expect(findAll(s1.pendingEvents, 'atomSpawned')).toHaveLength(1);
  });

  it('releases atoms across the correct ticks per schedule', () => {
    const rod = makeRod(1, [
      { atTick: 1, atomType: 'U235', offset: { x: 1, y: 0 } },
      { atTick: 3, atomType: 'U238', offset: { x: 2, y: 0 } },
      { atTick: 5, atomType: 'Pu239', offset: { x: 3, y: 0 } },
    ]);

    let s = withFuelRods(createSimState(1, config), [rod]);
    s = advanceTick(s, [], config); // tick 1
    expect(s.atoms.size).toBe(1);
    s = advanceTick(s, [], config); // tick 2
    expect(s.atoms.size).toBe(1);
    s = advanceTick(s, [], config); // tick 3
    expect(s.atoms.size).toBe(2);
    s = advanceTick(s, [], config); // tick 4
    expect(s.atoms.size).toBe(2);
    s = advanceTick(s, [], config); // tick 5
    expect(s.atoms.size).toBe(3);

    const types = [...s.atoms.values()].map((a) => a.type).sort();
    expect(types).toEqual(['Pu239', 'U235', 'U238']);
  });

  it('offsets a release that would violate minAtomSpacing — atom appears at adjusted position', () => {
    const desiredPos = { x: 0, y: 0 };
    const blocker = makeAtom(99, 0, 0);
    const rod = makeRod(
      1,
      [{ atTick: 1, atomType: 'U235', offset: desiredPos }],
      { x: 0, y: 0 },
    );

    const initial = withFuelRods(withAtoms(createSimState(7, config), [blocker]), [rod]);

    const s1 = advanceTick(initial, [], config);
    expect(s1.atoms.size).toBe(2);
    const newAtom = [...s1.atoms.values()].find((a) => a.id !== blocker.id)!;
    // Adjusted position is at minAtomSpacing distance from desired, in some direction.
    const d = Math.hypot(newAtom.position.x, newAtom.position.y);
    expect(d).toBeGreaterThanOrEqual(config.minAtomSpacing - 1e-9);
  });

  it('skips a release silently when no offset candidate is valid (rod radius too small)', () => {
    // Build a wall of blockers around the desired position so no candidate fits.
    // Keep them just inside the spacing zone of every candidate at minAtomSpacing.
    const ring: Atom[] = [];
    const r = config.minAtomSpacing;
    // 16 atoms in a ring at distance r — every 8-candidate slot at distance r
    // has at least one ring atom within minAtomSpacing.
    for (let i = 0; i < 16; i++) {
      const a = (i * 2 * Math.PI) / 16;
      ring.push(makeAtom(100 + i, Math.cos(a) * r, Math.sin(a) * r));
    }
    // Plus a center blocker so the desired position itself violates.
    ring.push(makeAtom(200, 0, 0));

    // Use a tiny rod radius so candidates outside r get rejected by the radius
    // check too.
    const tinyConfig = {
      ...config,
      actions: {
        ...config.actions,
        fuelRod: { ...config.actions.fuelRod, radius: 0.5 },
      },
    };

    const rod = makeRod(1, [{ atTick: 1, atomType: 'U235', offset: { x: 0, y: 0 } }]);
    const initial = withFuelRods(withAtoms(createSimState(7, tinyConfig), ring), [rod]);

    const s1 = advanceTick(initial, [], tinyConfig);
    expect(s1.atoms.size).toBe(ring.length); // no new atom
    expect(findAll(s1.pendingEvents, 'atomSpawned')).toHaveLength(0);
  });

  it('emits fuelRodExhausted exactly once when the rod transitions to exhausted', () => {
    const rod = makeRod(1, [
      { atTick: 1, atomType: 'U235', offset: { x: 1, y: 0 } },
      { atTick: 2, atomType: 'U235', offset: { x: -1, y: 0 } },
    ]);
    let s = withFuelRods(createSimState(1, config), [rod]);

    s = advanceTick(s, [], config); // tick 1: release first; not yet exhausted
    let drained = drainEvents(s);
    expect(findAll(drained[0], 'fuelRodExhausted')).toHaveLength(0);
    s = drained[1];
    expect(s.fuelRods.get(fidT(1))?.exhausted).toBe(false);

    s = advanceTick(s, [], config); // tick 2: release second; transitions to exhausted
    drained = drainEvents(s);
    expect(findAll(drained[0], 'fuelRodExhausted')).toHaveLength(1);
    s = drained[1];
    expect(s.fuelRods.get(fidT(1))?.exhausted).toBe(true);

    s = advanceTick(s, [], config); // tick 3: already exhausted, no new event
    drained = drainEvents(s);
    expect(findAll(drained[0], 'fuelRodExhausted')).toHaveLength(0);
  });

  it('emits fuelRodExhausted even when the final release was skipped due to no valid offset', () => {
    // Block the desired position and the entire candidate ring so the release
    // has nowhere to land.
    const ring: Atom[] = [];
    const r = config.minAtomSpacing;
    for (let i = 0; i < 16; i++) {
      const a = (i * 2 * Math.PI) / 16;
      ring.push(makeAtom(100 + i, Math.cos(a) * r, Math.sin(a) * r));
    }
    ring.push(makeAtom(200, 0, 0));

    const tinyConfig = {
      ...config,
      actions: {
        ...config.actions,
        fuelRod: { ...config.actions.fuelRod, radius: 0.5 },
      },
    };

    const rod = makeRod(1, [{ atTick: 1, atomType: 'U235', offset: { x: 0, y: 0 } }]);
    const initial = withFuelRods(withAtoms(createSimState(7, tinyConfig), ring), [rod]);

    const s1 = advanceTick(initial, [], tinyConfig);
    expect(findAll(s1.pendingEvents, 'atomSpawned')).toHaveLength(0);
    expect(findAll(s1.pendingEvents, 'fuelRodExhausted')).toHaveLength(1);
    expect(s1.fuelRods.get(fidT(1))?.exhausted).toBe(true);
  });

  it('exhausted rod remains in state (cleanup is a future phase)', () => {
    const rod = makeRod(1, [{ atTick: 1, atomType: 'U235', offset: { x: 1, y: 0 } }]);
    let s = withFuelRods(createSimState(1, config), [rod]);
    s = advanceTick(s, [], config); // exhausted at end of tick 1
    expect(s.fuelRods.get(fidT(1))?.exhausted).toBe(true);

    s = advanceTick(s, [], config); // tick 2: still present
    expect(s.fuelRods.has(fidT(1))).toBe(true);
  });

  it('determinism: same fuel rod schedule produces identical atom positions across runs', () => {
    const placeRod: InputCommand = {
      type: 'placeFuelRod',
      position: { x: 0, y: 0 },
      fuelMix: { U235: 4, U238: 2 },
    };

    const run = (): SimState => {
      let s = createSimState(13, config);
      s = advanceTick(s, [placeRod], config); // tick 1
      // run through the release window
      for (let i = 0; i < config.actions.fuelRod.releaseDuration + 5; i++) {
        s = advanceTick(s, [], config);
      }
      return s;
    };

    const a = run();
    const b = run();
    expect(a.atoms.size).toBe(b.atoms.size);
    expect(a.atoms.size).toBe(6);

    const positionsA = [...a.atoms.values()]
      .map((x) => `${x.type}:${x.position.x.toFixed(8)},${x.position.y.toFixed(8)}`)
      .sort();
    const positionsB = [...b.atoms.values()]
      .map((x) => `${x.type}:${x.position.x.toFixed(8)},${x.position.y.toFixed(8)}`)
      .sort();
    expect(positionsA).toEqual(positionsB);
  });
});
