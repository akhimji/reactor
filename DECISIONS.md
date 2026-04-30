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
- **Consequences:** Atoms placed at `(0,0)` sit at reactor center, matching the visual model. Boundary check is `position < min || position > max` — strictly inside is `min ≤ position ≤ max`. When Sites land, larger or smaller fields ship as overrides; the default stays. Tie-break for a neutron that both expires and crosses the bound on the same tick: expiration wins. Causal priority — a neutron at its lifetime end is definitionally gone; whether it also happens to be out of bounds at that moment is a property of its location, not its existence. Lifetime expiration takes precedence because the neutron ceasing to exist precedes any check about where it is. If we change the tie-break, log a new ADR.

---

## ADR-014: Event schema refinement principle

- **Date:** 2026-04-28
- **Decision:** Event payloads are part of the spec contract. When implementation reveals an event needs a richer or more typed payload than v1 captured, the change is a spec amendment (sim-spec.md §8) and a new ADR if it changes meaning, not a silent code drift. Code and spec move together.
- **Context:** Phase 3 implementation revealed `neutronExpired` needed a `reason` field to be useful to the renderer. We added it in code and flagged it for a later spec pass — that lag created a window where code and spec disagreed on the contract. Future phases will surface similar payload questions (e.g., `atomSplit` carrying neutron-spawn data, `runEnded` carrying score/duration). We need a standing rule before that compounds.
- **Alternatives:**
  - *Code is the source of truth, spec is best-effort* — rejected. The spec is the contract for the renderer, balance scripts, replays, and any future second renderer. If it drifts, those consumers break in non-obvious ways.
  - *Freeze event payloads at spec v1, never refine* — rejected. We'd accumulate ad-hoc side channels (state polling, separate event streams) instead of evolving the schema cleanly.
- **Consequences:** Adding or changing a field on any `SimEvent` variant requires (a) the spec change in §8, (b) a brief ADR if semantics changed, (c) the type change in `events.ts`, and (d) renderer/test updates. Slight friction on each event change, but consumers can rely on the spec.

---

## ADR-015: State field semantics — fields have one meaning

- **Date:** 2026-04-28
- **Decision:** Every field on a sim entity has exactly one meaning. State changes happen through dedicated operations and dedicated fields, never by overloading an existing field with a second meaning. `Neutron.expiresAt` is the canonical example: it means "tick when this neutron's lifetime ends," and removal for any other reason (out-of-bounds, absorption) does not write to `expiresAt`.
- **Context:** Phase 3 surfaced the question of whether out-of-bounds removal should set `expiresAt = currentTick` to mark the neutron as gone. That would conflate two distinct facts ("when does its lifetime end" and "when did we remove it") into one field. The right model is: lifetime end is a property; removal for other reasons is an operation that filters the entity out of state without touching properties.
- **Alternatives:**
  - *Overload fields for compactness* — rejected. Saves a field at the cost of every reader having to know the overload. Bug magnet, especially when entities are inspected mid-pipeline.
  - *Add a separate `removedAt` / `removalReason` field on every entity* — rejected for v1. Removed entities are filtered out of state in the same tick; we don't keep removed entities around to inspect. The reason travels in the event payload (ADR-014), which is the right channel.
- **Consequences:** Future entity field design starts from "what does this field mean?" If you want to express two things, that's two fields or a separate operation. Any future field that looks like it's serving multiple purposes is a smell — flag it in review. Applies to atoms (`state`, `excitedSince`, `decaysAt` are each one fact), control rods (`durability`), and fuel rods (`exhausted`).

---

## ADR-016: Same-tick spawn deferral

- **Date:** 2026-04-29
- **Decision:** When a phase creates an entity within a tick, later phases in the same tick must skip that entity if their job is to advance, expire, or remove it. The canonical predicate is `entity.spawnedAt === state.tick` — newly-spawned entities are deferred to the next tick before they become subject to lifecycle phases. Phase 3 (advance neutrons) already implements this for neutrons spawned by phase 1; the rule generalizes to all future phases that pair a creator with an advancer/cleanup in the same tick.
- **Context:** Sim spec §4.1 defines a fixed phase order within each tick. Phase 1 (process inputs) and phase 3 (advance neutrons) both run inside one tick. Without explicit deferral, a neutron spawned by phase 1 would be advanced and possibly removed by phase 3 in the same tick — meaning the entity could be created and destroyed before any subscriber observes its existence. That breaks the pre-decision that "phase 3 cleans up out-of-bounds spawns the next tick" and denies the renderer a stable spawn frame for setup (sprite creation, particle attach, audio cue).
- **Alternatives:**
  - *Allow same-tick lifecycle* — rejected. Saves one tick of latency at the cost of an unobservable entity window. Subscribers would need to special-case "spawned and removed in the same tick" events to know when to skip animation setup. The complexity moves out of sim into every consumer.
  - *Reorder phases so creators always come after destroyers* — rejected. Spec §4.1 phase order is locked for determinism reasons (ADR-005); reordering for one entity type breaks others. And the order in §4.1 is the natural causal order — input → fuel release → neutron advance → collision — reordering would invert it.
  - *Track a separate "observable" flag per entity* — rejected. Field semantics rule (ADR-015): the deferral is a property of when the entity was created, not a separate fact. `spawnedAt === state.tick` is already the right predicate.
