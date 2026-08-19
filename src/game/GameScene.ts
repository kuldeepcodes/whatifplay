import Phaser from "phaser";
import type { SillyAudio } from "./audio";
import { RULES, type MovementTuning, type RuleHost, type RuleModule } from "./rules";
import { seededRuleOrder } from "./customRules";
import type { Modifier, RuleId, RunConfig } from "./types";

const WORLD_WIDTH = 960;
const WORLD_HEIGHT = 640;
const PHASE_SECONDS = 20;
const RUN_SECONDS = 300;

interface TouchState {
  x: number;
  y: number;
}

interface HeldProp {
  object: Phaser.Physics.Arcade.Image;
}

interface BonusChicken {
  object: Phaser.GameObjects.Text;
  velocity: Phaser.Math.Vector2;
  cooldown: number;
}

interface HudPayload {
  score?: number;
  health?: number;
  rule?: string;
  timer?: number;
  kicker?: string;
}

export class GameScene extends Phaser.Scene implements RuleHost {
  readonly arena = new Phaser.Geom.Rectangle(45, 55, 870, 535);
  readonly movement: MovementTuning = {
    speedMultiplier: 1,
    acceleration: 1500,
    drag: 1300,
    autoHop: false,
  };
  readonly reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  readonly world: Phaser.Scene = this;
  player!: Phaser.Physics.Arcade.Sprite;
  safeZones!: Phaser.Physics.Arcade.StaticGroup;

  private floor!: Phaser.GameObjects.Ellipse;
  private props!: Phaser.Physics.Arcade.Group;
  private collectibles!: Phaser.Physics.Arcade.StaticGroup;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private keys!: Record<"up" | "down" | "left" | "right" | "jump" | "grab" | "emote" | "pause" | "escape", Phaser.Input.Keyboard.Key>;
  private config!: RunConfig;
  private audio!: SillyAudio;
  private touch: TouchState = { x: 0, y: 0 };
  private currentRule: RuleModule | null = null;
  private ruleOrder: RuleId[] = [];
  private phaseElapsed = 0;
  private runElapsed = 0;
  private warningSecond = -1;
  private score = 0;
  private health = 5;
  private held: HeldProp | null = null;
  private airborneUntil = 0;
  private invulnerableUntil = 0;
  private gameOver = false;
  private secretFound = false;
  private reactionText!: Phaser.GameObjects.Text;
  private countdownText!: Phaser.GameObjects.Text;
  private playerHat!: Phaser.GameObjects.Text;
  private customModifiers = new Set<Modifier>();
  private autoHopElapsed = 0;
  private bonusChickens: BonusChicken[] = [];

  constructor() {
    super("arena");
  }

  init(data: { config: RunConfig; audio: SillyAudio }): void {
    this.config = data.config;
    this.audio = data.audio;
    this.customModifiers = new Set(data.config.challenge?.modifiers ?? []);
    this.currentRule = null;
    this.phaseElapsed = 0;
    this.runElapsed = 0;
    this.warningSecond = -1;
    this.score = 0;
    this.health = 5;
    this.held = null;
    this.airborneUntil = 0;
    this.invulnerableUntil = 0;
    this.gameOver = false;
    this.secretFound = false;
    this.autoHopElapsed = 0;
    this.touch = { x: 0, y: 0 };
    this.movement.speedMultiplier = 1;
    this.movement.acceleration = 1500;
    this.movement.drag = 1300;
    this.movement.autoHop = false;
  }

