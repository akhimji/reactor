import type {
  AtomId,
  AtomType,
  ControlRodId,
  CriticalityZone,
  FuelRodId,
  NeutronId,
  RunEndReason,
  Vec2,
} from './types.js';

// Spec §8.1: `neutronExpired` carries a reason so the renderer can
// differentiate lifetime end, leaving the field, and absorption. 'absorbed'
// is reserved for phases 4/5 (collision resolution) and is not yet emitted.
export type NeutronExpirationReason = 'expired' | 'out-of-bounds' | 'absorbed';

// Per ADR-018, every payload is self-contained — a subscriber must be able
// to act without re-reading sim state. Per spec §8.2, the `tick` envelope
// field is not duplicated inside `data`.
export type SimEvent =
  | {
      readonly type: 'tick';
      readonly tick: number;
      readonly data: { readonly criticality: number; readonly zone: CriticalityZone };
    }
  | {
      readonly type: 'atomSpawned';
      readonly tick: number;
      readonly data: {
        readonly atomId: AtomId;
        readonly type: AtomType;
        readonly position: Vec2;
      };
    }
  | {
      readonly type: 'atomSplit';
      readonly tick: number;
      readonly data: {
        readonly atomId: AtomId;
        readonly position: Vec2;
        readonly neutronsReleased: number;
      };
    }
  | {
      readonly type: 'atomSpent';
      readonly tick: number;
      readonly data: { readonly atomId: AtomId; readonly position: Vec2 };
    }
  | {
      readonly type: 'atomDecayed';
      readonly tick: number;
      readonly data: {
        readonly atomId: AtomId;
        readonly type: AtomType;
        readonly position: Vec2;
      };
    }
  | {
      readonly type: 'neutronSpawned';
      readonly tick: number;
      readonly data: {
        readonly neutronId: NeutronId;
        readonly position: Vec2;
        readonly velocity: { readonly vx: number; readonly vy: number };
      };
    }
  | {
      readonly type: 'neutronAbsorbed';
      readonly tick: number;
      readonly data: {
        readonly neutronId: NeutronId;
        readonly absorbedBy: 'atom' | 'controlRod';
        readonly targetId: AtomId | ControlRodId;
        readonly position: Vec2;
      };
    }
  | {
      readonly type: 'neutronExpired';
      readonly tick: number;
      readonly data: {
        readonly neutronId: NeutronId;
        readonly reason: NeutronExpirationReason;
      };
    }
  | {
      readonly type: 'controlRodPlaced';
      readonly tick: number;
      readonly data: {
        readonly controlRodId: ControlRodId;
        readonly position: Vec2;
        readonly radius: number;
      };
    }
  | {
      readonly type: 'controlRodDepleted';
      readonly tick: number;
      readonly data: { readonly controlRodId: ControlRodId; readonly position: Vec2 };
    }
  | {
      readonly type: 'fuelRodPlaced';
      readonly tick: number;
      readonly data: {
        readonly fuelRodId: FuelRodId;
        readonly position: Vec2;
        readonly radius: number;
      };
    }
  | {
      readonly type: 'fuelRodExhausted';
      readonly tick: number;
      readonly data: { readonly fuelRodId: FuelRodId; readonly position: Vec2 };
    }
  | {
      readonly type: 'criticalityZoneChanged';
      readonly tick: number;
      readonly data: {
        readonly previousZone: CriticalityZone;
        readonly newZone: CriticalityZone;
        readonly k: number;
      };
    }
  | {
      readonly type: 'runEnded';
      readonly tick: number;
      readonly data: {
        readonly outcome: RunEndReason;
        readonly finalTick: number;
        readonly finalScore: number;
      };
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