- **Consequences:** Phases within a tick respect causal ordering. Renderer always sees a spawn event one tick before any movement or removal event for that entity. Phase 4 (resolve collisions) inherits this: a neutron created by phase 1 in tick N cannot be checked for collision until tick N+1; an atom released by phase 2 in tick N is collision-eligible immediately because phase 4 runs after phase 2 in the same tick — but the *atom-spawned-this-tick* case still needs care for any phase that would remove the atom (e.g., a future poisoning mechanic). The deferral is one tick of cosmetic latency; the architectural cleanliness is permanent. If a future phase needs to opt out (e.g., a collision that should be resolved in the spawn tick), log a new ADR.

---

## ADR-017: Post-end input handling

- **Date:** 2026-04-29
- **Decision:** Once `state.ended` is set within a phase, any subsequent operations in that same phase that would mutate state are dropped silently. No event is emitted for the dropped operation; no inventory or cooldown is touched. This applies to all phases that mutate state in a loop where an earlier iteration could end the run. Phase 1's input loop is the present-day case (a SCRAM followed by other commands in the same tick); the rule generalizes to every future phase that does the same.
- **Context:** Phase 1 implements this today: after `applyScram` sets `state.ended = { reason: 'stabilized' }`, the input loop short-circuits and remaining commands in the batch are not applied. But there's no decision logged saying *why* — and as more phases land that can end the run mid-iteration (phase 8 hits a meltdown threshold, phase 9 detects extinction), each one needs the same rule. Without a written precedent, each phase risks a different choice.
- **Alternatives:**
  - *Keep applying mutations after end-of-run* — rejected. State changes after `ended` is set are wasted churn, and any inventory/cooldown updates emitted post-end create misleading state for the renderer (e.g., a `controlRodPlaced` event after `runEnded` would imply the rod is live). It also masks bugs: a phase that "works" by overwriting end state silently is impossible to debug.
  - *Throw on post-end mutation* — rejected. Real workloads can submit a batch of inputs that include both a SCRAM and follow-up commands; treating that as a fatal error punishes legitimate input timelines (and replays). Silent drop is the spec §10 idiom for invalid commands; extending it to post-end commands is consistent.
  - *Reverse the SCRAM on subsequent commands* — rejected. SCRAM is canonical: once submitted, the run is over. Letting any later command "undo" it would be a footgun.
- **Consequences:** This is a sub-application of ADR-015 — `ended` is the canonical "this run is done" field, and respecting it everywhere is the same kind of single-meaning discipline. Renderer sees one `runEnded` event per run and no entity events after it. Test pattern: every phase that mutates state in a loop should have a "drops post-end mutations" test. The rule applies between phases too — `advanceTick` short-circuits at the top if `state.ended !== null` from a prior tick, and each phase function is free to assume end-of-run did not happen *before* it ran. End-of-run within a phase is the case this ADR governs.

---

## ADR-018: Event payloads are self-contained

