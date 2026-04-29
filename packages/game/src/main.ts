import { advanceTick, createSimState, loadConfig } from '@reactor/sim';
import defaultConfig from '@reactor/sim/configs/default.json' with { type: 'json' };

// Smoke test the sim wiring at boot. Real Phaser scene + render loop land in
// the next milestone (sim spec §13: minimal Phaser scene with placeholder graphics).
const config = loadConfig(defaultConfig);
const initial = createSimState(Date.now() | 0, config);
const next = advanceTick(initial, [], config);

console.log('[reactor] sim wired:', { initialTick: initial.tick, nextTick: next.tick });
