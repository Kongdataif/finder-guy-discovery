import Phaser from "phaser";

export const INK = "#243c55";
export const MUTED = "#657b92";
export const BLUE = 0x2387ec;
export const FONT = '"Gowun Dodum", system-ui, sans-serif';

export function panel(scene: Phaser.Scene, parent: Phaser.GameObjects.Container, x: number, y: number, w: number, h: number, fill = 0xffffff, radius = 20, stroke?: number): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics();
  g.fillStyle(fill, 1).fillRoundedRect(x, y, w, h, radius);
  if (stroke !== undefined) g.lineStyle(1, stroke).strokeRoundedRect(x, y, w, h, radius);
  parent.add(g);
  return g;
}

export function text(scene: Phaser.Scene, parent: Phaser.GameObjects.Container, x: number, y: number, value: string, size = 16, color = INK, width?: number): Phaser.GameObjects.Text {
  const item = scene.add.text(x, y, value, {
    fontFamily: FONT, fontSize: size, color, lineSpacing: 5,
    ...(width ? { wordWrap: { width, useAdvancedWrap: true } } : {}),
  }).setResolution(2);
  parent.add(item);
  return item;
}

export function button(scene: Phaser.Scene, parent: Phaser.GameObjects.Container, x: number, y: number, w: number, h: number, value: string, action: () => void, opts: { primary?: boolean; name?: string; small?: boolean; selected?: boolean } = {}): Phaser.GameObjects.Container {
  const root = scene.add.container(x, y).setName(opts.name ?? value);
  parent.add(root);
  const active = opts.primary || opts.selected;
  const shape = panel(scene, root, 0, 0, w, h, active ? BLUE : 0xffffff, 13, active ? BLUE : 0xdce6f2);
  const label = text(scene, root, w / 2, h / 2, value, opts.small ? 13 : 17, active ? "#ffffff" : INK).setOrigin(0.5);
  label.setFontStyle("bold");
  // Keep compact desktop visuals while giving landscape-phone taps more room.
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const hit = scene.add.zone(w / 2, h / 2, coarse ? Math.max(w, 64) : w, coarse ? Math.max(h, 64) : h).setInteractive({ useHandCursor: true });
  root.add(hit);
  let pointerId: number | null = null;
  hit.on("pointerdown", (pointer: Phaser.Input.Pointer, _x: number, _y: number, event: Phaser.Types.Input.EventData) => { pointerId = pointer.id; event.stopPropagation(); });
  hit.on("pointerup", (pointer: Phaser.Input.Pointer, _x: number, _y: number, event: Phaser.Types.Input.EventData) => {
    if (pointerId !== pointer.id) return;
    if (pointer.wasCanceled) { pointerId = null; return; }
    event.stopPropagation();
    pointerId = null;
    action();
  });
  hit.on("pointerout", () => { pointerId = null; shape.setAlpha(1); });
  hit.on("pointerover", () => shape.setAlpha(0.83));
  return root;
}

export function fileIcon(scene: Phaser.Scene, parent: Phaser.GameObjects.Container, x: number, y: number, icon: string, scale = 1): Phaser.GameObjects.Container {
  const root = scene.add.container(x, y).setScale(scale);
  parent.add(root);
  const g = scene.add.graphics();
  root.add(g);
  if (icon === "cat" || icon === "dog") {
    g.fillStyle(icon === "cat" ? 0xffdc95 : 0xc8e8e7).fillRoundedRect(-35, -29, 70, 58, 10);
    g.fillStyle(icon === "cat" ? 0xe99d52 : 0xaf7e62);
    if (icon === "cat") {
      g.fillTriangle(-19, -6, -23, -23, -5, -13).fillTriangle(19, -6, 23, -23, 5, -13);
    } else {
      g.fillEllipse(-21, 0, 15, 32).fillEllipse(21, 0, 15, 32);
    }
    g.fillStyle(icon === "cat" ? 0xffedce : 0xf4d2a9).fillEllipse(0, 1, 44, 36);
    g.fillStyle(0x374455).fillCircle(-8, -1, 2.2).fillCircle(8, -1, 2.2).fillEllipse(0, 7, 5, 4);
    g.lineStyle(1.4, 0x8a6557).lineBetween(-21, 8, -12, 9).lineBetween(12, 9, 21, 8);
  } else {
    g.fillStyle(0xe0eaff).fillRoundedRect(-26, -32, 52, 64, 8);
    g.fillStyle(0xffffff).fillTriangle(11, -32, 26, -17, 11, -17);
    g.lineStyle(3, 0x85a9d7).lineBetween(-15, -9, 12, -9).lineBetween(-15, 1, 15, 1).lineBetween(-15, 11, 7, 11);
    if (icon === "pdf") root.add(scene.add.text(0, 5, "PDF", { fontFamily: FONT, fontSize: 15, color: "#295a89", backgroundColor: "#e0eaff" }).setOrigin(0.5));
  }
  return root;
}

export function folderIcon(scene: Phaser.Scene, parent: Phaser.GameObjects.Container, x: number, y: number, color = 0x70bafd): void {
  const g = scene.add.graphics();
  g.fillStyle(color).fillRoundedRect(x - 26, y - 22, 24, 16, 5).fillRoundedRect(x - 29, y - 14, 58, 39, 6);
  g.fillStyle(0xffffff, 0.23).fillRoundedRect(x - 26, y - 9, 52, 29, 5);
  parent.add(g);
}