- **Date:** 2026-04-29
- **Decision:** Every `SimEvent` payload must carry sufficient information for a renderer (or any subscriber) to act on the event without re-reading sim state. Sparse payloads like `{ id }` are a smell and require uplift to a typed payload that includes the entity's salient fields at the moment of the event (e.g., `position`, `type`, counts, transition `from`/`to` values). The exact field set per event type is defined in sim spec §8.1; this ADR sets the principle.
- **Context:** ADR-014 established that event schema is part of the spec contract and that `neutronExpired` carries `reason`. Phase 1, 2, 3 implementations shipped with thinner payloads (`{ id }`) because the consuming code didn't exist yet to pull on the schema. With phase 4 (collisions) up next — the largest piece of sim logic — and a real renderer landing soon after, sparse payloads would force every subscriber to maintain a parallel state cache and re-query on every event. That defeats the purpose of an event stream and makes subscribers fragile to the sim's state representation (which the typed-array neutron refactor will change anyway).
- **Alternatives:**
  - *Subscribers query state on each event* — rejected. Spec §8 makes the renderer a subscriber, not a polling client. State queries from event handlers also race with the next tick's state mutations if the renderer batches across ticks. Worst, it couples the renderer to internal state shape: every refactor in `SimState` ripples into every consumer.
  - *Single fat "tick snapshot" event with full state diff* — rejected. Pushes parsing and dispatch complexity to the renderer; loses the per-event semantic clarity (a `criticalityZoneChanged` is meaningful in a way that "field 27 of state changed" is not). Replays would also balloon.
  - *Hybrid: thin event + accessor closure for full data* — rejected. Adds API surface area and lifetime questions (does the closure capture the tick's state or the current state?). Plain typed payloads are simpler.
- **Consequences:** Spec §8.1 grows from a list of event names into a per-event payload schema (this session). Every event emission site must populate the typed payload — slightly more code at emit time, much less code at consume time. Replays gain richer ground truth (each event is a self-contained record of what happened). Tests assert payload contents, not just event presence. When entity shape changes (e.g., neutron typed-array refactor), event payloads stay stable because they were copied out of state at emit time. The cost is one design pass per event; it pays back across every subscriber and every renderer iteration.

---

## ADR-019: Same-tick atom collisions allowed

- **Date:** 2026-04-29
- **Decision:** Atoms spawned in phase 2 of the current tick are eligible for collision processing in phase 4 of the same tick. ADR-016 (same-tick spawn deferral) applies specifically to phase 3's removal logic for newly-spawned neutrons, not to phase 4's collision logic for newly-spawned atoms. Each phase decides independently whether same-tick entities are eligible for its operations.
- **Context:** Phase 4 lands next and needs an explicit rule for the case where phase 2 releases a fresh atom inside the swept path of an in-flight neutron. ADR-016 generalizes "newly-spawned entities are deferred to the next tick" — taken literally, that would skip the new atom in phase 4 too. But ADR-016 was written about phase 3's lifecycle work on neutrons; the generalization needs a deliberate boundary, not a default.
- **Alternatives:**
  - *Defer same-tick atom collisions to next tick (literal generalization of ADR-016)* — rejected. Feel-deadening: drop fuel, wait a tick, then chains start. Closes off a real tactical mechanic — timing fuel placements so existing neutrons hit the new atoms. The deferral is also physically counterintuitive: the atom exists at its position; treating it as invisible to a neutron passing through that exact location for one tick is a renderer-perception fiction, not sim physics.
  - *Reorder phases so atom release runs after collision resolution* — rejected. Spec §4.1 phase order is locked (ADR-005); reordering for one entity type breaks others, and the natural causal order is input → fuel release → neutron advance → collision.
- **Consequences:** Phase 4 includes newly-spawned atoms (those with `atom.spawnedAt === state.tick`) in its collision pair search. ADR-016 still governs neutron-side same-tick deferral: a neutron created this tick is excluded from phase 3's advancement and from phase 4's collision detection (it has no swept path yet). The boundary is explicit: ADR-016 governs lifecycle phases acting on entities of the same kind that just spawned; ADR-019 governs interaction phases that mix entities of different kinds where one is fresh. If a future phase needs the opposite rule (e.g., a poisoning effect that should not fire on a freshly-spawned atom), log a new ADR — do not derive it from ADR-016 by default.

---

## ADR-020: Losing neutrons pass through; per-tick atom-already-hit exclusion

- **Date:** 2026-04-29
- **Decision:** When multiple neutrons would collide with the same atom in a single tick, phase 4 sorts the collision pairs by spawn order (`spawnedAt` ascending, then `neutronId` ascending as tiebreak). The first neutron in spawn order resolves the collision normally. Subsequent neutrons whose collision pair targets the same atom continue moving along their path with their original velocity — they pass through and remain candidates for collisions later in the same tick (against other atoms further along their swept path) or on subsequent ticks. Phase 4 maintains a per-tick `Set<AtomId>` of atoms-already-hit; when iterating collision pairs in spawn order, it skips any pair whose atom is already in the set.
- **Context:** Spec §10 says "two neutrons arriving at the same atom in the same tick: resolved in spawn-order; first hit wins." That answers the resolution question for the winner but leaves the loser ambiguous. Phase 4 needs an explicit rule: do the losing neutrons disappear, or do they continue? The choice has knock-on effects on the event stream and on future scattering/reflection mechanics.
- **Alternatives:**
  - *Losing neutrons are consumed (removed without effect)* — rejected. A neutron that "would have hit" a now-gone atom did not interact with anything. Removing it requires emitting `neutronExpired` for an event that has no real cause — the renderer would draw a phantom absorption animation at a position where nothing is there to absorb. It also corrupts replay ground truth: the neutron's removal would be recorded with no matching `neutronAbsorbed`, so subscribers cannot reconstruct what happened.
  - *Resolve all collision pairs simultaneously (one atom can split or absorb multiple neutrons in one tick)* — rejected. Breaks spec §10's spawn-order rule. Also overweights coincidental clustering — three neutrons arriving in the same tick should not yield 3× the energy of three neutrons arriving across three ticks.
  - *Track atom contention in pair construction (skip collision pairs whose atom is hit by an earlier neutron in the same tick before building any pairs)* — rejected. Couples collision detection (the geometric question) to resolution ordering (the gameplay question). Cleaner to build the full set of pairs in `collisions.ts` and let phase 4 enforce ordering during resolution.
- **Consequences:** Phase 4 holds the per-tick exclusion set itself; the collision-detection layer (`collisions.ts`) returns all valid neutron-atom pairs unsorted. Pass-through emits no events — no `neutronAbsorbed`, no state mutation on the atom, no entry in the exclusion set. Future scattering or reflection mechanics naturally fit this model: a "deflect" outcome would also leave the neutron alive and the atom unhit, with a velocity update and a new event type. The pass-through neutron is *not* added to `hitAtoms` because pass-through doesn't claim the atom — another neutron later in spawn order is still free to hit it (though in practice the spawn-order winner already did, so this is mainly a future-proofing note). Tests must cover both shapes: same-atom multi-neutron collisions where the loser passes through, and the explicit invariant that pass-through emits no events.

---

## ADR-021: Per-tick absorption checks inside control rod radius

- **Date:** 2026-04-29
- **Decision:** While a neutron is inside a control rod's radius, an absorption probability check fires every tick. The `controlRod.absorbStrength` config value is per-tick, not per-encounter — each tick a neutron sits inside the radius is an independent Bernoulli trial against `absorbStrength`. Default `absorbStrength` values in config are now per-tick semantics; the placeholder values may need rebalancing during phase 4 implementation (likely lower than the prior 0.7-0.9 range).
- **Context:** Spec §2.3 describes control rods as absorbing "neutrons within its area of effect" with a probability `absorbStrength`. The spec leaves the time semantics open — is `absorbStrength` the probability per encounter (one roll on entry), per tick (independent rolls each tick inside), or some kind of cumulative function? Phase 4 needs a single concrete answer. Per-encounter would require tracking per-(neutron, rod) entry events; per-tick is stateless and matches the rest of phase 4's stateless-per-tick design.
- **Alternatives:**
  - *Per-encounter (one roll on entry, then immune until exit)* — rejected. Requires phase 4 to track which (neutron, rod) pairs have already rolled this entry, which means new state on the neutron or a per-tick "previously inside" set carried across ticks. Adds memory and complicates determinism. Also less physically faithful: real absorption probability scales with dwell time.
  - *Per-encounter on first entry, with re-roll on each re-entry* — rejected. Same complexity as per-encounter plus an entry/exit edge detector. Buys nothing the per-tick model doesn't.
  - *Continuous integration: probability of absorption over a tick = 1 - exp(-strength × dt)* — interesting, more physically correct, but overkill at v1 fidelity. Per-tick Bernoulli at a tuned rate is indistinguishable from a player perspective and simpler to test.
- **Consequences:** A neutron crossing a rod at high velocity spends fewer ticks inside the radius and is correspondingly harder to absorb — speed-dependent absorption emerges from the per-tick rule for free, no extra design effort. Slow or stationary neutrons (e.g., a neutron deflected to near-zero velocity by some future mechanic) are very likely to be absorbed. Tuning `absorbStrength` becomes a per-tick rate question, similar to how decay rates are normally expressed. Default values in `default.json` will be lowered from the placeholder (originally 0.7) to roughly 0.4 as a starting point — this is a balance placeholder, not a fixed contract; expect rebalancing during playtest. If level design later needs per-encounter semantics for a specific rod variant, log a new ADR and add a per-rod `absorbModel` field rather than changing the default semantics.

---

## ADR-022: Three-outcome rule for neutron-atom interactions; B10 is immortal

- **Date:** 2026-04-29
- **Decision:** Every neutron-atom encounter resolves to exactly one of three outcomes — `split`, `absorb`, or `pass-through`. Resolution uses a single PRNG roll in `[0, 1)` evaluated in fixed order: if `roll < splitChance`, the atom splits; else if `roll < splitChance + absorbChance`, the atom absorbs the neutron; else the neutron passes through. The fixed evaluation order is part of the determinism contract and must not be reordered. The complement `1 - splitChance - absorbChance` is the implicit `passThroughChance`; configs must satisfy `splitChance + absorbChance ≤ 1.0`. B10 atoms are exempt from `spent` transitions on absorb: a neutron absorbed by B10 is consumed, but the B10 atom remains `intact`. All other atom types transition to `spent` immediately on absorb.
- **Context:** Spec §3 lists per-type `splitChance` and `absorbChance` but stops short of describing how a single neutron-atom encounter is resolved. Phase 4 needs a deterministic rule that uses the configured probabilities and produces an unambiguous outcome from a single PRNG roll. There are several roll-shape options (one roll vs. two rolls, evaluation order, what the third outcome is). The choice has to be locked before any phase 4 code lands or every test is fragile to PRNG-call accounting.
- **Alternatives:**
  - *Two independent PRNG rolls (one for split, one for absorb)* — rejected. Doubles PRNG draws per collision and creates the "rolled split-no, then rolled absorb-no" double-negative path that makes pass-through implicit but harder to reason about. Single roll with ordered thresholds is equivalent in distribution and uses half the PRNG draws.
  - *Implicit `passThroughChance` defaults to zero (always one of split/absorb)* — rejected for U235 and Pu239: a 0.85 split chance with no pass-through forces the remaining 0.15 to also resolve as either split or absorb, which is a misnomer for "neutron grazed off the atom without effect." The pass-through outcome models the geometric reality that not every entry into a collision radius is a hard hit.
  - *B10 transitions to `spent` like other atoms* — rejected for v1. In real physics, B10 + neutron → Li7 + alpha consumes the boron nucleus, but at the granularity of this game's atoms (each "atom" represents a region of material, not a single nucleus) the effective capacity is unbounded for game timescales. Treating B10 as immortal lets it function as static defense distinct from player-placed control rods (which have finite per-spec §2.3 durability). If level design later needs B10 wear-out, revisit with a new ADR — perhaps adding per-type `absorbCapacity` rather than a per-type immortality flag.
- **Consequences:** Phase 4 emits exactly one PRNG draw per collision-pair resolution attempt, regardless of outcome — easy to assert in determinism tests. Configs that violate `splitChance + absorbChance ≤ 1.0` are a bug; phase 4 doesn't validate, but balance tooling and config schema work (planned-milestones) will. B10 atoms accumulate absorbed neutrons silently; the renderer can show an absorbed-count badge by counting `neutronAbsorbed` events with `targetId === b10AtomId`, but the sim does not track per-atom absorb counts in v1. The probability defaults are spec'd at U235 split 0.85 / absorb 0.00, U238 split 0.05 / absorb 0.95, Pu239 split 0.95 / absorb 0.00, B10 split 0.00 / absorb 0.90; existing `default.json` values match.

---

## ADR-023: Atom state machine

- **Date:** 2026-04-29
- **Decision:** Atoms transition between four states per these rules:
  - `intact` → `excited` — phase 4 of the collision tick, when a neutron-atom encounter resolves to `split` per ADR-022. The atom also gets a `pendingNeutrons: number` value populated from a PRNG draw against the atom-type's `neutronsPerSplit` range. Phase 4 emits `atomSplit` carrying that count.
  - `excited` → `splitting` — phase 6 (advance atom states) of the next tick. Duration in `excited` is exactly 1 tick. Phase 5 (apply collision results) consumes `pendingNeutrons` to spawn the neutrons before phase 6 transitions the state and clears the field. (Resolving phase 5's exact relationship to the `excited → splitting` transition — i.e. whether phase 5 runs while the atom is still `excited` and phase 6 then transitions, or whether phase 5 itself transitions — is left to the phase 5/6 session; phase 4's contract is unaffected either way.)
  - `splitting` → `spent` — phase 6, after `splittingDuration` ticks (default `splittingDuration: 4`).
  - `intact` → `spent` — phase 4, when a neutron-atom encounter resolves to `absorb`. Immediate, in the same tick. Exception per ADR-022: B10 atoms remain `intact`.
  - `intact` → `spent` — phase 7 (auto-decay), when an atom's `decaysAt` tick is reached without a prior split (Pu239 unstable timeout per spec §3).
- **Context:** Spec §2.1 lists four atom states (`intact`, `excited`, `splitting`, `spent`) but does not define the transition graph or which phase owns each transition. Phase 4 is the first phase that mutates atom state — it needs to know exactly which transitions it is responsible for and which it must defer. The neutron-release count problem is the load-bearing detail: spec §8.1 says `atomSplit` carries `neutronsReleased`, which means the count must be decided in phase 4 (when the event fires), not in phase 5 (when the neutrons actually spawn). That requires a new field on `Atom` to communicate the count across phases.
- **Alternatives:**
  - *Phase 4 spawns the neutrons immediately on split* — rejected. Phase 5 is "apply collision results — spawn new neutrons" per spec §4.1; collapsing the spawn into phase 4 mixes detection with effect. It also bypasses the renderer's spawn-frame contract: a neutron created in phase 4 of tick N would be visible in the same tick the atom enters `excited`, but the renderer needs the atom's `excited` frame to play before neutrons appear flying outward.
  - *Pass the `neutronsReleased` count via the event payload only, no new atom field* — rejected. The event would be the only carrier of the count, but phase 5 needs to read the count to actually spawn the neutrons. Phase 5 reading from the event stream is a backward dependency (events flow out of the sim, not within it). A field on the atom is the right channel.
  - *`pendingNeutrons` lives on a side channel (e.g., a per-tick `Map<AtomId, number>` in `SimState`)* — rejected. Adds state with the same lifetime as the atom in `excited` for one tick. Cleaner to put it on the atom and let phase 5/6 clear it on transition.
  - *No `excited` intermediate — go directly from `intact` to `splitting`* — rejected. The 1-tick `excited` state is what gives the renderer time to play a "buildup" animation before particles spawn. Removing it would require the renderer to predict splits, which contradicts the event-driven design (ADR-018).
- **Consequences:** `Atom` gains an optional `pendingNeutrons?: number` field (added in the same task that adds `collisionRadius`). Populated by phase 4 on split, consumed and cleared by phase 5 (or 6, depending on the resolution noted above). The `intact → spent` direct transitions (absorb in phase 4, decay in phase 7) skip the `excited`/`splitting` middle states by design — the renderer's spawn animation distinguishes "split" (which goes through `excited`) from "absorbed" (which doesn't). `excitedSince` and `decaysAt` (already on the type) are populated on entry to `excited` and `intact` respectively, per ADR-015 (one fact per field): `excitedSince` is "tick when entered excited", `decaysAt` is "tick when this atom auto-decays". Both are nullable and only populated when the corresponding state is entered. Phase 4 sets `excitedSince = state.tick` when entering `excited`.

