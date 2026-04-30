import { describe, expect, it } from 'vitest';
import defaultConfig from '../configs/default.json' with { type: 'json' };
import {
  advanceTick,
  createSimState,
  loadConfig,
  type Atom,
  type AtomId,
  type AtomType,
  type SimEvent,
  type SimState,
} from '../src/index.js';

const baseConfig = loadConfig(defaultConfig);
const aid = (n: number): AtomId => n as unknown as AtomId;

function makeIntact(
  id: number,
  type: AtomType,
  decaysAt: number | null,
): Atom {
  return {
    id: aid(id),
    position: { x: 0, y: 0 },
    type,
    state: 'intact',
    excitedSince: null,
    decaysAt,
    collisionRadius: baseConfig.atom.collisionRadius,
  };
}

function makeSpent(id: number, spentAt: number | undefined): Atom {
  const base: Atom = {
    id: aid(id),
    position: { x: 0, y: 0 },
    type: 'U235',
    state: 'spent',
    excitedSince: null,
    decaysAt: null,
    collisionRadius: baseConfig.atom.collisionRadius,
  };
  return spentAt === undefined ? base : { ...base, spentAt };
}

function withInitialAtoms(
  base: SimState,
  atoms: readonly Atom[],
  tick: number,
): SimState {
  const m = new Map<AtomId, Atom>();
  for (const a of atoms) m.set(a.id, a);
  return { ...base, tick, atoms: m };
}

function findAll<T extends SimEvent['type']>(
  events: readonly SimEvent[],
  type: T,
): Extract<SimEvent, { type: T }>[] {
  return events.filter((e): e is Extract<SimEvent, { type: T }> => e.type === type);
}

describe('phase 7: auto-decay — Pu239 timer path', () => {
  it('Pu239 one tick early: NOT decayed', () => {
    // tick advances 0 -> 1; decaysAt = 2 means tick - decaysAt = -1, not yet.
    const initial = withInitialAtoms(
      createSimState(1, baseConfig),
      [makeIntact(10, 'Pu239', 2)],
      0,
    );
    const s1 = advanceTick(initial, [], baseConfig);

    expect(s1.atoms.has(aid(10))).toBe(true);
    expect(findAll(s1.pendingEvents, 'atomDecayed')).toHaveLength(0);
  });

  it('Pu239 exactly at decaysAt: decayed; atomDecayed fires; atom removed', () => {
    const initial = withInitialAtoms(
      createSimState(1, baseConfig),
      [makeIntact(10, 'Pu239', 1)],
      0,
    );
    const s1 = advanceTick(initial, [], baseConfig);

    expect(s1.atoms.has(aid(10))).toBe(false);
    const events = findAll(s1.pendingEvents, 'atomDecayed');
    expect(events).toHaveLength(1);
    expect(events[0]!.data.atomId).toBe(aid(10));
    expect(events[0]!.data.type).toBe('Pu239');
  });

  it('Pu239 past decaysAt: decayed (catches late-decay edge case)', () => {
    const initial = withInitialAtoms(
      createSimState(1, baseConfig),
      [makeIntact(10, 'Pu239', -5)],
      0,
    );
    const s1 = advanceTick(initial, [], baseConfig);

    expect(s1.atoms.has(aid(10))).toBe(false);
    expect(findAll(s1.pendingEvents, 'atomDecayed')).toHaveLength(1);
  });

  it('Pu239 in excited state at decay time: NOT decayed (state machine wins)', () => {
    const excited: Atom = {
      ...makeIntact(10, 'Pu239', 1),
      state: 'excited',
      excitedSince: 0,
      pendingNeutrons: 2,
    };
    const initial = withInitialAtoms(createSimState(1, baseConfig), [excited], 0);
    const s1 = advanceTick(initial, [], baseConfig);

    expect(s1.atoms.has(aid(10))).toBe(true);
    expect(findAll(s1.pendingEvents, 'atomDecayed')).toHaveLength(0);
  });

  it('Pu239 in splitting state at decay time: NOT decayed', () => {
    const splitting: Atom = {
      ...makeIntact(10, 'Pu239', 1),
      state: 'splitting',
      splittingStartedAt: 0,
    };
    const initial = withInitialAtoms(createSimState(1, baseConfig), [splitting], 0);
    const s1 = advanceTick(initial, [], baseConfig);

    expect(s1.atoms.has(aid(10))).toBe(true);
    expect(findAll(s1.pendingEvents, 'atomDecayed')).toHaveLength(0);
  });

  it('Pu239 in spent state: handled by cleanup path, not decay path', () => {
    // spentAt 1 - cleanup ticks short; tick advances to 1; should NOT cleanup.
    // Even though decaysAt is reached, the atom is `spent`, so the decay path skips.
    const spent: Atom = {
      ...makeIntact(10, 'Pu239', 1),
      state: 'spent',
      spentAt: 1,
    };
    const initial = withInitialAtoms(createSimState(1, baseConfig), [spent], 0);
    const s1 = advanceTick(initial, [], baseConfig);

    expect(s1.atoms.has(aid(10))).toBe(true);
    expect(findAll(s1.pendingEvents, 'atomDecayed')).toHaveLength(0);
  });

  it('atomDecayed payload matches spec §8.1: { atomId, type, position }', () => {
    const positioned: Atom = {
      ...makeIntact(10, 'Pu239', 1),
      position: { x: 3, y: -7 },
    };
    const initial = withInitialAtoms(createSimState(1, baseConfig), [positioned], 0);
    const s1 = advanceTick(initial, [], baseConfig);

    const events = findAll(s1.pendingEvents, 'atomDecayed');
    expect(events).toHaveLength(1);
    expect(events[0]!.tick).toBe(s1.tick);
    expect(events[0]!.data.atomId).toBe(aid(10));
    expect(events[0]!.data.type).toBe('Pu239');
    expect(events[0]!.data.position).toEqual({ x: 3, y: -7 });
  });
});

