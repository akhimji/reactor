import { describe, expect, it } from 'vitest';
import defaultConfig from '../configs/default.json' with { type: 'json' };
import {
  advanceTick,
  createSimState,
  loadConfig,
  next,
  type Atom,
  type AtomId,
  type SimConfig,
  type SimEvent,
  type SimState,
} from '../src/index.js';

const baseConfig = loadConfig(defaultConfig);

const aid = (n: number): AtomId => n as unknown as AtomId;

// Build an Atom in `excited` state ready to be processed by phase 5 (i.e.
// excitedSince < the tick advanceTick will advance into).
function makeExcited(
  id: number,
  position: { x: number; y: number },
  pendingNeutrons: number | undefined,
  excitedSince: number,
  config = baseConfig,
): Atom {
  const base = {
    id: aid(id),
    position,
    type: 'U235' as const,
    state: 'excited' as const,
    excitedSince,
    decaysAt: null,
    collisionRadius: config.atom.collisionRadius,
  };
  return pendingNeutrons === undefined ? base : { ...base, pendingNeutrons };
}

function withInitialAtoms(base: SimState, atoms: readonly Atom[]): SimState {
  const m = new Map<AtomId, Atom>();
  for (const a of atoms) m.set(a.id, a);
  return { ...base, atoms: m };
}

function findAll<T extends SimEvent['type']>(
  events: readonly SimEvent[],
  type: T,
): Extract<SimEvent, { type: T }>[] {
  return events.filter((e): e is Extract<SimEvent, { type: T }> => e.type === type);
}

describe('phase 5: apply collisions — state transitions', () => {
  it('excited atom with pendingNeutrons=2 transitions to splitting', () => {
    const initial = withInitialAtoms(createSimState(1, baseConfig), [
      makeExcited(10, { x: 0, y: 0 }, 2, 0),
    ]);
    const s1 = advanceTick(initial, [], baseConfig);

    const atom = s1.atoms.get(aid(10))!;
    expect(atom.state).toBe('splitting');
    expect(atom.splittingStartedAt).toBe(s1.tick);
    expect(atom.pendingNeutrons).toBeUndefined();
  });

  it('atom in intact state is untouched by phase 5', () => {
    const intact: Atom = {
      id: aid(10),
      position: { x: 0, y: 0 },
      type: 'U235',
      state: 'intact',
      excitedSince: null,
      decaysAt: null,
      collisionRadius: baseConfig.atom.collisionRadius,
    };
    const initial = withInitialAtoms(createSimState(1, baseConfig), [intact]);
    const s1 = advanceTick(initial, [], baseConfig);

    const atom = s1.atoms.get(aid(10))!;
    expect(atom.state).toBe('intact');
    expect(atom.splittingStartedAt).toBeUndefined();
    expect(s1.neutrons.size).toBe(0);
  });

  it('atom in splitting state is untouched by phase 5', () => {
    const splitting: Atom = {
      id: aid(10),
      position: { x: 0, y: 0 },
      type: 'U235',
      state: 'splitting',
      excitedSince: null,
      decaysAt: null,
      collisionRadius: baseConfig.atom.collisionRadius,
      splittingStartedAt: 0,
    };
    const initial = withInitialAtoms(createSimState(1, baseConfig), [splitting]);
    const s1 = advanceTick(initial, [], baseConfig);

    const atom = s1.atoms.get(aid(10))!;
    expect(atom.state).toBe('splitting');
    expect(atom.splittingStartedAt).toBe(0);
    expect(s1.neutrons.size).toBe(0);
  });

  it('atom in spent state is untouched by phase 5', () => {
    const spent: Atom = {
      id: aid(10),
      position: { x: 0, y: 0 },
      type: 'U235',
      state: 'spent',
      excitedSince: null,
      decaysAt: null,
      collisionRadius: baseConfig.atom.collisionRadius,
    };
    const initial = withInitialAtoms(createSimState(1, baseConfig), [spent]);
    const s1 = advanceTick(initial, [], baseConfig);

    expect(s1.atoms.get(aid(10))?.state).toBe('spent');
    expect(s1.neutrons.size).toBe(0);
  });

  it('excited atom whose excitedSince equals current tick is deferred (ADR-016 family)', () => {
    // tick 0 → advanceTick increments to tick 1; setting excitedSince=1 means
    // "set this tick" relative to phase 5's iteration → phase 5 skips it.
    const initial = withInitialAtoms(createSimState(1, baseConfig), [
      makeExcited(10, { x: 0, y: 0 }, 2, 1),
    ]);
    const s1 = advanceTick(initial, [], baseConfig);

    const atom = s1.atoms.get(aid(10))!;
    expect(atom.state).toBe('excited');
    expect(atom.pendingNeutrons).toBe(2);
    expect(s1.neutrons.size).toBe(0);
  });

  it('excited atom with pendingNeutrons undefined transitions cleanly with 0 neutrons spawned', () => {
    const initial = withInitialAtoms(createSimState(1, baseConfig), [
      makeExcited(10, { x: 0, y: 0 }, undefined, 0),
    ]);
    const s1 = advanceTick(initial, [], baseConfig);

    const atom = s1.atoms.get(aid(10))!;
    expect(atom.state).toBe('splitting');
    expect(atom.splittingStartedAt).toBe(s1.tick);
    expect(s1.neutrons.size).toBe(0);
    expect(findAll(s1.pendingEvents, 'neutronSpawned')).toHaveLength(0);
  });
});