---

## ADR-024: Collision algorithm choice — O(n×m) brute force behind a clean interface

- **Date:** 2026-04-29
- **Decision:** Phase 4's collision detection is implemented as O(n×m) brute force in `packages/sim/src/collisions.ts` behind a single function: `findNeutronAtomCollisions(neutrons, atoms, currentTick, config) → CollisionPair[]`. Spatial partitioning (uniform grid, quadtree, BVH) is deferred until profiling demonstrates need. The interface — a pure function returning a list of `(neutronId, atomId, intersectionPoint)` triples — is designed so that swap-in optimization is a pure replacement of the function body, with no architectural churn elsewhere in the sim.
- **Context:** Spec §13 sets the v1 perf target at 200 atoms + 500 neutrons sustained at 60 ticks/sec. Phase 4 is the most expensive single phase: it reads every neutron's swept path against every atom's collision radius. Brute force is the simplest correct implementation; spatial partitioning is faster asymptotically but has fixed per-tick overhead and adds complexity. A choice has to be locked before phase 4 implementation lands — without one, the implementation either ships with brute force and leaves a "TODO: optimize" or starts with a half-baked grid that complicates testing.
- **Alternatives:**
  - *Uniform grid hash with cell size ~atom collision radius* — rejected for v1. The asymptotic win is real (O(n) at fixed density), but the bucket maintenance has constant cost: clear buckets each tick, insert each atom, query each neutron's swept path against the buckets it traverses. At 200×500 = 100k checks, brute force is ~1ms per tick on modern hardware (well within the 16.67ms tick budget). Grid construction adds ~0.2ms minimum and testability overhead (off-by-one cell-boundary bugs are subtle). Net negative at v1 scale.
  - *Spatial partitioning by sector ownership (each atom registers in nearby sectors)* — rejected. Requires phase 2 (atom creation) and phase 7 (atom removal) to maintain the index, which couples geometry to lifecycle phases. Brute force keeps phase 4 self-contained.
  - *Pre-broadphase by axis-aligned bounding box (AABB)* — rejected. Reasonable for static geometry but neutrons are short-lived and atoms outnumber them less than 1:3 in v1; the AABB pre-pass cost approaches the brute-force cost itself.
  - *Inline the collision logic inside `phaseResolveCollisions` instead of a separate file* — rejected. Mixing detection (geometry) with resolution (rules + PRNG) in one function makes both harder to test in isolation. The interface boundary is cheap to maintain and pays for itself in test clarity.
