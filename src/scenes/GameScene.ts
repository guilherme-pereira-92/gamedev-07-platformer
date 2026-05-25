import Phaser from "phaser";
import { COLOR_HEX, TEXT_PRESETS } from "../theme";
import { drawDiagonalScanlines, createPulsingDot, addCornerLabel, getResponsiveTextSize } from "../ui";
import { takeScreenshot } from "../screenshot";
import { playTone, unlockAudio } from "../audio";

// ---------- physics ----------
const TILE = 32;
const ROWS = 19;                 // world height em tiles. 19*32=608 ≥ canvas 600.
const WORLD_H = ROWS * TILE;
const PLAYER_W = 22;
const PLAYER_H = 30;

const MOVE_SPEED = 220;
const JUMP_VELOCITY = -500;
const MAX_FALL = 700;
const COYOTE_MS = 110;
const JUMP_BUFFER_MS = 110;
// Com gravidade 900 (config no main.ts) + JUMP_VELOCITY -500, dá:
//   - altura máxima de pulo: 500² / (2·900) = 138.9px ≈ 4.3 tiles
//   - distância horizontal máxima: 220 · (2·500/900) ≈ 244px ≈ 7.6 tiles
// Use isso pra calibrar gaps e plataformas: gap ≤ 7 tiles, salto vertical ≤ 4 tiles.

// ---------- storage ----------
const BESTPHASE_KEY = "gamedev-07-platformer-bestphase";
const BESTCOINS_KEY = "gamedev-07-platformer-bestcoins";

// ---------- levels ----------
interface LevelData {
  width: number; // em tiles
  spawn: { row: number; col: number };
  goal: { row: number; col: number };
  groundRow: number;
  groundGaps: Array<{ start: number; end: number }>; // start inclusive, end exclusive
  platforms: Array<{ row: number; start: number; end: number }>;
  coins: Array<{ row: number; col: number }>;
}

// Convenção de design (verificada matematicamente):
//   - ground sempre em row 17 (chão em y=544, player spawn em row 16 fica em pé em y~528)
//   - sky/jogo: rows 0-16 (acima do chão, com platforms entre rows 10-15)
//   - gaps no chão são preenchidos por platforms no ar formando uma rota
//   - todas as moedas verificadas pra alcançabilidade
const LEVELS: LevelData[] = [
  // PHASE 1: aquece — 50 tiles, 2 gaps pequenos com platforms-ponte
  {
    width: 50,
    spawn: { row: 16, col: 2 },
    goal: { row: 16, col: 48 },
    groundRow: 17,
    groundGaps: [
      { start: 14, end: 18 },
      { start: 32, end: 36 },
    ],
    platforms: [
      { row: 14, start: 14, end: 18 }, // bridge do gap 1, com folga vertical
      { row: 14, start: 32, end: 36 }, // bridge do gap 2
    ],
    coins: [
      { row: 15, col: 8 },   // chão, salto curto
      { row: 13, col: 16 },  // em cima do bridge 1
      { row: 15, col: 24 },  // chão (terreno meio)
      { row: 13, col: 34 },  // em cima do bridge 2
      { row: 15, col: 42 },  // chão (terreno final)
    ],
  },
  // PHASE 2: 80 tiles, gaps maiores, plataformas em alturas variadas, requer chained jumps
  {
    width: 80,
    spawn: { row: 16, col: 2 },
    goal: { row: 16, col: 78 },
    groundRow: 17,
    groundGaps: [
      { start: 10, end: 14 },
      { start: 28, end: 33 },
      { start: 48, end: 52 },
      { start: 64, end: 68 },
    ],
    platforms: [
      { row: 14, start: 11, end: 14 },  // bridge gap 1
      { row: 13, start: 28, end: 33 },  // bridge gap 2 (mais alto)
      { row: 12, start: 36, end: 39 },  // stepping stone
      { row: 11, start: 42, end: 45 },  // alto (recompensa)
      { row: 14, start: 49, end: 51 },  // bridge gap 3
      { row: 14, start: 64, end: 68 },  // bridge gap 4
    ],
    coins: [
      { row: 15, col: 5 },
      { row: 13, col: 12 },  // em cima do bridge 1
      { row: 12, col: 30 },  // em cima do bridge 2
      { row: 11, col: 37 },  // em cima da stepping
      { row: 10, col: 43 },  // em cima da plataforma alta (recompensa)
      { row: 15, col: 56 },
      { row: 13, col: 66 },  // em cima do bridge 4
      { row: 16, col: 73 },
    ],
  },
  // PHASE 3: 120 tiles, gaps frequentes, plataformas exigem precisão
  {
    width: 120,
    spawn: { row: 16, col: 2 },
    goal: { row: 16, col: 118 },
    groundRow: 17,
    groundGaps: [
      { start: 9, end: 13 },
      { start: 20, end: 26 },
      { start: 35, end: 41 },
      { start: 50, end: 56 },
      { start: 67, end: 73 },
      { start: 84, end: 90 },
      { start: 100, end: 107 },
    ],
    platforms: [
      { row: 14, start: 9, end: 13 },
      { row: 13, start: 20, end: 26 },
      { row: 11, start: 28, end: 31 },   // alto, pulado de (13,20-26)
      { row: 13, start: 35, end: 41 },
      { row: 11, start: 43, end: 47 },
      { row: 14, start: 50, end: 56 },
      { row: 12, start: 60, end: 64 },
      { row: 14, start: 67, end: 73 },
      { row: 12, start: 78, end: 82 },
      { row: 14, start: 84, end: 90 },
      { row: 11, start: 92, end: 96 },
      { row: 14, start: 100, end: 107 },
      { row: 12, start: 110, end: 114 },
    ],
    coins: [
      { row: 15, col: 5 },
      { row: 13, col: 11 },
      { row: 12, col: 23 },
      { row: 10, col: 29 },   // recompensa em cima do alto
      { row: 12, col: 38 },
      { row: 10, col: 45 },   // recompensa
      { row: 13, col: 53 },
      { row: 11, col: 62 },
      { row: 13, col: 70 },
      { row: 11, col: 80 },
      { row: 13, col: 87 },
      { row: 10, col: 94 },   // recompensa
      { row: 13, col: 103 },
      { row: 11, col: 112 },
    ],
  },
];