describe('phase 5: apply collisions — neutron spawning', () => {
  it('spawns N neutrons for N pendingNeutrons', () => {
    const initial = withInitialAtoms(createSimState(1, baseConfig), [
      makeExcited(10, { x: 0, y: 0 }, 3, 0),
    ]);
    const s1 = advanceTick(initial, [], baseConfig);
    expect(s1.neutrons.size).toBe(3);
  });

  it('spawned neutrons sit at parent.position + direction * (collisionRadius + 0.01)', () => {
    const initial = withInitialAtoms(createSimState(1, baseConfig), [
      makeExcited(10, { x: 5, y: 7 }, 2, 0),
    ]);
    const s1 = advanceTick(initial, [], baseConfig);
    const speed = baseConfig.neutron.defaultSpeed;
    const radius = baseConfig.atom.collisionRadius;

    for (const n of s1.neutrons.values()) {
      const dx = n.velocity.vx / speed;
      const dy = n.velocity.vy / speed;
      const expectedX = 5 + dx * (radius + 0.01);
      const expectedY = 7 + dy * (radius + 0.01);
      expect(n.position.x).toBeCloseTo(expectedX, 10);
      expect(n.position.y).toBeCloseTo(expectedY, 10);
    }
  });

  it('spawned neutrons have velocity magnitude equal to defaultSpeed', () => {
    const initial = withInitialAtoms(createSimState(1, baseConfig), [
      makeExcited(10, { x: 0, y: 0 }, 4, 0),
    ]);
    const s1 = advanceTick(initial, [], baseConfig);
    for (const n of s1.neutrons.values()) {
      const mag = Math.hypot(n.velocity.vx, n.velocity.vy);
      expect(mag).toBeCloseTo(baseConfig.neutron.defaultSpeed, 10);
    }
  });

  it('spawned neutrons have spawnedAt === current tick', () => {
    const initial = withInitialAtoms(createSimState(1, baseConfig), [
      makeExcited(10, { x: 0, y: 0 }, 2, 0),
    ]);
    const s1 = advanceTick(initial, [], baseConfig);
    for (const n of s1.neutrons.values()) {
      expect(n.spawnedAt).toBe(s1.tick);
    }
  });

  it('spawned neutrons have expiresAt === currentTick + lifetimeTicks', () => {
    const initial = withInitialAtoms(createSimState(1, baseConfig), [
      makeExcited(10, { x: 0, y: 0 }, 2, 0),
    ]);
    const s1 = advanceTick(initial, [], baseConfig);
    const expected = s1.tick + baseConfig.neutron.lifetimeTicks;
    for (const n of s1.neutrons.values()) {
      expect(n.expiresAt).toBe(expected);
    }
  });
});

