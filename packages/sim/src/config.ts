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
  readonly atoms: { readonly [K in AtomType]: AtomBehavior };
  readonly neutron: {
    readonly defaultSpeed: number;
    readonly lifetimeTicks: number;
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
    };
  };
  readonly endConditions: {
    readonly meltdownThreshold: number;
    readonly extinctionThreshold: number;
    readonly extinctionGracePeriod: number;
  };
  readonly scoring: {
    readonly basePerTick: number;
    readonly edgeMultiplier: number;
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
