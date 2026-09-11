import Phaser from "phaser";
import "@fontsource/gowun-dodum/korean-400.css";
import "./style.css";
import { FinderScene } from "./game/scenes/FinderScene";

async function start(): Promise<void> {
  await Promise.allSettled([document.fonts.load('400 16px "Gowun Dodum"', "파인더 Finder Guy")]);
  const game = new Phaser.Game({
    // 2D toy artwork and a shared workbench, without a live 3D engine.
    type: Phaser.CANVAS,
    parent: "game-container",
    width: 1920,
    height: 1080,
    backgroundColor: "#f4f7fc",
    antialias: true,
    // Scene listeners prevent only cancelable touch defaults. Phaser's blanket
    // capture also calls preventDefault on non-cancelable native touchcancel.
    input: { activePointers: 3, touch: { capture: false } },
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene: [FinderScene],
  });
  if (new URLSearchParams(location.search).get("debug") === "1") {
    Object.assign(window, { __FINDER_GAME__: game });
  }
}

void start();
