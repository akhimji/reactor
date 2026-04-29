import type {
  AtomId,
  ControlRodId,
  CriticalityZone,
  FuelRodId,
  NeutronId,
  RunEndReason,
} from './types.js';

// Refinement of sim spec §8.1: `neutronExpired` carries a reason so the
// renderer can differentiate "fizzled" (lifetime) from "left the field"
// (out-of-bounds). Update the spec doc on the next pass.
export type NeutronExpirationReason = 'expired' | 'out-of-bounds';

export type SimEvent =
  | {
      readonly type: 'tick';
      readonly tick: number;
      readonly data: { readonly criticality: number; readonly zone: CriticalityZone };
    }
  | { readonly type: 'atomSpawned'; readonly tick: number; readonly data: { readonly id: AtomId } }
  | { readonly type: 'atomSplit'; readonly tick: number; readonly data: { readonly id: AtomId } }
  | { readonly type: 'atomSpent'; readonly tick: number; readonly data: { readonly id: AtomId } }
  | { readonly type: 'atomDecayed'; readonly tick: number; readonly data: { readonly id: AtomId } }
  | {
      readonly type: 'neutronSpawned';
      readonly tick: number;
      readonly data: { readonly id: NeutronId };
    }
  | {
      readonly type: 'neutronAbsorbed';
      readonly tick: number;
      readonly data: { readonly id: NeutronId; readonly by: AtomId | ControlRodId };
    }
  | {
      readonly type: 'neutronExpired';
      readonly tick: number;
      readonly data: {
        readonly id: NeutronId;
        readonly reason: NeutronExpirationReason;
      };
    }
  | {
      readonly type: 'controlRodPlaced';
      readonly tick: number;
      readonly data: { readonly id: ControlRodId };
    }
  | {
      readonly type: 'controlRodDepleted';
      readonly tick: number;
      readonly data: { readonly id: ControlRodId };
    }
  | {
      readonly type: 'fuelRodPlaced';
      readonly tick: number;
      readonly data: { readonly id: FuelRodId };
    }
  | {
      readonly type: 'fuelRodExhausted';
      readonly tick: number;
      readonly data: { readonly id: FuelRodId };
    }
  | {
      readonly type: 'criticalityZoneChanged';
      readonly tick: number;
      readonly data: { readonly from: CriticalityZone; readonly to: CriticalityZone };
    }
  | {
      readonly type: 'runEnded';
      readonly tick: number;
      readonly data: { readonly reason: RunEndReason };
    };

export type SimEventType = SimEvent['type'];
export type SimEventHandler = (event: SimEvent) => void;

export type EventEmitter = {
  subscribe(handler: SimEventHandler): () => void;
  flush(events: readonly SimEvent[]): void;
};

export function createEventEmitter(): EventEmitter {
  const handlers = new Set<SimEventHandler>();
  return {
    subscribe(handler) {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },
    flush(events) {
      for (const event of events) {
        for (const handler of handlers) {
          handler(event);
        }
      }
    },
  };
}
