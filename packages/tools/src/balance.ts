import { advanceTick, createSimState, loadConfig } from '@reactor/sim';
import defaultConfig from '@reactor/sim/configs/default.json' with { type: 'json' };

// Minimal headless runner. Run a single sim for N ticks and print the outcome
// as JSON. Use as a template for sweeps, replay verification, and CSV emitters
// (see packages/tools/README.md for the pattern).

const seed = Number.parseInt(process.argv[2] ?? '1', 10);
const ticks = Number.parseInt(process.argv[3] ?? '600', 10);

const config = loadConfig(defaultConfig);
let state = createSimState(seed, config);

for (let i = 0; i < ticks; i++) {
  state = advanceTick(state, [], config);
  if (state.ended) break;
}

const outcome = {
  seed,
  ticks: state.tick,
  ended: state.ended?.reason ?? null,
};

console.log(JSON.stringify(outcome));