  create(): void {
    this.physics.world.setBounds(this.arena.left, this.arena.top, this.arena.width, this.arena.height);
    this.createTextures();
    this.createArena();
    this.createPlayer();
    this.createProps();
    this.createCollectibles();
    this.createBonusChickens();
    this.createInput();
    this.createEffects();
    this.layoutCamera(this.scale.width, this.scale.height);
    this.scale.on(Phaser.Scale.Events.RESIZE, this.handleResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.cleanup, this);
    this.game.events.on("touch-move", this.handleTouchMove, this);
    this.game.events.on("touch-action", this.handleTouchAction, this);
    this.game.events.on("request-pause", this.togglePause, this);

    const seed = this.config.challenge?.seed ?? Date.now();
    this.ruleOrder = seededRuleOrder(seed);
    this.emitHud({ score: 0, health: 5, rule: "Warm-up", timer: 4, kicker: "GET READY" });
    this.time.delayedCall(900, () => this.react(this.config.challenge?.name ?? "Stay weird. Stay alive.", "✨"));
  }

  update(_time: number, delta: number): void {
    if (this.gameOver || this.scene.isPaused()) return;
    this.runElapsed += delta;
    this.phaseElapsed += delta;
    this.updateMovement(delta);
    this.updateHeldProp();
    this.updateHat();
    this.updateBonusChickens(delta);
    this.checkSecret();
    this.currentRule?.update(this, delta);

    const phaseDuration = this.currentRule ? PHASE_SECONDS * 1000 : 4000;
    const remaining = Math.max(0, Math.ceil((phaseDuration - this.phaseElapsed) / 1000));
    this.emitHud({ timer: remaining });

    if (this.currentRule && remaining <= 3 && remaining !== this.warningSecond) {
      this.warningSecond = remaining;
      this.showCountdown(remaining);
    }

    if (this.phaseElapsed >= phaseDuration) this.advanceRule();
    if (this.runElapsed >= RUN_SECONDS * 1000) this.finishRun(true);
  }

  setFloor(color: number, alpha = 1): void {
    this.floor.setFillStyle(color, alpha);
  }

  resetFloor(): void {
    this.floor.setFillStyle(0x58bf67, 1);
  }

  isPlayerSafe(): boolean {
    let safe = false;
    this.physics.overlap(this.player, this.safeZones, () => {
      safe = true;
    });
    return safe;
  }

  isPlayerAirborne(): boolean {
    return this.time.now < this.airborneUntil;
  }

  damage(message: string): void {
    if (this.time.now < this.invulnerableUntil || this.gameOver) return;
    this.health -= 1;
    this.invulnerableUntil = this.time.now + 2500;
    this.emitHud({ health: this.health });
    this.playSound("hit");
    this.shake();
    this.react(message, "💥");
    this.player.setTintFill(0xffffff);
    this.time.delayedCall(130, () => {
      if (this.player.active) this.restorePlayerAppearance();
    });
    if (this.health <= 0) this.finishRun(false);
  }

  react(message: string, emoji = "😜"): void {
    if (!this.reactionText.active) return;
    this.reactionText.setText(`${emoji} ${message}`).setPosition(this.player.x, this.player.y - 48).setAlpha(1).setScale(0.8);
    this.tweens.killTweensOf(this.reactionText);
    this.tweens.add({
      targets: this.reactionText,
      y: this.reactionText.y - 30,
      alpha: 0,
      scale: 1,
      duration: this.reducedMotion ? 350 : 900,
      ease: "Cubic.out",
    });
  }

  playSound(kind: "jump" | "collect" | "hit" | "throw" | "warning" | "emote" | "splash"): void {
    this.audio.play(kind);
  }

  shake(amount = 0.004): void {
    if (!this.reducedMotion) this.cameras.main.shake(110, amount);
  }

  restorePlayerAppearance(baseStyle = false): void {
    const color = !baseStyle && this.currentRule?.id === "frog"
      ? 0x69ef73
      : Phaser.Display.Color.HexStringToColor(this.config.style.color).color;
    this.player.setTint(color);
    this.player.setScale(this.customModifiers.has("tiny") ? 0.58 : 1);
    this.playerHat.setScale(this.customModifiers.has("tiny") ? 0.7 : 1);
  }

