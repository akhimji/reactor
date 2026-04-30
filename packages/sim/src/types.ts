export type Vec2 = { readonly x: number; readonly y: number };

export type AtomId = number & { readonly __brand: 'AtomId' };
export type NeutronId = number & { readonly __brand: 'NeutronId' };
export type ControlRodId = number & { readonly __brand: 'ControlRodId' };
export type FuelRodId = number & { readonly __brand: 'FuelRodId' };

export type AtomType = 'U235' | 'U238' | 'Pu239' | 'B10';
export type AtomState = 'intact' | 'excited' | 'splitting' | 'spent';

export type Atom = {
  readonly id: AtomId;
  readonly position: Vec2;
  readonly type: AtomType;
  readonly state: AtomState;
  readonly excitedSince: number | null;
  readonly decaysAt: number | null;
  // Per-instance collision radius, mirroring FuelRod.radius (ADR-015 / spec §2.4).
  // In v1 every atom uses config.atom.collisionRadius at spawn time, but the
  // field belongs on the entity so future variants can carry their own radius.
  readonly collisionRadius: number;
  // Set by phase 4 when this atom enters `excited`: the count of neutrons to
  // spawn when phase 5 reads it on the `excited → splitting` transition. ADR-023
  // explains why the count is decided in phase 4 (atomSplit event payload) but
  // consumed by phase 5 (actual neutron spawn).
  readonly pendingNeutrons?: number;
  // Set by phase 5 on the `excited → splitting` transition; consumed by phase 6
  // to decide when `splittingDuration` ticks have elapsed and the atom should
  // transition to `spent`. Cleared on transition to `spent`. Spec §4.1.5/§4.1.6.
  readonly splittingStartedAt?: number;
};

export type Neutron = {
  readonly id: NeutronId;
  readonly position: Vec2;
  readonly velocity: { readonly vx: number; readonly vy: number };
  readonly spawnedAt: number;
  readonly expiresAt: number;
};

export type ControlRod = {
  readonly id: ControlRodId;
  readonly position: Vec2;
  readonly radius: number;
  readonly placedAt: number;
  readonly durability: number;
  readonly absorbStrength: number;
};

export type FuelRodReleaseEntry = {
  readonly atTick: number;
  readonly atomType: AtomType;
  readonly offset: Vec2;
};

export type FuelRod = {
  readonly id: FuelRodId;
  readonly position: Vec2;
  readonly radius: number;
  readonly placedAt: number;
  readonly releaseSchedule: readonly FuelRodReleaseEntry[];
  readonly exhausted: boolean;
};

export type CriticalityZone =
  | 'extinct'
  | 'subcritical'
  | 'nominal'
  | 'supercritical'
  | 'runaway'
  | 'meltdown';

export type RunEndReason = 'meltdown' | 'extinction' | 'sustained' | 'stabilized';
