import Phaser from "phaser";
import type { RuleId, RuleSummary } from "./types";

export interface MovementTuning {
  speedMultiplier: number;
  acceleration: number;
  drag: number;
  autoHop: boolean;
}

export interface RuleHost {
  readonly world: Phaser.Scene;
  readonly player: Phaser.Physics.Arcade.Sprite;
  readonly arena: Phaser.Geom.Rectangle;
  readonly reducedMotion: boolean;
  readonly movement: MovementTuning;
  setFloor(color: number, alpha?: number): void;
  resetFloor(): void;
  isPlayerSafe(): boolean;
  isPlayerAirborne(): boolean;
  damage(message: string): void;
  react(message: string, emoji?: string): void;
  playSound(kind: "jump" | "collect" | "hit" | "throw" | "warning" | "emote" | "splash"): void;
  shake(amount?: number): void;
  restorePlayerAppearance(baseStyle?: boolean): void;
}

export interface RuleModule extends RuleSummary {
  activate(host: RuleHost): void;
  update(host: RuleHost, delta: number): void;
  deactivate(host: RuleHost): void;
}

abstract class TrackedRule implements RuleModule {
  abstract readonly id: RuleId;
  abstract readonly name: string;
  abstract readonly emoji: string;
  abstract readonly description: string;
  protected objects: Phaser.GameObjects.GameObject[] = [];
  protected timers: Phaser.Time.TimerEvent[] = [];
  protected elapsed = 0;

  activate(host: RuleHost): void {
    void host;
    this.elapsed = 0;
  }

  update(_host: RuleHost, delta: number): void {
    this.elapsed += delta;
  }

  deactivate(host: RuleHost): void {
    for (const timer of this.timers) timer.destroy();
    for (const object of this.objects) {
      host.world.tweens.killTweensOf(object);
      object.destroy();
    }
    this.timers = [];
    this.objects = [];
    host.world.tweens.killTweensOf(this.objects);
    host.resetFloor();
    host.movement.speedMultiplier = 1;
    host.movement.acceleration = 1500;
    host.movement.drag = 1300;
    host.movement.autoHop = false;
    host.restorePlayerAppearance(true);
  }

  protected track<T extends Phaser.GameObjects.GameObject>(object: T): T {
    this.objects.push(object);
    return object;
  }

  protected trackTimer(timer: Phaser.Time.TimerEvent): void {
    this.timers.push(timer);
  }

  protected circleBody(host: RuleHost, x: number, y: number, radius: number, color: number, alpha = 1): Phaser.GameObjects.Arc {
    const circle = this.track(host.world.add.circle(x, y, radius, color, alpha).setDepth(5));
    host.world.physics.add.existing(circle);
    const body = circle.body as Phaser.Physics.Arcade.Body;
    body.setCircle(radius);
    body.setCollideWorldBounds(true);
    return circle;
  }
}

class LavaRule extends TrackedRule {
  readonly id = "lava";
  readonly name = "THE FLOOR IS LAVA";
  readonly emoji = "🔥";
  readonly description = "Raised zones are safe. Everything else is extremely toasted.";
  private tick = 0;

  override activate(host: RuleHost): void {
    super.activate(host);
    this.tick = 0;
    host.setFloor(0xff5b24, 0.96);
    for (let index = 0; index < 18; index += 1) {
      const spark = this.track(host.world.add.circle(
        Phaser.Math.Between(65, 895),
        Phaser.Math.Between(80, 570),
        Phaser.Math.Between(2, 5),
        0xffd44f,
        0.8,
      ).setDepth(1));
      host.world.tweens.add({
        targets: spark,
        y: spark.y - Phaser.Math.Between(18, 45),
        alpha: 0.1,
        duration: Phaser.Math.Between(550, 1100),
        yoyo: true,
        repeat: -1,
      });
    }
  }

  override update(host: RuleHost, delta: number): void {
    super.update(host, delta);
    this.tick += delta;
    if (this.tick > 950 && !host.isPlayerSafe() && !host.isPlayerAirborne()) {
      this.tick = 0;
      host.damage("Hot feet! Find something raised.");
    }
  }
}

class WaterRule extends TrackedRule {
  readonly id = "water";
  readonly name = "TIDAL TROUBLE";
  readonly emoji = "🌊";
  readonly description = "The island is flooding. Swim slowly or scramble onto a platform.";
  private tick = 0;

  override activate(host: RuleHost): void {
    super.activate(host);
    this.tick = 0;
    host.setFloor(0x39aee8, 0.9);
    host.movement.speedMultiplier = 0.62;
    host.movement.drag = 700;
    const wave = this.track(host.world.add.rectangle(480, 610, 900, 50, 0x8ae9ff, 0.42).setDepth(3));
    host.world.tweens.add({
      targets: wave,
      y: 320,
      duration: 8500,
      ease: "Sine.inOut",
    });
    for (let index = 0; index < 20; index += 1) {
      const bubble = this.track(host.world.add.circle(
        Phaser.Math.Between(70, 890),
        Phaser.Math.Between(100, 580),
        Phaser.Math.Between(2, 7),
        0xffffff,
        0.35,
      ).setDepth(4));
      host.world.tweens.add({
        targets: bubble,
        y: bubble.y - 50,
        alpha: 0,
        duration: Phaser.Math.Between(900, 1800),
        repeat: -1,
      });
    }
  }

