import { describe, expect, it } from 'vitest';
import defaultConfig from '../configs/default.json' with { type: 'json' };
import {
  advanceTick,
  createSimState,
  loadConfig,
  type SimCriticality,
  type SimEvent,
  type SimState,
} from '../src/index.js';

const baseConfig = loadConfig(defaultConfig);

function withCriticality(state: SimState, k: number): SimState {
  const crit: SimCriticality = { k, zone: 'nominal' };
  return { ...state, criticality: crit };
}

function findAll<T extends SimEvent['type']>(
  events: readonly SimEvent[],
  type: T,
): Extract<SimEvent, { type: T }>[] {
  return events.filter((e): e is Extract<SimEvent, { type: T }> => e.type === type);
}

describe('phase 9: end conditions — meltdown', () => {
  it('k > meltdownThreshold: state.ended = meltdown, runEnded fires', () => {
    const initial = withCriticality(createSimState(1, baseConfig), 2.5);
    const s1 = advanceTick(initial, [], baseConfig);

    expect(s1.ended).toEqual({ reason: 'meltdown' });
    const ended = findAll(s1.pendingEvents, 'runEnded');
    expect(ended).toHaveLength(1);
    expect(ended[0]!.data.outcome).toBe('meltdown');
    expect(ended[0]!.data.finalTick).toBe(s1.tick);
    expect(ended[0]!.data.finalScore).toBe(0);
  });

  it('k === 2.0: NOT a meltdown (strict >)', () => {
    const initial = withCriticality(createSimState(1, baseConfig), 2.0);
    const s1 = advanceTick(initial, [], baseConfig);

    expect(s1.ended).toBeNull();
    expect(findAll(s1.pendingEvents, 'runEnded')).toHaveLength(0);
  });

  it('k < 2.0: no meltdown', () => {
    const initial = withCriticality(createSimState(1, baseConfig), 1.5);
    const s1 = advanceTick(initial, [], baseConfig);

    expect(s1.ended).toBeNull();
  });

  it('after meltdown set, subsequent ticks short-circuit (ADR-017)', () => {
    const initial = withCriticality(createSimState(1, baseConfig), 2.5);
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
    const initial = withCriticality(createSimState(1, baseConfig), 0.05);
    const s1 = advanceTick(initial, [], baseConfig);

    expect(s1.ticksBelowExtinction).toBe(1);
    expect(s1.ended).toBeNull();
  });

  it('k below threshold for grace period ticks: ended = extinction', () => {
    const grace = baseConfig.endConditions.extinctionGracePeriod;
    let s = withCriticality(createSimState(1, baseConfig), 0.05);
    for (let i = 0; i < grace; i++) {
      s = advanceTick(s, [], baseConfig);
      // Re-apply criticality each tick because advanceTick produces a new state
      // and phase 8 (which would maintain criticality) is not yet implemented.
      if (s.ended === null) s = withCriticality(s, 0.05);
    }

    expect(s.ended).toEqual({ reason: 'extinction' });
    const ended = findAll(s.pendingEvents, 'runEnded');
    expect(ended).toHaveLength(1);
    expect(ended[0]!.data.outcome).toBe('extinction');
    expect(ended[0]!.data.finalScore).toBe(0);
  });

  it('k below threshold for grace - 1 ticks then rebounds: counter resets', () => {
    const grace = baseConfig.endConditions.extinctionGracePeriod;
    let s = withCriticality(createSimState(1, baseConfig), 0.05);
    for (let i = 0; i < grace - 1; i++) {
      s = advanceTick(s, [], baseConfig);
      if (s.ended === null) s = withCriticality(s, 0.05);
    }
    expect(s.ticksBelowExtinction).toBe(grace - 1);
    expect(s.ended).toBeNull();

    // Rebound above threshold.
    s = withCriticality(s, 0.5);
    s = advanceTick(s, [], baseConfig);

    expect(s.ticksBelowExtinction).toBe(0);
    expect(s.ended).toBeNull();
  });

  it('k oscillates above and below threshold: counter resets on each rebound', () => {
    let s = withCriticality(createSimState(1, baseConfig), 0.05);
    s = advanceTick(s, [], baseConfig);
    expect(s.ticksBelowExtinction).toBe(1);

    s = withCriticality(s, 0.05);
    s = advanceTick(s, [], baseConfig);
    expect(s.ticksBelowExtinction).toBe(2);

    s = withCriticality(s, 0.5);
    s = advanceTick(s, [], baseConfig);
    expect(s.ticksBelowExtinction).toBe(0);

    s = withCriticality(s, 0.05);
    s = advanceTick(s, [], baseConfig);
    expect(s.ticksBelowExtinction).toBe(1);
  });

  it('k at threshold (0.1) does NOT count as below', () => {
    const initial = withCriticality(createSimState(1, baseConfig), 0.1);
    const s1 = advanceTick(initial, [], baseConfig);

    expect(s1.ticksBelowExtinction).toBe(0);
    expect(s1.ended).toBeNull();
  });
});

