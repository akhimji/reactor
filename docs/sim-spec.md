# Reactor — Simulation Design Spec v1

**Status:** Draft for review
**Owner:** Claude (chief) + Aly (founder)
**Last updated:** 2026-04-28

This document defines the simulation core that powers Reactor. It is the contract everything else is built against — the renderer, the level designs, the balance scripts, the tools. If something contradicts this spec, this spec wins until it is updated.

---

## 1. Goals and Non-Goals

### Goals
- Model a self-sustaining nuclear reaction with enough realism that the underlying physics rewards player understanding, but enough abstraction that gameplay is fun in 30 seconds.
- Be fully deterministic given a seed and an input timeline. Same inputs always produce the same outputs.
- Be headless and renderer-agnostic. The simulation runs identically in a Phaser scene, a Node.js test harness, or a future educational visualizer.
- Run at 60 ticks per second on a mid-range laptop with 200+ atoms and 500+ neutrons in flight without dropping ticks.
- Expose a clean event stream so the renderer can subscribe without polling state.

### Non-Goals (for v1)
- Realistic neutron physics (cross-sections, moderator effects, delayed neutrons). We model the *flavor* of these, not the equations.
- Multiplayer, networking, or server-authoritative play.
- Procedural Site generation algorithms — the sim supports parameter sets, but generation logic lives in the tools package, not the sim.
- Save/load mid-run state. Runs are atomic. (Persistence of run *results* — high scores, unlocks — is a game concern, not a sim concern.)
- Replay playback UI. The data needed for replays is captured (seed + input timeline), but rendering replays is a future feature.

---

## 2. Core Entities

The simulation has four entity types. Everything else is derived from these.

### 2.1 Atom
A stationary fissile or non-fissile particle on the playfield. Each atom has:
- `id` — unique stable identifier
- `position` — `{ x, y }` in sim-space (not pixels)
- `type` — one of the atom types defined in §3
- `state` — one of `intact`, `excited`, `splitting`, `spent`
- `excitedSince` — tick number when entered `excited` state, or null
- `decaysAt` — tick number when this atom auto-decays, or null

Atoms do not move. Atoms transition between states based on neutron interactions and time.

### 2.2 Neutron
A moving particle that triggers atom interactions. Each neutron has:
- `id` — unique stable identifier
- `position` — `{ x, y }`
- `velocity` — `{ vx, vy }`, magnitude is fixed at spawn (see §6)
- `spawnedAt` — tick number when created
- `expiresAt` — tick number when this neutron's lifetime ends. Neutrons may be removed earlier for other reasons (leaving the playfield, being absorbed); those removals do not modify `expiresAt`.

Neutrons travel in straight lines until they hit an atom or leave the playfield bounds. They do not collide with each other.

### 2.3 Control Rod
A player-placed region that absorbs neutrons within its area of effect. Each rod has:
- `id`
- `position` — center point
- `radius` — area of effect
- `placedAt` — tick number
- `durability` — integer, decremented on each absorption; rod is removed when ≤ 0
- `absorbStrength` — probability (0-1) that any given neutron passing through is absorbed

### 2.4 Fuel Rod
A player-placed bundle that introduces new atoms into the playfield. Each fuel rod has:
- `id`
- `position` — center point
- `placedAt` — tick number
- `releaseSchedule` — array of `{ atTick, atomType, offset }` describing when and where atoms appear
- `exhausted` — boolean, true once all atoms have been released

Fuel rods are how the player adds fuel to a struggling reaction.

---

## 3. Atom Types

V1 ships with these atom types. The set is intentionally small. New types are added in later versions.

| Type | Behavior on neutron hit | Neutrons released | Notes |
|---|---|---|---|
| `U235` | Splits with high probability (`splitChance: 0.85`) | 2-3, random angles | The workhorse fuel. Most plentiful. |
| `U238` | Absorbs neutron, becomes `spent`. Small chance (`splitChance: 0.05`) of splitting. | 0 (absorb) or 2 (split) | Acts as a damper. Mixed in with U235 in low-quality fuel. |
| `Pu239` | Splits with very high probability (`splitChance: 0.95`) | 2-4, random angles | High-yield, rare, unstable. Auto-decays after `decayTicks: 1800` (30s) if not split. |
| `B10` | Absorbs neutron with high probability (`splitChance: 0.0`, `absorbChance: 0.9`) | 0 | Static control material. Player can't add it directly; appears in some Sites as fixed obstacles. |

All `splitChance` and `absorbChance` values are tunable via the data layer (§9).

---

## 4. Tick Model

The simulation advances in discrete fixed-rate ticks. The tick rate is `60Hz` (16.67ms per tick), independent of render frame rate.

### 4.1 Tick Order
Each tick executes in this exact order:

