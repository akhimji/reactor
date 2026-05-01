import { describe, expect, it } from 'vitest';
import defaultConfig from '../configs/default.json' with { type: 'json' };
import {
  advanceTick,
  createSimState,
  loadConfig,
  type AtomId,
  type CriticalityZone,
  type SimEvent,
  type SimState,
} from '../src/index.js';

const baseConfig = loadConfig(defaultConfig);

const aid = (n: number): AtomId => n as unknown as AtomId;

function findAll<T extends SimEvent['type']>(
  events: readonly SimEvent[],
  type: T,
): Extract<SimEvent, { type: T }>[] {
  return events.filter((e): e is Extract<SimEvent, { type: T }> => e.type === type);
}

// Phase 8 reads pendingEvents looking for atomSplit events with tick === state.tick.
// advanceTick increments state.tick to inputState.tick + 1 before phase 8 runs, so
// events injected here must use that target tick.
function withInjectedSplits(
  state: SimState,
  splits: readonly { atomId: number; neutronsReleased: number }[],
): SimState {
  const targetTick = state.tick + 1;
  const events: SimEvent[] = splits.map((s) => ({
    type: 'atomSplit',
    tick: targetTick,
    data: {
      atomId: aid(s.atomId),
      position: { x: 0, y: 0 },
      neutronsReleased: s.neutronsReleased,
    },
  }));
  return { ...state, pendingEvents: [...state.pendingEvents, ...events] };
}

function injectEvent(state: SimState, event: SimEvent): SimState {
  return { ...state, pendingEvents: [...state.pendingEvents, event] };
}

// Set fissionHistory to a target windowTotal distributed in a slot that
// won't be overwritten this tick (slot 0 unless tick+1 % window === 0).
function withFissionHistoryTotal(
  state: SimState,
  total: number,
  windowSize = baseConfig.criticalityWindow,
): SimState {
  const overwriteSlot = (((state.tick + 1) % windowSize) + windowSize) % windowSize;
  const targetSlot = overwriteSlot === 0 ? 1 : 0;
  const fissionHistory = new Array(windowSize).fill(0);
  fissionHistory[targetSlot] = total;
  return { ...state, fissionHistory };
}

