# Architecture Decision Log

This document records every meaningful architecture and product decision made on Reactor, with reasoning and alternatives considered. Append-only — never delete entries, only supersede them with new ones referencing the old.

## Format

Each entry follows this structure:

- **Date** — when the decision was made
- **Decision** — what we decided
- **Context** — what problem this solves
- **Alternatives** — what else we considered and why we didn't pick them
- **Consequences** — what this commits us to, both good and bad

---

## ADR-001: Product shape — premium indie game

- **Date:** 2026-04-27
- **Decision:** Reactor will be a premium single-purchase game, $5-10 price point, sold on itch.io and Steam with a web demo for discovery.
- **Context:** Aly is bootstrapping nights/days alongside a day job, targeting $10-50k/year, and prefers tech and data work to live-ops or sales. Need a product shape that fits those constraints.
- **Alternatives:**
  - *F2P mobile* — rejected. Demands user acquisition spend, daily live-ops, retention grinding. Doesn't fit solo bootstrap or stated preferences.
  - *Platform / IP play* — rejected. Multi-year venture-scale effort. Doesn't fit timeline or capital.
- **Consequences:** Optimizing for craft and depth over retention metrics. Marketing burden is lighter (no UA spend) but discovery is harder (Steam wishlists become primary funnel). Revenue ceiling is bounded by copies × price, but downside is also bounded.

---

## ADR-002: Tech stack — TypeScript + Phaser 3 + Vite + Tauri

- **Date:** 2026-04-27
- **Decision:** Build with TypeScript, Phaser 3 for rendering, Vite for tooling, Vitest for tests, Tauri for desktop packaging. Plain HTML/CSS for menu UI (no React).
- **Context:** Solo dev shipping in 3-6 months with strong TS/infra background and local LLM tooling for agentic coding. Need a stack that maximizes velocity and works well with AI-assisted workflows.
- **Alternatives:**
  - *Unity + C#* — rejected for this project. Larger job market and asset store, but editor-driven workflow is harder to drive agentically and overkill for 2D arcade scope.
  - *Godot* — strong second choice. Open source, nice 2D pipeline, but smaller ecosystem and less mature TS/AI tooling integration.
  - *PixiJS + custom stack* — more flexible than Phaser but more work. Phaser is the right velocity choice for 6-month solo ship.
  - *Electron for packaging* — rejected. 100MB+ bundles vs Tauri's ~10MB. Steam users notice install size.
- **Consequences:** Web-native build is essentially free (huge for playtesting via shareable URL). Cross-compilation to Windows/macOS/Linux desktop via Tauri. Locked into JS/TS ecosystem for game logic. If we ever need 3D or heavy physics, this stack is wrong — but we don't.

---

## ADR-003: Architecture — three-layer separation (presentation / sim / data)

- **Date:** 2026-04-27
- **Decision:** Strict separation between presentation (Phaser), simulation core (pure TS), and data/tuning (JSON configs). Presentation subscribes to sim events and sends commands. Sim never knows about Phaser. Data is external to code.
- **Context:** The simulation is the differentiator for this product. It must be testable in isolation, deterministic, and reusable across renderers and contexts (game, balance scripts, future educational version).
- **Alternatives:**
  - *Tightly coupled sim + render in one Phaser scene* — rejected. Faster to start, much harder to test and balance. Standard solo-dev mistake.
  - *Server-authoritative simulation* — rejected. Overkill for single-player offline game and adds infrastructure we don't need.
- **Consequences:** Slightly more upfront architecture work. Headless testing becomes possible. Replays come nearly free. Multiple front-ends are possible later (debug visualizer, educational version, sandbox mode). Renderer can interpolate between fixed-rate sim ticks for smooth visuals.

---

## ADR-004: Sim state — plain immutable objects, not ECS

- **Date:** 2026-04-27
- **Decision:** Simulation state is a plain object tree with immutable updates. Not an entity-component-system architecture.
- **Context:** ECS shines with thousands of entities and complex behavior compositions. Reactor will have hundreds of entities max and 3-4 entity types.
- **Alternatives:**
  - *ECS (bitecs, miniplex, etc.)* — rejected for v1. Adds complexity we don't need at this scale and makes code harder for LLMs to reason about cleanly. Revisit only if performance requires it.
- **Consequences:** Simpler code, easier reasoning, easier AI-assisted edits. If we ever need to scale to thousands of entities, we'll need to refactor — but the three-layer architecture (ADR-003) makes that contained to the sim package.

---

## ADR-005: Determinism and seeded PRNG

- **Date:** 2026-04-27
- **Decision:** All randomness in the simulation uses a seeded PRNG. Never `Math.random()`. Fixed tick rate (60Hz). Same seed + same inputs always produces the same result.
- **Context:** Determinism enables headless balance testing, replays, reproducible bug reports, and future features like spectator mode or competitive leaderboards with verification.
- **Alternatives:**
  - *Non-deterministic with `Math.random()`* — rejected. Impossible to debug, no replays, no automated balance testing.
