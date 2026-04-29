import { describe, expect, it } from 'vitest';
import defaultConfig from '../configs/default.json' with { type: 'json' };
import { advanceTick, createSimState, loadConfig, next } from '../src/index.js';

const config = loadConfig(defaultConfig);

describe('sim core skeleton', () => {
  it('advances tick counter by exactly 1', () => {
    const s0 = createSimState(42, config);
    const s1 = advanceTick(s0, [], config);
    expect(s1.tick).toBe(s0.tick + 1);
  });

  it('produces identical state from identical inputs (determinism placeholder)', () => {
    const a = advanceTick(createSimState(42, config), [], config);
    const b = advanceTick(createSimState(42, config), [], config);
    expect(a).toStrictEqual(b);
  });

  it('starts with no entities and no end state', () => {
    const s = createSimState(42, config);
    expect(s.atoms.size).toBe(0);
    expect(s.neutrons.size).toBe(0);
    expect(s.controlRods.size).toBe(0);
    expect(s.fuelRods.size).toBe(0);
    expect(s.ended).toBeNull();
    expect(s.tick).toBe(0);
  });

  it('PRNG returns the same sequence for the same seed', () => {
    const s = createSimState(42, config);
    const [a1, after1] = next(s.prng);
    const [a2] = next(after1);
    const t = createSimState(42, config);
    const [b1, after2] = next(t.prng);
    const [b2] = next(after2);
    expect(a1).toBe(b1);
    expect(a2).toBe(b2);
  });
});