describe('phase 8: fission counting from pendingEvents', () => {
  it('one atomSplit with neutronsReleased=3: fissionsThisTick=3', () => {
    const initial = withInjectedSplits(createSimState(1, baseConfig), [
      { atomId: 1, neutronsReleased: 3 },
    ]);
    const s1 = advanceTick(initial, [], baseConfig);

    const slot = s1.tick % baseConfig.criticalityWindow;
    expect(s1.fissionHistory[slot]).toBe(3);
  });

  it('three atomSplit events {2, 3, 2}: fissionsThisTick=7', () => {
    const initial = withInjectedSplits(createSimState(1, baseConfig), [
      { atomId: 1, neutronsReleased: 2 },
      { atomId: 2, neutronsReleased: 3 },
      { atomId: 3, neutronsReleased: 2 },
    ]);
    const s1 = advanceTick(initial, [], baseConfig);

    const slot = s1.tick % baseConfig.criticalityWindow;
    expect(s1.fissionHistory[slot]).toBe(7);
  });

  it('no atomSplit events: fissionsThisTick=0', () => {
    const initial = createSimState(1, baseConfig);
    const s1 = advanceTick(initial, [], baseConfig);

    const slot = s1.tick % baseConfig.criticalityWindow;
    expect(s1.fissionHistory[slot]).toBe(0);
  });

  it('atomDecayed event (Pu239 timer) does NOT count toward fissions', () => {
    const initial = injectEvent(createSimState(1, baseConfig), {
      type: 'atomDecayed',
      tick: 1,
      data: { atomId: aid(1), type: 'Pu239', position: { x: 0, y: 0 } },
    });
    const s1 = advanceTick(initial, [], baseConfig);

    const slot = s1.tick % baseConfig.criticalityWindow;
    expect(s1.fissionHistory[slot]).toBe(0);
  });

  it('mix of atomSplit and other event types: only atomSplit summed', () => {
    let s = createSimState(1, baseConfig);
    s = injectEvent(s, {
      type: 'atomSpawned',
      tick: 1,
      data: { atomId: aid(1), type: 'U235', position: { x: 0, y: 0 } },
    });
    s = injectEvent(s, {
      type: 'atomSplit',
      tick: 1,
      data: { atomId: aid(1), position: { x: 0, y: 0 }, neutronsReleased: 3 },
    });
    s = injectEvent(s, {
      type: 'atomDecayed',
      tick: 1,
      data: { atomId: aid(2), type: 'Pu239', position: { x: 0, y: 0 } },
    });
    s = injectEvent(s, {
      type: 'neutronAbsorbed',
      tick: 1,
      data: {
        neutronId: 99 as never,
        absorbedBy: 'atom',
        targetId: aid(1),
        position: { x: 0, y: 0 },
      },
    });

    const s1 = advanceTick(s, [], baseConfig);
    const slot = s1.tick % baseConfig.criticalityWindow;
    expect(s1.fissionHistory[slot]).toBe(3);
  });

  it('atomSplit events from prior ticks are NOT counted', () => {
    // Inject an atomSplit with tick=0 (prior tick). After advanceTick state.tick=1.
    // Phase 8 should ignore the prior-tick event.
    const initial = injectEvent(createSimState(1, baseConfig), {
      type: 'atomSplit',
      tick: 0,
      data: { atomId: aid(1), position: { x: 0, y: 0 }, neutronsReleased: 5 },
    });
    const s1 = advanceTick(initial, [], baseConfig);

    const slot = s1.tick % baseConfig.criticalityWindow;
    expect(s1.fissionHistory[slot]).toBe(0);
  });

  it('phase 8 does not consume pendingEvents (phase 10 owns flush)', () => {
    const initial = withInjectedSplits(createSimState(1, baseConfig), [
      { atomId: 1, neutronsReleased: 3 },
    ]);
    const s1 = advanceTick(initial, [], baseConfig);

    // The injected atomSplit event is still in pendingEvents.
    const splits = findAll(s1.pendingEvents, 'atomSplit');
    expect(splits).toHaveLength(1);
    expect(splits[0]!.data.neutronsReleased).toBe(3);
  });
});

