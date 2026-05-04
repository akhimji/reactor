import Phaser from 'phaser';
import {
  loadConfig,
  Sim,
  type AtomId,
  type AtomState,
  type AtomType,
  type InputCommand,
  type NeutronId,
} from '@reactor/sim';
import defaultConfig from '@reactor/sim/configs/default.json' with { type: 'json' };

// Sim playfield is centered, ±50 units on each axis (ADR-013). Render at
// 8 px / sim unit → 800×800 px canvas, sim origin at canvas (400, 400).
const PLAYFIELD_HALF_UNITS = 50;
const PIXELS_PER_UNIT = 8;
export const CANVAS_SIZE = PLAYFIELD_HALF_UNITS * 2 * PIXELS_PER_UNIT;
const CENTER_PX = CANVAS_SIZE / 2;

// ADR-037: fixed-step accumulator. Sim runs at 60Hz regardless of refresh rate.
const TICK_MS = 1000 / 60;
const MAX_TICKS_PER_FRAME = 5;

const NEUTRON_RADIUS_PX = 3;
const NEUTRON_COLOR = 0xffffff;

// Placeholder palette per ADR-036 — primitives, no design intent.
const ATOM_COLORS: Record<AtomType, number> = {
  U235: 0xffd700,
  U238: 0x808080,
  Pu239: 0xff4500,
  B10: 0x1e90ff,
};

const STATE_ALPHA: Record<AtomState, number> = {
  intact: 1.0,
  excited: 1.0,
  splitting: 0.5,
  spent: 0.2,
};

// Sim playfield is centered on (0, 0), spanning [-PLAYFIELD_HALF_UNITS,
// +PLAYFIELD_HALF_UNITS] on each axis. Pixel space is [0, CANVAS_SIZE]
// with origin at top-left and Y growing downward (Phaser/screen convention),
// while sim Y is mathematical (up = +). The canonical re-centering form
// (simX + 50) * 8 makes the offset explicit; (50 - simY) * 8 inverts Y in
// the same expression.
function simToPixelX(simX: number): number {
  return (simX + PLAYFIELD_HALF_UNITS) * PIXELS_PER_UNIT;
}
function simToPixelY(simY: number): number {
  return (PLAYFIELD_HALF_UNITS - simY) * PIXELS_PER_UNIT;
}
function pixelToSimX(pxX: number): number {
  return pxX / PIXELS_PER_UNIT - PLAYFIELD_HALF_UNITS;
}
function pixelToSimY(pxY: number): number {
  return PLAYFIELD_HALF_UNITS - pxY / PIXELS_PER_UNIT;
}

// Given a cursor position in sim coords, return the edge-spawn point on the
// opposite side of the playfield (so a neutron launched from edge → cursor
// crosses the playfield) and the unit direction toward the cursor. Returns
// null if the cursor is at the origin (no defined direction).
function computeEdgeSpawn(
  cursorSimX: number,
  cursorSimY: number,
): { edge: { x: number; y: number }; dir: { x: number; y: number } } | null {
  const m = Math.max(Math.abs(cursorSimX), Math.abs(cursorSimY));
  if (m < 1e-6) return null;
  const scale = PLAYFIELD_HALF_UNITS / m;
  const edge = { x: -cursorSimX * scale, y: -cursorSimY * scale };
  const dx = cursorSimX - edge.x;
  const dy = cursorSimY - edge.y;
  const len = Math.hypot(dx, dy);
  return { edge, dir: { x: dx / len, y: dy / len } };
}

export class GameScene extends Phaser.Scene {
  private sim!: Sim;
  private readonly atomSprites = new Map<AtomId, Phaser.GameObjects.Arc>();
  private readonly neutronSprites = new Map<NeutronId, Phaser.GameObjects.Arc>();
  private pendingInputs: InputCommand[] = [];

  private accumulator = 0;
  private lastTime = 0;

  // Rolling 1-second counters for the debug overlay. Reset each time
  // wallclock crosses a second boundary; sim TPS verifies the accumulator
  // is keeping pace at 60Hz regardless of display refresh rate.
  private tickCountSecond = 0;
  private frameCountSecond = 0;
  private secondStartedAt = 0;
  private simTps = 0;
  private fps = 0;

  private overlayLeft!: HTMLElement;
  private overlayRight!: HTMLElement;
  private instructionsOverlay: HTMLElement | null = null;
  private hasReceivedFirstInput = false;
  private endBanner: string | null = null;

  private aimLine!: Phaser.GameObjects.Graphics;
  private cooldownIndicator!: Phaser.GameObjects.Graphics;
  private mouseSimX = 0;
  private mouseSimY = 0;
  private mousePxX = 0;
  private mousePxY = 0;
  private mouseInside = false;
  private injectCooldownTicks = 0;

