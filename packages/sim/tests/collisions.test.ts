import { describe, expect, it } from 'vitest';
import defaultConfig from '../configs/default.json' with { type: 'json' };
import { findNeutronAtomCollisions } from '../src/collisions.js';
import { loadConfig } from '../src/index.js';
import type { Atom, AtomId, Neutron, NeutronId } from '../src/types.js';

const config = loadConfig(defaultConfig);

const aid = (n: number): AtomId => n as unknown as AtomId;
const nid = (n: number): NeutronId => n as unknown as NeutronId;

function makeAtom(id: number, x: number, y: number, radius?: number): Atom {
  return {
    id: aid(id),
    position: { x, y },
    type: 'U235',
    state: 'intact',
    excitedSince: null,
    decaysAt: null,
    collisionRadius: radius ?? config.atom.collisionRadius,
  };
}

function makeNeutron(
  id: number,
  position: { x: number; y: number },
  velocity: { vx: number; vy: number },
  spawnedAt = -100,
): Neutron {
  return {
    id: nid(id),
    position,
    velocity,
    spawnedAt,
    expiresAt: 10_000,
  };
}

function neutronMap(ns: readonly Neutron[]): ReadonlyMap<NeutronId, Neutron> {
  const m = new Map<NeutronId, Neutron>();
  for (const n of ns) m.set(n.id, n);
  return m;
}

function atomMap(as: readonly Atom[]): ReadonlyMap<AtomId, Atom> {
  const m = new Map<AtomId, Atom>();
  for (const a of as) m.set(a.id, a);
  return m;
}

