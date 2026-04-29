# Reactor — Dev Log

Weekly status, two paragraphs max per entry. Forward-looking notes go under "Planned milestones" — those are tracked, not deadline-driven.

---

## 2026-04-28 — Phases 1+2 (process inputs, advance fuel rods) land

Phase 1 covers all four input commands: `injectNeutron`, `placeControlRod`, `placeFuelRod`, `scram`. Cooldowns (`{ injectNeutron }`) and inventory (`{ controlRods, fuelRods, scramAvailable }`) now live on `SimState`, sourced from new `actions.controlRod.inventoryDefault`, `actions.fuelRod.{ radius, releaseDuration, inventoryDefault }`, and `actions.scram.availableDefault` config fields. Invalid commands are dropped silently per spec §10. SCRAM sets `state.ended = 'stabilized'` and short-circuits subsequent inputs in the same tick. Phase 3 was extended by one line to skip neutrons whose `spawnedAt` equals the current tick — newly-spawned neutrons sit at the spawn position for one tick before moving, which honors the "phase 3 cleans up on the next tick" pre-decision and gives the renderer a stable spawn frame. Phase 2 walks each rod's `releaseSchedule`, releases atoms whose `atTick` matches the current tick, runs an 8-candidate spacing-aware offset adjustment (PRNG-seeded rotation for determinism), skips releases that have nowhere to land, and emits `fuelRodExhausted` exactly once when the rod transitions to exhausted. Spent rods stay in state for phase 7 cleanup later.

Spec amendments and ADRs cleaned up the contract while we were here. Sim spec §2.2 now says `expiresAt` means "lifetime end" and is never written to by other removal paths. §8.1 says `neutronExpired` carries `reason: 'expired' | 'out-of-bounds' | 'absorbed'` (the third one is forward-looking, for phase 4/5 collision absorption). ADR-013's tie-break reasoning was tightened from "integer-tick-deterministic" to "causal priority — a neutron at lifetime end is definitionally gone before any location check." ADR-014 makes event schema changes a spec amendment, not silent code drift; ADR-015 establishes that fields have one meaning and removals are operations, not field overloads. Test count went from 14 → 37 (15 phase-1 tests, 8 phase-2 tests). Phases 4–10 remain, with phase 4 (resolve collisions) being the next major piece — phases 5–10 are smaller in scope.

---

## 2026-04-28 — Phase 3 (advance neutrons) lands

First real sim logic. Pure motion: `position += velocity` each fixed-rate tick. Neutrons crossing playfield bounds (ADR-013, centered 100×100) are removed and emit `neutronExpired { reason: 'out-of-bounds' }`. Neutrons past `expiresAt` are removed with `reason: 'expired'`. The `reason` field refines sim spec §8.1 — flag for spec doc update on the next pass. Tests cover motion, both removal paths, inclusive boundary, expiration-wins tie-break, determinism over 30 ticks, input-state immutability, no-op when empty, and event append. 10 new tests, all green.

---

## 2026-04-28 — Scaffolding sprint

Repo is scaffolded. pnpm workspaces with `packages/{sim,game,tools}`; TypeScript strict + project references; ESLint 9 flat config with sim/game/tools boundary rules; Vitest for sim and tools; Vite for game shell; GitHub Actions CI running `pnpm check` (typecheck + lint + test) on every push and PR. Sim core is a 10-phase tick skeleton over plain immutable state, with all entity types, the event union, the input command union, and the `SimConfig` shape from sim-spec.md. Default config file populated with placeholder values consistent with the spec; smoke tests pass on tick advancement, determinism placeholder, and PRNG reproducibility.

ADRs 009-012 added covering pnpm, TS project references, ESLint flat config, and the xorshift32 PRNG choice. No real game logic yet — that's the next deliverable. Setup note for any new machine: `corepack enable` activates the pinned pnpm version; `pnpm install` then `pnpm check` verifies the toolchain.

---

## Planned milestones

These are known migrations or upgrades that have a clear trigger. They are not fire drills — when we cross the trigger, log the decision in `DECISIONS.md` as a new ADR and proceed.

- **Neutron storage refactor (sim)** — sim spec calls for object pooling from day one for neutrons. The v0 scaffold uses `ReadonlyMap<NeutronId, Neutron>` for clarity while there's no real collision logic to benchmark. The pooled implementation will be a typed-array-backed freelist (parallel arrays for `position.x`, `position.y`, `velocity.vx`, `velocity.vy`, `spawnedAt`, `expiresAt`, plus a free-index stack). **Trigger:** whichever comes first — (a) we start writing real neutron-vs-atom collision logic in `phaseResolveCollisions`, or (b) the perf gate from sim spec §13 (200 atoms + 500 neutrons at 60Hz) starts dropping ticks. Log as a new ADR when we cross it.
- **Schema validation for `SimConfig`** — `loadConfig` currently casts and freezes. When we start writing per-Site config overrides and balance sweeps, we'll need real validation (likely a hand-rolled validator or `valibot` if a runtime dep is justified at that point). Trigger: the first time a malformed config produces a confusing tick-time error instead of a load-time error.
- **Real benchmark suite** — `packages/tools/src/bench.ts` will cover the perf gate in spec §13. Trigger: real sim logic exists to measure. Today it would benchmark a no-op.
- **Tauri packaging config** — deferred until ~month 4 per ADR-008.