  private simConfig!: ReturnType<typeof loadConfig>;
  private restartButton: HTMLButtonElement | null = null;

  constructor() {
    super({ key: 'GameScene' });
  }

  create(): void {
    const baseConfig = loadConfig(defaultConfig);
    // ADR-038: prototype-mode extinction grace is extended to 1800 ticks
    // (30 s) so a tester can orient before the run dies. Production Sites
    // set their own grace via Site config when the Site system lands.
    this.simConfig = loadConfig({
      ...baseConfig,
      endConditions: { ...baseConfig.endConditions, extinctionGracePeriod: 1800 },
    });
    this.injectCooldownTicks = this.simConfig.actions.injectCooldown;

    this.cameras.main.setBackgroundColor('#000000');

    this.setupInput();
    this.setupOverlay();
    this.setupInstructions();
    this.logCoordinateVerification();

    this.initSim();

    this.lastTime = performance.now();
    this.secondStartedAt = this.lastTime;
  }

  // Constructs a fresh Sim instance, wires its subscriptions, and queues the
  // hardcoded fuel rod placement on tick 0. Called from create() and on
  // restart. Anything that depends on the *current* sim instance (subscriber
  // callbacks, cooldown reads) goes through this.sim and is naturally
  // updated when this.sim is replaced.
  private initSim(): void {
    // Fixed seed (42) so the prototype is reproducible session-to-session.
    // Site-driven seeding lands when the Site system is wired.
    this.sim = new Sim(this.simConfig, 42);
    this.setupSubscriptions();

    // Debug seed: hardcoded fuel rod at origin so there's something to see and
    // interact with. ~11 atoms across the rod's release schedule. Replaced by
    // Site config loading once the Site system is wired.
    this.pendingInputs.push({
      type: 'placeFuelRod',
      position: { x: 0, y: 0 },
      fuelMix: { U235: 8, U238: 2, Pu239: 1 },
    });
  }

  private restart(): void {
    for (const sprite of this.atomSprites.values()) sprite.destroy();
    this.atomSprites.clear();
    for (const sprite of this.neutronSprites.values()) sprite.destroy();
    this.neutronSprites.clear();
    this.endBanner = null;
    this.hasReceivedFirstInput = false;
    this.pendingInputs = [];
    this.accumulator = 0;
    this.lastTime = performance.now();
    this.hideRestartButton();
    this.setupInstructions();
    this.initSim();
  }

  override update(): void {
    const now = performance.now();
    const delta = now - this.lastTime;
    this.lastTime = now;
    this.accumulator += delta;

    let ticks = 0;
    while (this.accumulator >= TICK_MS && ticks < MAX_TICKS_PER_FRAME) {
      this.sim.tick(this.pendingInputs);
      this.pendingInputs = [];
      this.accumulator -= TICK_MS;
      ticks++;
    }
    // Spiral-of-death cap: drop accumulated debt rather than grinding through it.
    if (ticks === MAX_TICKS_PER_FRAME) {
      this.accumulator = 0;
    }

    this.tickCountSecond += ticks;
    this.frameCountSecond += 1;
    if (now - this.secondStartedAt >= 1000) {
      this.simTps = this.tickCountSecond;
      this.fps = this.frameCountSecond;
      this.tickCountSecond = 0;
      this.frameCountSecond = 0;
      this.secondStartedAt = now;
    }

    this.render();
    this.updateAimLine();
    this.updateCooldownIndicator();
    this.updateOverlay();
  }

  private updateCooldownIndicator(): void {
    this.cooldownIndicator.clear();
    if (!this.mouseInside) return;
    const state = this.sim.getState();
    const cx = this.mousePxX + 12;
    const cy = this.mousePxY + 12;
    const radius = 5;
    if (state.tick >= state.cooldowns.injectNeutron) {
      // Ready: empty outline.
      this.cooldownIndicator.lineStyle(1, 0xffffff, 1);
      this.cooldownIndicator.strokeCircle(cx, cy, radius);
    } else {
      const remaining = state.cooldowns.injectNeutron - state.tick;
      const progress =
        this.injectCooldownTicks > 0
          ? Math.max(0, Math.min(1, 1 - remaining / this.injectCooldownTicks))
          : 1;
      // Filled circle, color shifts gray (0x404040) → white (0xffffff) by
      // progress. Linear ramp on each channel — cheap and readable.
      const channel = Math.round(0x40 + progress * (0xff - 0x40));
      const fill = (channel << 16) | (channel << 8) | channel;
      this.cooldownIndicator.fillStyle(fill, 1);
      this.cooldownIndicator.fillCircle(cx, cy, radius);
    }
  }