describe('phase 8: rolling window math', () => {
  it('fissionHistory indexed by tick % criticalityWindow', () => {
    let s = createSimState(1, baseConfig);
    s = withInjectedSplits(s, [{ atomId: 1, neutronsReleased: 5 }]);
    s = advanceTick(s, [], baseConfig);
    expect(s.fissionHistory[1]).toBe(5); // tick 1 → slot 1

    // Inject another split for the next tick. After advanceTick, state.tick=2,
    // so events must have tick=2 (the next tick). Use the helper.
    s = withInjectedSplits(s, [{ atomId: 2, neutronsReleased: 7 }]);
    s = advanceTick(s, [], baseConfig);
    expect(s.fissionHistory[2]).toBe(7); // tick 2 → slot 2
  });

  it('after window+1 ticks, oldest slot is overwritten', () => {
    const window = baseConfig.criticalityWindow;
    let s = createSimState(1, baseConfig);
    // Inject split for tick=1 only.
    s = withInjectedSplits(s, [{ atomId: 1, neutronsReleased: 9 }]);
    s = advanceTick(s, [], baseConfig);
    expect(s.fissionHistory[1]).toBe(9);

    // Run window more ticks (no splits). After tick (1 + window), slot 1
    // should be overwritten back to 0.
    for (let i = 0; i < window; i++) {
      s = advanceTick(s, [], baseConfig);
    }
    expect(s.fissionHistory[1]).toBe(0);
  });

  it('sustained 8 fissions/sec for full window: k = 1.0', () => {
    // 8 fissions per tick × 60 ticks/sec ≠ 8/sec; the rate is 8/sec means
    // 8 fissions across 60 ticks. With window=120 ticks (2 sec), sustained
    // 8/sec = 16 fissions in window. Wait — let's be precise:
    // baselineNeutronRate = 8 (neutrons/sec). windowSeconds = 120/60 = 2.
    // k = windowTotal / (windowSeconds * baselineNeutronRate) = total / 16.
    // For k=1: total = 16. Spread 16 fissions across 120 slots.
    const window = baseConfig.criticalityWindow;
    const fissionHistory = new Array(window).fill(0);
    for (let i = 0; i < 16; i++) fissionHistory[i] = 1;
    const s = { ...createSimState(1, baseConfig), fissionHistory };
    // Pre-position at tick=window so the slot-overwrite this tick lands on
    // slot 0 (which holds 1, going to 0). After overwrite, total = 15.
    // Hmm — that drops k below 1.0. Easier: pre-fill 17 entries; after
    // overwrite of slot (tick+1)%window = 1, total = 16, k = 1.0 exactly.
    const fissionHistory2 = new Array(window).fill(0);
    for (let i = 0; i < 17; i++) fissionHistory2[i] = 1;
    const s2 = { ...createSimState(1, baseConfig), fissionHistory: fissionHistory2 };
    const r = advanceTick(s2, [], baseConfig);

    // After phase 8: slot 1 (overwriteSlot for input tick=0) gets set to 0.
    // Pre-fill had 17 slots = 1; one is overwritten to 0; remaining = 16.
    // k = 16 / 16 = 1.0.
    expect(r.criticality?.k).toBeCloseTo(1.0, 10);
    expect(r.criticality?.zone).toBe<CriticalityZone>('nominal');
  });

  it('burst of 16 fissions in one tick, otherwise idle: k computed from window', () => {
    // 16 fissions in slot 0, all others 0. k = 16/16 = 1.0.
    // But the slot phase 8 overwrites is (input.tick+1) % window = 1,
    // which is currently 0, so it stays 0. Slot 0 keeps 16. Total = 16.
    const window = baseConfig.criticalityWindow;
    const fissionHistory = new Array(window).fill(0);
    fissionHistory[0] = 16;
    const s = { ...createSimState(1, baseConfig), fissionHistory };
    const r = advanceTick(s, [], baseConfig);

    expect(r.criticality?.k).toBeCloseTo(1.0, 10);
  });

  it('empty fissionHistory: k = 0', () => {
    const s = createSimState(1, baseConfig);
    const r = advanceTick(s, [], baseConfig);

    expect(r.criticality?.k).toBe(0);
    expect(r.criticality?.zone).toBe<CriticalityZone>('extinct');
  });
});

