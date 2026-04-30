import { describe, expect, it } from 'vitest';
import defaultConfig from '../configs/default.json' with { type: 'json' };
import {
  advanceTick,
  createSimState,
  loadConfig,
  type Atom,
  type AtomId,
  type SimConfig,
  type SimEvent,
  type SimState,
} from '../src/index.js';

const aid = (n: number): AtomId => n as unknown as AtomId;

// Force U235 split=1, absorb=0 so the integration test is deterministic at
// the outcome level. The PRNG still drives neutron count, angles, etc.
function withForcedU235Split(): SimConfig {
  const cfg = loadConfig(defaultConfig);
  return {
    ...cfg,
    atoms: {
      ...cfg.atoms,
      U235: { ...cfg.atoms.U235, splitChance: 1, absorbChance: 0 },
    },
  };
}

function withInitialAtom(base: SimState, atom: Atom): SimState {
  const m = new Map<AtomId, Atom>();
  m.set(atom.id, atom);
  return { ...base, atoms: m };
}

function findAll<T extends SimEvent['type']>(
  events: readonly SimEvent[],
  type: T,
): Extract<SimEvent, { type: T }>[] {
  return events.filter((e): e is Extract<SimEvent, { type: T }> => e.type === type);
}

describe('integration: full U235 split lifecycle', () => {
  it('atom progresses intact → excited → splitting → spent across phases 1-6', () => {
    const cfg = withForcedU235Split();
    const u235: Atom = {
      id: aid(1),
      position: { x: 0, y: 0 },
      type: 'U235',
      state: 'intact',
      excitedSince: null,
      decaysAt: null,
      collisionRadius: cfg.atom.collisionRadius,
    };
    let state = withInitialAtom(createSimState(42, cfg), u235);

    // T+1: inject neutron at (-2, 0) heading +x. Phase 3 defers it (same-tick
    // spawn). No collision yet.
    state = advanceTick(
      state,
      [
        {
          type: 'injectNeutron',
          position: { x: -2, y: 0 },
          direction: { x: 1, y: 0 },
        },
      ],
      cfg,
    );
    expect(state.tick).toBe(1);
    expect(state.atoms.get(aid(1))?.state).toBe('intact');
    expect(state.neutrons.size).toBe(1);

    // T+2: phase 3 advances neutron from (-2, 0) by velocity (4, 0) to (2, 0).
    // Phase 4 detects swept-segment collision with atom at origin → split.
    state = advanceTick(state, [], cfg);
    expect(state.tick).toBe(2);
    const excited = state.atoms.get(aid(1))!;
    expect(excited.state).toBe('excited');
    expect(excited.excitedSince).toBe(2);
    expect(excited.pendingNeutrons).toBeGreaterThanOrEqual(
      cfg.atoms.U235.neutronsPerSplit.min,
    );
    expect(excited.pendingNeutrons).toBeLessThanOrEqual(
      cfg.atoms.U235.neutronsPerSplit.max,
    );
    expect(state.neutrons.size).toBe(0); // injected neutron absorbed

    // T+3: phase 5 transitions excited → splitting and spawns neutrons.
    state = advanceTick(state, [], cfg);
    expect(state.tick).toBe(3);
    const splitting = state.atoms.get(aid(1))!;
    expect(splitting.state).toBe('splitting');
    expect(splitting.splittingStartedAt).toBe(3);
    expect(splitting.pendingNeutrons).toBeUndefined();
    const spawnedCount = state.neutrons.size;
    expect(spawnedCount).toBeGreaterThanOrEqual(
      cfg.atoms.U235.neutronsPerSplit.min,
    );
    expect(spawnedCount).toBeLessThanOrEqual(
      cfg.atoms.U235.neutronsPerSplit.max,
    );

    // T+4..T+(3+splittingDuration): atom remains splitting.
    const dur = cfg.physics.splittingDuration;
    for (let i = 0; i < dur - 1; i++) {
      state = advanceTick(state, [], cfg);
      expect(state.atoms.get(aid(1))?.state).toBe('splitting');
    }

    // T+(3+splittingDuration): phase 6 transitions splitting → spent.
    state = advanceTick(state, [], cfg);
    expect(state.tick).toBe(3 + dur);
    const spent = state.atoms.get(aid(1))!;
    expect(spent.state).toBe('spent');
    expect(spent.splittingStartedAt).toBeUndefined();
  });

  it('emits the expected event sequence in correct order', () => {
    const cfg = withForcedU235Split();
    const u235: Atom = {
      id: aid(1),
      position: { x: 0, y: 0 },
      type: 'U235',
      state: 'intact',
      excitedSince: null,
      decaysAt: null,
      collisionRadius: cfg.atom.collisionRadius,
    };
    let state = withInitialAtom(createSimState(42, cfg), u235);

    state = advanceTick(
      state,
      [
        {
          type: 'injectNeutron',
          position: { x: -2, y: 0 },
          direction: { x: 1, y: 0 },
        },
      ],
      cfg,
    );
    state = advanceTick(state, [], cfg);
    state = advanceTick(state, [], cfg);
    const dur = cfg.physics.splittingDuration;
    for (let i = 0; i < dur; i++) state = advanceTick(state, [], cfg);

    const events = state.pendingEvents;

    expect(findAll(events, 'atomSplit')).toHaveLength(1);
    expect(findAll(events, 'atomSpent')).toHaveLength(1);

    const split = findAll(events, 'atomSplit')[0]!;
    const splitNeutronCount = split.data.neutronsReleased;

    // 1 injection + N spawned by split.
    expect(findAll(events, 'neutronSpawned').length).toBe(1 + splitNeutronCount);

    // The injected neutron is absorbed.
    expect(findAll(events, 'neutronAbsorbed')).toHaveLength(1);

    // Tick ordering: injected neutronSpawned (T=1) < atomSplit (T=2) <
    // post-split neutronSpawned events (T=3) < atomSpent (T=3+dur).
    const injectionSpawn = findAll(events, 'neutronSpawned')[0]!;
    const postSplitSpawns = findAll(events, 'neutronSpawned').slice(1);
    const atomSplit = findAll(events, 'atomSplit')[0]!;
    const atomSpent = findAll(events, 'atomSpent')[0]!;

    expect(injectionSpawn.tick).toBe(1);
    expect(atomSplit.tick).toBe(2);
    for (const ev of postSplitSpawns) expect(ev.tick).toBe(3);
    expect(atomSpent.tick).toBe(3 + dur);
  });

  it('determinism: re-run with same seed produces identical event sequence', () => {
    const cfg = withForcedU235Split();
    const u235: Atom = {
      id: aid(1),
      position: { x: 0, y: 0 },
      type: 'U235',
      state: 'intact',
      excitedSince: null,
      decaysAt: null,
      collisionRadius: cfg.atom.collisionRadius,
    };
    function run(): readonly SimEvent[] {
      let state = withInitialAtom(createSimState(42, cfg), u235);
      state = advanceTick(
        state,
        [
          {
            type: 'injectNeutron',
            position: { x: -2, y: 0 },
            direction: { x: 1, y: 0 },
          },
        ],
        cfg,
      );
      const dur = cfg.physics.splittingDuration;
      for (let i = 0; i < dur + 1; i++) state = advanceTick(state, [], cfg);
      return state.pendingEvents;
    }

    expect(run()).toEqual(run());
  });
});