- **Consequences:** Same pattern as ADR-008 (object pooling deferred): pay the simplest cost now, capture the swap point in the interface, optimize when profiling justifies it. The trigger for revisiting is the same as the planned-milestones "neutron storage refactor" trigger — either real workloads start dropping ticks at the v1 perf gate, or an order-of-magnitude entity scaleup (post-v1 Sites with 1000+ atoms) makes brute force untenable. Until then, `collisions.ts` stays under 100 lines and any future spatial structure (e.g., a `SpatialIndex` class with `query(neutron)` and `update(atom)`) sits behind the same `findNeutronAtomCollisions` signature. Phase 4 itself is unaffected by the swap.

---

## ADR-025: Neutron release angle algorithm — evenly-distributed-with-jitter

- **Date:** 2026-04-29
- **Decision:** Phase 5 spawns neutrons from a splitting atom using evenly-distributed-with-jitter angles. For a split releasing `N` neutrons:
  ```
  [baseOffset, prng] = next(prng)         // single PRNG draw, scaled to [0, 2π)
  for i in 0..N-1:
    evenAngle = baseOffset + (i / N) * 2π
    [u, prng] = next(prng)
    jitter = (u - 0.5) * jitterMagnitude  // range [-jitterMagnitude/2, +jitterMagnitude/2)
    angle_i = evenAngle + jitter
  ```
  Total PRNG draws per split: `N + 1`. The first draw seeds the rotation of the even pattern; each subsequent draw perturbs one neutron. Draw count is part of the determinism contract — tests assert it. `jitterMagnitude` is a config value `physics.neutronReleaseJitter`, default `0.4` radians (~23°).
