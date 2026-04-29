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