  private createTextures(): void {
    const graphics = this.make.graphics({ x: 0, y: 0 });
    graphics.fillStyle(0xffffff);
    graphics.fillCircle(22, 22, 18);
    graphics.fillStyle(0x2c155f);
    graphics.fillCircle(16, 19, 3);
    graphics.fillCircle(28, 19, 3);
    graphics.lineStyle(3, 0x2c155f);
    graphics.beginPath();
    graphics.arc(22, 23, 7, 0.15, Math.PI - 0.15);
    graphics.strokePath();
    graphics.generateTexture("player", 44, 44);
    graphics.clear();
    graphics.fillStyle(0xffd44f);
    graphics.fillRoundedRect(2, 2, 28, 28, 7);
    graphics.lineStyle(3, 0x17103a);
    graphics.strokeRoundedRect(2, 2, 28, 28, 7);
    graphics.generateTexture("prop", 32, 32);
    graphics.clear();
    graphics.fillStyle(0xffffff);
    const starPoints = Array.from({ length: 10 }, (_, index) => {
      const angle = -Math.PI / 2 + index * Math.PI / 5;
      const radius = index % 2 === 0 ? 15 : 7;
      return new Phaser.Math.Vector2(16 + Math.cos(angle) * radius, 16 + Math.sin(angle) * radius);
    });
    graphics.fillPoints(starPoints, true);
    graphics.generateTexture("star", 32, 32);
    graphics.destroy();
  }

  private createArena(): void {
    this.add.rectangle(WORLD_WIDTH / 2, WORLD_HEIGHT / 2, WORLD_WIDTH, WORLD_HEIGHT, 0x49b8da);
    for (let index = 0; index < 14; index += 1) {
      this.add.circle(Phaser.Math.Between(15, 945), Phaser.Math.Between(15, 625), Phaser.Math.Between(3, 8), 0x9be8f0, 0.35);
    }
    this.floor = this.add.ellipse(480, 322, 900, 570, 0x58bf67).setStrokeStyle(12, 0xf2d28d).setDepth(0);

    const path = this.add.graphics().setDepth(1);
    path.fillStyle(0xf0cc82, 0.4);
    path.fillRoundedRect(390, 80, 160, 475, 60);
    path.fillStyle(0x2e9555, 0.65);
    for (let index = 0; index < 28; index += 1) {
      path.fillCircle(Phaser.Math.Between(75, 885), Phaser.Math.Between(90, 560), Phaser.Math.Between(3, 9));
    }

    this.safeZones = this.physics.add.staticGroup();
    const zones = [
      { x: 220, y: 180, width: 170, height: 70, color: 0x9d6ce5, label: "STAGE" },
      { x: 650, y: 190, width: 155, height: 75, color: 0xffa94d, label: "PICNIC" },
      { x: 470, y: 455, width: 190, height: 80, color: 0x6ed4d0, label: "DOCK" },
    ];
    for (const zone of zones) {
      const platform = this.add.rectangle(zone.x, zone.y, zone.width, zone.height, zone.color)
        .setStrokeStyle(5, 0x17103a, 0.75)
        .setDepth(2);
      this.add.text(zone.x, zone.y, zone.label, {
        color: "#17103a",
        fontSize: "15px",
        fontStyle: "bold",
      }).setOrigin(0.5).setDepth(3).setAlpha(0.65);
      this.safeZones.add(platform);
    }

    const shelter = this.add.container(790, 455).setDepth(3);
    shelter.add([
      this.add.rectangle(0, 15, 110, 72, 0xfff3cb).setStrokeStyle(5, 0x17103a),
      this.add.triangle(0, -32, -70, 20, 70, 20, 0, -35, 0xff5277).setStrokeStyle(5, 0x17103a),
      this.add.text(0, 14, "SNACK\nSHELTER", { align: "center", color: "#17103a", fontSize: "13px", fontStyle: "bold" }).setOrigin(0.5),
    ]);
    const shelterZone = this.add.rectangle(790, 470, 105, 65, 0xffffff, 0);
    this.safeZones.add(shelterZone);

    for (const [x, y, emoji] of [[105, 115, "🌴"], [845, 105, "🌴"], [115, 500, "🌺"], [870, 520, "🌴"], [330, 520, "🌻"]] as const) {
      this.add.text(x, y, emoji, { fontSize: "42px" }).setOrigin(0.5).setDepth(4);
    }

    this.add.rectangle(895, 325, 36, 120, 0x2d8d4c).setDepth(4);
    this.add.text(900, 325, "🌿\n🌿\n🌿", { fontSize: "23px", lineSpacing: -7 }).setOrigin(0.5).setDepth(5);
    this.add.ellipse(930, 325, 95, 150, 0x2c8f72, 0.9).setDepth(1);
    this.add.text(930, 325, "?", { color: "#ffffff", fontSize: "34px", fontStyle: "bold" }).setOrigin(0.5).setAlpha(0.22).setDepth(2);
  }