  private updateAimLine(): void {
    this.aimLine.clear();
    if (!this.mouseInside) return;
    const geom = computeEdgeSpawn(this.mouseSimX, this.mouseSimY);
    if (!geom) return;
    this.aimLine.lineStyle(1, 0xffffff, 0.3);
    this.aimLine.beginPath();
    this.aimLine.moveTo(simToPixelX(geom.edge.x), simToPixelY(geom.edge.y));
    this.aimLine.lineTo(simToPixelX(this.mouseSimX), simToPixelY(this.mouseSimY));
    this.aimLine.strokePath();
  }

  // Sanity check that prints sim → pixel mappings for canonical points to
  // the console at startup. If atoms ever appear off-center, this is the
  // first place to look — the printed values must match the comments.
  private logCoordinateVerification(): void {
    const samples: Array<readonly [string, number, number]> = [
      ['origin       ', 0, 0],
      ['top edge     ', 0, PLAYFIELD_HALF_UNITS],
      ['bottom edge  ', 0, -PLAYFIELD_HALF_UNITS],
      ['left edge    ', -PLAYFIELD_HALF_UNITS, 0],
      ['right edge   ', PLAYFIELD_HALF_UNITS, 0],
    ];
    const lines = samples.map(
      ([label, sx, sy]) =>
        `  ${label} sim(${sx}, ${sy})  →  px(${simToPixelX(sx)}, ${simToPixelY(sy)})`,
    );
    console.log(
      `[reactor] coordinate map (canvas ${CANVAS_SIZE}×${CANVAS_SIZE}, ${PIXELS_PER_UNIT} px/unit):\n` +
        lines.join('\n') +
        `\n  expect: origin → (${CENTER_PX}, ${CENTER_PX}); corners at 0 and ${CANVAS_SIZE}.`,
    );
  }

  private setupSubscriptions(): void {
    this.sim.subscribe('atomSpawned', (e) => {
      const sprite = this.add.circle(
        simToPixelX(e.data.position.x),
        simToPixelY(e.data.position.y),
        PIXELS_PER_UNIT,
        ATOM_COLORS[e.data.type],
      );
      this.atomSprites.set(e.data.atomId, sprite);
    });

    // Decay path bypasses `spent` (ADR-028); destroy immediately.
    this.sim.subscribe('atomDecayed', (e) => {
      this.removeAtomSprite(e.data.atomId);
    });

    this.sim.subscribe('neutronSpawned', (e) => {
      const sprite = this.add.circle(
        simToPixelX(e.data.position.x),
        simToPixelY(e.data.position.y),
        NEUTRON_RADIUS_PX,
        NEUTRON_COLOR,
      );
      this.neutronSprites.set(e.data.neutronId, sprite);
    });

    this.sim.subscribe('neutronExpired', (e) => {
      this.removeNeutronSprite(e.data.neutronId);
    });

    this.sim.subscribe('neutronAbsorbed', (e) => {
      this.removeNeutronSprite(e.data.neutronId);
    });

    this.sim.subscribe('criticalityZoneChanged', (e) => {
      console.log(
        `[reactor] zone: ${e.data.previousZone} → ${e.data.newZone} (k=${e.data.k.toFixed(3)})`,
      );
    });

    this.sim.subscribe('runEnded', (e) => {
      this.endBanner = `RUN ENDED — ${e.data.outcome.toUpperCase()} @ tick ${e.data.finalTick} | score ${e.data.finalScore}`;
      console.log(`[reactor] ${this.endBanner}`);
      this.showRestartButton();
    });
  }

  private showRestartButton(): void {
    if (this.restartButton) return;
    const host = document.getElementById('game') ?? document.body;
    const btn = document.createElement('button');
    btn.id = 'restart-button';
    btn.type = 'button';
    btn.textContent = '[ RESTART ]';
    btn.addEventListener('click', () => this.restart());
    host.appendChild(btn);
    this.restartButton = btn;
  }

  private hideRestartButton(): void {
    if (!this.restartButton) return;
    this.restartButton.remove();
    this.restartButton = null;
  }

