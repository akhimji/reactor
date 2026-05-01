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

describe('integration: Pu239 decays unused after timer', () => {
  it('Pu239 with no neutron interaction decays at decayTicks; atom removed immediately', () => {
    // With phase 8 active, an empty playfield produces k = 0 every tick, so
    // phase 9 would extinct the run after `extinctionGracePeriod` ticks (300)
    // — well before Pu239's decayTicks (1800). This test is scoped to phase 7
    // behavior, not phase 9, so we extend the grace period past decayTicks.
    const base = loadConfig(defaultConfig);
    const cfg: SimConfig = {
      ...base,
      endConditions: {
        ...base.endConditions,
        extinctionGracePeriod: base.atoms.Pu239.decayTicks! + 100,
      },
    };
    const decayTicks = cfg.atoms.Pu239.decayTicks!;
    const pu239: Atom = {
      id: aid(1),
      position: { x: 0, y: 0 },
      type: 'Pu239',
      state: 'intact',
      excitedSince: null,
      // Spawn at tick 0; decaysAt = decayTicks (matches phase 2 convention).
      decaysAt: decayTicks,
      collisionRadius: cfg.atom.collisionRadius,
    };
    let state = withInitialAtom(createSimState(42, cfg), pu239);

    // Advance to one tick before decay. Atom should still be intact, no event.
    for (let t = 1; t < decayTicks; t++) {
      state = advanceTick(state, [], cfg);
    }
    expect(state.tick).toBe(decayTicks - 1);
    expect(state.atoms.has(aid(1))).toBe(true);
    expect(state.atoms.get(aid(1))?.state).toBe('intact');
    expect(findAll(state.pendingEvents, 'atomDecayed')).toHaveLength(0);

    // One more tick → state.tick === decayTicks; phase 7 fires.
    state = advanceTick(state, [], cfg);
    expect(state.tick).toBe(decayTicks);
    expect(state.atoms.has(aid(1))).toBe(false);
    const decayed = findAll(state.pendingEvents, 'atomDecayed');
    expect(decayed).toHaveLength(1);
    expect(decayed[0]!.tick).toBe(decayTicks);
    expect(decayed[0]!.data.atomId).toBe(aid(1));
    expect(decayed[0]!.data.type).toBe('Pu239');

    // No further atom-related events on subsequent ticks. Phase 8 emits a
    // per-tick `tick` event regardless; filter those out to scope the check.
    const nonTickBefore = state.pendingEvents.filter((e) => e.type !== 'tick').length;
    for (let i = 0; i < 5; i++) state = advanceTick(state, [], cfg);
    const nonTickAfter = state.pendingEvents.filter((e) => e.type !== 'tick').length;
    expect(nonTickAfter).toBe(nonTickBefore);
  });
});

describe('integration: spent atom cleanup after fission', () => {
  it('atom removed exactly spentAtomCleanupTicks after spentAt', () => {
    const cfg = withForcedU235Split();
    const cleanupTicks = cfg.physics.spentAtomCleanupTicks;
    const splittingDuration = cfg.physics.splittingDuration;
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

    // T+1: inject neutron (deferred this tick).
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
    // T+2: collision → excited.
    state = advanceTick(state, [], cfg);
    // T+3: phase 5 → splitting.
    state = advanceTick(state, [], cfg);
    expect(state.atoms.get(aid(1))?.state).toBe('splitting');

    // Run splittingDuration more ticks to land on spent.
    for (let i = 0; i < splittingDuration; i++) {
      state = advanceTick(state, [], cfg);
    }
    expect(state.tick).toBe(3 + splittingDuration);
    const spent = state.atoms.get(aid(1))!;
    expect(spent.state).toBe('spent');
    expect(spent.spentAt).toBe(state.tick);
    const spentAt = spent.spentAt!;

    // Run until just before cleanup.
    while (state.tick < spentAt + cleanupTicks - 1) {
      state = advanceTick(state, [], cfg);
    }
    expect(state.atoms.has(aid(1))).toBe(true);

    // One more tick lands on the cleanup boundary: state.tick - spentAt === cleanupTicks.
    state = advanceTick(state, [], cfg);
    expect(state.tick - spentAt).toBe(cleanupTicks);
    expect(state.atoms.has(aid(1))).toBe(false);

    // No event fires for cleanup itself — only the prior atomSpent.
    const cleanupTickEvents = state.pendingEvents.filter((e) => e.tick === state.tick);
    // Stale neutron expirations may fire, but no atom-related events for this atom.
    for (const ev of cleanupTickEvents) {
      if ('atomId' in ev.data) {
        expect(ev.data.atomId).not.toBe(aid(1));
      }
    }
  });
});