  private createPlayer(): void {
    this.player = this.physics.add.sprite(480, 330, "player").setDepth(8).setTint(Phaser.Display.Color.HexStringToColor(this.config.style.color).color);
    this.player.setCircle(18, 4, 4);
    this.player.setCollideWorldBounds(true);
    const body = this.player.body as Phaser.Physics.Arcade.Body;
    body.setMaxVelocity(330, 330);
    body.setDrag(this.movement.drag);
    this.playerHat = this.add.text(this.player.x, this.player.y - 24, this.hatGlyph(), { fontSize: "25px" }).setOrigin(0.5).setDepth(9);
  }

  private createProps(): void {
    this.props = this.physics.add.group({ collideWorldBounds: true });
    const positions = [[330, 165], [570, 260], [710, 370], [260, 410], [590, 515], [750, 120]] as const;
    for (const [x, y] of positions) {
      const prop = this.physics.add.image(x, y, "prop").setDepth(6).setBounce(0.65).setDrag(180);
      prop.setData("held", false);
      this.props.add(prop);
    }
    this.physics.add.collider(this.props, this.props);
  }

  private createCollectibles(): void {
    this.collectibles = this.physics.add.staticGroup();
    const positions = [[175, 310], [300, 270], [465, 125], [630, 330], [800, 275], [420, 545], [690, 525], [902, 325]] as const;
    for (const [x, y] of positions) {
      const star = this.physics.add.staticImage(x, y, "star").setDepth(5);
      this.collectibles.add(star);
      if (!this.reducedMotion) {
        this.tweens.add({ targets: star, angle: 360, duration: 2700, repeat: -1 });
      }

    }
    this.physics.add.overlap(this.player, this.collectibles, (_player, object) => {
      const star = object as Phaser.Physics.Arcade.Image;
      if (!star.active) return;
      star.disableBody(true, true);
      this.score += 100;
      this.playSound("collect");
      this.emitHud({ score: this.score });
      this.react("+100 sparkle points", "⭐");
      this.burst(this.player.x, this.player.y, 0xffd44f);
    });
  }

  private createBonusChickens(): void {
    this.bonusChickens = [];
    if (!this.customModifiers.has("extraChickens")) return;
    for (let index = 0; index < 4; index += 1) {
      const object = this.add.text(
        Phaser.Math.Between(this.arena.left + 20, this.arena.right - 20),
        Phaser.Math.Between(this.arena.top + 20, this.arena.bottom - 20),
        "🐔",
        { fontSize: "27px" },
      ).setOrigin(0.5).setDepth(7);
      this.bonusChickens.push({
        object,
        velocity: new Phaser.Math.Vector2(Phaser.Math.Between(-90, 90), Phaser.Math.Between(-90, 90)),
        cooldown: 0,
      });
    }
  }

