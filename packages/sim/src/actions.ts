import type { AtomType, Vec2 } from './types.js';

export type FuelMix = { readonly [K in AtomType]?: number };

export type InputCommand =
  | { readonly type: 'injectNeutron'; readonly position: Vec2; readonly direction: Vec2 }
  | { readonly type: 'placeControlRod'; readonly position: Vec2 }
  | { readonly type: 'placeFuelRod'; readonly position: Vec2; readonly fuelMix: FuelMix }
  | { readonly type: 'scram' };

export type InputCommandType = InputCommand['type'];