describe('findNeutronAtomCollisions', () => {
  it('detects a swept collision when the neutron path passes through an atom', () => {
    // Neutron at (2,0), velocity (1,0). Previous position (1,0). Atom at (1.5, 0).
    const n = makeNeutron(1, { x: 2, y: 0 }, { vx: 1, vy: 0 });
    const a = makeAtom(10, 1.5, 0);

    const pairs = findNeutronAtomCollisions(neutronMap([n]), atomMap([a]), 0, config);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]?.neutronId).toBe(nid(1));
    expect(pairs[0]?.atomId).toBe(aid(10));
  });

  it('does not collide when the neutron path misses the atom', () => {
    // Neutron sweeping along y=5; atom at origin with radius 1.
    const n = makeNeutron(1, { x: 1, y: 5 }, { vx: 1, vy: 0 });
    const a = makeAtom(10, 0, 0);

    const pairs = findNeutronAtomCollisions(neutronMap([n]), atomMap([a]), 0, config);
    expect(pairs).toHaveLength(0);
  });

  it('detects a collision when a stationary neutron sits inside the atom radius (degenerate segment)', () => {
    // Velocity zero: prev == curr. Neutron at (0.3, 0), atom at origin radius 1.
    const n = makeNeutron(1, { x: 0.3, y: 0 }, { vx: 0, vy: 0 });
    const a = makeAtom(10, 0, 0);

    const pairs = findNeutronAtomCollisions(neutronMap([n]), atomMap([a]), 0, config);
    expect(pairs).toHaveLength(1);
  });

  it('does not collide when a stationary neutron sits outside the atom radius', () => {
    const n = makeNeutron(1, { x: 5, y: 5 }, { vx: 0, vy: 0 });
    const a = makeAtom(10, 0, 0);

    const pairs = findNeutronAtomCollisions(neutronMap([n]), atomMap([a]), 0, config);
    expect(pairs).toHaveLength(0);
  });

  it('returns all valid pairs for multiple neutrons against multiple atoms', () => {
    // n1 hits a1; n2 hits a2; both atoms exist so there are exactly 2 pairs.
    const n1 = makeNeutron(1, { x: 1.5, y: 0 }, { vx: 1, vy: 0 });
    const n2 = makeNeutron(2, { x: 0, y: 1.5 }, { vx: 0, vy: 1 });
    const a1 = makeAtom(10, 1, 0);
    const a2 = makeAtom(11, 0, 1);

    const pairs = findNeutronAtomCollisions(
      neutronMap([n1, n2]),
      atomMap([a1, a2]),
      0,
      config,
    );
    expect(pairs).toHaveLength(2);

    const byNeutron = new Map(pairs.map((p) => [p.neutronId, p.atomId] as const));
    expect(byNeutron.get(nid(1))).toBe(aid(10));
    expect(byNeutron.get(nid(2))).toBe(aid(11));
  });

  it('excludes neutrons whose spawnedAt equals the current tick (ADR-016)', () => {
    // Newly-spawned neutron at the atom's location — would collide if eligible.
    const n = makeNeutron(1, { x: 0, y: 0 }, { vx: 1, vy: 0 }, 5);
    const a = makeAtom(10, 0, 0);

    const pairs = findNeutronAtomCollisions(neutronMap([n]), atomMap([a]), 5, config);
    expect(pairs).toHaveLength(0);

    // Same configuration on the next tick — neutron is now eligible.
    const pairsNext = findNeutronAtomCollisions(
      neutronMap([n]),
      atomMap([a]),
      6,
      config,
    );
    expect(pairsNext).toHaveLength(1);
  });

  it('includes atoms regardless of state — collisions.ts is pure geometry (ADR-019)', () => {
    // Even an atom that just spawned this tick is a valid candidate. The
    // collisions layer doesn't filter atoms by state or spawn time.
    const n = makeNeutron(1, { x: 1.5, y: 0 }, { vx: 1, vy: 0 });
    const a = makeAtom(10, 1, 0);

    const pairs = findNeutronAtomCollisions(neutronMap([n]), atomMap([a]), 0, config);
    expect(pairs).toHaveLength(1);
  });

  it('does not let a fast neutron tunnel through an atom whose diameter is smaller than one step', () => {
    // Speed 4 (default), atom radius 1.0. Segment from (-2, 0) to (2, 0) — well
    // past the atom in one tick. Closest point to origin is (0, 0); collision
    // detected.
    const n = makeNeutron(1, { x: 2, y: 0 }, { vx: 4, vy: 0 });
    const a = makeAtom(10, 0, 0, 1.0);

    const pairs = findNeutronAtomCollisions(neutronMap([n]), atomMap([a]), 0, config);
    expect(pairs).toHaveLength(1);
  });

  it('produces deterministic pair ordering for identical inputs', () => {
    const n1 = makeNeutron(1, { x: 1.5, y: 0 }, { vx: 1, vy: 0 });
    const n2 = makeNeutron(2, { x: 0, y: 1.5 }, { vx: 0, vy: 1 });
    const a1 = makeAtom(10, 1, 0);
    const a2 = makeAtom(11, 0, 1);

    const a = findNeutronAtomCollisions(
      neutronMap([n1, n2]),
      atomMap([a1, a2]),
      0,
      config,
    );
    const b = findNeutronAtomCollisions(
      neutronMap([n1, n2]),
      atomMap([a1, a2]),
      0,
      config,
    );

    expect(a).toEqual(b);
  });

  it('returns an empty list when there are no neutrons or no atoms', () => {
    const n = makeNeutron(1, { x: 0, y: 0 }, { vx: 1, vy: 0 });
    const a = makeAtom(10, 0, 0);

    expect(
      findNeutronAtomCollisions(neutronMap([]), atomMap([a]), 0, config),
    ).toHaveLength(0);
    expect(
      findNeutronAtomCollisions(neutronMap([n]), atomMap([]), 0, config),
    ).toHaveLength(0);
  });

  it('records the closest point on the segment as the intersection point', () => {
    // Neutron sweeping along y=0 with velocity (4,0); prev=(-2,0), curr=(2,0).
    // Atom at (0, 0.3). Closest point on segment is (0, 0) — perpendicular foot.
    const n = makeNeutron(1, { x: 2, y: 0 }, { vx: 4, vy: 0 });
    const a = makeAtom(10, 0, 0.3);

    const pairs = findNeutronAtomCollisions(neutronMap([n]), atomMap([a]), 0, config);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]?.intersectionPoint.x).toBeCloseTo(0, 10);
    expect(pairs[0]?.intersectionPoint.y).toBeCloseTo(0, 10);
  });
});
