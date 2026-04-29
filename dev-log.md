# Reactor — Dev Log

Weekly status, two paragraphs max per entry. Forward-looking notes go under "Planned milestones" — those are tracked, not deadline-driven.

---

## 2026-04-29 — Spec/ADR cleanup before phase 4

Foundation pass between phases 3 and 4. Three new ADRs landed: ADR-016 (same-tick spawn deferral, generalizing the `spawnedAt === state.tick` rule from phase 3 into a precedent for phase 4 and beyond), ADR-017 (post-end input handling, codifying that `state.ended` short-circuits subsequent operations within a phase as a sub-application of ADR-015), and ADR-018 (event payloads are self-contained, generalizing ADR-014's `neutronExpired.reason` precedent into a contract that no subscriber should re-read sim state to act on an event). Spec amendments followed: §2.4 now lists `radius` on `FuelRod` as a per-instance field (mirroring `ControlRod`), §2.4.1 documents the `fuelMix → releaseSchedule` algorithm precisely (fixed key order, evenly-spaced ticks, uniform-disk offsets, all draws threaded through the seeded PRNG), §6.4 notes that SCRAM cleanup is deferred to phases 6 and 7 in subsequent ticks, §8.1 was rewritten from a list of event names into a per-event typed payload schema for all 14 events (with `neutronAbsorbed` and `criticalityZoneChanged` shapes locked now so phase 4 doesn't need a spec amendment to start), and §9 notes that v1 default config values are placeholders pending balance work.

Code migrated to match. `FuelRod.radius` is now on the entity; `applyPlaceFuelRod` populates it from `config.actions.fuelRod.radius` at placement, and `phaseAdvanceFuelRods` reads it per-rod for the candidate-radius check. Event payload emissions in phases 1, 2, 3 were updated to the new typed shapes (full `position`, `velocity`, `type`, `radius` fields where the spec calls for them; entity-disambiguated id field names like `atomId` / `neutronId` instead of bare `id`; `runEnded.outcome` with `finalTick` and `finalScore`; `RunEndReason` union member `'objective'` renamed to `'sustained'` to match the spec). One tiny scope decision worth noting: `runEnded.finalScore` is emitted as `0` from SCRAM today since scoring lives in phases 8+ — when phase 8 lands it will populate from the score field. No phase logic changed; 37 tests still green. Phase 4 (resolve collisions) is the next major piece and gets its own dedicated session — it's the largest sim logic chunk in the project.

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

- **Phase 4 — resolve collisions (next major sim work)** — the next phase to land, and the largest single chunk of sim logic in the project. Dedicated session: spatial query for neutron-vs-atom and neutron-vs-controlRod intersections, fission resolution against per-type `splitChance` / `absorbChance`, neutron-spawn output from splits, control rod durability decrement. Phase order is locked (spec §4.1); the open design questions are spatial structure (uniform grid vs. brute-force at v1 entity counts), tie-break for two neutrons hitting the same atom in the same tick (spec §10 says spawn-order, first hit wins — confirm in code), and how absorption interacts with ADR-016 (a neutron spawned this tick is not collision-eligible until next tick). Event payloads for `atomSplit`, `atomSpent`, `neutronAbsorbed`, `neutronExpired { reason: 'absorbed' }` are already locked in spec §8.1 (2026-04-29 pass) so this session ships against a stable contract.
- **Neutron storage refactor (sim)** — sim spec calls for object pooling from day one for neutrons. The v0 scaffold uses `ReadonlyMap<NeutronId, Neutron>` for clarity while there's no real collision logic to benchmark. The pooled implementation will be a typed-array-backed freelist (parallel arrays for `position.x`, `position.y`, `velocity.vx`, `velocity.vy`, `spawnedAt`, `expiresAt`, plus a free-index stack). **Trigger:** whichever comes first — (a) we start writing real neutron-vs-atom collision logic in `phaseResolveCollisions`, or (b) the perf gate from sim spec §13 (200 atoms + 500 neutrons at 60Hz) starts dropping ticks. Log as a new ADR when we cross it.
- **Schema validation for `SimConfig`** — `loadConfig` currently casts and freezes. When we start writing per-Site config overrides and balance sweeps, we'll need real validation (likely a hand-rolled validator or `valibot` if a runtime dep is justified at that point). Trigger: the first time a malformed config produces a confusing tick-time error instead of a load-time error.
- **Real benchmark suite** — `packages/tools/src/bench.ts` will cover the perf gate in spec §13. Trigger: real sim logic exists to measure. Today it would benchmark a no-op.
- **Tauri packaging config** — deferred until ~month 4 per ADR-008.
