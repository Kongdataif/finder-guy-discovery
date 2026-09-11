import Phaser from "phaser";

export type FinderPose = "idle" | "move" | "carry" | "search" | "work" | "success" | "oops" | "rest" | "cool" | "holiday" | "friend" | "perfect";
export const FINDER_ATLAS_URL = `${import.meta.env.BASE_URL}assets/finder/poses-v2.png`;
export const FINDER_FRIEND_URL = `${import.meta.env.BASE_URL}assets/finder/friend-ending-v1.png`;
export const FINDER_PERFECT_URL = `${import.meta.env.BASE_URL}assets/finder/perfect-finder-v1.png`;
export const POSE_FRAME: Record<Exclude<FinderPose, "perfect">, number> = { idle: 0, move: 0, search: 1, work: 2, rest: 3, cool: 4, success: 5, holiday: 6, friend: 7, carry: 7, oops: 0 };

export function prepareFinderFrames(scene: Phaser.Scene): void {
  const atlas = scene.textures.get("finder-art");
  const source = atlas.getSourceImage() as HTMLImageElement;
  const w = source.width / 4;
  const h = source.height / 2;
  for (let i = 0; i < 8; i++) if (!atlas.has(String(i))) atlas.add(String(i), 0, (i % 4) * w, Math.floor(i / 4) * h, w, h);
  if (!atlas.has("head")) atlas.add("head", 0, Math.round(w * 0.12), Math.round(h * 0.19), Math.round(w * 0.77), Math.round(h * 0.50));
}

export function drawFinderFace(scene: Phaser.Scene, x: number, y: number, width: number): Phaser.GameObjects.Container {
  const face = scene.add.container(x, y).setName("finder-face");
  face.add(scene.add.image(0, 0, "finder-art", "head").setDisplaySize(width, width * 0.97));
  return face;
}

/** Identity-preserving raster poses; only presentation lives here. */
export class FinderActor extends Phaser.GameObjects.Container {
  private readonly figure: Phaser.GameObjects.Image;
  private pose: FinderPose = "idle";
  private reducedMotion = false;
  private reaction: Phaser.Tweens.Tween | null = null;

  constructor(scene: Phaser.Scene, x: number, y: number, scale = 1) {
    super(scene, x, y);
    scene.add.existing(this);
    this.setName("finder-actor").setSize(208, 235).setScale(scale);
    this.add(scene.add.ellipse(0, 115, 112, 14, 0x52769b, 0.10));
    this.figure = scene.add.image(0, -15, "finder-art", "0").setDisplaySize(208, 312);
    this.add(this.figure);
  }

  setReducedMotion(value: boolean): this {
    this.reducedMotion = value;
    if (value) { this.reaction?.stop(); this.figure.setY(-15).setAngle(0); }
    return this;
  }

  setPose(pose: FinderPose): this {
    if (this.pose === pose) return this;
    this.reaction?.stop(); this.reaction = null;
    this.pose = pose;
    if (pose === "perfect") this.figure.setTexture("finder-perfect").setDisplaySize(176, 264);
    else this.figure.setTexture("finder-art", String(POSE_FRAME[pose])).setDisplaySize(208, 312);
    this.figure.setY(-15).setAngle(pose === "oops" && !this.reducedMotion ? -8 : 0);
    return this;
  }

  react(pose: FinderPose): void {
    this.setPose(pose);
    if (this.reducedMotion) return;
    this.reaction?.stop();
    this.reaction = this.scene.tweens.add({ targets: this.figure, y: -23, duration: 180, yoyo: true, ease: "Sine.easeOut" });
  }

  override destroy(fromScene?: boolean): void {
    this.reaction?.stop(); this.reaction = null;
    super.destroy(fromScene);
  }
}
