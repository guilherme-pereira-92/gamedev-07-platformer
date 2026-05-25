import Phaser from "phaser";
import { COLOR_HEX, TEXT_PRESETS } from "../theme";
import { drawDiagonalScanlines, createPulsingDot, addCornerLabel, getResponsiveTextSize } from "../ui";
import { takeScreenshot } from "../screenshot";
import { playTone, unlockAudio } from "../audio";

const TILE = 32;
const PLAYER_W = 22;
const PLAYER_H = 30;

const MOVE_SPEED = 220;
const JUMP_VELOCITY = -500;
const MAX_FALL = 700;
const COYOTE_MS = 110;
const JUMP_BUFFER_MS = 110;

// Level ASCII: each char is one tile (32×32 logical).
// '=' = solid block / ground
// 'c' = coin
// 'G' = goal flag
// ' ' = empty
// 'P' = player spawn
const LEVEL: string[] = [
  "                                                                                                              ",
  "                                                                                                              ",
  "                                                                                                              ",
  "                                                                                                              ",
  "                          ===              c                                                                  ",
  "                                                                                                              ",
  "                                                  ===              ===                                        ",
  "                                                                                          c                   ",
  "          ===                  c                                                                              ",
  "                                                                                ====                          ",
  "  P     c                                                       c     c                                  G    ",
  "==========    =====    ======================    =====    =========    ==========    ==========    ===========",
];

const LEVEL_HEIGHT_TILES = LEVEL.length;
const LEVEL_WIDTH_TILES = Math.max(...LEVEL.map((r) => r.length));
const WORLD_W = LEVEL_WIDTH_TILES * TILE;
const WORLD_H = LEVEL_HEIGHT_TILES * TILE;

type GameState = "playing" | "paused" | "win" | "dead";

export class GameScene extends Phaser.Scene {
  private player!: Phaser.GameObjects.Rectangle;
  private playerBody!: Phaser.Physics.Arcade.Body;
  private tiles!: Phaser.Physics.Arcade.StaticGroup;
  private coins: Phaser.GameObjects.Arc[] = [];
  private goal!: Phaser.GameObjects.Rectangle;

  private coinsCollected = 0;
  private totalCoins = 0;
  private state: GameState = "playing";
  private spawnX = 0;
  private spawnY = 0;

  private lastGroundedAt = 0;
  private lastJumpRequestedAt = 0;

  private scoreLabel!: Phaser.GameObjects.Text;
  private overlayBg!: Phaser.GameObjects.Rectangle;
  private overlayTitle!: Phaser.GameObjects.Text;
  private overlayHint!: Phaser.GameObjects.Text;

  private keys!: Record<
    "LEFT" | "RIGHT" | "UP" | "A" | "D" | "W" | "SPACE" | "P" | "ESC" | "K" | "R",
    Phaser.Input.Keyboard.Key
  >;

  constructor() { super("game"); }