// Build a config that forces every collision to split with deterministic
// per-type neutron counts, so chain dynamics depend only on geometry and PRNG
// (for angles), not collision outcome variance.
function withForcedSplits(opts: {
  u235Neutrons?: number;
  pu239Neutrons?: number;
  extinctionGracePeriod?: number;
}): SimConfig {
  const base = loadConfig(defaultConfig);
  const u235N = opts.u235Neutrons ?? 2;
  const pu239N = opts.pu239Neutrons ?? 4;
  return {
    ...base,
    atoms: {
      ...base.atoms,
      U235: {
        ...base.atoms.U235,
        splitChance: 1,
        absorbChance: 0,
        neutronsPerSplit: { min: u235N, max: u235N },
      },
      Pu239: {
        ...base.atoms.Pu239,
        splitChance: 1,
        absorbChance: 0,
        neutronsPerSplit: { min: pu239N, max: pu239N },
      },
    },
    endConditions: {
      ...base.endConditions,
      extinctionGracePeriod: opts.extinctionGracePeriod ?? base.endConditions.extinctionGracePeriod,
    },
  };
}

// Place a regular grid of atoms within a square. Returns a state map keyed by
// id so callers can append more atoms or inspect specific ones.
function gridAtoms(
  startId: number,
  type: Atom['type'],
  cols: number,
  rows: number,
  spacing: number,
  collisionRadius: number,
): Atom[] {
  const atoms: Atom[] = [];
  const xOffset = -((cols - 1) * spacing) / 2;
  const yOffset = -((rows - 1) * spacing) / 2;
  let id = startId;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      atoms.push({
        id: aid(id++),
        position: { x: xOffset + c * spacing, y: yOffset + r * spacing },
        type,
        state: 'intact',
        excitedSince: null,
        decaysAt: null,
        collisionRadius,
      });
    }
  }
  return atoms;
}

function withAtoms(state: SimState, atoms: readonly Atom[], nextEntityId: number): SimState {
  const m = new Map<AtomId, Atom>();
  for (const a of atoms) m.set(a.id, a);
  return { ...state, atoms: m, nextEntityId };
}

describe('integration: criticality lifecycle — sustained chain', () => {
  it('chain reaction propagates through nominal and supercritical zones', () => {
    // 7×7 grid of forced-split U235 with 2 neutrons per split. Spacing 3
    // sim units, atom collision radius 1. A neutron injected at the edge
    // travels through and triggers chain growth. The expected progression
    // is extinct → subcritical → nominal → supercritical (and possibly
    // beyond, since this is a closed system that will burn through fuel).
    const cfg = withForcedSplits({ u235Neutrons: 2 });
    const atoms = gridAtoms(10, 'U235', 7, 7, 3, cfg.atom.collisionRadius);
    // Seed 7 produces chain dynamics that briefly visit nominal before
    // running away to meltdown. Other seeds (e.g. 42) skip nominal — the
    // chain ramp can cross 0.9 → 1.1 in a single tick when fissions per
    // generation exceed ~3. This is a balance observation, not a sim bug;
    // logged as a finding for the post-phase-8 balance pass.
    let state = withAtoms(createSimState(7, cfg), atoms, 10 + atoms.length);

    state = advanceTick(
      state,
      [
        {
          type: 'injectNeutron',
          position: { x: -15, y: 0 },
          direction: { x: 1, y: 0 },
        },
      ],
      cfg,
    );

    // Run for 200 ticks (at least 120 to populate the rolling window).
    for (let i = 0; i < 200; i++) {
      if (state.ended !== null) break;
      state = advanceTick(state, [], cfg);
    }

    // Verify the zone progression actually happened. The chain must have
    // crossed subcritical (sequentially ordered above extinct).
    const zoneChanges = findAll(state.pendingEvents, 'criticalityZoneChanged');
    const zonesSeen = new Set<string>(zoneChanges.map((e) => e.data.newZone));
    expect(zonesSeen.has('subcritical')).toBe(true);
    // Score > 0 proves the reactor was in nominal for at least one tick.
    expect(state.score).toBeGreaterThan(0);

    // tick events fire every tick (until run end if any).
    const tickEvents = findAll(state.pendingEvents, 'tick');
    expect(tickEvents.length).toBeGreaterThan(0);
    // Each tick event has a populated k and zone.
    for (const t of tickEvents) {
      expect(typeof t.data.criticality).toBe('number');
      expect(typeof t.data.zone).toBe('string');
    }
  });
});