describe('phase 5: apply collisions — angle distribution', () => {
  function spawnAndGetAngles(
    seed: number,
    n: number,
    config: SimConfig = baseConfig,
  ): number[] {
    const initial = withInitialAtoms(createSimState(seed, config), [
      makeExcited(10, { x: 0, y: 0 }, n, 0, config),
    ]);
    const s1 = advanceTick(initial, [], config);
    const angles: number[] = [];
    for (const ne of s1.neutrons.values()) {
      angles.push(Math.atan2(ne.velocity.vy, ne.velocity.vx));
    }
    return angles;
  }

  it('N=4 angles span the circle (no two within jitter of each other)', () => {
    const angles = spawnAndGetAngles(1, 4).sort((a, b) => a - b);
    const jitter = baseConfig.physics.neutronReleaseJitter;
    // Each pair of consecutive angles should be roughly π/2 apart, allowing
    // up to ±jitter spread on each side.
    for (let i = 1; i < angles.length; i++) {
      const delta = angles[i]! - angles[i - 1]!;
      expect(delta).toBeGreaterThan(Math.PI / 2 - jitter);
      expect(delta).toBeLessThan(Math.PI / 2 + jitter);
    }
  });

  it('different seeds produce different baseOffsets (rotation is randomized)', () => {
    const a1 = spawnAndGetAngles(1, 3);
    const a2 = spawnAndGetAngles(2, 3);
    expect(a1).not.toEqual(a2);
  });

  it('N=2 angles are roughly opposite (Δ ≈ π within jitter)', () => {
    const angles = spawnAndGetAngles(7, 2);
    const jitter = baseConfig.physics.neutronReleaseJitter;
    let delta = Math.abs(angles[0]! - angles[1]!);
    if (delta > Math.PI) delta = 2 * Math.PI - delta;
    expect(delta).toBeGreaterThan(Math.PI - jitter);
    expect(delta).toBeLessThan(Math.PI + jitter);
  });

  it('two splits in the same tick consume PRNG state independently', () => {
    const initial = withInitialAtoms(createSimState(1, baseConfig), [
      makeExcited(10, { x: 0, y: 0 }, 1, 0),
      makeExcited(11, { x: 10, y: 10 }, 1, 0),
    ]);
    const s1 = advanceTick(initial, [], baseConfig);
    const neutrons = [...s1.neutrons.values()];
    const a0 = Math.atan2(neutrons[0]!.velocity.vy, neutrons[0]!.velocity.vx);
    const a1 = Math.atan2(neutrons[1]!.velocity.vy, neutrons[1]!.velocity.vx);
    expect(a0).not.toBeCloseTo(a1, 10);
  });
});

describe('phase 5: apply collisions — events', () => {
  it('emits one neutronSpawned event per spawned neutron', () => {
    const initial = withInitialAtoms(createSimState(1, baseConfig), [
      makeExcited(10, { x: 0, y: 0 }, 3, 0),
    ]);
    const s1 = advanceTick(initial, [], baseConfig);
    expect(findAll(s1.pendingEvents, 'neutronSpawned')).toHaveLength(3);
  });

  it('neutronSpawned payload matches the spawned neutron', () => {
    const initial = withInitialAtoms(createSimState(1, baseConfig), [
      makeExcited(10, { x: 5, y: 0 }, 2, 0),
    ]);
    const s1 = advanceTick(initial, [], baseConfig);
    for (const ev of findAll(s1.pendingEvents, 'neutronSpawned')) {
      const n = s1.neutrons.get(ev.data.neutronId);
      expect(n).toBeDefined();
      expect(ev.data.position).toEqual(n!.position);
      expect(ev.data.velocity).toEqual(n!.velocity);
    }
  });

  it('does not re-emit atomSplit (that was phase 4 work)', () => {
    const initial = withInitialAtoms(createSimState(1, baseConfig), [
      makeExcited(10, { x: 0, y: 0 }, 2, 0),
    ]);
    const s1 = advanceTick(initial, [], baseConfig);
    expect(findAll(s1.pendingEvents, 'atomSplit')).toHaveLength(0);
  });
});