- **Context:** Phase 5 must turn `pendingNeutrons: N` into N neutron velocity vectors. The angle distribution shapes how the player perceives a split: pure uniform random (each angle independent in [0, 2π)) clusters at small N — three random angles often land within 60° of each other, which reads to the player as "the split was bugged, neutrons all went the same way." Pure even distribution (N points equally spaced around the circle) reads as "robotic" and visually identical between splits at the same N. We need a single rule that produces explosive-but-covering distributions and is cheap to compute.
- **Alternatives:**
  - *Uniform random per-neutron (`angle = next(prng) * 2π`, N draws total)* — rejected. Cheaper by one draw but the clustering problem is real at N=2 and N=3, which is the dominant case (U235 is `[2,3]`, U238 is `[2,2]`, Pu239 is `[2,4]`). The whole point of a split is that neutrons fly outward in different directions; clustering defeats the gameplay.
  - *Pure even distribution, no jitter (`angle_i = baseOffset + (i/N) * 2π`, 1 draw total)* — rejected. Visually too regular. A U235 atom always splitting into 3 perfectly 120°-spaced neutrons makes consecutive U235 splits look identical, which dampens the sense of explosive variety. Real fission isn't this orderly even at human scales.
  - *Jitter applied to even distribution by perturbing the index angle directly without a base rotation* — rejected. Without `baseOffset`, the first neutron of every U235 split would always go roughly east. The base rotation per split is what makes splits feel uncorrelated to each other.
  - *Continuous Poisson disc sampling on the circle* — overkill. The N+1 draw rule is cheap and gives essentially the same player perception. Reserve sophisticated sampling for visual effects systems (renderer concern), not sim physics.