describe('phase 9: end conditions — priority ordering', () => {
  it('meltdown wins when both conditions could apply (k > meltdown threshold)', () => {
    // k > 2.0 cannot also be < 0.1, but we still verify meltdown short-circuits
    // before any extinction logic touches the counter.
    const initial = withCriticality(createSimState(1, baseConfig), 5.0);
    const s1 = advanceTick(initial, [], baseConfig);

    expect(s1.ended).toEqual({ reason: 'meltdown' });
    expect(s1.ticksBelowExtinction).toBe(0);
  });

  it('ended already set: phase 9 returns unchanged', () => {
    // Direct phase 9 test would be cleaner, but advanceTick short-circuits at
    // the top when ended is set, which is the same behavior the ADR-017 test
    // exercises. Verify the no-op via state identity.
    let s = withCriticality(createSimState(1, baseConfig), 2.5);
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

    expect(s1.ended).toBeNull();
    expect(findAll(s1.pendingEvents, 'runEnded')).toHaveLength(0);
  });
});

describe('phase 9: end conditions — runEnded payload', () => {
  it('meltdown payload matches spec §8.1', () => {
    const initial = withCriticality(createSimState(1, baseConfig), 3.0);
    const s1 = advanceTick(initial, [], baseConfig);

    const ended = findAll(s1.pendingEvents, 'runEnded')[0]!;
    expect(ended.tick).toBe(s1.tick);
    expect(ended.data.outcome).toBe('meltdown');
    expect(ended.data.finalTick).toBe(s1.tick);
    expect(ended.data.finalScore).toBe(0);
  });

  it('extinction payload matches spec §8.1', () => {
    const grace = baseConfig.endConditions.extinctionGracePeriod;
    let s = withCriticality(createSimState(1, baseConfig), 0.05);
    for (let i = 0; i < grace; i++) {
      s = advanceTick(s, [], baseConfig);
      if (s.ended === null) s = withCriticality(s, 0.05);
    }

    const ended = findAll(s.pendingEvents, 'runEnded')[0]!;
    expect(ended.data.outcome).toBe('extinction');
    expect(ended.data.finalTick).toBe(s.tick);
    expect(ended.data.finalScore).toBe(0);
  });
});

describe('phase 9: end conditions — criticality undefined (phase 8 stub)', () => {
  it('without criticality field, no meltdown, no extinction', () => {
    // Run for many ticks with no criticality set. With phase 8 not yet
    // implemented, this is the production state of the world today.
    let s = createSimState(1, baseConfig);
    for (let i = 0; i < 500; i++) {
      s = advanceTick(s, [], baseConfig);
    }

    expect(s.ended).toBeNull();
    expect(s.ticksBelowExtinction).toBe(0);
  });
});

describe('phase 9: end conditions — determinism', () => {
  it('phase 9 makes no PRNG draws', () => {
    const initial = withCriticality(createSimState(123, baseConfig), 0.05);
    const before = initial.prng;
    const s1 = advanceTick(initial, [], baseConfig);

    expect(s1.prng).toEqual(before);
  });

  it('same input state across runs produces identical output', () => {
    const init = (): SimState => withCriticality(createSimState(7, baseConfig), 0.05);
    const a = advanceTick(init(), [], baseConfig);
    const b = advanceTick(init(), [], baseConfig);

    expect(a.ticksBelowExtinction).toBe(b.ticksBelowExtinction);
    expect(a.ended).toEqual(b.ended);
    expect(a.pendingEvents).toEqual(b.pendingEvents);
  });
});

describe('phase 9: end conditions — immutability', () => {
  it('input state is unchanged after advanceTick', () => {
    const initial = withCriticality(createSimState(1, baseConfig), 2.5);
    const initialEnded = initial.ended;
    const initialEvents = [...initial.pendingEvents];
    const initialTicksBelow = initial.ticksBelowExtinction;

    advanceTick(initial, [], baseConfig);

    expect(initial.ended).toBe(initialEnded);
    expect(initial.pendingEvents).toEqual(initialEvents);
    expect(initial.ticksBelowExtinction).toBe(initialTicksBelow);
  });
});
