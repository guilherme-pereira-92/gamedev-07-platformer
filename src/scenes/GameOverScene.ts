// Placeholder: no-op scene — GameScene handles its own overlay (dead/win).
// Existe pra manter padrão de 3 scenes mas pode ser usado no futuro pra
// game over fullscreen (separar do GameScene quando level system crescer).
import Phaser from "phaser";

export class GameOverScene extends Phaser.Scene {
  constructor() { super("gameover"); }
  create() { this.scene.start("menu"); }
}