1. **Process player input queue** — apply any commands submitted since the last tick
2. **Advance fuel rod schedules** — release any atoms scheduled for this tick
3. **Advance neutrons** — move each neutron by its velocity vector
4. **Resolve collisions** — for each neutron, check against atoms and control rods
5. **Apply collision results** — update atom states, spawn new neutrons, decrement rod durability
6. **Advance atom states** — handle state transitions (`splitting` → `spent`, `excited` → `intact` if no follow-up)
7. **Advance auto-decay** — atoms past their `decaysAt` decay; spent atoms past cleanup threshold are removed
8. **Recompute criticality** — derive criticality factor from current population (§5)
9. **Check end conditions** — meltdown, extinction, objective met
10. **Emit events** — flush queued events to subscribers

This order is not negotiable. Changing it changes determinism.

### 4.2 Determinism
- All randomness uses a single seeded PRNG threaded through the sim.
- The PRNG is seeded once at run start.
- Player input is timestamped by tick number, not wall clock.
- Floating-point math is allowed but must use deterministic operations (no `Math.random()`, no `performance.now()`-based timing inside sim logic).
- Given `(seed, inputTimeline)`, the sim produces identical state at every tick across runs and machines.

---

## 5. Criticality

Criticality is the single most important number in the game. It drives the game state, the win/lose conditions, and the player's moment-to-moment tension.

### 5.1 Definition
At any tick, criticality `k` is computed as a rolling average of neutrons-per-second produced by fission events over the last `criticalityWindow` ticks (default: 120 ticks = 2 seconds).

```
k = (neutrons_produced_in_window) / (window_seconds * baselineNeutronRate)
```

Where `baselineNeutronRate` is a tunable constant (default: 8 neutrons/sec) representing the threshold of self-sustaining reaction.

- `k < 1.0` — subcritical (reaction dying)
- `k = 1.0` — exactly self-sustaining
- `k > 1.0` — supercritical (reaction accelerating)

### 5.2 Zones
The criticality value falls into named zones, exposed to the renderer for UI:

| Zone | Range | Meaning |
|---|---|---|
| `extinct` | `k < 0.1` | Reaction has effectively died |
| `subcritical` | `0.1 ≤ k < 0.9` | Below sustaining; reaction will die without intervention |
| `nominal` | `0.9 ≤ k ≤ 1.1` | The green zone. Score accumulates here. |
| `supercritical` | `1.1 < k ≤ 1.5` | Above sustaining; danger zone but salvageable |
| `runaway` | `1.5 < k ≤ 2.0` | Imminent meltdown; emergency action required |
| `meltdown` | `k > 2.0` | Game over |

Zone boundaries are tunable.

### 5.3 Score
Score accumulates per tick the reactor is in `nominal`. Score also includes a multiplier for time spent near the edges of nominal (rewarding skilled play near boundaries vs. coasting in the middle). Specifics in §9.

---

## 6. Player Actions

The player has exactly four action types in v1. Each action is a command submitted to the sim with parameters, processed in tick order (§4.1).

### 6.1 `injectNeutron`
- **Params:** `{ position, direction }`
- **Effect:** Spawns one neutron at `position` moving in `direction` at `defaultNeutronSpeed`.
- **Cost / cooldown:** Cooldown of `injectCooldown` ticks (default: 30 ticks = 0.5s).
- **Use case:** Kickstart a reaction or extend a dying one.

### 6.2 `placeControlRod`
- **Params:** `{ position }`
- **Effect:** Creates a control rod at `position` with default `radius`, `durability`, and `absorbStrength`.
- **Cost / cooldown:** Limited inventory per Site; some Sites grant 0 control rods.
- **Use case:** Dampen a runaway reaction in a localized area.

### 6.3 `placeFuelRod`
- **Params:** `{ position, fuelMix }`
- **Effect:** Creates a fuel rod at `position` that releases atoms over time according to a release schedule derived from `fuelMix`.
- **Cost / cooldown:** Limited inventory per Site.
- **Use case:** Add fuel to keep the reaction going.

### 6.4 `scram`
- **Params:** none
- **Effect:** All in-flight neutrons decay immediately. All atoms enter `spent` state. Reaction stops.
- **Cost / cooldown:** Single use per Site, or long cooldown in endless mode.
- **Use case:** Panic button. Saves the reactor from meltdown but ends the run as a "stabilized" outcome.

---

## 7. Win/Lose Conditions

### 7.1 Lose
- **Meltdown:** `k > 2.0` for any tick → run ends, marked as `meltdown`.
- **Extinction:** `k < 0.1` for `extinctionGracePeriod` ticks (default: 300 ticks = 5s) → run ends, marked as `extinction`.

### 7.2 Win (per Site)
Each Site defines its own objective. V1 supports these objective types:
- **`sustain`** — Stay in `nominal` for at least `targetSeconds` cumulative seconds.
- **`yield`** — Generate at least `targetEnergy` total energy (energy = sum of fission events × per-type yield).
- **`survive`** — Last for `targetSeconds` real-time seconds without meltdown or extinction.

Endless mode has no win condition. Run continues until lose condition triggers. Score is the meta.

### 7.3 SCRAM Outcome
Using `scram` ends the run as a `stabilized` outcome. In Site mode, this counts as a partial completion (no progression unlock, but no failure either). In endless mode, it ends the score run.

---

