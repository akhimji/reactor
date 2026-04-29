import { describe, expect, it } from 'vitest';
import defaultConfig from '../configs/default.json' with { type: 'json' };
import {
  advanceTick,
  createSimState,
  loadConfig,
  type Neutron,
  type NeutronId,
  type SimEvent,
  type SimState,
} from '../src/index.js';

const config = loadConfig(defaultConfig);

const nid = (n: number): NeutronId => n as unknown as NeutronId;

function makeNeutron(id: number, overrides: Partial<Neutron> = {}): Neutron {
  return {
    id: nid(id),
    position: { x: 0, y: 0 },
    velocity: { vx: 1, vy: 0 },
    spawnedAt: 0,
    expiresAt: 10_000,
    ...overrides,
  };
}

function withNeutrons(state: SimState, neutrons: readonly Neutron[]): SimState {
  const map = new Map<NeutronId, Neutron>();
  for (const n of neutrons) map.set(n.id, n);
  return { ...state, neutrons: map };
}

function findExpired(events: readonly SimEvent[], id: NeutronId) {
  return events.find(
    (e): e is Extract<SimEvent, { type: 'neutronExpired' }> =>
      e.type === 'neutronExpired' && e.data.id === id,
  );
}

describe('phase 3: advance neutrons', () => {
  it('moves a neutron by exactly its velocity each tick', () => {
    const initial = withNeutrons(createSimState(1, config), [
      makeNeutron(1, { position: { x: 0, y: 0 }, velocity: { vx: 2, vy: -1 } }),
    ]);

    const s1 = advanceTick(initial, [], config);
    expect(s1.neutrons.get(nid(1))?.position).toEqual({ x: 2, y: -1 });

    const s2 = advanceTick(s1, [], config);
    expect(s2.neutrons.get(nid(1))?.position).toEqual({ x: 4, y: -2 });

    const s3 = advanceTick(s2, [], config);
    expect(s3.neutrons.get(nid(1))?.position).toEqual({ x: 6, y: -3 });
  });

  it('preserves velocity across ticks (magnitude is fixed at spawn)', () => {
    const v = { vx: 1.7, vy: -0.4 };
    const initial = withNeutrons(createSimState(1, config), [
      makeNeutron(1, { position: { x: 0, y: 0 }, velocity: v }),
    ]);

    let s = initial;
    for (let i = 0; i < 5; i++) s = advanceTick(s, [], config);
    expect(s.neutrons.get(nid(1))?.velocity).toEqual(v);
  });

  it('removes a neutron crossing the playfield bounds and emits neutronExpired with reason out-of-bounds', () => {
    const initial = withNeutrons(createSimState(1, config), [
      makeNeutron(1, { position: { x: 49, y: 0 }, velocity: { vx: 5, vy: 0 } }),
    ]);

    const s1 = advanceTick(initial, [], config);
    expect(s1.neutrons.has(nid(1))).toBe(false);

    const expired = findExpired(s1.pendingEvents, nid(1));
    expect(expired).toBeDefined();
    expect(expired?.data.reason).toBe('out-of-bounds');
    expect(expired?.tick).toBe(1);
  });

  it('treats the boundary itself as inside (inclusive bounds)', () => {
    const initial = withNeutrons(createSimState(1, config), [
      makeNeutron(1, { position: { x: 49, y: 0 }, velocity: { vx: 1, vy: 0 } }),
    ]);

    const s1 = advanceTick(initial, [], config);
    expect(s1.neutrons.get(nid(1))?.position).toEqual({ x: 50, y: 0 });

    const s2 = advanceTick(s1, [], config);
    expect(s2.neutrons.has(nid(1))).toBe(false);
  });

  it('removes a neutron whose expiresAt is reached and emits neutronExpired with reason expired', () => {
    const initial = withNeutrons(createSimState(1, config), [
      makeNeutron(1, {
        position: { x: 0, y: 0 },
        velocity: { vx: 1, vy: 0 },
        spawnedAt: 0,
        expiresAt: 1,
      }),
    ]);

    const s1 = advanceTick(initial, [], config);
    expect(s1.neutrons.has(nid(1))).toBe(false);

    const expired = findExpired(s1.pendingEvents, nid(1));
    expect(expired).toBeDefined();
    expect(expired?.data.reason).toBe('expired');
  });

  it('expiration takes priority over out-of-bounds when both fire on the same tick', () => {
    const initial = withNeutrons(createSimState(1, config), [
      makeNeutron(1, {
        position: { x: 49, y: 0 },
        velocity: { vx: 100, vy: 0 },
        expiresAt: 1,
      }),
    ]);

    const s1 = advanceTick(initial, [], config);
    expect(s1.neutrons.has(nid(1))).toBe(false);

    const expired = findExpired(s1.pendingEvents, nid(1));
    expect(expired?.data.reason).toBe('expired');
  });

  it('determinism: identical initial state and inputs produce identical positions over 30 ticks', () => {
    const seed = 42;
    const seedNeutrons = (): readonly Neutron[] => [
      makeNeutron(1, { position: { x: 0, y: 0 }, velocity: { vx: 1, vy: 0.5 } }),
      makeNeutron(2, { position: { x: 10, y: -5 }, velocity: { vx: -0.3, vy: 2 } }),
      makeNeutron(3, { position: { x: -20, y: 20 }, velocity: { vx: 0.7, vy: -0.7 } }),
    ];

    let a = withNeutrons(createSimState(seed, config), seedNeutrons());
    let b = withNeutrons(createSimState(seed, config), seedNeutrons());
    for (let i = 0; i < 30; i++) {
      a = advanceTick(a, [], config);
      b = advanceTick(b, [], config);
    }

    expect(a.tick).toBe(b.tick);
    expect(a.neutrons.size).toBe(b.neutrons.size);
    for (const [id, na] of a.neutrons) {
      const nb = b.neutrons.get(id);
      expect(nb?.position).toEqual(na.position);
      expect(nb?.velocity).toEqual(na.velocity);
    }
  });

  it('does not mutate the input state', () => {
    const startPosition = { x: 3, y: 4 };
    const startVelocity = { vx: 1, vy: 1 };
    const initial = withNeutrons(createSimState(1, config), [
      makeNeutron(1, { position: startPosition, velocity: startVelocity }),
    ]);

    const beforeTick = initial.tick;
    const beforeSize = initial.neutrons.size;
    const beforeEvents = initial.pendingEvents;
    const beforePos = { ...initial.neutrons.get(nid(1))!.position };

    advanceTick(initial, [], config);

    expect(initial.tick).toBe(beforeTick);
    expect(initial.neutrons.size).toBe(beforeSize);
    expect(initial.pendingEvents).toBe(beforeEvents);
    expect(initial.neutrons.get(nid(1))?.position).toEqual(beforePos);
  });

  it('is a no-op when there are no neutrons', () => {
    const initial = createSimState(1, config);
    const s1 = advanceTick(initial, [], config);
    expect(s1.neutrons.size).toBe(0);
    expect(s1.pendingEvents).toEqual([]);
  });

  it('appends to pendingEvents without dropping prior entries', () => {
    const priorEvent: SimEvent = {
      type: 'tick',
      tick: 0,
      data: { criticality: 0, zone: 'extinct' },
    };
    const base = withNeutrons(createSimState(1, config), [
      makeNeutron(1, { position: { x: 49, y: 0 }, velocity: { vx: 5, vy: 0 } }),
    ]);
    const initial: SimState = { ...base, pendingEvents: [priorEvent] };

    const s1 = advanceTick(initial, [], config);
    expect(s1.pendingEvents[0]).toBe(priorEvent);
    expect(s1.pendingEvents.some((e) => e.type === 'neutronExpired')).toBe(true);
  });
});
