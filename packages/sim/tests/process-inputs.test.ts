import { describe, expect, it } from 'vitest';
import defaultConfig from '../configs/default.json' with { type: 'json' };
import {
  advanceTick,
  createSimState,
  loadConfig,
  type ControlRodId,
  type FuelRodId,
  type InputCommand,
  type NeutronId,
  type SimEvent,
  type SimState,
} from '../src/index.js';

const config = loadConfig(defaultConfig);

const nid = (n: number): NeutronId => n as unknown as NeutronId;
const cid = (n: number): ControlRodId => n as unknown as ControlRodId;
const fid = (n: number): FuelRodId => n as unknown as FuelRodId;

function findEvent<T extends SimEvent['type']>(
  events: readonly SimEvent[],
  type: T,
): Extract<SimEvent, { type: T }> | undefined {
  return events.find((e): e is Extract<SimEvent, { type: T }> => e.type === type);
}

function countEvents(events: readonly SimEvent[], type: SimEvent['type']): number {
  return events.filter((e) => e.type === type).length;
}

const inject = (
  position = { x: 0, y: 0 },
  direction = { x: 1, y: 0 },
): InputCommand => ({ type: 'injectNeutron', position, direction });

const placeControl = (position = { x: 0, y: 0 }): InputCommand => ({
  type: 'placeControlRod',
  position,
});

const placeFuel = (
  position = { x: 0, y: 0 },
  fuelMix: { U235?: number; U238?: number; Pu239?: number; B10?: number } = { U235: 5 },
): InputCommand => ({ type: 'placeFuelRod', position, fuelMix });

const scram = (): InputCommand => ({ type: 'scram' });