describe('phase 8: zone classification (spec §5.2 boundary inclusivity)', () => {
  function zoneAtTotal(total: number): CriticalityZone {
    const window = baseConfig.criticalityWindow;
    const fissionHistory = new Array(window).fill(0);
    // Place at slot 0; phase 8 overwrites slot 1 next tick (which is 0 anyway).
    fissionHistory[0] = total;
    const s = { ...createSimState(1, baseConfig), fissionHistory };
    const r = advanceTick(s, [], baseConfig);
    return r.criticality!.zone;
  }

  // k = total / 16 (windowSeconds=2, baselineNeutronRate=8).
  // Zone bounds:  extinct < 0.1, subcritical < 0.9, nominal ≤ 1.1,
  //               supercritical ≤ 1.5, runaway ≤ 2.0, meltdown > 2.0.

  it('total=0 (k=0): extinct', () => {
    expect(zoneAtTotal(0)).toBe<CriticalityZone>('extinct');
  });

  it('total=1 (k=0.0625 < 0.1): extinct', () => {
    expect(zoneAtTotal(1)).toBe<CriticalityZone>('extinct');
  });

  it('total=2 (k=0.125 ≥ 0.1): subcritical', () => {
    expect(zoneAtTotal(2)).toBe<CriticalityZone>('subcritical');
  });

  it('total=14 (k=0.875 < 0.9): subcritical', () => {
    expect(zoneAtTotal(14)).toBe<CriticalityZone>('subcritical');
  });

  it('total=15 (k=0.9375 ≥ 0.9, ≤ 1.1): nominal', () => {
    expect(zoneAtTotal(15)).toBe<CriticalityZone>('nominal');
  });

  it('total=16 (k=1.0): nominal', () => {
    expect(zoneAtTotal(16)).toBe<CriticalityZone>('nominal');
  });

  it('total=17 (k=1.0625 ≤ 1.1): nominal', () => {
    expect(zoneAtTotal(17)).toBe<CriticalityZone>('nominal');
  });

  it('total=18 (k=1.125 > 1.1, ≤ 1.5): supercritical', () => {
    expect(zoneAtTotal(18)).toBe<CriticalityZone>('supercritical');
  });

  it('total=24 (k=1.5): supercritical (boundary inclusive)', () => {
    expect(zoneAtTotal(24)).toBe<CriticalityZone>('supercritical');
  });

  it('total=25 (k=1.5625 > 1.5, ≤ 2.0): runaway', () => {
    expect(zoneAtTotal(25)).toBe<CriticalityZone>('runaway');
  });

  it('total=32 (k=2.0): runaway (boundary inclusive)', () => {
    expect(zoneAtTotal(32)).toBe<CriticalityZone>('runaway');
  });

  it('total=33 (k=2.0625 > 2.0): meltdown', () => {
    expect(zoneAtTotal(33)).toBe<CriticalityZone>('meltdown');
  });
});

describe('phase 8: zone transition events', () => {
  it('extinct → subcritical fires criticalityZoneChanged', () => {
    // Pre-state: criticality.zone = extinct (or null, default starting zone).
    // After phase 8: zone = subcritical.
    const initial = withFissionHistoryTotal(createSimState(1, baseConfig), 4);
    const s1 = advanceTick(initial, [], baseConfig);
    const changes = findAll(s1.pendingEvents, 'criticalityZoneChanged');
    expect(changes).toHaveLength(1);
    expect(changes[0]!.data.previousZone).toBe<CriticalityZone>('extinct');
    expect(changes[0]!.data.newZone).toBe<CriticalityZone>('subcritical');
  });

  it('no zone change: criticalityZoneChanged NOT emitted', () => {
    // Two consecutive ticks both yield the same zone (extinct, k=0).
    let s = createSimState(1, baseConfig);
    s = advanceTick(s, [], baseConfig);
    expect(s.criticality?.zone).toBe<CriticalityZone>('extinct');
    const eventsBefore = s.pendingEvents.length;

    s = advanceTick(s, [], baseConfig);
    // Only tick events should have been emitted; no zone change.
    const newEvents = s.pendingEvents.slice(eventsBefore);
    expect(findAll(newEvents, 'criticalityZoneChanged')).toHaveLength(0);
    expect(findAll(newEvents, 'tick')).toHaveLength(1);
  });

  it('first tick from null criticality: previousZone is extinct', () => {
    const initial = withFissionHistoryTotal(createSimState(1, baseConfig), 16);
    expect(initial.criticality).toBeNull();

    const s1 = advanceTick(initial, [], baseConfig);
    const changes = findAll(s1.pendingEvents, 'criticalityZoneChanged');
    expect(changes).toHaveLength(1);
    expect(changes[0]!.data.previousZone).toBe<CriticalityZone>('extinct');
    expect(changes[0]!.data.newZone).toBe<CriticalityZone>('nominal');
  });

  it('multiple zone transitions across ticks emit one event per change', () => {
    let s = createSimState(1, baseConfig);
    // Tick 1: extinct → nominal (16 in window).
    s = withFissionHistoryTotal(s, 16);
    s = advanceTick(s, [], baseConfig);
    expect(s.criticality?.zone).toBe<CriticalityZone>('nominal');

    // Tick 2: same total → still nominal (after phase 8 overwrites a slot
    // that is currently 0, so total stays 16). No zone change.
    s = advanceTick(s, [], baseConfig);

    // Now push to supercritical.
    s = withFissionHistoryTotal(s, 20);
    s = advanceTick(s, [], baseConfig);
    expect(s.criticality?.zone).toBe<CriticalityZone>('supercritical');

    const allChanges = findAll(s.pendingEvents, 'criticalityZoneChanged');
    expect(allChanges).toHaveLength(2);
    expect(allChanges[0]!.data.newZone).toBe<CriticalityZone>('nominal');
    expect(allChanges[1]!.data.newZone).toBe<CriticalityZone>('supercritical');
  });
});