## 8. Event Stream

The simulation emits events for the renderer to subscribe to. Events are the only way the renderer learns about state changes — it never polls.

### 8.1 Event Types
- `tick` — every tick, with current criticality and zone
- `atomSpawned` — new atom appears (from fuel rod release)
- `atomSplit` — atom transitions to `splitting`
- `atomSpent` — atom enters `spent` state
- `atomDecayed` — atom auto-decayed without splitting
- `neutronSpawned` — new neutron in flight
- `neutronAbsorbed` — neutron absorbed by atom or control rod
- `neutronExpired` — emitted when a neutron is removed from the simulation. Payload: `{ neutronId, tick, reason: 'expired' | 'out-of-bounds' | 'absorbed' }`.
- `controlRodPlaced` — player placed a rod
- `controlRodDepleted` — rod durability reached 0
- `fuelRodPlaced` — player placed a fuel rod
- `fuelRodExhausted` — fuel rod released all atoms
- `criticalityZoneChanged` — k crossed a zone boundary
- `runEnded` — meltdown, extinction, sustained objective met, or SCRAM

### 8.2 Event Schema
Every event has:
- `type` — string, one of the above
- `tick` — tick number when emitted
- `data` — type-specific payload

Events are emitted in tick-order batches. The renderer receives them after the tick completes, so all state is consistent when handlers run.

---

## 9. Tunable Parameters

Every magic number in the sim is exposed via a config object loaded from JSON. Default values shipped in `packages/sim/configs/default.json`.

Categories:
- **Tick rates** — `tickHz`, `criticalityWindow`
- **Atom behaviors** — per-type `splitChance`, `absorbChance`, `neutronsPerSplit`, `decayTicks`, `yield`
- **Neutron behaviors** — `defaultNeutronSpeed`, `neutronLifetimeTicks`
- **Criticality** — `baselineNeutronRate`, all zone boundaries
- **Player actions** — all cooldowns, inventory defaults, control rod stats
- **End conditions** — `meltdownThreshold`, `extinctionThreshold`, `extinctionGracePeriod`
- **Scoring** — base rate, edge multipliers

Per-Site overrides layer on top of the default config. Balance changes are pure data, never code.

---

## 10. Invariants and Edge Cases

The simulation upholds these invariants. Violating them is a bug.

- Neutron count, atom count, and control rod count are always non-negative.
- No atom is referenced after it transitions to a removed state.
- No neutron is referenced after it expires.
- Total energy released is monotonically non-decreasing.
- Tick number is monotonically increasing by exactly 1.
- The PRNG is called the same number of times for the same `(seed, inputTimeline)` regardless of subscriber behavior.

Edge cases handled explicitly:
- Two neutrons arriving at the same atom in the same tick: resolved in spawn-order; first hit wins.
- Neutron spawning inside a control rod: subject to absorption check on next tick, not spawn tick.
- Player submits action with invalid params: action is rejected silently and not added to input timeline.
- Fuel rod releases atom on top of existing atom: new atom is offset by `minAtomSpacing`; if no valid offset within radius, release is skipped.

---

## 11. What's Out of Scope for v1

Explicitly deferred. Do not build these into the v1 sim, even if it would be easy.

- Heat / temperature as a separate resource
- Coolant systems
- Moderator placement (water, graphite tiles)
- Delayed neutrons / multi-step decay chains
- Reactor poisoning (Xenon-135 etc.)
- Player-controlled neutron deflection
- Multi-reactor scenarios
- Time controls (pause, slow-mo, fast-forward)
- Difficulty modifiers (those live in Site configs as parameter overrides)
- Achievements / unlocks (game layer, not sim)

These are good ideas. Some will appear in v2+. None belong in v1.

---

## 12. Open Questions

Things this spec does not resolve. Resolve before sim-core construction begins.

1. **Coordinate system** — sim-space units. Pixels? Abstract units? Recommendation: abstract (1 unit = ~one atom diameter), with pixel mapping in the renderer.
2. **Playfield bounds** — fixed rectangle? Configurable per Site? Recommendation: configurable, with a default for endless.
3. **Atom spawn density limits** — what's the max atoms per Site before perf becomes a concern? Needs benchmarking.
4. **PRNG library** — `seedrandom`, custom xorshift, or other. Recommendation: lightweight custom xorshift, ~20 lines, zero deps.
5. **Event delivery** — synchronous callbacks or queue-based? Recommendation: queue-based, flushed at end of tick.

---

## 13. Acceptance Criteria for v1

The sim core is "done" when:

- All entities, actions, and events listed above are implemented.
- Vitest tests cover: deterministic replay, criticality calculation, win/lose conditions, all four action types, all event types.
- A headless balance script can run 1000 simulated games with parameter sweeps and emit a CSV of outcomes.
- A minimal Phaser scene can subscribe to events and render a playable game with placeholder graphics.
- Performance benchmark: 200 atoms + 500 neutrons sustained at 60 ticks/sec on a 2020 MacBook Air.

---

*End of v1 spec. Updates require a new ADR in `DECISIONS.md`.*
