import Phaser from 'phaser';
import { CANVAS_SIZE, GameScene } from './scenes/GameScene.js';

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: CANVAS_SIZE,
  height: CANVAS_SIZE,
  backgroundColor: '#000000',
  banner: false,
  scene: [GameScene],
});