- **Consequences:** Slightly more discipline required (must thread PRNG through sim code). All future features that depend on determinism (replays, leaderboards, headless testing) come essentially free.

---

## ADR-006: Repo structure — monorepo with workspaces

- **Date:** 2026-04-27
- **Decision:** Single GitHub repo with npm/pnpm workspaces. Packages: `packages/sim` (zero deps), `packages/game` (depends on sim), `packages/tools` (balance scripts, replay viewer, depends on sim only).
- **Context:** Multiple deliverables share the simulation core. Need clear dependency direction enforced by tooling.
- **Alternatives:**
  - *Multiple repos* — rejected. Overhead for solo dev, harder to coordinate changes across sim and game.
  - *Single package, no workspaces* — rejected. Loses the dependency-direction enforcement that protects ADR-003.
- **Consequences:** Slightly more setup. Sim package can be published or extracted later if useful. Tools and game both stay aligned with sim API.

---

## ADR-007: Theme — post-collapse engineer

- **Date:** 2026-04-27
- **Decision:** The setting is post-apocalyptic. The player is a lone engineer keeping reactors alive in a ruined world. Pixel art aesthetic, atmospheric, story told through environmental detail and short log entries.
- **Context:** Three themes were considered: Cold War scientist, post-collapse engineer, deep space engineer. Theme drives art direction, narrative, and what atom types and failure modes make sense in the simulation.
- **Alternatives:**
  - *Cold War scientist (1940s-50s historical)* — rejected. Educational angle is interesting but constrains creative direction and audience is narrower.
  - *Deep space engineer (sci-fi colony ship)* — rejected. More original art direction required and competes with high-polish sci-fi games.
- **Consequences:** Visual proof-of-concept already exists (loading screen). Pre-sold audience on Steam. The mechanic — sustaining a reaction in a dying world — is a tight thematic match. Risk: post-apoc pixel art is crowded; differentiation comes from real physics depth, not aesthetic alone.

---

## ADR-008: Windows test environment — local ESX lab

- **Date:** 2026-04-27
- **Decision:** Windows builds will be tested on a Windows VM in Aly's existing VMware ESX/vCenter lab. No external Windows hardware required.
- **Context:** Steam revenue is ~96% Windows. Tauri cross-compiles, but final QA on actual Windows is required before launch.
- **Alternatives:**
  - *Cloud Windows VM (e.g., AWS, Azure)* — rejected. Adds cost and friction for something we already have on-prem.
  - *Windows hardware purchase* — rejected. Unnecessary capex.
- **Consequences:** Zero additional cost or external dependency. Windows VM provisioning deferred until ~month 4 when we start packaging.

---

## ADR-009: Package manager — pnpm

- **Date:** 2026-04-28
- **Decision:** pnpm is the package manager for the monorepo, pinned via `packageManager` in root `package.json` and Node engines `>=22.0.0`. Activated locally through Corepack.
- **Context:** ADR-006 left npm vs pnpm open. We need a choice that mechanically protects the dependency direction set by ADR-003: `packages/sim` must not gain phaser as a transitive dep, `packages/game` must only see `@reactor/sim`'s public exports, etc.
- **Alternatives:**
  - *npm workspaces* — rejected. Hoists aggressively; a package can import a transitively-installed dep it never declared. That silently breaks ADR-003 boundaries.
  - *Yarn (Berry)* — rejected. PnP and zero-installs add operational surface area we don't need for a solo project.
  - *Bun* — interesting but immature for this stack. Vite, Vitest, and Phaser tooling all assume Node + pnpm/npm conventions today.
- **Consequences:** Strict isolated `node_modules` per package by default. CI uses `pnpm install --frozen-lockfile` so the lockfile is the contract. Contributors need Corepack enabled (`corepack enable`) — documented in `dev-log.md` as part of setup. No global pnpm install required.

---

## ADR-010: TypeScript project references

- **Date:** 2026-04-28
- **Decision:** Each package has `composite: true` and the root `tsconfig.json` declares project references to `packages/sim`, `packages/game`, `packages/tools`. Game and tools both reference sim.
- **Context:** ADR-003 mandates strict separation. Project references give us mechanical enforcement at the TypeScript level: a package can only import declared references, and `tsc -b` builds in dependency order. They also enable incremental builds, which matters when the sim package compiles a lot during development.
- **Alternatives:**
  - *No project references, pnpm workspaces only* — rejected. Pnpm enforces the runtime dep graph but TS can still cross boundaries via relative imports (`../../sim/src/foo`). Project refs close that hole.
  - *Single root `tsconfig.json` with `paths`* — rejected. Path aliases hide the dependency graph and make it harder to extract `@reactor/sim` as its own package later.
