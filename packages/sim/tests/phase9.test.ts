import { describe, expect, it } from 'vitest';
import defaultConfig from '../configs/default.json' with { type: 'json' };
import {
  advanceTick,
  createSimState,
  loadConfig,
  type SimConfig,
  type SimEvent,
  type SimState,
} from '../src/index.js';

const baseConfig = loadConfig(defaultConfig);

// Pre-populate state.fissionHistory so phase 8 computes a target k. After
// advanceTick increments tick by 1 and phase 8 overwrites slot
// `(state.tick + 1) % window`, the surviving slots' sum produces the target.
// We place the fission count in a slot that won't be overwritten this tick.
//
// k = sum / (windowSeconds * baselineNeutronRate)
// → required_sum = round(targetK * windowSeconds * baselineNeutronRate)
//
// Integer fission counts mean some target k values aren't expressible exactly
// (e.g., k = 0.1 needs sum = 1.6). For those, the closest integer is used and
// the test assertion is adjusted accordingly.
function withTargetK(state: SimState, targetK: number, config: SimConfig): SimState {
  const window = config.criticalityWindow;
  const windowSeconds = window / config.tickHz;
  const baseRate = config.criticality.baselineNeutronRate;
  const required = Math.round(targetK * windowSeconds * baseRate);
  const overwriteSlot = (((state.tick + 1) % window) + window) % window;
  const targetSlot = overwriteSlot === 0 ? 1 : 0;
  const fissionHistory = new Array(window).fill(0);
  fissionHistory[targetSlot] = required;
  return { ...state, fissionHistory };
}

function findAll<T extends SimEvent['type']>(
  events: readonly SimEvent[],
  type: T,
): Extract<SimEvent, { type: T }>[] {
  return events.filter((e): e is Extract<SimEvent, { type: T }> => e.type === type);
}

describe('phase 9: end conditions — meltdown', () => {
  it('k > meltdownThreshold: state.ended = meltdown, runEnded fires', () => {
    const initial = withTargetK(createSimState(1, baseConfig), 2.5, baseConfig);
    const s1 = advanceTick(initial, [], baseConfig);

    expect(s1.ended).toEqual({ reason: 'meltdown' });
    const ended = findAll(s1.pendingEvents, 'runEnded');
    expect(ended).toHaveLength(1);
    expect(ended[0]!.data.outcome).toBe('meltdown');
    expect(ended[0]!.data.finalTick).toBe(s1.tick);
    // Score is 0 because the run never spent a tick in nominal before melting.
    expect(ended[0]!.data.finalScore).toBe(0);
  });

  it('k === 2.0: NOT a meltdown (strict >)', () => {
    const initial = withTargetK(createSimState(1, baseConfig), 2.0, baseConfig);
    const s1 = advanceTick(initial, [], baseConfig);

    expect(s1.ended).toBeNull();
    expect(findAll(s1.pendingEvents, 'runEnded')).toHaveLength(0);
  });

  it('k < 2.0: no meltdown', () => {
    const initial = withTargetK(createSimState(1, baseConfig), 1.5, baseConfig);
    const s1 = advanceTick(initial, [], baseConfig);

    expect(s1.ended).toBeNull();
  });

  it('after meltdown set, subsequent ticks short-circuit (ADR-017)', () => {
    const initial = withTargetK(createSimState(1, baseConfig), 2.5, baseConfig);
    const s1 = advanceTick(initial, [], baseConfig);
    expect(s1.ended).not.toBeNull();
    const tickAtEnd = s1.tick;

    const s2 = advanceTick(s1, [], baseConfig);
    expect(s2.tick).toBe(tickAtEnd);
    expect(s2).toBe(s1);
  });
});

describe('phase 9: end conditions — extinction grace period', () => {
  it('k below threshold for 1 tick: ticksBelowExtinction = 1, not ended', () => {
    // Empty fissionHistory yields k = 0, well below extinctionThreshold (0.1).
    const initial = createSimState(1, baseConfig);
    const s1 = advanceTick(initial, [], baseConfig);

    expect(s1.ticksBelowExtinction).toBe(1);
    expect(s1.ended).toBeNull();
  });

  it('k below threshold for grace period ticks: ended = extinction', () => {
    const grace = baseConfig.endConditions.extinctionGracePeriod;
    let s = createSimState(1, baseConfig);
    for (let i = 0; i < grace; i++) {
      s = advanceTick(s, [], baseConfig);
    }

    expect(s.ended).toEqual({ reason: 'extinction' });
    const ended = findAll(s.pendingEvents, 'runEnded');
    expect(ended).toHaveLength(1);
    expect(ended[0]!.data.outcome).toBe('extinction');
    expect(ended[0]!.data.finalScore).toBe(0);
  });

  it('k below threshold for grace - 1 ticks then rebounds: counter resets', () => {
    const grace = baseConfig.endConditions.extinctionGracePeriod;
    let s = createSimState(1, baseConfig);
    for (let i = 0; i < grace - 1; i++) {
      s = advanceTick(s, [], baseConfig);
    }
    expect(s.ticksBelowExtinction).toBe(grace - 1);
    expect(s.ended).toBeNull();

    // Pre-populate fissionHistory to produce k well above threshold.
    s = withTargetK(s, 0.5, baseConfig);
    s = advanceTick(s, [], baseConfig);

    expect(s.ticksBelowExtinction).toBe(0);
    expect(s.ended).toBeNull();
  });

  it('k oscillates above and below threshold: counter resets on each rebound', () => {
    let s = createSimState(1, baseConfig);
    s = advanceTick(s, [], baseConfig);
    expect(s.ticksBelowExtinction).toBe(1);

    // Stays at k=0; counter increments.
    s = advanceTick(s, [], baseConfig);
    expect(s.ticksBelowExtinction).toBe(2);

    // Rebound: pre-populate fissionHistory to push k above threshold for the
    // next tick.
    s = withTargetK(s, 0.5, baseConfig);
    s = advanceTick(s, [], baseConfig);
    expect(s.ticksBelowExtinction).toBe(0);

    // Reset fissionHistory back to zeros so k returns to 0.
    s = { ...s, fissionHistory: new Array(baseConfig.criticalityWindow).fill(0) };
    s = advanceTick(s, [], baseConfig);
    expect(s.ticksBelowExtinction).toBe(1);
  });

  it('k just above threshold (0.125) does NOT count as below', () => {
    // The exact boundary k = 0.1 isn't representable with integer fission
    // counts (would need windowTotal = 1.6). Test the closest integer above:
    // 2 fissions in window → k = 2/16 = 0.125, which is above 0.1 and should
    // not increment ticksBelowExtinction.
    const initial = withTargetK(createSimState(1, baseConfig), 0.125, baseConfig);
    const s1 = advanceTick(initial, [], baseConfig);

    expect(s1.ticksBelowExtinction).toBe(0);
    expect(s1.ended).toBeNull();
  });
});

