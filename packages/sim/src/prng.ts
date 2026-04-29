// xorshift32 — see ADR-012. Pure functional: each call returns a fresh state.
export type PRNGState = { readonly s: number };

const NONZERO_FALLBACK = 0x9e3779b9;

export function createPRNG(seed: number): PRNGState {
  const s = seed | 0;
  return { s: s === 0 ? NONZERO_FALLBACK : s };
}

export function next(state: PRNGState): readonly [number, PRNGState] {
  let s = state.s;
  s ^= s << 13;
  s ^= s >>> 17;
  s ^= s << 5;
  s |= 0;
  const value = (s >>> 0) / 0x100000000;
  return [value, { s }];
}

export function nextRange(
  state: PRNGState,
  min: number,
  max: number,
): readonly [number, PRNGState] {
  const [v, after] = next(state);
  return [min + v * (max - min), after];
}

export function nextInt(
  state: PRNGState,
  minInclusive: number,
  maxExclusive: number,
): readonly [number, PRNGState] {
  const [v, after] = next(state);
  return [Math.floor(minInclusive + v * (maxExclusive - minInclusive)), after];
}

export function nextAngle(state: PRNGState): readonly [number, PRNGState] {
  return nextRange(state, 0, Math.PI * 2);
}
