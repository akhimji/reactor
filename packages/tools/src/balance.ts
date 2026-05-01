import { advanceTick, createSimState, loadConfig, Sim } from '@reactor/sim';
import defaultConfig from '@reactor/sim/configs/default.json' with { type: 'json' };

// Minimal headless runner. Run a single sim for N ticks and print the outcome
// as JSON. Use as a template for sweeps, replay verification, and CSV emitters
// (see packages/tools/README.md for the pattern).
//
// Two interfaces are valid for headless work:
//   - `raw` (default): createSimState + advanceTick. Lowest overhead — no
//     subscriber dispatch — best for parameter sweeps that don't need to
//     observe per-event detail.
//   - `sim`: Sim wrapper class. Adds subscriber dispatch overhead but lets
//     scripts observe the event stream (useful for debug traces, CSV
//     emitters, replay verification).

const seed = Number.parseInt(process.argv[2] ?? '1', 10);
const ticks = Number.parseInt(process.argv[3] ?? '600', 10);
const mode = process.argv[4] ?? 'raw';

const config = loadConfig(defaultConfig);

let finalTick: number;
let endedReason: string | null;
let finalScore: number;
let observedTickCount: number | null = null;

if (mode === 'sim') {
  const sim = new Sim(config, seed);
  let observed = 0;
  sim.subscribe('tick', () => {
    observed++;
  });
  for (let i = 0; i < ticks; i++) {
    sim.tick([]);
    if (sim.getState().ended) break;
  }
  const state = sim.getState();
  finalTick = state.tick;
  endedReason = state.ended?.reason ?? null;
  finalScore = state.score;
  observedTickCount = observed;
} else {
  let state = createSimState(seed, config);
  for (let i = 0; i < ticks; i++) {
    state = advanceTick(state, [], config);
    if (state.ended) break;
  }
  finalTick = state.tick;
  endedReason = state.ended?.reason ?? null;
  finalScore = state.score;
}

const outcome = {
  seed,
  mode,
  ticks: finalTick,
  ended: endedReason,
  score: finalScore,
  ...(observedTickCount !== null ? { observedTickEvents: observedTickCount } : {}),
};

console.log(JSON.stringify(outcome));
