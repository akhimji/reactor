# Reactor — Dev Log

Weekly status, two paragraphs max per entry. Forward-looking notes go under "Planned milestones" — those are tracked, not deadline-driven.

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