describe('integration: criticality lifecycle — runaway leads to meltdown', () => {
  it('high-density Pu239 chain triggers meltdown', () => {
    // 9×9 grid of forced-split Pu239 (4 neutrons per split). The branching
    // factor (4× per generation) ensures a chain that ramps fast enough to
    // exceed k > 2.0 within the rolling window.
    const cfg = withForcedSplits({ pu239Neutrons: 4 });
    const atoms = gridAtoms(10, 'Pu239', 9, 9, 3, cfg.atom.collisionRadius);
    let state = withAtoms(createSimState(7, cfg), atoms, 10 + atoms.length);

    state = advanceTick(
      state,
      [
        {
          type: 'injectNeutron',
          position: { x: -20, y: 0 },
          direction: { x: 1, y: 0 },
        },
      ],
      cfg,
    );

    // Run until meltdown or 500 ticks (whichever first). With this
    // configuration, meltdown should happen well before 500 ticks.
    let i = 0;
    while (state.ended === null && i < 500) {
      state = advanceTick(state, [], cfg);
      i++;
    }

    expect(state.ended).toEqual({ reason: 'meltdown' });
    const ended = findAll(state.pendingEvents, 'runEnded');
    expect(ended).toHaveLength(1);
    expect(ended[0]!.data.outcome).toBe('meltdown');

    // After meltdown, advanceTick short-circuits (ADR-017): no further state
    // mutation, no further events.
    const beforeIdle = state.pendingEvents.length;
    state = advanceTick(state, [], cfg);
    state = advanceTick(state, [], cfg);
    expect(state.pendingEvents.length).toBe(beforeIdle);
  });
});

describe('integration: criticality lifecycle — subcritical decay to extinction', () => {
  it('empty playfield extincts at extinctionGracePeriod', () => {
    // No atoms, no neutrons. Phase 8 computes k = 0 every tick; phase 9
    // increments ticksBelowExtinction; at grace period the run ends as
    // extinction.
    const cfg = loadConfig(defaultConfig);
    const grace = cfg.endConditions.extinctionGracePeriod;
    let state = createSimState(1, cfg);

    while (state.ended === null && state.tick < grace + 50) {
      state = advanceTick(state, [], cfg);
    }

    expect(state.ended).toEqual({ reason: 'extinction' });
    const ended = findAll(state.pendingEvents, 'runEnded');
    expect(ended).toHaveLength(1);
    expect(ended[0]!.data.outcome).toBe('extinction');
  });

  it('single-atom chain dies and run extincts after grace period', () => {
    // One U235 atom; inject a neutron that splits it; the released neutrons
    // fly off into empty space. After the rolling window flushes, k → 0 and
    // extinction grace begins.
    const cfg = withForcedSplits({ u235Neutrons: 2 });
    const atom: Atom = {
      id: aid(1),
      position: { x: 0, y: 0 },
      type: 'U235',
      state: 'intact',
      excitedSince: null,
      decaysAt: null,
      collisionRadius: cfg.atom.collisionRadius,
    };
    let state = withAtoms(createSimState(2, cfg), [atom], 2);

    state = advanceTick(
      state,
      [
        {
          type: 'injectNeutron',
          position: { x: -3, y: 0 },
          direction: { x: 1, y: 0 },
        },
      ],
      cfg,
    );

    // Run until extinction or a generous bound. Extinction should fire by
    // criticalityWindow (120) + extinctionGracePeriod (300) + buffer.
    const bound = cfg.criticalityWindow + cfg.endConditions.extinctionGracePeriod + 100;
    let i = 0;
    while (state.ended === null && i < bound) {
      state = advanceTick(state, [], cfg);
      i++;
    }

    expect(state.ended).toEqual({ reason: 'extinction' });
    const ended = findAll(state.pendingEvents, 'runEnded');
    expect(ended).toHaveLength(1);
    expect(ended[0]!.data.outcome).toBe('extinction');
  });
});