  override update(host: RuleHost, delta: number): void {
    super.update(host, delta);
    this.tick += delta;
    if (this.tick > 3500 && !host.isPlayerSafe()) {
      this.tick = 0;
      host.damage("Glub glub! Platforms are dry.");
      host.playSound("splash");
    }
  }
}

interface Chaser {
  object: Phaser.GameObjects.Arc;
  speed: number;
  damageCooldown: number;
}

abstract class ChaserRule extends TrackedRule {
  protected chasers: Chaser[] = [];

  protected spawnChaser(host: RuleHost, color: number, radius: number, speed: number, alpha = 1): Chaser {
    const edge = Phaser.Math.Between(0, 3);
    const positions = [
      [host.arena.left + 15, Phaser.Math.Between(host.arena.top, host.arena.bottom)],
      [host.arena.right - 15, Phaser.Math.Between(host.arena.top, host.arena.bottom)],
      [Phaser.Math.Between(host.arena.left, host.arena.right), host.arena.top + 15],
      [Phaser.Math.Between(host.arena.left, host.arena.right), host.arena.bottom - 15],
    ] as const;
    const position = positions[edge] ?? positions[0];
    const object = this.circleBody(host, position[0], position[1], radius, color, alpha);
    const chaser = { object, speed, damageCooldown: 0 };
    this.chasers.push(chaser);
    return chaser;
  }

  override update(host: RuleHost, delta: number): void {
    super.update(host, delta);
    for (const chaser of this.chasers) {
      if (!chaser.object.active) continue;
      const body = chaser.object.body as Phaser.Physics.Arcade.Body;
      const angle = Phaser.Math.Angle.Between(chaser.object.x, chaser.object.y, host.player.x, host.player.y);
      body.setVelocity(Math.cos(angle) * chaser.speed, Math.sin(angle) * chaser.speed);
      chaser.damageCooldown -= delta;
      if (chaser.damageCooldown <= 0 && Phaser.Math.Distance.Between(chaser.object.x, chaser.object.y, host.player.x, host.player.y) < 34 && !host.isPlayerAirborne()) {
        chaser.damageCooldown = 1400;
        this.hit(host);
      }
    }
  }

  protected abstract hit(host: RuleHost): void;

  override deactivate(host: RuleHost): void {
    this.chasers = [];
    super.deactivate(host);
  }
}

class GhostRule extends ChaserRule {
  readonly id = "ghosts";
  readonly name = "GHOSTS ARE COMING";
  readonly emoji = "👻";
  readonly description = "Spectral party crashers are following you. Keep moving.";

  override activate(host: RuleHost): void {
    super.activate(host);
    host.setFloor(0x433788, 0.62);
    const spawn = (): void => {
      const ghost = this.spawnChaser(host, 0xf4f1ff, 17, Phaser.Math.Between(75, 105), 0.82);
      const eyes = this.track(host.world.add.text(ghost.object.x, ghost.object.y, "••", {
        color: "#35256f",
        fontSize: "15px",
        fontStyle: "bold",
      }).setOrigin(0.5).setDepth(6));
      const timer = host.world.time.addEvent({
        delay: 30,
        loop: true,
        callback: () => eyes.setPosition(ghost.object.x, ghost.object.y - 2),
      });
      this.trackTimer(timer);
    };
    spawn();
    spawn();
    this.trackTimer(host.world.time.addEvent({ delay: 5200, repeat: 2, callback: spawn }));
  }

  protected hit(host: RuleHost): void {
    host.damage("A ghost said boo directly at you.");
  }
}

class FreezeRule extends TrackedRule {
  readonly id = "freeze";
  readonly name = "EVERYTHING FREEZES";
  readonly emoji = "🧊";
  readonly description = "The floor is slippery. Commit to the slide.";

  override activate(host: RuleHost): void {
    super.activate(host);
    host.setFloor(0xbfeeff, 0.94);
    host.movement.acceleration = 390;
    host.movement.drag = 75;
    host.movement.speedMultiplier = 1.18;
    for (let index = 0; index < 11; index += 1) {
      this.track(host.world.add.star(
        Phaser.Math.Between(80, 880),
        Phaser.Math.Between(90, 560),
        4,
        2,
        8,
        0xffffff,
        0.55,
      ).setDepth(3).setAngle(45));
    }
  }
}

class ChickenRule extends ChaserRule {
  readonly id = "chickens";
  readonly name = "CHICKEN ATTACK";
  readonly emoji = "🐔";
  readonly description = "The chickens have organized. This was inevitable.";