  private updateBonusChickens(delta: number): void {
    const seconds = delta / 1000;
    for (const chicken of this.bonusChickens) {
      const pursuit = new Phaser.Math.Vector2(this.player.x - chicken.object.x, this.player.y - chicken.object.y)
        .normalize()
        .scale(22);
      chicken.velocity.x = Phaser.Math.Linear(chicken.velocity.x, pursuit.x * 3, Math.min(1, seconds * 0.55));
      chicken.velocity.y = Phaser.Math.Linear(chicken.velocity.y, pursuit.y * 3, Math.min(1, seconds * 0.55));
      chicken.object.x += chicken.velocity.x * seconds;
      chicken.object.y += chicken.velocity.y * seconds;
      if (chicken.object.x <= this.arena.left || chicken.object.x >= this.arena.right) chicken.velocity.x *= -1;
      if (chicken.object.y <= this.arena.top || chicken.object.y >= this.arena.bottom) chicken.velocity.y *= -1;
      chicken.object.x = Phaser.Math.Clamp(chicken.object.x, this.arena.left, this.arena.right);
      chicken.object.y = Phaser.Math.Clamp(chicken.object.y, this.arena.top, this.arena.bottom);
      chicken.cooldown -= delta;
      if (chicken.cooldown <= 0 && !this.isPlayerAirborne() && Phaser.Math.Distance.Between(chicken.object.x, chicken.object.y, this.player.x, this.player.y) < 30) {
        chicken.cooldown = 1600;
        this.damage("Custom chicken delivery!");
      }
    }
  }

  private createInput(): void {
    if (!this.input.keyboard) throw new Error("Keyboard input is unavailable.");
    this.cursors = this.input.keyboard.createCursorKeys();
    this.keys = this.input.keyboard.addKeys({
      up: "W",
      down: "S",
      left: "A",
      right: "D",
      jump: "SPACE",
      grab: "E",
      emote: "Q",
      pause: "P",
      escape: "ESC",
    }) as typeof this.keys;
  }

  private createEffects(): void {
    this.reactionText = this.add.text(0, 0, "", {
      color: "#ffffff",
      backgroundColor: "#17103add",
      fontSize: "15px",
      fontStyle: "bold",
      padding: { x: 8, y: 5 },
    }).setOrigin(0.5).setDepth(30).setAlpha(0);
    this.countdownText = this.add.text(480, 320, "", {
      align: "center",
      color: "#fff9e8",
      fontSize: "100px",
      fontStyle: "bold",
      stroke: "#17103a",
      strokeThickness: 12,
    }).setOrigin(0.5).setDepth(40).setAlpha(0).setScrollFactor(0);
  }

  private updateMovement(delta: number): void {
    const body = this.player.body as Phaser.Physics.Arcade.Body;
    const keyboardX = Number(this.cursors.right.isDown || this.keys.right.isDown) - Number(this.cursors.left.isDown || this.keys.left.isDown);
    const keyboardY = Number(this.cursors.down.isDown || this.keys.down.isDown) - Number(this.cursors.up.isDown || this.keys.up.isDown);
    let x = Math.abs(this.touch.x) > Math.abs(keyboardX) ? this.touch.x : keyboardX;
    let y = Math.abs(this.touch.y) > Math.abs(keyboardY) ? this.touch.y : keyboardY;
    if (this.customModifiers.has("backwards")) {
      x *= -1;
      y *= -1;
    }
    const length = Math.hypot(x, y);
    if (length > 1) {
      x /= length;
      y /= length;
    }
    const canMove = !this.customModifiers.has("jumpOnly") || this.isPlayerAirborne();
    const modifierSpeed = this.customModifiers.has("speed") ? 1.55 : 1;
    const speed = 220 * this.movement.speedMultiplier * modifierSpeed;
    body.setDrag(this.movement.drag);
    if (canMove && (x !== 0 || y !== 0)) {
      body.setAcceleration(x * this.movement.acceleration, y * this.movement.acceleration);
      body.setMaxVelocity(speed, speed);
      this.player.setFlipX(x < 0);
    } else {
      body.setAcceleration(0);
    }

    if (this.movement.autoHop) {
      this.autoHopElapsed += delta;
      if (this.autoHopElapsed > 900) {
        this.autoHopElapsed = 0;
        this.jump();
      }
    }
    if (Phaser.Input.Keyboard.JustDown(this.keys.jump) || Phaser.Input.Keyboard.JustDown(this.cursors.space)) this.jump();
    if (Phaser.Input.Keyboard.JustDown(this.keys.grab)) this.grabOrThrow();
    if (Phaser.Input.Keyboard.JustDown(this.keys.emote)) this.emote();
    if (Phaser.Input.Keyboard.JustDown(this.keys.pause) || Phaser.Input.Keyboard.JustDown(this.keys.escape)) this.togglePause();
  }

