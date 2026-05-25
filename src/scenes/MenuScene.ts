import Phaser from "phaser";
import { COLORS, COLOR_HEX, TEXT_PRESETS } from "../theme";
import { drawDiagonalScanlines, createPulsingDot, addCornerLabel, getResponsiveTextSize } from "../ui";
import { takeScreenshot } from "../screenshot";
import { unlockAudio } from "../audio";
import { isTouchDevice } from "../input";

const HIGHSCORE_KEY = "gamedev-07-platformer-bestcoins";

export class MenuScene extends Phaser.Scene {
  private keys!: Record<"SPACE" | "ENTER" | "K", Phaser.Input.Keyboard.Key>;

  constructor() { super("menu"); }

  create() {
    const best = this.loadBest();
    const W = this.scale.width;
    const H = this.scale.height;

    this.add.rectangle(0, 0, W, H, COLOR_HEX.bg).setOrigin(0, 0);
    drawDiagonalScanlines(this, W, H, 15, 0.045);

    addCornerLabel(this, 22, 22, "/ 07", "PLATFORMER", false);
    createPulsingDot(this, W - 22 - 4, 22 + 6, 4, COLOR_HEX.accent);
    this.add.text(W - 38, 22, `MELHOR  ${String(best).padStart(3, "0")} COINS`, TEXT_PRESETS.monoLabel).setOrigin(1, 0);

    this.add.text(22, H - 22, "GAMEDEV.07", TEXT_PRESETS.hint).setOrigin(0, 1);
    this.add.text(W - 22, H - 22, "BRICOLAGE · GEIST", TEXT_PRESETS.hint).setOrigin(1, 1);

    this.add.text(W / 2, H * 0.18, "/ JORNADA GAMEDEV", { ...TEXT_PRESETS.monoLabel, color: COLORS.muted }).setOrigin(0.5);
    this.add.text(W / 2, H * 0.32, "PLATFORMER", TEXT_PRESETS.heroOutline).setOrigin(0.5).setFontSize(getResponsiveTextSize(this, "hero"));
    this.add.text(W / 2, H * 0.42, "pule plataformas · colete moedas · chegue à bandeira", TEXT_PRESETS.body).setOrigin(0.5);

    // Decorative platformer setup: chão + player (laranja) + 3 platforms + 2 coins + flag
    this.drawDecoration();

    const controls = isTouchDevice()
      ? ["◄ ► mover · ▲ pular (botões na tela)", "ou: arraste lateral / tap em cima pra pular"]
      : ["← → ou A D mover · ESPAÇO ou ↑ pular", "P pausar · ESC menu"];
    controls.forEach((line, i) => {
      this.add.text(W / 2, H * 0.78 + i * 22, line, { ...TEXT_PRESETS.body, fontSize: "14px" }).setOrigin(0.5);
    });

    this.add.text(W / 2, H - 56,
      isTouchDevice() ? "TOQUE A TELA PRA COMEÇAR" : "ESPAÇO OU ENTER PRA COMEÇAR · K SCREENSHOT",
      TEXT_PRESETS.hint).setOrigin(0.5);

    const kb = this.input.keyboard!;
    this.keys = {
      SPACE: kb.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE),
      ENTER: kb.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER),
      K: kb.addKey(Phaser.Input.Keyboard.KeyCodes.K),
    };
    kb.on("keydown", unlockAudio);
    this.input.on("pointerdown", () => { unlockAudio(); this.scene.start("game"); });
  }

  private drawDecoration() {
    const W = this.scale.width;
    const H = this.scale.height;
    const baseY = H * 0.62;

    // Chão
    const groundY = baseY + 80;
    for (let x = W / 2 - 240; x < W / 2 + 240; x += 32) {
      const r = this.add.rectangle(x, groundY, 30, 24, COLOR_HEX.bgSoft);
      r.setStrokeStyle(1, COLOR_HEX.border, 1);
    }

    // Plataformas flutuantes
    const platCells = [
      [W / 2 - 200, baseY],
      [W / 2 - 80, baseY - 60],
      [W / 2 + 80, baseY - 40],
    ];
    for (const [px, py] of platCells) {
      for (let dx = 0; dx < 3; dx++) {
        const r = this.add.rectangle(px + dx * 32, py, 30, 24, COLOR_HEX.bgSoft);
        r.setStrokeStyle(1, COLOR_HEX.border, 1);
      }
    }

    // Player (orange)
    const player = this.add.rectangle(W / 2 - 200, baseY - 36, 22, 30, COLOR_HEX.accent);
    player.setStrokeStyle(1, COLOR_HEX.fg, 0.4);

    // Coin (amber)
    this.add.circle(W / 2 - 48, baseY - 80, 5, COLOR_HEX.amber);
    this.add.circle(W / 2 + 112, baseY - 60, 5, COLOR_HEX.amber);

    // Flag (cyan)
    this.add.rectangle(W / 2 + 200, baseY - 24, 4, 48, COLOR_HEX.secondary);
    this.add.triangle(W / 2 + 200 + 8, baseY - 36, 0, 0, 14, 6, 0, 12, COLOR_HEX.secondary);
  }

  update() {
    const justDown = Phaser.Input.Keyboard.JustDown;
    if (justDown(this.keys.K)) takeScreenshot(this.game, "gamedev-07-platformer-menu");
    if (justDown(this.keys.SPACE) || justDown(this.keys.ENTER)) this.scene.start("game");
  }

  private loadBest(): number {
    try {
      const raw = localStorage.getItem(HIGHSCORE_KEY);
      const n = raw ? parseInt(raw, 10) : 0;
      return Number.isFinite(n) && n > 0 ? n : 0;
    } catch { return 0; }
  }
}

export { HIGHSCORE_KEY };