- **Consequences:** PRNG draw budget for phase 5 per atom split is exactly `N + 1` — assertable in tests, predictable in determinism replays. `jitterMagnitude = 0.4` radians is a starting point; it puts each neutron within roughly ±11.5° of its evenly-spaced slot, which preserves the "covering the circle" property while breaking the visual regularity. If playtesting reveals jitter is too tight (looks robotic) or too loose (loses coverage), the value tunes via config without code changes — the algorithm itself is fixed by this ADR. The jitter is symmetric around zero by construction (`(u - 0.5) * jitter`), so over many splits the angular distribution is unbiased. Real physics doesn't constrain us here — neutron emission angles in a real fission reactor have nothing to do with this game's sim — but game feel does, and even-with-jitter is the shape that matches player expectation of "explosive but full coverage."

---

## ADR-026: Split-spawned neutrons — same-tick deferred and offset from parent atom

- **Date:** 2026-04-29
- **Decision:** Neutrons spawned by phase 5 (the result of an atom split) follow ADR-016 same-tick deferral — their `spawnedAt === state.tick` so phases 3 and 4 of the same tick (and the rod-absorption sub-pass of phase 4) skip them. Additionally, they are spawned at a position offset from the parent atom's center along their direction of travel:
  ```
  spawnPosition = parentAtom.position + direction * (parentAtom.collisionRadius + 0.01)
  ```
  The `0.01` epsilon places the neutron just outside the parent atom's collision boundary. This is invisible to the player (sub-pixel at any reasonable render zoom) but eliminates a subtle edge case: when the neutron starts moving on the next tick, it is already outside its parent atom's geometry, so swept-collision checks cannot re-collide with the (now `splitting`) parent.
