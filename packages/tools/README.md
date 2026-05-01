# @reactor/tools

Headless tooling for Reactor. Depends only on `@reactor/sim` — never on Phaser, never on the DOM. Anything in here must run in plain Node.

## When to add a tool here

- **Balance scripts** — sweep parameters across thousands of seeds, report distributions.
- **Replay verification** — re-run a captured `(seed, inputTimeline)` and confirm the same outcome.
- **Headless benchmarks** — measure ticks/sec for the perf gate from sim spec §13.
- **Data exports** — CSVs of run outcomes, criticality traces, neutron lifetimes.

If a tool needs rendering, it does not belong here. Make it a separate game scene or a debug overlay.

## How to run a balance script

The example: `src/balance.ts` runs one sim for N ticks and prints the outcome as JSON.

```sh
pnpm --filter @reactor/tools run balance              # default: seed=1, ticks=600, mode=raw
pnpm --filter @reactor/tools run balance 42 3600      # seed=42, 60s of sim time, raw mode
pnpm --filter @reactor/tools run balance 42 3600 sim  # same, but driven through the Sim wrapper
```

`balance` is wired in `package.json` as `tsx src/balance.ts`. `tsx` runs TypeScript directly without a build step — fine for tools, not for the shipped game.

### `raw` vs `sim`

The sim package exposes two valid entry points for headless work:

- **Raw functional core** — `createSimState` + `advanceTick`. Pure, deterministic, no subscriber dispatch. Lowest overhead. The right default for parameter sweeps and outcome-only emitters: each call returns the new state and you read `state.pendingEvents` directly when you want them.
- **Sim wrapper class** — `new Sim(config, seed)`, then `sim.tick(inputs)` and `sim.subscribe(type, handler)`. Adds a per-event dispatch step. The right choice when a script needs to observe the event stream as it happens (debug traces, CSV emitters that record per-event detail, replay verification). The renderer in `@reactor/game` is the primary consumer of this interface.

Both produce identical state given the same `(seed, inputs, config)`. The Sim wrapper is a thin convenience layer over the pure functions; the determinism contract from ADR-005 holds either way.

## How to write a new balance script

The shape is always the same. Three steps: load config, run sims in a loop, emit outcomes.

```ts
import { advanceTick, createSimState, loadConfig, type InputCommand } from '@reactor/sim';
import defaultConfig from '@reactor/sim/configs/default.json' with { type: 'json' };

const config = loadConfig(defaultConfig);

// 1. Define your sweep — seeds, parameter overrides, input timelines.
const seeds = Array.from({ length: 1000 }, (_, i) => i + 1);

// 2. Run each sim to completion (or a tick budget).
const outcomes = seeds.map((seed) => {
  let state = createSimState(seed, config);
  const inputs: InputCommand[] = []; // pre-scripted inputs go here
  for (let t = 0; t < 10_000 && !state.ended; t++) {
    state = advanceTick(state, inputs, config);
  }
  return { seed, ticks: state.tick, ended: state.ended?.reason ?? null };
});

// 3. Emit. CSV for spreadsheets, NDJSON for jq, plain JSON for one-offs.
for (const row of outcomes) {
  console.log(`${row.seed},${row.ticks},${row.ended ?? 'timeout'}`);
}
```

### Conventions

- **Imports come from the package entry only.** `@reactor/sim` is fine; `@reactor/sim/src/*` is blocked by ESLint and will fail `pnpm check`. The dependency direction is locked (see ADR-003 and ADR-006).
- **No `Math.random()`.** Seeds are how you reproduce a run. If you need randomness inside a script (e.g., to generate a random input timeline), use `next` from `@reactor/sim` with an explicit seed.
- **Determinism is the contract.** Same `(seed, inputTimeline)` must always produce the same outcome. If a script's results vary across runs, that's a sim bug — file it, don't paper over it.
- **Output to stdout.** Tools print, they don't write files. Pipe to `> outcomes.csv` or `| jq` from the shell. Keeps scripts composable.
- **Fail loud.** If `state.ended` is unexpected, `console.error` and exit non-zero. Silent failures hide real balance regressions.

## Where the perf gate lives

Sim spec §13 calls for 200 atoms + 500 neutrons sustained at 60 ticks/sec on a 2020 MacBook Air. That benchmark belongs in this package as `src/bench.ts` when we have real sim logic to measure. Today it would benchmark a no-op tick loop, which is meaningless.
