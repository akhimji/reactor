import type { SimConfig } from './config.js';
import type { Atom, AtomId, Neutron, NeutronId, Vec2 } from './types.js';

// One collision candidate: a neutron's swept path this tick passes within an
// atom's collision radius. Pair construction is geometry only; spawn-order
// resolution and per-tick atom exclusion (ADR-020) are phase 4's job.
export type CollisionPair = {
  readonly neutronId: NeutronId;
  readonly atomId: AtomId;
  // Closest point on the neutron's swept segment to the atom's center. Reserved
  // for future renderer use (hit-spark placement, particle origin); v1 phase 4
  // does not read it.
  readonly intersectionPoint: Vec2;
};

// O(n×m) brute force where n=neutrons, m=atoms. Spatial partitioning deferred
// per ADR-024 (collision algorithm choice) and ADR-008 (premature optimization).
//
// Same-tick handling:
// - Newly-spawned atoms (atom.spawnedAt may equal currentTick) are INCLUDED
//   per ADR-019. The interface treats all atoms uniformly; no spawn-tick check
//   is required because phase 4 wants same-tick atom collisions.
// - Newly-spawned neutrons (neutron.spawnedAt === currentTick) are EXCLUDED
//   per ADR-016. They have not moved this tick and have no swept path — their
//   previous position equals their current position. They become eligible on
//   the next tick once phase 3 has advanced them.
//
// Detection method is swept (line-segment vs circle), not point-in-circle, so
// fast neutrons cannot tunnel through atoms whose diameter is smaller than one
// step. The previous position is reconstructed as `current - velocity`, which
// is exact under the fixed-rate sim model: neutrons move by exactly one
// velocity vector per tick (ADR-005, spec §4.2).
export function findNeutronAtomCollisions(
  neutrons: ReadonlyMap<NeutronId, Neutron>,
  atoms: ReadonlyMap<AtomId, Atom>,
  currentTick: number,
  _config: SimConfig,
): CollisionPair[] {
  const pairs: CollisionPair[] = [];
  if (neutrons.size === 0 || atoms.size === 0) return pairs;

  for (const [neutronId, neutron] of neutrons) {
    if (neutron.spawnedAt === currentTick) continue;

    const prev: Vec2 = {
      x: neutron.position.x - neutron.velocity.vx,
      y: neutron.position.y - neutron.velocity.vy,
    };
    const curr = neutron.position;

    for (const [atomId, atom] of atoms) {
      const r = atom.collisionRadius;
      const closest = closestPointOnSegment(prev, curr, atom.position);
      const dx = closest.x - atom.position.x;
      const dy = closest.y - atom.position.y;
      const distSq = dx * dx + dy * dy;
      if (distSq <= r * r) {
        pairs.push({ neutronId, atomId, intersectionPoint: closest });
      }
    }
  }
  return pairs;
}

function closestPointOnSegment(a: Vec2, b: Vec2, p: Vec2): Vec2 {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return a;
  const t = clamp01(((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq);
  return { x: a.x + t * dx, y: a.y + t * dy };
}

function clamp01(t: number): number {
  if (t < 0) return 0;
  if (t > 1) return 1;
  return t;
}