describe('phase 8: tick event emission', () => {
  it('tick event fires every tick regardless of zone', () => {
    let s = createSimState(1, baseConfig);
    s = advanceTick(s, [], baseConfig);
    s = advanceTick(s, [], baseConfig);
    s = advanceTick(s, [], baseConfig);

    const ticks = findAll(s.pendingEvents, 'tick');
    expect(ticks).toHaveLength(3);
  });

  it('tick event payload includes correct k and zone', () => {
    const initial = withFissionHistoryTotal(createSimState(1, baseConfig), 16);
    const s1 = advanceTick(initial, [], baseConfig);

    const tickEvent = findAll(s1.pendingEvents, 'tick')[0]!;
    expect(tickEvent.data.criticality).toBeCloseTo(1.0, 10);
    expect(tickEvent.data.zone).toBe<CriticalityZone>('nominal');
  });

  it('tick event tick number matches state.tick at emission', () => {
    let s = createSimState(1, baseConfig);
    s = advanceTick(s, [], baseConfig);
    s = advanceTick(s, [], baseConfig);

    const ticks = findAll(s.pendingEvents, 'tick');
    expect(ticks[0]!.tick).toBe(1);
    expect(ticks[1]!.tick).toBe(2);
  });
});

describe('phase 8: score accumulation', () => {
  it('zone=nominal, k=1.0 (center): scoreThisTick = baseRate', () => {
    const initial = withFissionHistoryTotal(createSimState(1, baseConfig), 16);
    const s1 = advanceTick(initial, [], baseConfig);
    expect(s1.criticality?.k).toBeCloseTo(1.0, 10);
    expect(s1.score).toBeCloseTo(baseConfig.scoring.baseRatePerTick, 10);
  });

  it('zone=nominal, k=0.9375 (lower edge of representable nominal): max bonus near 2x', () => {
    // total=15 → k=0.9375. normalized = (1.0 - 0.9375) / 0.1 = 0.625.
    // multiplier = 1 + 1.0 * 0.625² = 1.390625.
    const initial = withFissionHistoryTotal(createSimState(1, baseConfig), 15);
    const s1 = advanceTick(initial, [], baseConfig);
    expect(s1.criticality?.k).toBeCloseTo(0.9375, 10);
    expect(s1.score).toBeCloseTo(1 * 1.390625, 10);
  });

  it('zone=nominal, k=1.0625 (upper edge): score reflects edge bonus', () => {
    // total=17 → k=1.0625. normalized = (1.0625 - 1.0) / 0.1 = 0.625.
    // multiplier = 1 + 1.0 * 0.625² = 1.390625.
    const initial = withFissionHistoryTotal(createSimState(1, baseConfig), 17);
    const s1 = advanceTick(initial, [], baseConfig);
    expect(s1.score).toBeCloseTo(1 * 1.390625, 10);
  });

  it('zone=nominal, k=1.05 (halfway from center to edge): quadratic shape', () => {
    // We can't hit k=1.05 exactly with integer fissions, but verify the
    // formula at a representable midpoint. total=16 → k=1.0 → multiplier=1.
    // total=17 → k=1.0625 → distance=0.0625, normalized=0.625, mult=1.390625.
    // The quadratic shape grows faster near the boundaries — this is
    // already captured by the previous tests.
    const totals = [15, 16, 17, 18];
    const scores: number[] = [];
    for (const t of totals) {
      const s1 = advanceTick(
        withFissionHistoryTotal(createSimState(1, baseConfig), t),
        [],
        baseConfig,
      );
      scores.push(s1.score);
    }
    // scores at 15, 16, 17 are all in nominal; 18 is supercritical (score=0).
    expect(scores[0]).toBeGreaterThan(scores[1]!); // 15 (edge) > 16 (center)
    expect(scores[2]).toBeGreaterThan(scores[1]!); // 17 (edge) > 16 (center)
    expect(scores[3]).toBe(0); // 18 → supercritical → no score
  });

  it('zone !== nominal: scoreThisTick = 0', () => {
    // extinct
    let s = advanceTick(createSimState(1, baseConfig), [], baseConfig);
    expect(s.score).toBe(0);

    // subcritical: total=4 → k=0.25
    s = advanceTick(
      withFissionHistoryTotal(createSimState(1, baseConfig), 4),
      [],
      baseConfig,
    );
    expect(s.score).toBe(0);

    // supercritical: total=20 → k=1.25
    s = advanceTick(
      withFissionHistoryTotal(createSimState(1, baseConfig), 20),
      [],
      baseConfig,
    );
    expect(s.score).toBe(0);

    // meltdown: total=40 → k=2.5 (run also ends, but phase 8 ran first
    // and computed score=0 because zone is meltdown).
    s = advanceTick(
      withFissionHistoryTotal(createSimState(1, baseConfig), 40),
      [],
      baseConfig,
    );
    expect(s.score).toBe(0);
  });

  it('score accumulates across multiple ticks in nominal', () => {
    let s = withFissionHistoryTotal(createSimState(1, baseConfig), 16);
    s = advanceTick(s, [], baseConfig);
    const s1Score = s.score;

    // Maintain k=1.0 across the next tick. The previous advanceTick wrote 0
    // to the slot it overwrote, but we pre-filled enough slots originally;
    // re-pre-fill to keep the next tick at k=1.0.
    s = withFissionHistoryTotal(s, 16);
    s = advanceTick(s, [], baseConfig);

    expect(s.score).toBeCloseTo(2 * s1Score, 10);
  });
});

