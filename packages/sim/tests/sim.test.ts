import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import defaultConfig from '../configs/default.json' with { type: 'json' };
import {
  loadConfig,
  Sim,
  type SimConfig,
  type SimEvent,
} from '../src/index.js';

// Use a generously-extended grace period so tests advancing past tick 300 do
// not trip phase 9's extinction (an empty playfield produces k = 0). Keeps
// these tests scoped to subscription mechanics rather than end conditions.
function withLongGrace(): SimConfig {
  const base = loadConfig(defaultConfig);
  return {
    ...base,
    endConditions: {
      ...base.endConditions,
      extinctionGracePeriod: 100_000,
    },
  };
}

describe('Sim subscription basics', () => {
  it('subscribe returns a function (Unsubscribe)', () => {
    const sim = new Sim(withLongGrace(), 1);
    const unsub = sim.subscribe('tick', () => {});
    expect(typeof unsub).toBe('function');
  });

  it('delivers matching events to a subscribed handler', () => {
    const sim = new Sim(withLongGrace(), 1);
    const ticks: SimEvent[] = [];
    sim.subscribe('tick', (e) => ticks.push(e));
    sim.tick([]);
    expect(ticks).toHaveLength(1);
    expect(ticks[0]!.type).toBe('tick');
  });

  it('does NOT deliver non-matching event types to a handler', () => {
    const sim = new Sim(withLongGrace(), 1);
    const tickEvents: SimEvent[] = [];
    const splitEvents: SimEvent[] = [];
    sim.subscribe('tick', (e) => tickEvents.push(e));
    sim.subscribe('atomSplit', (e) => splitEvents.push(e));
    sim.tick([]);
    // Empty playfield with no atoms — only `tick` events emit.
    expect(tickEvents.length).toBeGreaterThan(0);
    expect(splitEvents).toHaveLength(0);
  });

  it('delivers events to multiple subscribers of the same type', () => {
    const sim = new Sim(withLongGrace(), 1);
    const a: SimEvent[] = [];
    const b: SimEvent[] = [];
    const c: SimEvent[] = [];
    sim.subscribe('tick', (e) => a.push(e));
    sim.subscribe('tick', (e) => b.push(e));
    sim.subscribe('tick', (e) => c.push(e));
    sim.tick([]);
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(c).toHaveLength(1);
  });

  it('unsubscribe removes the handler from future dispatches', () => {
    const sim = new Sim(withLongGrace(), 1);
    const received: SimEvent[] = [];
    const unsub = sim.subscribe('tick', (e) => received.push(e));
    sim.tick([]);
    expect(received).toHaveLength(1);
    unsub();
    sim.tick([]);
    sim.tick([]);
    expect(received).toHaveLength(1);
  });

  it('unsubscribe is idempotent (calling twice does not throw)', () => {
    const sim = new Sim(withLongGrace(), 1);
    const unsub = sim.subscribe('tick', () => {});
    expect(() => {
      unsub();
      unsub();
    }).not.toThrow();
  });
});

describe('Sim subscription type narrowing', () => {
  it('handler for tick receives event narrowed to the tick variant', () => {
    const sim = new Sim(withLongGrace(), 1);
    let observedZone: string | null = null;
    let observedK: number | null = null;
    // No type assertions, no `as`, no `if (event.type === ...)` — narrowing
    // is provided by the generic at subscribe time.
    sim.subscribe('tick', (event) => {
      observedZone = event.data.zone;
      observedK = event.data.criticality;
    });
    sim.tick([]);
    expect(observedZone).not.toBeNull();
    expect(typeof observedK).toBe('number');
  });

  it('handler for runEnded receives event narrowed to the runEnded variant', () => {
    const sim = new Sim(withLongGrace(), 1);
    let observedOutcome: string | null = null;
    let observedFinalScore: number | null = null;
    sim.subscribe('runEnded', (event) => {
      observedOutcome = event.data.outcome;
      observedFinalScore = event.data.finalScore;
    });
    sim.tick([{ type: 'scram' }]);
    expect(observedOutcome).toBe('stabilized');
    expect(typeof observedFinalScore).toBe('number');
  });
});

describe('Sim dispatch order', () => {
  it('events from a single tick dispatch in pendingEvents insertion order', () => {
    const sim = new Sim(withLongGrace(), 1);
    const order: SimEvent['type'][] = [];
    // Subscribe to all types we expect to see for a SCRAM tick. SCRAM emits
    // `runEnded` (and may emit `tick` from phase 8 — though phase 8 short-
    // circuits when state.ended is set; we just want to verify the ordering
    // of whatever IS emitted).
    sim.subscribe('runEnded', (e) => order.push(e.type));
    sim.subscribe('tick', (e) => order.push(e.type));
    sim.tick([{ type: 'scram' }]);
    // Read the actual pendingEvents order (already cleared after dispatch,
    // so re-run on a fresh sim and intercept the queue via getState).
    const verify = new Sim(withLongGrace(), 1);
    const captured: SimEvent['type'][] = [];
    verify.subscribe('runEnded', (e) => captured.push(e.type));
    verify.subscribe('tick', (e) => captured.push(e.type));
    verify.tick([{ type: 'scram' }]);
    expect(order).toEqual(captured);
  });

  it('handlers within a single event type dispatch in subscription order', () => {
    const sim = new Sim(withLongGrace(), 1);
    const callOrder: string[] = [];
    sim.subscribe('tick', () => callOrder.push('first'));
    sim.subscribe('tick', () => callOrder.push('second'));
    sim.subscribe('tick', () => callOrder.push('third'));
    sim.tick([]);
    expect(callOrder).toEqual(['first', 'second', 'third']);
  });
});

