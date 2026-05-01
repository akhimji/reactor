import type { InputCommand } from './actions.js';
import type { SimConfig } from './config.js';
import type { SimEvent } from './events.js';
import { createSimState, type SimState } from './state.js';
import { advanceTick } from './tick.js';

// Public subscription surface. ADR-034 — type-keyed handlers, no wildcard in v1.
export type EventType = SimEvent['type'];
export type Handler<T extends EventType> = (event: Extract<SimEvent, { type: T }>) => void;
export type Unsubscribe = () => void;

export interface Subscriptions {
  subscribe<T extends EventType>(type: T, handler: Handler<T>): Unsubscribe;
}

// Internal handler type — the registry stores type-erased handlers because a
// single Set per event type cannot hold variant-typed callbacks. Type narrowing
// is preserved at the public `subscribe` boundary via the generic parameter;
// the assertion at registration is a single localized cast.
type ErasedHandler = (event: SimEvent) => void;

export class Sim implements Subscriptions {
  private state: SimState;
  private readonly config: SimConfig;
  private readonly subscribers: Map<EventType, Set<ErasedHandler>> = new Map();

  constructor(config: SimConfig, seed: number) {
    this.config = config;
    this.state = createSimState(seed, config);
  }

  // Subscriber dispatch lands in the next commit (ADR-034). For now `tick`
  // advances state and clears pendingEvents so the structural slot is in
  // place; subscribers registered today receive nothing until dispatch is
  // wired.
  tick(inputs: readonly InputCommand[]): void {
    this.state = advanceTick(this.state, inputs, this.config);
    this.state = { ...this.state, pendingEvents: [] };
  }

  subscribe<T extends EventType>(type: T, handler: Handler<T>): Unsubscribe {
    let set = this.subscribers.get(type);
    if (!set) {
      set = new Set<ErasedHandler>();
      this.subscribers.set(type, set);
    }
    const erased = handler as ErasedHandler;
    set.add(erased);
    return () => {
      set.delete(erased);
    };
  }

  getState(): Readonly<SimState> {
    return this.state;
  }
}
