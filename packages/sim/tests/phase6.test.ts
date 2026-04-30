import { describe, expect, it } from 'vitest';
import defaultConfig from '../configs/default.json' with { type: 'json' };
import {
  advanceTick,
  createSimState,
  loadConfig,
  type Atom,
  type AtomId,
  type SimEvent,
  type SimState,
} from '../src/index.js';

const baseConfig = loadConfig(defaultConfig);
const aid = (n: number): AtomId => n as unknown as AtomId;

function makeSplitting(
  id: number,
  splittingStartedAt: number,
): Atom {
  return {
    id: aid(id),
    position: { x: 0, y: 0 },
    type: 'U235',
    state: 'splitting',
    excitedSince: null,
    decaysAt: null,
    collisionRadius: baseConfig.atom.collisionRadius,
    splittingStartedAt,
  };
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

describe('phase 6: advance atom states — state transitions', () => {
  it('splitting atom whose duration has elapsed transitions to spent', () => {
    // tick will be advanced from 0 to 1; with splittingDuration=4, an atom
    // started at -3 has elapsed 4 ticks by tick 1.
    const dur = baseConfig.physics.splittingDuration;
    const initial = withInitialAtoms(
      createSimState(1, baseConfig),
      [makeSplitting(10, 1 - dur)],
      0,
    );
    const s1 = advanceTick(initial, [], baseConfig);

    expect(s1.atoms.get(aid(10))?.state).toBe('spent');
  });

  it('splitting atom one tick short of duration does NOT transition', () => {
    const dur = baseConfig.physics.splittingDuration;
    const initial = withInitialAtoms(
      createSimState(1, baseConfig),
      [makeSplitting(10, 1 - (dur - 1))],
      0,
    );
    const s1 = advanceTick(initial, [], baseConfig);

    expect(s1.atoms.get(aid(10))?.state).toBe('splitting');
  });

  it('splitting atom that just started does NOT transition', () => {
    const initial = withInitialAtoms(
      createSimState(1, baseConfig),
      [makeSplitting(10, 1)],
      0,
    );
    const s1 = advanceTick(initial, [], baseConfig);

    expect(s1.atoms.get(aid(10))?.state).toBe('splitting');
  });

  it('atom in intact state is untouched', () => {
    const intact: Atom = {
      id: aid(10),
      position: { x: 0, y: 0 },
      type: 'U235',
      state: 'intact',
      excitedSince: null,
      decaysAt: null,
      collisionRadius: baseConfig.atom.collisionRadius,
    };
    const initial = withInitialAtoms(createSimState(1, baseConfig), [intact], 0);
    const s1 = advanceTick(initial, [], baseConfig);

    expect(s1.atoms.get(aid(10))?.state).toBe('intact');
    expect(findAll(s1.pendingEvents, 'atomSpent')).toHaveLength(0);
  });

  it('atom in excited state is untouched (phase 5 owns excited transitions)', () => {
    // Mark excitedSince to current tick so phase 5 also defers it.
    const excited: Atom = {
      id: aid(10),
      position: { x: 0, y: 0 },
      type: 'U235',
      state: 'excited',
      excitedSince: 1,
      decaysAt: null,
      collisionRadius: baseConfig.atom.collisionRadius,
      pendingNeutrons: 2,
    };
    const initial = withInitialAtoms(createSimState(1, baseConfig), [excited], 0);
    const s1 = advanceTick(initial, [], baseConfig);

    expect(s1.atoms.get(aid(10))?.state).toBe('excited');
    expect(findAll(s1.pendingEvents, 'atomSpent')).toHaveLength(0);
  });

  it('atom in spent state is untouched (terminal for now)', () => {
    const spent: Atom = {
      id: aid(10),
      position: { x: 0, y: 0 },
      type: 'U235',
      state: 'spent',
      excitedSince: null,
      decaysAt: null,
      collisionRadius: baseConfig.atom.collisionRadius,
    };
    const initial = withInitialAtoms(createSimState(1, baseConfig), [spent], 0);
    const s1 = advanceTick(initial, [], baseConfig);

    expect(s1.atoms.get(aid(10))?.state).toBe('spent');
    expect(findAll(s1.pendingEvents, 'atomSpent')).toHaveLength(0);
  });
});

describe('phase 6: advance atom states — field clearing', () => {
  it('after transition, splittingStartedAt is undefined', () => {
    const dur = baseConfig.physics.splittingDuration;
    const initial = withInitialAtoms(
      createSimState(1, baseConfig),
      [makeSplitting(10, 1 - dur)],
      0,
    );
    const s1 = advanceTick(initial, [], baseConfig);

    const atom = s1.atoms.get(aid(10))!;
    expect(atom.state).toBe('spent');
    expect(atom.splittingStartedAt).toBeUndefined();
  });
});

describe('phase 6: advance atom states — events', () => {
  it('emits atomSpent on transition with correct payload', () => {
    const dur = baseConfig.physics.splittingDuration;
    const splitting = makeSplitting(10, 1 - dur);
    const positioned: Atom = { ...splitting, position: { x: 4, y: -7 } };
    const initial = withInitialAtoms(createSimState(1, baseConfig), [positioned], 0);
    const s1 = advanceTick(initial, [], baseConfig);

    const events = findAll(s1.pendingEvents, 'atomSpent');
    expect(events).toHaveLength(1);
    expect(events[0]!.data.atomId).toBe(aid(10));
    expect(events[0]!.data.position).toEqual({ x: 4, y: -7 });
    expect(events[0]!.tick).toBe(s1.tick);
  });

  it('emits no event for atoms that did not transition', () => {
    const initial = withInitialAtoms(
      createSimState(1, baseConfig),
      [makeSplitting(10, 1)],
      0,
    );
    const s1 = advanceTick(initial, [], baseConfig);

    expect(findAll(s1.pendingEvents, 'atomSpent')).toHaveLength(0);
  });
});

describe('phase 6: advance atom states — determinism', () => {
  it('phase 6 makes no PRNG draws (state.prng unchanged when only phase 6 acts)', () => {
    const dur = baseConfig.physics.splittingDuration;
    const initial = withInitialAtoms(
      createSimState(123, baseConfig),
      [makeSplitting(10, 1 - dur)],
      0,
    );
    const before = initial.prng;
    const s1 = advanceTick(initial, [], baseConfig);

    // No other phases consume PRNG when state has only a splitting atom (no
    // neutrons → no collisions; no excited atoms → phase 5 no-op; no fuel
    // rods → phase 2 no-op; no inputs → phase 1 no-op).
    expect(s1.prng).toEqual(before);
  });

  it('same input state across runs produces identical output', () => {
    const dur = baseConfig.physics.splittingDuration;
    const init = (): SimState =>
      withInitialAtoms(
        createSimState(7, baseConfig),
        [makeSplitting(10, 1 - dur), makeSplitting(11, 1 - dur)],
        0,
      );
    const a = advanceTick(init(), [], baseConfig);
    const b = advanceTick(init(), [], baseConfig);

    expect([...a.atoms.entries()]).toEqual([...b.atoms.entries()]);
    expect(a.pendingEvents).toEqual(b.pendingEvents);
  });
});

describe('phase 6: advance atom states — immutability', () => {
  it('input state is unchanged after advanceTick', () => {
    const dur = baseConfig.physics.splittingDuration;
    const initial = withInitialAtoms(
      createSimState(1, baseConfig),
      [makeSplitting(10, 1 - dur)],
      0,
    );
    const initialAtoms = [...initial.atoms.entries()];
    const initialEvents = [...initial.pendingEvents];

    advanceTick(initial, [], baseConfig);

    expect([...initial.atoms.entries()]).toEqual(initialAtoms);
    expect(initial.pendingEvents).toEqual(initialEvents);
    expect(initial.atoms.get(aid(10))?.state).toBe('splitting');
    expect(initial.atoms.get(aid(10))?.splittingStartedAt).toBe(1 - dur);
  });
});

describe('phase 6: advance atom states — multi-atom processing', () => {
  it('two atoms ready to transition: both transition in same tick', () => {
    const dur = baseConfig.physics.splittingDuration;
    const initial = withInitialAtoms(
      createSimState(1, baseConfig),
      [makeSplitting(10, 1 - dur), makeSplitting(11, 1 - dur)],
      0,
    );
    const s1 = advanceTick(initial, [], baseConfig);

    expect(s1.atoms.get(aid(10))?.state).toBe('spent');
    expect(s1.atoms.get(aid(11))?.state).toBe('spent');
    expect(findAll(s1.pendingEvents, 'atomSpent')).toHaveLength(2);
  });

  it('mix of ready and not-ready atoms: only ready ones transition', () => {
    const dur = baseConfig.physics.splittingDuration;
    const initial = withInitialAtoms(
      createSimState(1, baseConfig),
      [
        makeSplitting(10, 1 - dur), // ready
        makeSplitting(11, 1 - (dur - 1)), // one short
      ],
      0,
    );
    const s1 = advanceTick(initial, [], baseConfig);

    expect(s1.atoms.get(aid(10))?.state).toBe('spent');
    expect(s1.atoms.get(aid(11))?.state).toBe('splitting');
    expect(findAll(s1.pendingEvents, 'atomSpent')).toHaveLength(1);
  });
});