- **Context:** Phase 5 needs to decide where the freshly-spawned neutrons sit in space. The natural choice is `parentAtom.position` itself — the atom is gone (well, transitioning) and the neutrons are a product of it. But spawning at the parent's center creates a fragile dependency: `phaseAdvanceNeutrons` and `phaseResolveCollisions` would need to be careful that the neutron doesn't immediately re-collide with the parent atom on the next tick (the parent is still in `splitting` state and still has its collision radius). Today this is handled by ADR-016 (newly-spawned neutrons are deferred for one tick), so by tick N+1 the neutron exists but hasn't moved yet, and by tick N+2 the parent has typically transitioned to `spent` and is no longer a collision target — but the timing depends on phase 6's `splittingDuration` (4 ticks) versus the deferral window (1 tick), which means the parent is still a collision-eligible `splitting` atom for several ticks while the neutron is positioned at its center. Without the offset, the neutron's first move on tick N+1 would shift it from the parent center to wherever its velocity vector points, and the swept-segment collision check between the parent atom and this neutron would re-collide.
- **Alternatives:**
  - *Spawn at parent center, rely on ADR-016 alone* — rejected. Works in the current tick, but on tick N+1 the swept-collision logic in phase 4 would check the neutron's path from the parent's center outward against the parent atom's collision circle and find a hit (the segment starts inside the circle). The phase 4 pre-decision around "atom already hit" doesn't help here either — that set is per-tick. Solving this would require special-casing parent-child neutron-atom pairs, which adds state and special cases to phase 4 for a problem that's eliminated geometrically by the offset.
  - *Spawn at parent center, mark the parent as `spent` immediately in phase 5 instead of `splitting`* — rejected. That collapses the entire `splitting → spent` timeline and kills the renderer's split animation window. The whole point of the `splitting` state is to give the renderer time to play the explosion frames before the atom disappears.
  - *Larger offset (e.g., `2 * collisionRadius`)* — rejected. Visually disconnects the neutrons from the parent. The 0.01 epsilon is the smallest offset that puts the neutron strictly outside the boundary, which is what we want — the neutron looks like it came from the atom, not from a halo around it.
  - *Spawn the neutron at the parent center but immediately mark it as exempt from colliding with the parent specifically (per-pair exemption)* — rejected. State on the neutron with the lifetime "until the parent transitions to spent" is fragile and bug-prone. The geometric solution is stateless.
- **Consequences:** Belt-and-suspenders with ADR-016: ADR-016 prevents same-tick collision between the spawn and the parent (and any other atom); the offset prevents next-tick re-collision with the parent atom even if some future change to ADR-016 would allow it. Phase 5 becomes self-contained — regardless of what other phases do with same-tick deferral semantics, split-spawned neutrons are always positioned safely. The offset cost is negligible (one cosine + one sine + two adds per spawned neutron, already computed for the velocity vector). Tests assert the spawn position is exactly `(collisionRadius + 0.01)` along the direction vector. If a future entity gets a much larger collision radius (e.g., a hypothetical "neutron cluster" entity), the formula scales naturally — it always sits just outside the parent's geometric boundary, whatever that is.