describe('phase 7: auto-decay — spent cleanup path', () => {
  it('spent atom exactly at cleanup threshold: removed', () => {
    const cleanup = baseConfig.physics.spentAtomCleanupTicks;
    // tick advances 0 -> 1. Need state.tick - spentAt >= cleanup -> spentAt <= 1 - cleanup.
    const initial = withInitialAtoms(
      createSimState(1, baseConfig),
      [makeSpent(10, 1 - cleanup)],
      0,
    );
    const s1 = advanceTick(initial, [], baseConfig);

    expect(s1.atoms.has(aid(10))).toBe(false);
  });

  it('spent atom one tick early: NOT removed', () => {
    const cleanup = baseConfig.physics.spentAtomCleanupTicks;
    const initial = withInitialAtoms(
      createSimState(1, baseConfig),
      [makeSpent(10, 1 - cleanup + 1)],
      0,
    );
    const s1 = advanceTick(initial, [], baseConfig);

    expect(s1.atoms.has(aid(10))).toBe(true);
  });

  it('spent atom past cleanup threshold: removed', () => {
    const cleanup = baseConfig.physics.spentAtomCleanupTicks;
    const initial = withInitialAtoms(
      createSimState(1, baseConfig),
      [makeSpent(10, 1 - cleanup - 5)],
      0,
    );
    const s1 = advanceTick(initial, [], baseConfig);

    expect(s1.atoms.has(aid(10))).toBe(false);
  });

  it('spent atom with spentAt undefined: NOT removed (graceful handling)', () => {
    const initial = withInitialAtoms(
      createSimState(1, baseConfig),
      [makeSpent(10, undefined)],
      0,
    );
    const s1 = advanceTick(initial, [], baseConfig);

    expect(s1.atoms.has(aid(10))).toBe(true);
    // No crash, no event, atom lingers — the source bug, not phase 7's concern.
  });

  it('no event emitted on cleanup (housekeeping is silent)', () => {
    const cleanup = baseConfig.physics.spentAtomCleanupTicks;
    const initial = withInitialAtoms(
      createSimState(1, baseConfig),
      [makeSpent(10, 1 - cleanup)],
      0,
    );
    const s1 = advanceTick(initial, [], baseConfig);

    expect(findAll(s1.pendingEvents, 'atomSpent')).toHaveLength(0);
    expect(findAll(s1.pendingEvents, 'atomDecayed')).toHaveLength(0);
    // No new events at all from this state — input-free, no other entities.
    expect(s1.pendingEvents).toHaveLength(0);
  });
});