describe('phase 9: end conditions — priority ordering', () => {
  it('meltdown wins when both conditions could apply (k > meltdown threshold)', () => {
    const initial = withTargetK(createSimState(1, baseConfig), 5.0, baseConfig);
    const s1 = advanceTick(initial, [], baseConfig);

    expect(s1.ended).toEqual({ reason: 'meltdown' });
    expect(s1.ticksBelowExtinction).toBe(0);
  });

  it('ended already set: phase 9 returns unchanged', () => {
    let s = withTargetK(createSimState(1, baseConfig), 2.5, baseConfig);
    s = advanceTick(s, [], baseConfig);
    expect(s.ended).not.toBeNull();
    const s2 = advanceTick(s, [], baseConfig);
    expect(s2).toBe(s);
  });
});

describe('phase 9: end conditions — site objective stub', () => {
  it('state.siteObjective undefined: phase 9 does not error or end via objective', () => {
    const initial = createSimState(1, baseConfig);
    const s1 = advanceTick(initial, [], baseConfig);

    // Phase 9 doesn't end via objective; it may still register ticksBelowExtinction.
    expect(s1.ended).toBeNull();
    expect(findAll(s1.pendingEvents, 'runEnded')).toHaveLength(0);
  });
});

describe('phase 9: end conditions — runEnded payload', () => {
  it('meltdown payload matches spec §8.1', () => {
    const initial = withTargetK(createSimState(1, baseConfig), 3.0, baseConfig);
    const s1 = advanceTick(initial, [], baseConfig);

    const ended = findAll(s1.pendingEvents, 'runEnded')[0]!;
    expect(ended.tick).toBe(s1.tick);
    expect(ended.data.outcome).toBe('meltdown');
    expect(ended.data.finalTick).toBe(s1.tick);
    expect(ended.data.finalScore).toBe(0);
  });

  it('extinction payload matches spec §8.1', () => {
    const grace = baseConfig.endConditions.extinctionGracePeriod;
    let s = createSimState(1, baseConfig);
    for (let i = 0; i < grace; i++) {
      s = advanceTick(s, [], baseConfig);
    }

    const ended = findAll(s.pendingEvents, 'runEnded')[0]!;
    expect(ended.data.outcome).toBe('extinction');
    expect(ended.data.finalTick).toBe(s.tick);
    expect(ended.data.finalScore).toBe(0);
  });
});

describe('phase 9: end conditions — determinism', () => {
  it('phase 9 makes no PRNG draws', () => {
    // Phase 8 also makes no PRNG draws, so the entire tick should leave the
    // PRNG state untouched (no inputs, no atoms, no neutrons).
    const initial = createSimState(123, baseConfig);
    const before = initial.prng;
    const s1 = advanceTick(initial, [], baseConfig);

    expect(s1.prng).toEqual(before);
  });

  it('same input state across runs produces identical output', () => {
    const init = (): SimState => createSimState(7, baseConfig);
    const a = advanceTick(init(), [], baseConfig);
    const b = advanceTick(init(), [], baseConfig);

    expect(a.ticksBelowExtinction).toBe(b.ticksBelowExtinction);
    expect(a.ended).toEqual(b.ended);
    expect(a.pendingEvents).toEqual(b.pendingEvents);
  });
});

describe('phase 9: end conditions — immutability', () => {
  it('input state is unchanged after advanceTick', () => {
    const initial = withTargetK(createSimState(1, baseConfig), 2.5, baseConfig);
    const initialEnded = initial.ended;
    const initialEvents = [...initial.pendingEvents];
    const initialTicksBelow = initial.ticksBelowExtinction;
    const initialFissionHistory = [...initial.fissionHistory];

    advanceTick(initial, [], baseConfig);

    expect(initial.ended).toBe(initialEnded);
    expect(initial.pendingEvents).toEqual(initialEvents);
    expect(initial.ticksBelowExtinction).toBe(initialTicksBelow);
    expect(initial.fissionHistory).toEqual(initialFissionHistory);
  });
});