type GameState = "playing" | "paused" | "win" | "dead";

interface SceneInitData {
  phase?: number;
}

export class GameScene extends Phaser.Scene {
  private player!: Phaser.GameObjects.Rectangle;
  private playerBody!: Phaser.Physics.Arcade.Body;
  private tiles!: Phaser.Physics.Arcade.StaticGroup;
  private coins: Phaser.GameObjects.Arc[] = [];
  private goal!: Phaser.GameObjects.Rectangle;

  private currentPhase = 1;
  private level!: LevelData;
  private worldW = 0;

  private coinsCollected = 0;
  private totalCoins = 0;
  private state: GameState = "playing";
  private spawnX = 0;
  private spawnY = 0;

  private lastGroundedAt = 0;
  private lastJumpRequestedAt = 0;

  private scoreLabel!: Phaser.GameObjects.Text;
  private phaseLabel!: Phaser.GameObjects.Text;
  private overlayBg!: Phaser.GameObjects.Rectangle;
  private overlayTitle!: Phaser.GameObjects.Text;
  private overlayHint!: Phaser.GameObjects.Text;

  private keys!: Record<
    "LEFT" | "RIGHT" | "UP" | "A" | "D" | "W" | "SPACE" | "P" | "ESC" | "K" | "R",
    Phaser.Input.Keyboard.Key
  >;

  constructor() { super("game"); }

  init(data: SceneInitData) {
    const phase = data?.phase ?? 1;
    this.currentPhase = Phaser.Math.Clamp(phase, 1, LEVELS.length);
    this.level = LEVELS[this.currentPhase - 1];
    this.worldW = this.level.width * TILE;
    // Reset fields que persistem entre cenas se não resetar
    this.coinsCollected = 0;
    this.totalCoins = 0;
    this.state = "playing";
    this.coins = [];
    this.lastGroundedAt = 0;
    this.lastJumpRequestedAt = 0;
  }