describe('phase 7: auto-decay — cross-path interactions', () => {
  it('multiple Pu239 atoms decaying in same tick: all decay deterministically', () => {
    const initial = withInitialAtoms(
      createSimState(1, baseConfig),
      [
        makeIntact(10, 'Pu239', 1),
        makeIntact(11, 'Pu239', 1),
        makeIntact(12, 'Pu239', 1),
      ],
      0,
    );
    const s1 = advanceTick(initial, [], baseConfig);

    expect(s1.atoms.size).toBe(0);
    expect(findAll(s1.pendingEvents, 'atomDecayed')).toHaveLength(3);
  });

  it('mixed paths: one decaying, one cleaning up, one untouched', () => {
    const cleanup = baseConfig.physics.spentAtomCleanupTicks;
    const initial = withInitialAtoms(
      createSimState(1, baseConfig),
      [
        makeIntact(10, 'Pu239', 1), // will decay
        makeSpent(11, 1 - cleanup), // will cleanup
        makeIntact(12, 'U235', null), // untouched
      ],
      0,
    );
    const s1 = advanceTick(initial, [], baseConfig);

    expect(s1.atoms.has(aid(10))).toBe(false);
    expect(s1.atoms.has(aid(11))).toBe(false);
    expect(s1.atoms.has(aid(12))).toBe(true);
    expect(findAll(s1.pendingEvents, 'atomDecayed')).toHaveLength(1);
    expect(findAll(s1.pendingEvents, 'atomDecayed')[0]!.data.atomId).toBe(aid(10));
  });
});

describe('phase 7: auto-decay — other atom types never auto-decay', () => {
  it('U235 with no decaysAt: never decayed regardless of tick', () => {
    const initial = withInitialAtoms(
      createSimState(1, baseConfig),
      [makeIntact(10, 'U235', null)],
      1000,
    );
    const s1 = advanceTick(initial, [], baseConfig);

    expect(s1.atoms.has(aid(10))).toBe(true);
    expect(findAll(s1.pendingEvents, 'atomDecayed')).toHaveLength(0);
  });

  it('U238 with no decaysAt: never decayed', () => {
    const initial = withInitialAtoms(
      createSimState(1, baseConfig),
      [makeIntact(10, 'U238', null)],
      1000,
    );
    const s1 = advanceTick(initial, [], baseConfig);

    expect(s1.atoms.has(aid(10))).toBe(true);
    expect(findAll(s1.pendingEvents, 'atomDecayed')).toHaveLength(0);
  });

  it('B10 with no decaysAt: never decayed', () => {
    const initial = withInitialAtoms(
      createSimState(1, baseConfig),
      [makeIntact(10, 'B10', null)],
      1000,
    );
    const s1 = advanceTick(initial, [], baseConfig);

    expect(s1.atoms.has(aid(10))).toBe(true);
    expect(findAll(s1.pendingEvents, 'atomDecayed')).toHaveLength(0);
  });
});

describe('phase 7: auto-decay — determinism', () => {
  it('phase 7 makes no PRNG draws', () => {
    const initial = withInitialAtoms(
      createSimState(123, baseConfig),
      [makeIntact(10, 'Pu239', 1)],
      0,
    );
    const before = initial.prng;
    const s1 = advanceTick(initial, [], baseConfig);

    expect(s1.prng).toEqual(before);
  });

  it('same input state across runs produces identical output', () => {
    const cleanup = baseConfig.physics.spentAtomCleanupTicks;
    const init = (): SimState =>
      withInitialAtoms(
        createSimState(7, baseConfig),
        [makeIntact(10, 'Pu239', 1), makeSpent(11, 1 - cleanup)],
        0,
      );
    const a = advanceTick(init(), [], baseConfig);
    const b = advanceTick(init(), [], baseConfig);

    expect([...a.atoms.entries()]).toEqual([...b.atoms.entries()]);
    expect(a.pendingEvents).toEqual(b.pendingEvents);
  });
});

describe('phase 7: auto-decay — immutability', () => {
  it('input state is unchanged after advanceTick', () => {
    const cleanup = baseConfig.physics.spentAtomCleanupTicks;
    const initial = withInitialAtoms(
      createSimState(1, baseConfig),
      [makeIntact(10, 'Pu239', 1), makeSpent(11, 1 - cleanup)],
      0,
    );
    const initialAtoms = [...initial.atoms.entries()];
    const initialEvents = [...initial.pendingEvents];

    advanceTick(initial, [], baseConfig);

    expect([...initial.atoms.entries()]).toEqual(initialAtoms);
    expect(initial.pendingEvents).toEqual(initialEvents);
  });
});