describe('phase 1: process inputs', () => {
  describe('injectNeutron', () => {
    it('creates a neutron with correct position, velocity magnitude, and expiresAt', () => {
      const initial = createSimState(1, config);
      const s1 = advanceTick(initial, [inject({ x: 1, y: 2 }, { x: 3, y: 4 })], config);

      expect(s1.neutrons.size).toBe(1);
      const n = [...s1.neutrons.values()][0]!;
      // Newly-spawned neutrons are not advanced in their spawn tick (phase 3
      // skips them). Position equals the spawn position.
      expect(n.position).toEqual({ x: 1, y: 2 });

      const speed = config.neutron.defaultSpeed;
      expect(Math.hypot(n.velocity.vx, n.velocity.vy)).toBeCloseTo(speed, 10);
      // direction (3,4) normalized → (0.6, 0.8) × speed
      expect(n.velocity.vx).toBeCloseTo(0.6 * speed, 10);
      expect(n.velocity.vy).toBeCloseTo(0.8 * speed, 10);

      expect(n.spawnedAt).toBe(1);
      expect(n.expiresAt).toBe(1 + config.neutron.lifetimeTicks);

      expect(findEvent(s1.pendingEvents, 'neutronSpawned')).toBeDefined();
    });

    it('does not advance a freshly-spawned neutron in the spawn tick — it moves starting next tick', () => {
      const initial = createSimState(1, config);
      const s1 = advanceTick(initial, [inject({ x: 0, y: 0 }, { x: 1, y: 0 })], config);
      expect([...s1.neutrons.values()][0]!.position).toEqual({ x: 0, y: 0 });

      const s2 = advanceTick(s1, [], config);
      const speed = config.neutron.defaultSpeed;
      expect([...s2.neutrons.values()][0]!.position.x).toBeCloseTo(speed, 10);
    });

    it('sets the inject cooldown so a second injection in the cooldown window is rejected silently', () => {
      const initial = createSimState(1, config);
      const s1 = advanceTick(initial, [inject()], config);
      expect(s1.neutrons.size).toBe(1);
      expect(s1.cooldowns.injectNeutron).toBe(1 + config.actions.injectCooldown);

      // Advance ticks staying inside the cooldown window — second inject should be dropped.
      let s = s1;
      for (let i = 0; i < 5; i++) {
        s = advanceTick(s, [inject()], config);
      }
      expect(s.neutrons.size).toBe(1);
      expect(countEvents(s.pendingEvents, 'neutronSpawned')).toBe(1);
    });

    it('rejects injection with zero direction silently', () => {
      const initial = createSimState(1, config);
      const s1 = advanceTick(initial, [inject({ x: 0, y: 0 }, { x: 0, y: 0 })], config);

      expect(s1.neutrons.size).toBe(0);
      expect(findEvent(s1.pendingEvents, 'neutronSpawned')).toBeUndefined();
      expect(s1.cooldowns.injectNeutron).toBe(0);
    });

    it('accepts an out-of-bounds spawn — phase 3 cleans it up next tick', () => {
      const initial = createSimState(1, config);
      const s1 = advanceTick(initial, [inject({ x: 999, y: 999 }, { x: 1, y: 0 })], config);
      expect(s1.neutrons.size).toBe(1);

      const s2 = advanceTick(s1, [], config);
      expect(s2.neutrons.size).toBe(0);
      const expired = s2.pendingEvents.find(
        (e): e is Extract<SimEvent, { type: 'neutronExpired' }> => e.type === 'neutronExpired',
      );
      expect(expired?.data.reason).toBe('out-of-bounds');
    });
  });

  describe('placeControlRod', () => {
    it('creates a rod, decrements inventory, and emits controlRodPlaced', () => {
      const initial = createSimState(1, config);
      const startInv = initial.inventory.controlRods;

      const s1 = advanceTick(initial, [placeControl({ x: 5, y: -3 })], config);
      expect(s1.controlRods.size).toBe(1);
      const rod = [...s1.controlRods.values()][0]!;
      expect(rod.position).toEqual({ x: 5, y: -3 });
      expect(rod.radius).toBe(config.actions.controlRod.radius);
      expect(rod.durability).toBe(config.actions.controlRod.durability);
      expect(rod.absorbStrength).toBe(config.actions.controlRod.absorbStrength);
      expect(rod.placedAt).toBe(1);

      expect(s1.inventory.controlRods).toBe(startInv - 1);
      expect(findEvent(s1.pendingEvents, 'controlRodPlaced')).toBeDefined();
    });

    it('rejects placement when inventory is 0', () => {
      const base = createSimState(1, config);
      const drained: SimState = {
        ...base,
        inventory: { ...base.inventory, controlRods: 0 },
      };

      const s1 = advanceTick(drained, [placeControl()], config);
      expect(s1.controlRods.size).toBe(0);
      expect(s1.inventory.controlRods).toBe(0);
      expect(findEvent(s1.pendingEvents, 'controlRodPlaced')).toBeUndefined();
    });
  });

  describe('placeFuelRod', () => {
    it('creates a rod with a release schedule whose entries match fuelMix counts', () => {
      const initial = createSimState(1, config);
      const startInv = initial.inventory.fuelRods;

      const s1 = advanceTick(
        initial,
        [placeFuel({ x: 0, y: 0 }, { U235: 3, U238: 2 })],
        config,
      );
      expect(s1.fuelRods.size).toBe(1);
      const rod = [...s1.fuelRods.values()][0]!;
      expect(rod.releaseSchedule).toHaveLength(5);
      expect(rod.releaseSchedule.filter((e) => e.atomType === 'U235')).toHaveLength(3);
      expect(rod.releaseSchedule.filter((e) => e.atomType === 'U238')).toHaveLength(2);
      expect(rod.exhausted).toBe(false);

      // All atTicks fall within (currentTick, currentTick + releaseDuration]
      const last = rod.releaseSchedule[rod.releaseSchedule.length - 1]!;
      expect(last.atTick).toBeGreaterThan(1);
      expect(last.atTick).toBeLessThanOrEqual(1 + config.actions.fuelRod.releaseDuration);

      // Offsets stay within rod radius
      const radius = config.actions.fuelRod.radius;
      for (const e of rod.releaseSchedule) {
        const d = Math.hypot(e.offset.x, e.offset.y);
        expect(d).toBeLessThanOrEqual(radius + 1e-9);
      }

      expect(s1.inventory.fuelRods).toBe(startInv - 1);
      expect(findEvent(s1.pendingEvents, 'fuelRodPlaced')).toBeDefined();
    });

    it('rejects placement with empty fuelMix silently', () => {
      const initial = createSimState(1, config);
      const startInv = initial.inventory.fuelRods;

      const s1 = advanceTick(initial, [placeFuel({ x: 0, y: 0 }, {})], config);
      expect(s1.fuelRods.size).toBe(0);
      expect(s1.inventory.fuelRods).toBe(startInv);
      expect(findEvent(s1.pendingEvents, 'fuelRodPlaced')).toBeUndefined();
    });

    it('rejects placement when inventory is 0', () => {
      const base = createSimState(1, config);
      const drained: SimState = { ...base, inventory: { ...base.inventory, fuelRods: 0 } };

      const s1 = advanceTick(drained, [placeFuel()], config);
      expect(s1.fuelRods.size).toBe(0);
      expect(findEvent(s1.pendingEvents, 'fuelRodPlaced')).toBeUndefined();
    });
  });

  describe('scram', () => {
    it('sets state.ended to stabilized and emits runEnded', () => {
      const initial = createSimState(1, config);
      const s1 = advanceTick(initial, [scram()], config);

      expect(s1.ended).toEqual({ reason: 'stabilized' });
      expect(s1.inventory.scramAvailable).toBe(false);
      const ended = findEvent(s1.pendingEvents, 'runEnded');
      expect(ended?.data.reason).toBe('stabilized');
    });

    it('is rejected silently if scramAvailable is already false', () => {
      const base = createSimState(1, config);
      const used: SimState = {
        ...base,
        inventory: { ...base.inventory, scramAvailable: false },
      };

      const s1 = advanceTick(used, [scram()], config);
      expect(s1.ended).toBeNull();
      expect(findEvent(s1.pendingEvents, 'runEnded')).toBeUndefined();
    });
  });

  describe('input ordering and ending', () => {
    it('processes multiple inputs in submission order within a single tick', () => {
      const initial = createSimState(1, config);
      const s1 = advanceTick(
        initial,
        [
          inject({ x: 1, y: 0 }, { x: 1, y: 0 }),
          placeControl({ x: 2, y: 0 }),
          placeFuel({ x: 3, y: 0 }, { U235: 1 }),
        ],
        config,
      );

      expect(s1.neutrons.size).toBe(1);
      expect(s1.controlRods.size).toBe(1);
      expect(s1.fuelRods.size).toBe(1);

      // Entity ids are issued in submission order.
      expect(s1.neutrons.has(nid(1))).toBe(true);
      expect(s1.controlRods.has(cid(2))).toBe(true);
      expect(s1.fuelRods.has(fid(3))).toBe(true);
    });

    it('drops subsequent inputs in the same tick after a SCRAM', () => {
      const initial = createSimState(1, config);
      const s1 = advanceTick(
        initial,
        [scram(), placeControl({ x: 0, y: 0 }), inject()],
        config,
      );

      expect(s1.ended).toEqual({ reason: 'stabilized' });
      expect(s1.controlRods.size).toBe(0);
      expect(s1.neutrons.size).toBe(0);
    });
  });

  describe('determinism', () => {
    it('same inputs across N ticks produce identical state', () => {
      const inputsPerTick: readonly (readonly InputCommand[])[] = [
        [inject({ x: 0, y: 0 }, { x: 1, y: 0 })],
        [],
        [placeFuel({ x: 0, y: 0 }, { U235: 4, U238: 2 })],
        [],
        [placeControl({ x: 5, y: 5 })],
        [],
        [],
      ];

      const run = (): SimState => {
        let s = createSimState(7, config);
        for (const inputs of inputsPerTick) s = advanceTick(s, inputs, config);
        return s;
      };

      const a = run();
      const b = run();

      expect(a.tick).toBe(b.tick);
      expect(a.neutrons.size).toBe(b.neutrons.size);
      expect(a.controlRods.size).toBe(b.controlRods.size);
      expect(a.fuelRods.size).toBe(b.fuelRods.size);
      expect(a.prng).toEqual(b.prng);

      for (const [id, ra] of a.fuelRods) {
        const rb = b.fuelRods.get(id);
        expect(rb?.releaseSchedule).toEqual(ra.releaseSchedule);
      }
    });
  });
});