- **Consequences:** Slightly more config surface (one extra `tsconfig` per package). `tsc -b` is the canonical typecheck and build command. Game uses `composite: false` because nothing depends on it; that's an explicit exception, not an oversight. ESLint additionally enforces "import only from `@reactor/sim` package entry, never `/src/*`" so neither tool nor TS can be bypassed.

---

## ADR-011: ESLint flat config (v9)

- **Date:** 2026-04-28
- **Decision:** ESLint 9 with the flat config format (`eslint.config.js` at repo root). Single root config with file-scoped overrides for `packages/sim/src/**`, `packages/game/src/**`, and `packages/tools/src/**`.
- **Context:** Linting is where we encode the boundary rules from ADR-003 that TypeScript and pnpm don't already cover — `no-restricted-imports` patterns blocking `phaser` from sim and blocking `@reactor/sim/src/*` deep-imports from game and tools.
- **Alternatives:**
  - *Legacy `.eslintrc` + `overrides`* — rejected. Deprecated as of ESLint 9; we'd be adopting it just to migrate it later.
  - *Biome* — interesting (single tool for lint + format, faster) but its `no-restricted-imports` story is weaker and the typescript-eslint type-aware rules don't have equivalents yet.
- **Consequences:** One config file, flat array, predictable override precedence. Type-aware linting via `projectService` so rules can reason about TS types. Pre-commit hooks not added (per scaffold plan); CI is the gate.

---

## ADR-012: PRNG — custom xorshift32

- **Date:** 2026-04-28
- **Decision:** The simulation uses a hand-rolled xorshift32 PRNG implemented in `packages/sim/src/prng.ts`. Pure functional API: `next(state) → [value, nextState]`. Seeded with a 32-bit integer; zero seeds map to a non-zero fallback constant.
- **Context:** Sim spec §12.4 left this open. The sim package is constrained to zero runtime deps (ADR-006 / ADR-003), so we either pull in a 50-line library or write 50 lines ourselves. xorshift32 is simple, deterministic across platforms, and fast enough — neutron-volume reactor sims don't need cryptographic quality.
- **Alternatives:**
  - *`seedrandom`* — rejected. Adds a runtime dep to a package that's supposed to have none. Larger than the algorithm we're shipping.
  - *Mulberry32 / sfc32 / pcg32* — viable. xorshift32 was picked for minimal code size; if statistical quality becomes an issue (e.g., visible bias in long balance sweeps), upgrading to sfc32 is a localized change behind the same `next()` signature.
  - *`Math.random`* — categorically rejected by ADR-005.
- **Consequences:** Determinism guarantee from ADR-005 holds across machines because xorshift32 only uses 32-bit integer ops, no `Math.fround`/`Math.random`/floats with platform-dependent precision. PRNG state is part of `SimState` and threaded through every randomness call — no module-level mutable state. If we ever need a second independent stream (e.g., rendering RNG that doesn't perturb sim), we instantiate a second `PRNGState`.

---

## ADR-013: Playfield bounds — centered 100×100 abstract units (default)

- **Date:** 2026-04-28
- **Decision:** Default playfield is `{ minX: -50, minY: -50, maxX: 50, maxY: 50 }` in sim-space units (~one atom diameter, per spec §12.1). Boundary is inclusive — a neutron exactly at `maxX` is still on the field. Out-of-bounds detection lives in `phaseAdvanceNeutrons` and is the only consumer of `config.playfield.bounds` today. Per-Site overrides will layer on top via the existing `SimConfig` per-Site mechanism (spec §9).
- **Context:** Sim spec §12.2 left bounds as an open question with the recommendation "configurable per Site, with a default for endless." Phase 3 (advance neutrons) needs concrete bounds to detect out-of-bounds neutrons; we cannot ship the phase without picking a default.
- **Alternatives:**
  - *Origin-anchored `(0,0)..(100,100)`* — rejected for sim space. A reactor is symmetric around its center; placing the center at `(0,0)` makes random angles produce balanced distributions and lets per-Site geometry be expressed without offset arithmetic. Renderer maps sim-space → screen-space with one offset+scale, so origin-anchored vs centered makes no difference downstream.
  - *Larger field (200×200) or non-square aspect* — deferred. 100 abstract units is a reasonable starting density we can grow per Site. We don't yet have benchmarks telling us this is too cramped or too sparse.
- **Consequences:** Atoms placed at `(0,0)` sit at reactor center, matching the visual model. Boundary check is `position < min || position > max` — strictly inside is `min ≤ position ≤ max`. When Sites land, larger or smaller fields ship as overrides; the default stays. Tie-break for a neutron that both expires and crosses the bound on the same tick: expiration wins (lifetime is the more deterministic property). If we change the tie-break, log a new ADR.