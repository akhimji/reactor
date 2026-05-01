import type { AtomType, CriticalityZone } from './types.js';

export type AtomBehavior = {
  readonly splitChance: number;
  readonly absorbChance: number;
  readonly neutronsPerSplit: { readonly min: number; readonly max: number };
  readonly decayTicks: number | null;
  readonly yield: number;
};

export type SimConfig = {
  readonly tickHz: number;
  readonly criticalityWindow: number;
  readonly atom: {
    readonly collisionRadius: number;
  };
  readonly atoms: { readonly [K in AtomType]: AtomBehavior };
  readonly neutron: {
    readonly defaultSpeed: number;
    readonly lifetimeTicks: number;
  };
  readonly physics: {
    // Ticks an atom remains in `splitting` state before transitioning to `spent`.
    // Phase 6 (§4.1.6) gates this transition.
    readonly splittingDuration: number;
    // Maximum jitter (radians) applied to evenly-spaced neutron release angles
    // in phase 5. ADR-025 — the algorithm is fixed; this value tunes feel.
    readonly neutronReleaseJitter: number;
    // Ticks an atom remains in `spent` state before phase 7 removes it from
    // state (ADR-027). Atoms transitioning via Pu239 auto-decay are removed
    // immediately and bypass this window (ADR-028).
    readonly spentAtomCleanupTicks: number;
  };
  readonly criticality: {
    readonly baselineNeutronRate: number;
    readonly zoneBoundaries: {
      readonly [K in Exclude<CriticalityZone, 'meltdown'>]: number;
    };
  };
  readonly actions: {
    readonly injectCooldown: number;
    readonly controlRod: {
      readonly radius: number;
      readonly durability: number;
      readonly absorbStrength: number;
      readonly inventoryDefault: number;
    };
    readonly fuelRod: {
      readonly radius: number;
      readonly releaseDuration: number;
      readonly inventoryDefault: number;
    };
    readonly scram: {
      readonly availableDefault: boolean;
    };
  };
  readonly endConditions: {
    readonly meltdownThreshold: number;
    readonly extinctionThreshold: number;
    readonly extinctionGracePeriod: number;
  };
  readonly scoring: {
    // Per-tick base score earned while in the nominal zone (ADR-032).
    readonly baseRatePerTick: number;
    // Maximum quadratic edge bonus applied at the nominal zone boundary
    // (ADR-032). With edgeBonusMax = 1.0, a player at exactly k = 0.9 or
    // k = 1.1 earns 2× baseRatePerTick; at k = 1.0 they earn baseRatePerTick.
    readonly edgeBonusMax: number;
  };
  readonly playfield: {
    readonly bounds: {
      readonly minX: number;
      readonly minY: number;
      readonly maxX: number;
      readonly maxY: number;
    };
  };
  readonly minAtomSpacing: number;
};

// Schema validation lands when balance work begins. For now, trust the file shape
// and freeze it so accidental mutation in sim code throws.
export function loadConfig(json: unknown): SimConfig {
  return Object.freeze(json as SimConfig);
}
