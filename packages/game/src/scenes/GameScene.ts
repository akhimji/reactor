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

function simToPixelX(simX: number): number {
  return simX * PIXELS_PER_UNIT + CENTER_PX;
}
function simToPixelY(simY: number): number {
  // Sim Y is mathematical (up = +). Phaser Y is screen (down = +). Invert.
  return -simY * PIXELS_PER_UNIT + CENTER_PX;
}
function pixelToSimX(pxX: number): number {
  return (pxX - CENTER_PX) / PIXELS_PER_UNIT;
}
function pixelToSimY(pxY: number): number {
  return -(pxY - CENTER_PX) / PIXELS_PER_UNIT;
}

export class GameScene extends Phaser.Scene {
  private sim!: Sim;
  private readonly atomSprites = new Map<AtomId, Phaser.GameObjects.Arc>();
  private readonly neutronSprites = new Map<NeutronId, Phaser.GameObjects.Arc>();
  private pendingInputs: InputCommand[] = [];

  private accumulator = 0;
  private lastTime = 0;

  private overlayLeft!: HTMLElement;
  private overlayRight!: HTMLElement;
  private endBanner: string | null = null;

  constructor() {
    super({ key: 'GameScene' });
  }

  create(): void {
    const config = loadConfig(defaultConfig);
    // Fixed seed (42) so the prototype is reproducible session-to-session.
    // Site-driven seeding lands when the Site system is wired.
    this.sim = new Sim(config, 42);

    this.cameras.main.setBackgroundColor('#000000');

    this.setupSubscriptions();
    this.setupInput();
    this.setupOverlay();

    this.lastTime = performance.now();
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

    this.render();
    this.updateOverlay();
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
    });
  }

  private setupInput(): void {
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      const simX = pixelToSimX(pointer.x);
      const simY = pixelToSimY(pointer.y);
      const len = Math.hypot(simX, simY);
      if (len === 0) return; // can't normalize a zero vector
      this.pendingInputs.push({
        type: 'injectNeutron',
        position: { x: simX, y: simY },
        direction: { x: simX / len, y: simY / len },
      });
    });
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
      `tick  ${state.tick}\nk     ${k.toFixed(3)}\nzone  ${zone}${banner}`;
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