  override activate(host: RuleHost): void {
    super.activate(host);
    const spawn = (): void => {
      const chicken = this.spawnChaser(host, 0xfff4ca, 14, Phaser.Math.Between(110, 170));
      const face = this.track(host.world.add.text(chicken.object.x, chicken.object.y, "🐔", { fontSize: "25px" }).setOrigin(0.5).setDepth(7));
      chicken.object.setVisible(false);
      this.trackTimer(host.world.time.addEvent({
        delay: 30,
        loop: true,
        callback: () => face.setPosition(chicken.object.x, chicken.object.y),
      }));
    };
    for (let index = 0; index < 5; index += 1) spawn();
    this.trackTimer(host.world.time.addEvent({ delay: 3300, repeat: 3, callback: spawn }));
  }

  protected hit(host: RuleHost): void {
    host.damage("Pecked by a tiny professional.");
    const body = host.player.body as Phaser.Physics.Arcade.Body;
    body.setVelocity(body.velocity.x * -1.8, body.velocity.y * -1.8);
  }
}

interface PianoWarning {
  marker: Phaser.GameObjects.Arc;
  piano: Phaser.GameObjects.Container | null;
  landed: boolean;
  cooldown: number;
}

class PianoRule extends TrackedRule {
  readonly id = "pianos";
  readonly name = "PIANO PANIC";
  readonly emoji = "🎹";
  readonly description = "Red warning circles are not decorative. Move.";
  private warnings: PianoWarning[] = [];

  override activate(host: RuleHost): void {
    super.activate(host);
    const drop = (): void => {
      const x = Phaser.Math.Between(95, 865);
      const y = Phaser.Math.Between(110, 545);
      const marker = this.track(host.world.add.circle(x, y, 42, 0xff355e, 0.18).setStrokeStyle(5, 0xff355e, 0.9).setDepth(3));
      const warning: PianoWarning = { marker, piano: null, landed: false, cooldown: 0 };
      this.warnings.push(warning);
      host.world.tweens.add({
        targets: marker,
        scale: 0.72,
        alpha: 0.62,
        duration: 280,
        yoyo: true,
        repeat: 3,
        onComplete: () => {
          if (!marker.active) return;
          const body = host.world.add.rectangle(0, 0, 80, 50, 0x17103a).setStrokeStyle(4, 0xffffff);
          const keys = host.world.add.text(0, 7, "▮▯▮▯▮▯", { color: "#ffffff", fontSize: "23px" }).setOrigin(0.5);
          const piano = this.track(host.world.add.container(x, y - 260, [body, keys]).setDepth(9));
          warning.piano = piano;
          host.world.tweens.add({
            targets: piano,
            y,
            duration: host.reducedMotion ? 500 : 280,
            ease: "Quad.in",
            onComplete: () => {
              warning.landed = true;
              marker.setAlpha(0.05);
              host.shake(0.006);
            },
          });
        },
      });
    };
    drop();
    this.trackTimer(host.world.time.addEvent({ delay: 1900, loop: true, callback: drop }));
  }

  override update(host: RuleHost, delta: number): void {
    super.update(host, delta);
    for (const warning of this.warnings) {
      warning.cooldown -= delta;
      if (warning.landed && warning.cooldown <= 0 && Phaser.Math.Distance.Between(warning.marker.x, warning.marker.y, host.player.x, host.player.y) < 52 && !host.isPlayerAirborne()) {
        warning.cooldown = 2000;
        host.damage("You have been musically flattened.");
      }
    }
  }

  override deactivate(host: RuleHost): void {
    this.warnings = [];
    super.deactivate(host);
  }
}

class FrogRule extends TrackedRule {
  readonly id = "frog";
  readonly name = "EVERYONE IS A FROG";
  readonly emoji = "🐸";
  readonly description = "You are green, springy, and suddenly very interested in flies.";
  private hopTimer = 0;

  override activate(host: RuleHost): void {
    super.activate(host);
    this.hopTimer = 0;
    host.setFloor(0x6fca62, 0.66);
    host.movement.speedMultiplier = 1.25;
    host.movement.autoHop = true;
    host.player.setTint(0x69ef73);
    host.player.setScale(0.82, 1.08);
    host.react("Ribbit responsibly.", "🐸");
  }

  override update(host: RuleHost, delta: number): void {
    super.update(host, delta);
    this.hopTimer += delta;
    if (this.hopTimer > 1200) {
      this.hopTimer = 0;
      host.playSound("jump");
    }
  }
}

export const RULES: Record<RuleId, RuleModule> = {
  lava: new LavaRule(),
  water: new WaterRule(),
  ghosts: new GhostRule(),
  freeze: new FreezeRule(),
  chickens: new ChickenRule(),
  pianos: new PianoRule(),
  frog: new FrogRule(),
};