  create() {
    // Mario-style camera: main cam scrolls dentro do world (3.7k px de largura)
    // seguindo o player; UI cam fica fixa no viewport 800×600 pra desenhar chrome.
    const W = this.scale.width;
    const H = this.scale.height;
    const main = this.cameras.main;
    main.setBounds(0, 0, WORLD_W, WORLD_H);

    const uiCam = this.cameras.add(0, 0, W, H);
    uiCam.setScroll(0, 0);

    const registerWorld = (obj: Phaser.GameObjects.GameObject) => uiCam.ignore(obj);
    const registerUi = (obj: Phaser.GameObjects.GameObject) => main.ignore(obj);

    // Background fills entire WORLD area (camera scrolls within)
    const bg = this.add.rectangle(0, 0, WORLD_W, WORLD_H, COLOR_HEX.bg).setOrigin(0, 0);
    registerWorld(bg);

    // Scanlines only over viewport (UI cam)
    const scanlines = drawDiagonalScanlines(this, W, H, 18, 0.04);
    registerUi(scanlines);

    // World bounds: bottom ABERTO (player cai = morre). Mario-style.
    this.physics.world.setBounds(0, 0, WORLD_W, WORLD_H);
    this.physics.world.setBoundsCollision(true, true, true, false); // left, right, up, NÃO down

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

    // Mario-style camera: player sempre próximo do centro, mapa rola atrás.
    // SEM deadzone (deadzone causa player "fixar" em zonas) — só lerp suave.
    this.cameras.main.startFollow(this.player, true, 0.18, 0.18);

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

  private buildLevel(registerWorld: (obj: Phaser.GameObjects.GameObject) => void) {
    this.coins = [];
    this.totalCoins = 0;
    for (let r = 0; r < LEVEL.length; r++) {
      const row = LEVEL[r];
      for (let c = 0; c < row.length; c++) {
        const ch = row[c];
        const x = c * TILE + TILE / 2;
        const y = r * TILE + TILE / 2;
        if (ch === "=") {
          const tile = this.add.rectangle(x, y, TILE - 2, TILE - 2, COLOR_HEX.bgSoft);
          tile.setStrokeStyle(1, COLOR_HEX.border, 1);
          this.tiles.add(tile);
          registerWorld(tile);
        } else if (ch === "c") {
          const coin = this.add.circle(x, y, 6, COLOR_HEX.amber);
          this.physics.add.existing(coin, true);
          this.coins.push(coin);
          this.totalCoins++;
          registerWorld(coin);
          // pulse animation
          this.tweens.add({
            targets: coin,
            scale: { from: 0.85, to: 1.1 },
            duration: 700,
            yoyo: true,
            repeat: -1,
            ease: "Sine.easeInOut",
          });
        } else if (ch === "G") {
          this.goal = this.add.rectangle(x, y - TILE / 2, 4, 48, COLOR_HEX.secondary).setOrigin(0.5, 0);
          this.physics.add.existing(this.goal, true);
          registerWorld(this.goal);
          const flag = this.add.triangle(x + 8, y - TILE / 2 + 6, 0, 0, 14, 6, 0, 12, COLOR_HEX.secondary);
          registerWorld(flag);
        } else if (ch === "P") {
          this.spawnX = x;
          this.spawnY = y;
        }
      }
    }
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
      this.scene.restart();
      return;
    }

    if (this.state !== "playing") return;

    // Death by fall — bottom do world está aberto (setBoundsCollision down=false).
    // Player cai indefinidamente até passar WORLD_H, então morre.
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

    // Horizontal
    if (left && !right) this.playerBody.setVelocityX(-MOVE_SPEED);
    else if (right && !left) this.playerBody.setVelocityX(MOVE_SPEED);
    else this.playerBody.setVelocityX(0);

    // Coyote time + jump buffer
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

  // ---------- death / win ----------

  private die() {
    this.state = "dead";
    playTone(180, 350, "sawtooth", 0.18);
    this.cameras.main.shake(280, 0.012);
    this.cameras.main.flash(150, 220, 40, 40, false);
    this.time.delayedCall(700, () => {
      this.showOverlay("VOCÊ MORREU", "R PRA TENTAR DE NOVO · ESC MENU");
    });
  }

  private winLevel() {
    if (this.state !== "playing") return;
    this.state = "win";
    this.saveBest();
    playTone(660, 120, "triangle", 0.14);
    this.time.delayedCall(140, () => playTone(880, 150, "triangle", 0.14));
    this.time.delayedCall(320, () => playTone(1175, 220, "triangle", 0.14));
    this.cameras.main.flash(200, 122, 209, 122, false);
    this.time.delayedCall(700, () => {
      this.showOverlay("CHEGOU!", `${this.coinsCollected}/${this.totalCoins} moedas · R pra jogar de novo · ESC menu`);
    });
  }

  private saveBest() {
    try {
      const raw = localStorage.getItem("gamedev-07-platformer-bestcoins");
      const prev = raw ? parseInt(raw, 10) : 0;
      if (this.coinsCollected > prev) localStorage.setItem("gamedev-07-platformer-bestcoins", String(this.coinsCollected));
    } catch {}
  }

  // ---------- chrome ----------

  private drawChrome(registerUi: (obj: Phaser.GameObjects.GameObject) => void) {
    const labels = addCornerLabel(this, 22, 22, "/ 07", "PLATFORMER", false);
    if (labels.accentText) registerUi(labels.accentText);
    registerUi(labels.mainText);

    const dot = createPulsingDot(this, this.scale.width - 22 - 4, 22 + 6, 4, COLOR_HEX.accent);
    registerUi(dot.dot); registerUi(dot.glow);

    this.scoreLabel = this.add.text(this.scale.width - 38, 22, "", TEXT_PRESETS.monoLabel).setOrigin(1, 0);
    registerUi(this.scoreLabel);

    const bottomLeft = this.add.text(22, this.scale.height - 22, "GAMEDEV.07", TEXT_PRESETS.hint).setOrigin(0, 1);
    registerUi(bottomLeft);

    const bottomRight = this.add.text(this.scale.width - 22, this.scale.height - 22,
      "← → ↑ ESPAÇO · P PAUSAR · ESC MENU · K", TEXT_PRESETS.hint).setOrigin(1, 1);
    registerUi(bottomRight);

    this.refreshChrome();
  }

  private refreshChrome() {
    this.scoreLabel.setText(`MOEDAS  ${this.coinsCollected}/${this.totalCoins}`);
  }

  private drawOverlay(registerUi: (obj: Phaser.GameObjects.GameObject) => void) {
    const W = this.scale.width;
    const H = this.scale.height;
    this.overlayBg = this.add.rectangle(W / 2, H / 2, W, H, COLOR_HEX.bg, 0.82); registerUi(this.overlayBg);
    this.overlayTitle = this.add.text(W / 2, H / 2 - 30, "", TEXT_PRESETS.heroOutline).setOrigin(0.5).setFontSize(getResponsiveTextSize(this, "hero")); registerUi(this.overlayTitle);
    this.overlayHint = this.add.text(W / 2, H / 2 + 40, "", TEXT_PRESETS.hint).setOrigin(0.5); registerUi(this.overlayHint);
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