  private jump(): void {
    if (this.isPlayerAirborne() || this.gameOver) return;
    const duration = this.customModifiers.has("lowGravity") || this.currentRule?.id === "frog" ? 780 : 470;
    this.airborneUntil = this.time.now + duration;
    this.playSound("jump");
    this.tweens.add({
      targets: [this.player, this.playerHat],
      scaleX: this.customModifiers.has("tiny") ? 0.62 : 1.22,
      scaleY: this.customModifiers.has("tiny") ? 0.62 : 1.22,
      yoyo: true,
      duration: duration / 2,
      ease: "Sine.out",
    });
  }

  private grabOrThrow(): void {
    if (this.held) {
      const prop = this.held.object;
      prop.setData("held", false);
      prop.enableBody(true, prop.x, prop.y, true, true);
      const body = this.player.body as Phaser.Physics.Arcade.Body;
      prop.setVelocity(body.velocity.x * 2.4 + (this.player.flipX ? -280 : 280), body.velocity.y * 2.4);
      this.held = null;
      this.playSound("throw");
      this.react("Delivery!", "📦");
      return;
    }
    let nearest: Phaser.Physics.Arcade.Image | null = null;
    let distance = 70;
    this.props.getChildren().forEach((child) => {
      const prop = child as Phaser.Physics.Arcade.Image;
      if (!prop.active || prop.getData("held") === true) return;
      const candidate = Phaser.Math.Distance.Between(this.player.x, this.player.y, prop.x, prop.y);
      if (candidate < distance) {
        distance = candidate;
        nearest = prop;
      }
    });
    if (nearest) {
      const prop: Phaser.Physics.Arcade.Image = nearest;
      prop.setData("held", true);
      prop.disableBody(false, false);
      this.held = { object: prop };
      this.react("Acquired: one thing.", "✋");
    } else {
      this.react("Nothing to grab over here.", "🤏");
    }
  }

  private updateHeldProp(): void {
    if (!this.held) return;
    const offset = this.player.flipX ? -31 : 31;
    this.held.object.setPosition(this.player.x + offset, this.player.y - 4).setDepth(9);
  }

  private updateHat(): void {
    this.playerHat.setPosition(this.player.x, this.player.y - (this.isPlayerAirborne() ? 31 : 24));
    this.playerHat.setVisible(this.config.style.accessory !== "none");
    if (this.customModifiers.has("tiny")) {
      this.player.setScale(this.isPlayerAirborne() ? this.player.scaleX : 0.58);
      this.playerHat.setScale(0.7);
    }
  }

  private hatGlyph(): string {
    return { crown: "♛", party: "🔺", leaf: "🍃", none: "" }[this.config.style.accessory];
  }

  private emote(): void {
    const reactions: [string, string][] = [["Truly athletic.", "😎"], ["I meant to do that.", "🤡"], ["Maximum effort!", "💪"], ["Behold!", "✨"]];
    const reaction = Phaser.Utils.Array.GetRandom(reactions);
    this.react(reaction[0], reaction[1]);
    this.playSound("emote");
  }