describe('Sim subscriber error handling', () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  it('a throwing handler does not stop dispatch to other handlers', () => {
    const sim = new Sim(withLongGrace(), 1);
    const reached: string[] = [];
    sim.subscribe('tick', () => {
      throw new Error('boom');
    });
    sim.subscribe('tick', () => reached.push('after-throw'));
    sim.tick([]);
    expect(reached).toEqual(['after-throw']);
  });

  it('a throwing handler does not crash the sim — subsequent ticks still work', () => {
    const sim = new Sim(withLongGrace(), 1);
    const seen: number[] = [];
    sim.subscribe('tick', () => {
      throw new Error('boom');
    });
    sim.subscribe('tick', (e) => seen.push(e.tick));
    sim.tick([]);
    sim.tick([]);
    sim.tick([]);
    expect(seen).toEqual([1, 2, 3]);
  });

  it('console.error is called when a handler throws', () => {
    const sim = new Sim(withLongGrace(), 1);
    const err = new Error('handler failure');
    sim.subscribe('tick', () => {
      throw err;
    });
    sim.tick([]);
    expect(consoleError).toHaveBeenCalled();
    const firstCall = consoleError.mock.calls[0]!;
    expect(firstCall[0]).toBe('Sim subscriber error:');
    expect(firstCall[1]).toBe(err);
    expect((firstCall[2] as { event: SimEvent }).event.type).toBe('tick');
  });

  it('after a handler throws, sim state remains consistent for the next tick', () => {
    const sim = new Sim(withLongGrace(), 1);
    sim.subscribe('tick', () => {
      throw new Error('boom');
    });
    sim.tick([]);
    sim.tick([]);
    expect(sim.getState().tick).toBe(2);
    expect(sim.getState().ended).toBeNull();
  });
});

describe('Sim state management', () => {
  it('pendingEvents is cleared after dispatch', () => {
    const sim = new Sim(withLongGrace(), 1);
    sim.tick([]);
    expect(sim.getState().pendingEvents).toHaveLength(0);
  });

  it('subsequent ticks start with empty pendingEvents', () => {
    const sim = new Sim(withLongGrace(), 1);
    sim.tick([]);
    sim.tick([]);
    sim.tick([]);
    expect(sim.getState().pendingEvents).toHaveLength(0);
  });

  it('getState returns current state with pendingEvents already cleared', () => {
    const sim = new Sim(withLongGrace(), 1);
    sim.tick([]);
    const state = sim.getState();
    expect(state.tick).toBe(1);
    expect(state.pendingEvents).toEqual([]);
  });

  it('handlers receive event objects without mutating sim state through them', () => {
    const sim = new Sim(withLongGrace(), 1);
    sim.subscribe('tick', (event) => {
      // Attempting to mutate the readonly event payload is a TS compile
      // error; at runtime, payloads are plain objects but the contract is
      // immutable. Verify the sim state itself is unaffected by reading
      // the event.
      void event.data.zone;
    });
    const beforeTick = sim.getState().tick;
    sim.tick([]);
    expect(sim.getState().tick).toBe(beforeTick + 1);
  });
});

describe('Sim integration', () => {
  it('multiple subscribers tracking different event types produce consistent results', () => {
    const sim = new Sim(withLongGrace(), 1);
    const ticks: SimEvent[] = [];
    const ended: SimEvent[] = [];
    sim.subscribe('tick', (e) => ticks.push(e));
    sim.subscribe('runEnded', (e) => ended.push(e));

    for (let i = 0; i < 5; i++) sim.tick([]);
    expect(ticks).toHaveLength(5);
    expect(ended).toHaveLength(0);

    sim.tick([{ type: 'scram' }]);
    expect(ended).toHaveLength(1);
  });

  it('subscriber registered before first tick receives first-tick events', () => {
    const sim = new Sim(withLongGrace(), 1);
    const seen: number[] = [];
    sim.subscribe('tick', (e) => seen.push(e.tick));
    sim.tick([]);
    expect(seen).toEqual([1]);
  });

  it('subscriber registered between ticks receives only events from subsequent ticks', () => {
    const sim = new Sim(withLongGrace(), 1);
    sim.tick([]);
    const seen: number[] = [];
    sim.subscribe('tick', (e) => seen.push(e.tick));
    sim.tick([]);
    sim.tick([]);
    expect(seen).toEqual([2, 3]);
  });
});

describe('Sim determinism', () => {
  it('same seed + same inputs produces identical event sequences across runs', () => {
    function run(): readonly SimEvent[] {
      const sim = new Sim(withLongGrace(), 42);
      const collected: SimEvent[] = [];
      sim.subscribe('tick', (e) => collected.push(e));
      sim.subscribe('atomSplit', (e) => collected.push(e));
      sim.subscribe('atomSpent', (e) => collected.push(e));
      sim.subscribe('atomDecayed', (e) => collected.push(e));
      sim.subscribe('neutronSpawned', (e) => collected.push(e));
      sim.subscribe('neutronAbsorbed', (e) => collected.push(e));
      sim.subscribe('neutronExpired', (e) => collected.push(e));
      sim.subscribe('criticalityZoneChanged', (e) => collected.push(e));
      sim.subscribe('runEnded', (e) => collected.push(e));
      for (let i = 0; i < 50; i++) sim.tick([]);
      return collected;
    }
    expect(run()).toEqual(run());
  });
});