describe('phase 5: apply collisions — determinism', () => {
  it('same seed + same input state produces identical neutron positions and velocities', () => {
    const init = (): SimState =>
      withInitialAtoms(createSimState(42, baseConfig), [
        makeExcited(10, { x: 0, y: 0 }, 3, 0),
      ]);
    const a = advanceTick(init(), [], baseConfig);
    const b = advanceTick(init(), [], baseConfig);

    const aNeutrons = [...a.neutrons.values()];
    const bNeutrons = [...b.neutrons.values()];
    expect(aNeutrons.length).toBe(bNeutrons.length);
    for (let i = 0; i < aNeutrons.length; i++) {
      expect(aNeutrons[i]!.position).toEqual(bNeutrons[i]!.position);
      expect(aNeutrons[i]!.velocity).toEqual(bNeutrons[i]!.velocity);
    }
  });

  it('PRNG advances by exactly N+1 draws per split (ADR-025 contract)', () => {
    const initial = withInitialAtoms(createSimState(13, baseConfig), [
      makeExcited(10, { x: 0, y: 0 }, 4, 0),
    ]);
    const s1 = advanceTick(initial, [], baseConfig);

    let p = initial.prng;
    for (let i = 0; i < 5; i++) {
      const [, np] = next(p);
      p = np;
    }
    expect(s1.prng).toEqual(p);
  });
});

describe('phase 5: apply collisions — immutability', () => {
  it('input state is unchanged after advanceTick', () => {
    const initial = withInitialAtoms(createSimState(1, baseConfig), [
      makeExcited(10, { x: 0, y: 0 }, 2, 0),
    ]);
    const initialAtoms = [...initial.atoms.entries()];
    const initialNeutrons = [...initial.neutrons.entries()];
    const initialEvents = [...initial.pendingEvents];
    const initialPrng = initial.prng;

    advanceTick(initial, [], baseConfig);

    expect([...initial.atoms.entries()]).toEqual(initialAtoms);
    expect([...initial.neutrons.entries()]).toEqual(initialNeutrons);
    expect(initial.pendingEvents).toEqual(initialEvents);
    expect(initial.prng).toEqual(initialPrng);
    expect(initial.atoms.get(aid(10))?.state).toBe('excited');
    expect(initial.atoms.get(aid(10))?.pendingNeutrons).toBe(2);
  });
});

describe('phase 5: apply collisions — multi-atom processing', () => {
  it('two excited atoms both transition and both spawn neutrons', () => {
    const initial = withInitialAtoms(createSimState(1, baseConfig), [
      makeExcited(10, { x: 0, y: 0 }, 2, 0),
      makeExcited(11, { x: 10, y: 0 }, 3, 0),
    ]);
    const s1 = advanceTick(initial, [], baseConfig);

    expect(s1.atoms.get(aid(10))?.state).toBe('splitting');
    expect(s1.atoms.get(aid(11))?.state).toBe('splitting');
    expect(s1.neutrons.size).toBe(5);
  });

  it('mix of excited and intact atoms: only excited ones processed', () => {
    const intact: Atom = {
      id: aid(11),
      position: { x: 10, y: 0 },
      type: 'U235',
      state: 'intact',
      excitedSince: null,
      decaysAt: null,
      collisionRadius: baseConfig.atom.collisionRadius,
    };
    const initial = withInitialAtoms(createSimState(1, baseConfig), [
      makeExcited(10, { x: 0, y: 0 }, 2, 0),
      intact,
    ]);
    const s1 = advanceTick(initial, [], baseConfig);

    expect(s1.atoms.get(aid(10))?.state).toBe('splitting');
    expect(s1.atoms.get(aid(11))?.state).toBe('intact');
    expect(s1.neutrons.size).toBe(2);
  });
});