  private setupInput(): void {
    this.aimLine = this.add.graphics();
    // cooldownIndicator draws above everything; bring to top after creation.
    this.cooldownIndicator = this.add.graphics();
    this.cooldownIndicator.setDepth(10);

    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      this.mousePxX = pointer.x;
      this.mousePxY = pointer.y;
      this.mouseSimX = pixelToSimX(pointer.x);
      this.mouseSimY = pixelToSimY(pointer.y);
      this.mouseInside =
        pointer.x >= 0 &&
        pointer.x <= CANVAS_SIZE &&
        pointer.y >= 0 &&
        pointer.y <= CANVAS_SIZE;
    });

    // Phaser stops firing pointermove once the cursor leaves the canvas, so
    // hook the DOM canvas element directly to clear the aim line.
    const canvas = this.game.canvas;
    canvas.addEventListener('mouseleave', () => {
      this.mouseInside = false;
    });
    canvas.addEventListener('mouseenter', () => {
      this.mouseInside = true;
    });

    // Click semantics: a click anywhere on the canvas spawns a neutron at
    // the playfield edge OPPOSITE the cursor and travels TOWARD the cursor.
    // The preview line in updateAimLine() shares the same computeEdgeSpawn
    // geometry, so what the player sees is what they get.
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      // Always show a click flash, even if the sim later rejects the input
      // (cooldown, run-ended). The player must see SOMETHING happened.
      this.spawnClickFlash(pointer.x, pointer.y);

      const cursorSimX = pixelToSimX(pointer.x);
      const cursorSimY = pixelToSimY(pointer.y);
      const geom = computeEdgeSpawn(cursorSimX, cursorSimY);
      if (!geom) return;
      this.pendingInputs.push({
        type: 'injectNeutron',
        position: geom.edge,
        direction: geom.dir,
      });
      if (!this.hasReceivedFirstInput) {
        this.hasReceivedFirstInput = true;
        this.dismissInstructions();
      }
    });
  }

  private spawnClickFlash(pxX: number, pxY: number): void {
    const flash = this.add.circle(pxX, pxY, 8, 0xffffff, 0.6);
    flash.setDepth(9);
    this.tweens.add({
      targets: flash,
      alpha: 0,
      duration: 200,
      onComplete: () => flash.destroy(),
    });
  }

  private setupInstructions(): void {
    const host = document.getElementById('game') ?? document.body;
    let el = document.getElementById('instructions-overlay');
    if (!el) {
      el = document.createElement('div');
      el.id = 'instructions-overlay';
      host.appendChild(el);
    }
    el.classList.remove('hidden');
    el.textContent =
      'REACTOR — PROTOTYPE\n' +
      'Click to fire a neutron at the reactor core.\n' +
      'Sustain the chain reaction to score points.';
    this.instructionsOverlay = el;
  }

  private dismissInstructions(): void {
    const el = this.instructionsOverlay;
    if (!el) return;
    this.instructionsOverlay = null;
    el.classList.add('hidden');
    window.setTimeout(() => el.remove(), 600);
  }

  private setupOverlay(): void {
    let overlay = document.getElementById('debug-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'debug-overlay';
      document.body.appendChild(overlay);
    }
    overlay.innerHTML = '<div class="col"></div><div class="col right"></div>';
    const [left, right] = overlay.children;
    this.overlayLeft = left as HTMLElement;
    this.overlayRight = right as HTMLElement;
  }

  private render(): void {
    const state = this.sim.getState();

    // Reconcile atom sprites against current state. Position + visual state
    // come from sim each frame; sprites whose atom was silently cleaned up
    // (ADR-027 spent-cleanup) get destroyed here.
    for (const [id, sprite] of this.atomSprites) {
      const atom = state.atoms.get(id);
      if (!atom) {
        sprite.destroy();
        this.atomSprites.delete(id);
        continue;
      }
      sprite.setPosition(simToPixelX(atom.position.x), simToPixelY(atom.position.y));
      sprite.setAlpha(STATE_ALPHA[atom.state]);
      if (atom.state === 'excited') {
        sprite.setStrokeStyle(1, 0xffffff);
      } else {
        sprite.setStrokeStyle();
      }
    }

    for (const [id, sprite] of this.neutronSprites) {
      const n = state.neutrons.get(id);
      if (!n) {
        sprite.destroy();
        this.neutronSprites.delete(id);
        continue;
      }
      sprite.setPosition(simToPixelX(n.position.x), simToPixelY(n.position.y));
    }
  }

  private updateOverlay(): void {
    const state = this.sim.getState();
    const k = state.criticality?.k ?? 0;
    const zone = state.criticality?.zone ?? '—';
    const banner = this.endBanner ? `\n${this.endBanner}` : '';
    this.overlayLeft.textContent =
      `tick  ${state.tick}\nk     ${k.toFixed(3)}\nzone  ${zone}\n` +
      `tps   ${this.simTps}\nfps   ${this.fps}\nacc   ${this.accumulator.toFixed(1)}ms${banner}`;
    this.overlayRight.textContent =
      `score    ${state.score}\natoms    ${state.atoms.size}\nneutrons ${state.neutrons.size}`;
  }

  private removeAtomSprite(id: AtomId): void {
    const sprite = this.atomSprites.get(id);
    if (sprite) {
      sprite.destroy();
      this.atomSprites.delete(id);
    }
  }

  private removeNeutronSprite(id: NeutronId): void {
    const sprite = this.neutronSprites.get(id);
    if (sprite) {
      sprite.destroy();
      this.neutronSprites.delete(id);
    }
  }
}