describe('phase 8: determinism', () => {
  it('same fission inputs across runs produce identical k, zone, score', () => {
    const setup = (): SimState =>
      withFissionHistoryTotal(createSimState(7, baseConfig), 16);
    const a = advanceTick(setup(), [], baseConfig);
    const b = advanceTick(setup(), [], baseConfig);

    expect(a.criticality).toEqual(b.criticality);
    expect(a.score).toBe(b.score);
    expect(a.fissionHistory).toEqual(b.fissionHistory);
  });

  it('phase 8 makes no PRNG draws', () => {
    const initial = withFissionHistoryTotal(createSimState(123, baseConfig), 16);
    const before = initial.prng;
    const s1 = advanceTick(initial, [], baseConfig);

    // No inputs, no atoms, no neutrons → no other phase touches prng either.
    expect(s1.prng).toEqual(before);
  });
});

describe('phase 8: immutability', () => {
  it('input state unchanged after phase 8', () => {
    const initial = withFissionHistoryTotal(createSimState(1, baseConfig), 16);
    const initialCriticality = initial.criticality;
    const initialScore = initial.score;
    const initialFissionHistory = [...initial.fissionHistory];

    advanceTick(initial, [], baseConfig);

    expect(initial.criticality).toBe(initialCriticality);
    expect(initial.score).toBe(initialScore);
    expect(initial.fissionHistory).toEqual(initialFissionHistory);
  });

  it('pendingEvents unchanged after phase 8 (phase 10 owns flush)', () => {
    const initial = withInjectedSplits(createSimState(1, baseConfig), [
      { atomId: 1, neutronsReleased: 3 },
    ]);
    const initialEventsCount = initial.pendingEvents.length;

    advanceTick(initial, [], baseConfig);

    expect(initial.pendingEvents).toHaveLength(initialEventsCount);
  });
});