  private advanceRule(): void {
    this.currentRule?.deactivate(this);
    const completedPhases = Math.floor(Math.max(0, this.runElapsed - 4000) / (PHASE_SECONDS * 1000));
    const ruleId = this.ruleOrder[completedPhases % this.ruleOrder.length] ?? "lava";
    this.currentRule = RULES[ruleId];
    this.phaseElapsed = 0;
    this.warningSecond = -1;
    if (this.health < 5) {
      this.health += 1;
      this.emitHud({ health: this.health });
    }
    this.currentRule.activate(this);
    if (this.customModifiers.has("extraChickens") && ruleId !== "chickens") this.react("Bonus chickens remain on duty.", "🐔");
    this.emitHud({
      rule: this.config.challenge ? `${this.currentRule.emoji} ${this.config.challenge.name}` : `${this.currentRule.emoji} ${this.currentRule.name}`,
      timer: PHASE_SECONDS,
      kicker: this.currentRule.description,
    });
    this.showCountdown(`${this.currentRule.emoji}\nGO!`);
  }

  private showCountdown(value: number | string): void {
    if (value === 0) return;
    this.playSound("warning");
    this.countdownText.setText(String(value)).setAlpha(1).setScale(0.35);
    this.tweens.killTweensOf(this.countdownText);
    this.tweens.add({
      targets: this.countdownText,
      alpha: 0,
      scale: this.reducedMotion ? 0.9 : 1.3,
      duration: this.reducedMotion ? 300 : 700,
      ease: "Back.out",
    });
  }

  private burst(x: number, y: number, color: number): void {
    for (let index = 0; index < 9; index += 1) {
      const particle = this.add.circle(x, y, Phaser.Math.Between(2, 5), color).setDepth(20);
      const angle = (Math.PI * 2 * index) / 9;
      this.tweens.add({
        targets: particle,
        x: x + Math.cos(angle) * Phaser.Math.Between(25, 55),
        y: y + Math.sin(angle) * Phaser.Math.Between(25, 55),
        alpha: 0,
        duration: this.reducedMotion ? 250 : 600,
        onComplete: () => particle.destroy(),
      });
    }
  }

  private checkSecret(): void {
    if (this.secretFound || this.player.x < 875 || Math.abs(this.player.y - 325) > 75) return;
    this.secretFound = true;
    this.score += 500;
    this.emitHud({ score: this.score });
    this.react("Secret cove! +500", "🗝️");
    this.burst(this.player.x, this.player.y, 0x8df7d5);
  }

  private finishRun(survived: boolean): void {
    if (this.gameOver) return;
    this.gameOver = true;
    this.currentRule?.deactivate(this);
    this.currentRule = null;
    this.physics.pause();
    this.showCountdown(survived ? "🏆\nYOU SURVIVED!" : "💫\nBONKED!");
    this.time.delayedCall(1200, () => {
      this.game.events.emit("run-ended", {
        score: this.score + Math.floor(this.runElapsed / 100),
        survived,
      });
    });
  }

  private emitHud(payload: HudPayload): void {
    this.game.events.emit("hud", payload);
  }

  private togglePause(): void {
    this.game.events.emit("pause-changed");
  }

  private handleTouchMove(state: TouchState): void {
    this.touch = state;
  }

  private handleTouchAction(action: "jump" | "grab" | "emote"): void {
    if (action === "jump") this.jump();
    if (action === "grab") this.grabOrThrow();
    if (action === "emote") this.emote();
  }

  private handleResize(gameSize: Phaser.Structs.Size): void {
    this.layoutCamera(gameSize.width, gameSize.height);
  }

  private layoutCamera(width: number, height: number): void {
    const zoom = Math.min(width / WORLD_WIDTH, height / WORLD_HEIGHT);
    this.cameras.main.setZoom(zoom).centerOn(WORLD_WIDTH / 2, WORLD_HEIGHT / 2);
  }

  private cleanup(): void {
    this.currentRule?.deactivate(this);
    this.currentRule = null;
    this.scale.off(Phaser.Scale.Events.RESIZE, this.handleResize, this);
    this.game.events.off("touch-move", this.handleTouchMove, this);
    this.game.events.off("touch-action", this.handleTouchAction, this);
    this.game.events.off("request-pause", this.togglePause, this);
    this.bonusChickens = [];
  }
}