  create() {
    const W = this.scale.width;
    const H = this.scale.height;
    const main = this.cameras.main;
    main.setBounds(0, 0, this.worldW, WORLD_H);

    const uiCam = this.cameras.add(0, 0, W, H);
    uiCam.setScroll(0, 0);

    const registerWorld = (obj: Phaser.GameObjects.GameObject) => uiCam.ignore(obj);
    const registerUi = (obj: Phaser.GameObjects.GameObject) => main.ignore(obj);

    // BG fills the whole world (camera scrolls within)
    const bg = this.add.rectangle(0, 0, this.worldW, WORLD_H, COLOR_HEX.bg).setOrigin(0, 0);
    registerWorld(bg);

    const scanlines = drawDiagonalScanlines(this, W, H, 18, 0.04);
    registerUi(scanlines);

    this.physics.world.setBounds(0, 0, this.worldW, WORLD_H);
    this.physics.world.setBoundsCollision(true, true, true, false); // bottom open

    this.tiles = this.physics.add.staticGroup();
    this.buildLevel(registerWorld);

    this.player = this.add.rectangle(this.spawnX, this.spawnY, PLAYER_W, PLAYER_H, COLOR_HEX.accent);
    this.player.setStrokeStyle(1, COLOR_HEX.fg, 0.4);
    this.physics.add.existing(this.player);
    this.playerBody = this.player.body as Phaser.Physics.Arcade.Body;
    this.playerBody.setCollideWorldBounds(true);
    this.playerBody.setMaxVelocity(MOVE_SPEED * 1.5, MAX_FALL);
    registerWorld(this.player);

    this.physics.add.collider(this.player, this.tiles);
    this.physics.add.overlap(this.player, this.coins, (_p, coin) => {
      const c = coin as Phaser.GameObjects.Arc;
      c.destroy();
      this.coinsCollected++;
      this.refreshChrome();
      playTone(880, 60, "triangle", 0.10);
      this.time.delayedCall(60, () => playTone(1175, 80, "triangle", 0.10));
    });
    this.physics.add.overlap(this.player, this.goal, () => this.winLevel());

    main.startFollow(this.player, true, 0.18, 0.18);

    this.drawChrome(registerUi);
    this.drawOverlay(registerUi);

    const kb = this.input.keyboard!;
    this.keys = {
      LEFT: kb.addKey(Phaser.Input.Keyboard.KeyCodes.LEFT),
      RIGHT: kb.addKey(Phaser.Input.Keyboard.KeyCodes.RIGHT),
      UP: kb.addKey(Phaser.Input.Keyboard.KeyCodes.UP),
      A: kb.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      D: kb.addKey(Phaser.Input.Keyboard.KeyCodes.D),
      W: kb.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      SPACE: kb.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE),
      P: kb.addKey(Phaser.Input.Keyboard.KeyCodes.P),
      ESC: kb.addKey(Phaser.Input.Keyboard.KeyCodes.ESC),
      K: kb.addKey(Phaser.Input.Keyboard.KeyCodes.K),
      R: kb.addKey(Phaser.Input.Keyboard.KeyCodes.R),
    };
    kb.on("keydown", unlockAudio);
  }

  // ---------- level building (from structured data) ----------

  private buildLevel(registerWorld: (obj: Phaser.GameObjects.GameObject) => void) {
    const lvl = this.level;

    // ground row, skipping gaps
    for (let col = 0; col < lvl.width; col++) {
      const inGap = lvl.groundGaps.some((g) => col >= g.start && col < g.end);
      if (!inGap) this.addTile(lvl.groundRow, col, registerWorld);
    }

    // platforms (cada uma é uma faixa horizontal de tiles)
    for (const plat of lvl.platforms) {
      for (let col = plat.start; col < plat.end; col++) {
        this.addTile(plat.row, col, registerWorld);
      }
    }

    // coins
    for (const cn of lvl.coins) {
      this.addCoin(cn.row, cn.col, registerWorld);
    }
    this.totalCoins = lvl.coins.length;

    // goal
    this.addGoal(lvl.goal.row, lvl.goal.col, registerWorld);

    // spawn
    this.spawnX = lvl.spawn.col * TILE + TILE / 2;
    this.spawnY = lvl.spawn.row * TILE + TILE / 2;
  }

  private addTile(row: number, col: number, registerWorld: (obj: Phaser.GameObjects.GameObject) => void) {
    const x = col * TILE + TILE / 2;
    const y = row * TILE + TILE / 2;
    const tile = this.add.rectangle(x, y, TILE - 2, TILE - 2, COLOR_HEX.bgSoft);
    tile.setStrokeStyle(1, COLOR_HEX.border, 1);
    this.tiles.add(tile);
    registerWorld(tile);
  }

  private addCoin(row: number, col: number, registerWorld: (obj: Phaser.GameObjects.GameObject) => void) {
    const x = col * TILE + TILE / 2;
    const y = row * TILE + TILE / 2;
    const coin = this.add.circle(x, y, 6, COLOR_HEX.amber);
    this.physics.add.existing(coin, true);
    this.coins.push(coin);
    registerWorld(coin);
    this.tweens.add({
      targets: coin,
      scale: { from: 0.85, to: 1.1 },
      duration: 700,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });
  }

  private addGoal(row: number, col: number, registerWorld: (obj: Phaser.GameObjects.GameObject) => void) {
    const x = col * TILE + TILE / 2;
    const y = row * TILE + TILE / 2;
    this.goal = this.add.rectangle(x, y - TILE / 2, 4, 48, COLOR_HEX.secondary).setOrigin(0.5, 0);
    this.physics.add.existing(this.goal, true);
    registerWorld(this.goal);
    const flag = this.add.triangle(x + 8, y - TILE / 2 + 6, 0, 0, 14, 6, 0, 12, COLOR_HEX.secondary);
    registerWorld(flag);
  }

  // ---------- update ----------

  update(time: number, delta: number) {
    if (Phaser.Input.Keyboard.JustDown(this.keys.K)) takeScreenshot(this.game, "gamedev-07-platformer");
    if (Phaser.Input.Keyboard.JustDown(this.keys.ESC)) { this.scene.start("menu"); return; }
    if (Phaser.Input.Keyboard.JustDown(this.keys.P)) {
      if (this.state === "playing") {
        this.state = "paused";
        this.physics.pause();
        this.showOverlay("PAUSADO", "P CONTINUAR · ESC MENU");
      } else if (this.state === "paused") {
        this.state = "playing";
        this.physics.resume();
        this.hideOverlay();
      }
      return;
    }
    if ((this.state === "dead" || this.state === "win") && Phaser.Input.Keyboard.JustDown(this.keys.R)) {
      this.handleRestartOrAdvance();
      return;
    }

    if (this.state !== "playing") return;

    if (this.player.y > WORLD_H + 80) {
      this.die();
      return;
    }

    this.handleMovement(time, delta);
  }

  private handleMovement(time: number, _delta: number) {
    const left = this.keys.LEFT.isDown || this.keys.A.isDown;
    const right = this.keys.RIGHT.isDown || this.keys.D.isDown;
    const jumpDown = Phaser.Input.Keyboard.JustDown(this.keys.SPACE)
                  || Phaser.Input.Keyboard.JustDown(this.keys.UP)
                  || Phaser.Input.Keyboard.JustDown(this.keys.W);

    if (left && !right) this.playerBody.setVelocityX(-MOVE_SPEED);
    else if (right && !left) this.playerBody.setVelocityX(MOVE_SPEED);
    else this.playerBody.setVelocityX(0);

    const grounded = this.playerBody.blocked.down || this.playerBody.touching.down;
    if (grounded) this.lastGroundedAt = time;
    if (jumpDown) this.lastJumpRequestedAt = time;

    const canCoyoteJump = time - this.lastGroundedAt < COYOTE_MS;
    const jumpBuffered = time - this.lastJumpRequestedAt < JUMP_BUFFER_MS;

    if (jumpBuffered && canCoyoteJump) {
      this.playerBody.setVelocityY(JUMP_VELOCITY);
      this.lastGroundedAt = 0;
      this.lastJumpRequestedAt = 0;
      playTone(440, 70, "square", 0.10);
    }
  }

  // ---------- death / win / restart ----------

  // R faz coisas diferentes dependendo do estado:
  //   - dead: reinicia a fase atual
  //   - win (não-final): vai pra próxima fase
  //   - win (última fase): volta pro menu
  private handleRestartOrAdvance() {
    if (this.state === "dead") {
      this.scene.start("game", { phase: this.currentPhase });
      return;
    }
    if (this.state === "win") {
      const next = this.currentPhase + 1;
      if (next > LEVELS.length) {
        this.scene.start("menu");
      } else {
        this.scene.start("game", { phase: next });
      }
    }
  }

  private die() {
    this.state = "dead";
    // Para o player no lugar — evita continuar caindo indefinidamente,
    // o que costuma confundir o restart da câmera.
    this.playerBody.setVelocity(0, 0);
    this.playerBody.setAllowGravity(false);

    playTone(180, 350, "sawtooth", 0.18);
    this.cameras.main.shake(280, 0.012);
    this.cameras.main.flash(150, 220, 40, 40, false);
    this.time.delayedCall(700, () => {
      if (this.state !== "dead") return;
      this.showOverlay("VOCÊ MORREU", "R PRA TENTAR DE NOVO · ESC MENU");
    });
  }

  private winLevel() {
    if (this.state !== "playing") return;
    this.state = "win";
    this.playerBody.setVelocity(0, 0);
    this.playerBody.setAllowGravity(false);

    this.saveBest();

    playTone(660, 120, "triangle", 0.14);
    this.time.delayedCall(140, () => playTone(880, 150, "triangle", 0.14));
    this.time.delayedCall(320, () => playTone(1175, 220, "triangle", 0.14));
    this.cameras.main.flash(200, 122, 209, 122, false);

    this.time.delayedCall(700, () => {
      if (this.state !== "win") return;
      const isLast = this.currentPhase >= LEVELS.length;
      const title = isLast ? "VITÓRIA!" : "FASE COMPLETA";
      const hint = isLast
        ? `${this.coinsCollected}/${this.totalCoins} moedas · você zerou as ${LEVELS.length} fases · R / ESC pro menu`
        : `${this.coinsCollected}/${this.totalCoins} moedas · R pra próxima fase · ESC menu`;
      this.showOverlay(title, hint);
    });
  }

  private saveBest() {
    try {
      // best coin count (global, across phases)
      const rawC = localStorage.getItem(BESTCOINS_KEY);
      const prevC = rawC ? parseInt(rawC, 10) : 0;
      if (this.coinsCollected > prevC) localStorage.setItem(BESTCOINS_KEY, String(this.coinsCollected));
      // best phase reached
      const rawP = localStorage.getItem(BESTPHASE_KEY);
      const prevP = rawP ? parseInt(rawP, 10) : 1;
      const reached = Math.min(LEVELS.length, this.currentPhase + 1);
      if (reached > prevP) localStorage.setItem(BESTPHASE_KEY, String(reached));
    } catch {}
  }

  // ---------- chrome ----------

  private drawChrome(registerUi: (obj: Phaser.GameObjects.GameObject) => void) {
    const labels = addCornerLabel(this, 22, 22, "/ 07", "PLATFORMER", false);
    if (labels.accentText) registerUi(labels.accentText);
    registerUi(labels.mainText);

    const dot = createPulsingDot(this, this.scale.width - 22 - 4, 22 + 6, 4, COLOR_HEX.accent);
    registerUi(dot.dot); registerUi(dot.glow);

    this.phaseLabel = this.add.text(this.scale.width - 38, 22, "", TEXT_PRESETS.monoLabel).setOrigin(1, 0);
    registerUi(this.phaseLabel);

    this.scoreLabel = this.add.text(this.scale.width - 22, 44, "", TEXT_PRESETS.hint).setOrigin(1, 0);
    registerUi(this.scoreLabel);

    const bottomLeft = this.add.text(22, this.scale.height - 22, "GAMEDEV.07", TEXT_PRESETS.hint).setOrigin(0, 1);
    registerUi(bottomLeft);

    const bottomRight = this.add.text(this.scale.width - 22, this.scale.height - 22,
      "← → ↑ ESPAÇO · P PAUSAR · ESC MENU · K", TEXT_PRESETS.hint).setOrigin(1, 1);
    registerUi(bottomRight);

    this.refreshChrome();
  }

  private refreshChrome() {
    this.phaseLabel.setText(`FASE  ${String(this.currentPhase).padStart(2, "0")} / ${String(LEVELS.length).padStart(2, "0")}`);
    this.scoreLabel.setText(`MOEDAS  ${this.coinsCollected}/${this.totalCoins}`);
  }

  private drawOverlay(registerUi: (obj: Phaser.GameObjects.GameObject) => void) {
    const W = this.scale.width;
    const H = this.scale.height;
    this.overlayBg = this.add.rectangle(W / 2, H / 2, W, H, COLOR_HEX.bg, 0.82); registerUi(this.overlayBg);
    this.overlayTitle = this.add.text(W / 2, H / 2 - 30, "", TEXT_PRESETS.heroOutline)
      .setOrigin(0.5)
      .setFontSize(getResponsiveTextSize(this, "hero"));
    registerUi(this.overlayTitle);
    this.overlayHint = this.add.text(W / 2, H / 2 + 40, "", TEXT_PRESETS.hint).setOrigin(0.5);
    registerUi(this.overlayHint);
    this.hideOverlay();
  }

  private showOverlay(title: string, hint: string) {
    this.overlayBg.setVisible(true);
    this.overlayTitle.setVisible(true).setText(title);
    this.overlayHint.setVisible(true).setText(hint);
  }

  private hideOverlay() {
    this.overlayBg.setVisible(false);
    this.overlayTitle.setVisible(false);
    this.overlayHint.setVisible(false);
  }
}

export { LEVELS, BESTPHASE_KEY, BESTCOINS_KEY };
