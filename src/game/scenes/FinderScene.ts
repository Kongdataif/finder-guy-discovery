import Phaser from "phaser";
import { FinderRunController } from "../core/FinderRunController";
import { FinderPointerInput } from "../core/PointerGestures";
import type { RunSnapshot, VirtualFile, RunKind } from "../core/types";
import { getCopy, formatCopy, type FinderCopy, type LocaleId } from "../i18n";
import { createSettingsStore, readLocaleOverride, resolveVisitLocale, type Settings } from "../settings";
import { FinderActor, drawFinderFace, prepareFinderFrames, FINDER_ATLAS_URL, FINDER_FRIEND_URL, FINDER_PERFECT_URL } from "../ui/FinderActor";
import { panel, text, button, fileIcon, folderIcon, INK, MUTED, BLUE } from "../ui/primitives";
import { Sound } from "../Sound";
import { TODAY_DISCOVERY, DISCOVERIES } from "../content/discoveries";
import { CARDS } from "../content/cards";
import { createProgressStore, localDateKey } from "../progress";
import { DeskDialogs, type DeskView } from "../ui/DeskDialogs";
import { DiscoveryReader } from "../ui/DiscoveryReader";
import { FINDER_PERSONALITIES } from "../content/finderPersonalities";
import type { CardId } from "../content/cards";

type Bounds = { id: string; rect: { x: number; y: number; width: number; height: number } };

export class FinderScene extends Phaser.Scene {
  private readonly controller = new FinderRunController();
  private readonly store = createSettingsStore(() => window.localStorage);
  private readonly audio = new Sound();
  private readonly progress = createProgressStore(() => window.localStorage, { catalog: DISCOVERIES });
  private transactionId = "";
  private lastRewardRun = -1;
  private newCardIds: readonly string[] = [];
  private recommendationId = "D02";
  private desk: DeskDialogs | null = null;
  private settings!: Settings;
  private locale: LocaleId = "ko";
  private copy!: FinderCopy;
  private root!: Phaser.GameObjects.Container;
  private overlay!: Phaser.GameObjects.Container;
  private ghost: Phaser.GameObjects.Container | null = null;
  private actor: FinderActor | null = null;
  private modal: "language" | "settings" | "discovery" | "desk" | null = null;
  private reader: DiscoveryReader | null = null;
  private pauseFromHidden = false;
  private audioNeedsGesture = false;
  private runFinderId: CardId = "C00";
  private lastPhase = "";
  private lastOverlay = "";
  private files: Bounds[] = [];
  private destinations: Bounds[] = [];
  private lanes: Array<Bounds & { lane: 0 | 1 | 2 }> = [];
  private fallingFile: Phaser.GameObjects.Container | null = null;
  private catchLabel: Phaser.GameObjects.Text | null = null;
  private readonly fileViews = new Map<string, { root: Phaser.GameObjects.Container; selected: Phaser.GameObjects.Graphics; check: Phaser.GameObjects.Text }>();
  private readonly stains = new Map<string, Phaser.GameObjects.Container>();
  private timerText: Phaser.GameObjects.Text | null = null;
  private timerFill: Phaser.GameObjects.Graphics | null = null;
  private statusText: Phaser.GameObjects.Text | null = null;
  private inputAdapter!: FinderPointerInput;
  private portraitHint!: HTMLParagraphElement;

  constructor() { super("FinderScene"); }

  preload(): void {
    this.load.image("finder-art", FINDER_ATLAS_URL);
    this.load.image("finder-friend", FINDER_FRIEND_URL);
    this.load.image("finder-perfect", FINDER_PERFECT_URL);
  }

  create(): void {
    prepareFinderFrames(this);
    this.cameras.main.setZoom(2).centerOn(480, 270);
    this.settings = this.store.load().settings;
    this.progress.load();
    this.locale = resolveVisitLocale(this.settings, location.search, navigator.language);
    this.copy = getCopy(this.locale);
    this.audio.muted = this.settings.muted;
    this.root = this.add.container(0, 0);
    this.overlay = this.add.container(0, 0).setDepth(100);
    this.modal = !this.settings.locale && !readLocaleOverride(location.search) ? "language" : null;
    this.inputAdapter = new FinderPointerInput(this.controller, () => ({ files: this.files, destinations: this.destinations, lanes: this.lanes }));
    this.portraitHint = document.createElement("p");
    this.portraitHint.style.cssText = "position:fixed;bottom:12px;left:16px;right:16px;text-align:center;background:#fff;padding:12px;border-radius:12px;font-size:14px;pointer-events:none";
    document.body.append(this.portraitHint);
    const now = () => performance.now();
    const point = (pointer: Phaser.Input.Pointer) => ({ x: pointer.worldX, y: pointer.worldY });
    const down = (pointer: Phaser.Input.Pointer) => {
      if (this.modal) return;
      this.inputAdapter.down(pointer.id, point(pointer), now());
      this.refresh();
    };
    const move = (pointer: Phaser.Input.Pointer) => {
      this.inputAdapter.move(pointer.id, point(pointer), now());
      this.refresh();
    };
    const up = (pointer: Phaser.Input.Pointer) => {
      if (pointer.wasCanceled) { this.clearGesture(); return; }
      const before = this.controller.snapshot();
      this.inputAdapter.up(pointer.id, point(pointer), now());
      const after = this.controller.snapshot();
      if (before.selectedId !== after.selectedId || before.completedIds.length !== after.completedIds.length || before.selectedIds.join() !== after.selectedIds.join()) this.audio.play("select");
      this.refresh();
    };
    const outside = (pointer: Phaser.Input.Pointer) => { this.inputAdapter.up(pointer.id, point(pointer), now(), true); this.clearGesture(); };
    const cancel = () => this.clearGesture();
    const preventTouchDefault = (event: TouchEvent) => {
      if (event.cancelable) event.preventDefault();
    };
    const stopForFocus = () => {
      this.audioNeedsGesture = true;
      this.audio.setPaused(true);
      this.pause(true);
    };
    const hidden = () => { if (document.hidden) stopForFocus(); };
    const blur = stopForFocus;
    const audioGesture = (event: Event) => {
      if (!event.isTrusted || document.hidden) return;
      this.audioNeedsGesture = false;
      this.audio.setPaused(this.controller.snapshot().paused);
      this.audio.unlock();
    };
    const resize = () => { this.clearGesture(); this.updatePortraitHint(); };
    const key = (event: KeyboardEvent) => {
      if (!this.modal && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
        const state = this.controller.snapshot();
        if (state.mission?.kind === "catch" && state.phase === "playing" && !state.paused) {
          event.preventDefault();
          this.controller.selectLane(Math.max(0, Math.min(2, state.catchLane + (event.key === "ArrowLeft" ? -1 : 1))) as 0 | 1 | 2, now(), this.controller.captureToken());
          this.refresh();
        }
      }
      if (event.key === "Escape" && !this.modal) {
        const state = this.controller.snapshot();
        if (state.paused) this.resume(); else this.pause(false);
      }
    };
    this.input.on("pointerdown", down);
    this.input.on("pointermove", move);
    this.input.on("pointerup", up);
    this.input.on("pointerupoutside", outside);
    this.game.canvas.addEventListener("pointercancel", cancel);
    this.game.canvas.addEventListener("touchcancel", cancel, true);
    // Bubble after Phaser handles input: canceling earlier makes Phaser skip
    // the event. Keep compatibility mouse events from repeating a touch action.
    const touchDefaults = ["touchstart", "touchmove", "touchend"] as const;
    for (const type of touchDefaults) {
      this.game.canvas.addEventListener(type, preventTouchDefault, { passive: false });
    }
    document.addEventListener("visibilitychange", hidden);
    document.addEventListener("pointerup", audioGesture, true);
    document.addEventListener("keydown", audioGesture, true);
    window.addEventListener("blur", blur);
    window.addEventListener("resize", resize);
    window.addEventListener("keydown", key);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.dismissDiscovery();
      this.clearGesture();
      this.input.off("pointerdown", down).off("pointermove", move).off("pointerup", up).off("pointerupoutside", outside);
      this.game.canvas.removeEventListener("pointercancel", cancel);
      this.game.canvas.removeEventListener("touchcancel", cancel, true);
      for (const type of touchDefaults) {
        this.game.canvas.removeEventListener(type, preventTouchDefault);
      }
      document.removeEventListener("visibilitychange", hidden);
      document.removeEventListener("pointerup", audioGesture, true);
      document.removeEventListener("keydown", audioGesture, true);
      window.removeEventListener("blur", blur);
      window.removeEventListener("resize", resize);
      window.removeEventListener("keydown", key);
      this.portraitHint.remove();
      this.audio.destroy();
      this.tweens.killAll();
    });
    this.refresh(true);
  }

  update(): void {
    this.controller.advance(performance.now());
    this.refresh();
  }

  /** Read-only inspection for browser regression; all actions still use real input. */
  public inspect() {
    if (!this.inputAdapter) return null;
    return { ...this.controller.snapshot(), locale: this.locale, modal: this.modal, discoveryId: this.reader?.discoveryId ?? null, files: this.files, destinations: this.destinations, lanes: this.lanes, progress: this.progress.load(), activeFinderId: this.controller.snapshot().phase === "lobby" ? this.progress.load().save.equippedCardId : this.runFinderId, audio: this.audio.inspect(), drag: this.inputAdapter.snapshot.drag, storageAvailable: this.store.load().storageAvailable };
  }

  private refresh(force = false): void {
    const state = this.controller.snapshot();
    this.audio.setPaused(state.paused || document.hidden || this.audioNeedsGesture);
    if (state.phase === "result" && this.lastRewardRun !== state.runId) {
      this.lastRewardRun = state.runId;
      const reward = this.progress.applyRun({ runId: this.transactionId, kind: state.runKind, completed: state.missionCount === 10 && state.outcomes.length === 10, mode: state.mode, successes: state.successes, maxCombo: state.maxCombo, score: state.score, handledFileIds: state.handledFileIds });
      this.newCardIds = reward.newCardIds;
      this.recommendationId = state.runKind === "practice" ? "D02" : this.progress.recommend(localDateKey(), DISCOVERIES).discoveryId ?? "D02";
    }
    const key = `${state.runId}:${state.missionId}:${state.phase}:${state.bossStep}:${this.locale}`;
    if (force || key !== this.lastPhase) {
      this.lastPhase = key;
      this.clearGesture();
      this.root.removeAll(true);
      this.actor = null;
      this.fileViews.clear();
      this.stains.clear();
      this.files = [];
      this.destinations = [];
      this.lanes = [];
      this.fallingFile = null;
      this.catchLabel = null;
      this.timerText = null;
      this.timerFill = null;
      this.statusText = null;
      this.frame(state);
      if (state.phase === "lobby") this.lobby();
      else if (state.phase === "result") this.result(state);
      else this.workbench(state);
      if (state.phase === "resolving") {
        this.audio.play(state.outcome?.status !== "success" ? "failure" : state.mission?.kind === "bundle" ? "bundle" : state.mission?.kind === "catch" ? "catch" : "success");
        (this.actor as FinderActor | null)?.react(state.outcome?.status === "success" ? "success" : "oops");
      }
      this.applyDocumentCopy();
    }
    this.updateMissionVisuals(state);
    const overlayKey = `${this.modal}:${state.paused}:${state.phase}:${state.missionId}:${this.locale}:${this.settings.muted}:${this.settings.reducedMotion}`;
    if (force || overlayKey !== this.lastOverlay) {
      this.lastOverlay = overlayKey;
      this.overlay.removeAll(true);
      if (this.modal === "language") this.languageGate();
      else if (this.modal === "settings") this.settingsDialog();
      else if (state.paused) this.pauseDialog();
      else if (state.phase === "tutorial") this.tutorial(state);
    }
  }

  private frame(state: RunSnapshot): void {
    panel(this, this.root, 0, 0, 960, 540, 0xf5f8fc, 0);
    panel(this, this.root, 0, 0, 960, 49, 0xffffff, 0);
    const dots = this.add.graphics();
    [0xff928b, 0xffd479, 0x84d7b2].forEach((color, i) => dots.fillStyle(color).fillCircle(28 + i * 18, 24, 4.5));
    this.root.add(dots);
    text(this, this.root, 480, 24, this.copy.common.windowTitle, 12, MUTED).setOrigin(0.5);
    const isLobby = state.phase === "lobby" || state.phase === "result";
    if (state.phase === "lobby") button(this, this.root, 82, 9, 145, 31, this.copy.full.practice, () => this.beginRun("practice"), { small: true, name: "start-practice" });
    if (state.phase === "lobby" || state.phase === "result") button(this, this.root, 239, 9, 143, 31, this.copy.guide.title, () => this.openDesk("guide"), { small: true, name: "open-guide" });
    if (isLobby) {
      button(this, this.root, 810, 9, 126, 31, `${this.locale.toUpperCase()}  ·  ${this.copy.common.settings}`, () => { this.modal = "settings"; this.refresh(); }, { small: true, name: "settings" });
    } else {
      button(this, this.root, 797, 9, 139, 31, `Ⅱ  ${this.copy.common.pause}`, () => this.pause(false), { small: true, name: "pause" });
    }
  }

  private lobby(): void {
    const c = this.copy;
    const badgeWidth = this.locale === "en" ? 220 : 178;
    panel(this, this.root, 54, 82, badgeWidth, 27, 0xe4efff, 13);
    text(this, this.root, 54 + badgeWidth / 2, 95, c.lobby.eyebrow, 12, "#2774bb").setOrigin(0.5);
    text(this, this.root, 54, 126, c.lobby.titleLines.join("\n"), this.locale === "ko" ? 39 : 37, INK, 466).setFontStyle("bold").setLineSpacing(2);
    text(this, this.root, 58, 238, c.lobby.subtitle, 15, MUTED, 430);
    c.guide.steps.forEach((step, i) => {
      const y = 285 + i * 28;
      panel(this, this.root, 58, y, 23, 23, 0xe4efff, 11);
      text(this, this.root, 70, y + 12, String(i + 1), 12, "#2774bb").setOrigin(0.5);
      text(this, this.root, 92, y + 2, step.title.replace(/^\d\.\s*/, ""), 14, INK, 364);
    });
    button(this, this.root, 58, 375, 407, 55, `${c.lobby.start}   →`, () => this.beginRun("regular"), { primary: true, name: "start-run" });
    button(this, this.root, 58, 446, 194, 37, c.lobby.normal, () => this.updateSettings({ mode: "normal" }), { small: true, selected: this.settings.mode === "normal", name: "mode-normal" });
    button(this, this.root, 270, 446, 195, 37, c.lobby.relaxed, () => this.updateSettings({ mode: "relaxed" }), { small: true, selected: this.settings.mode === "relaxed", name: "mode-relaxed" });
    text(this, this.root, 261, 496, this.settings.mode === "normal" ? c.lobby.normalDescription : c.lobby.relaxedDescription, 12, MUTED).setOrigin(0.5);
    panel(this, this.root, 526, 83, 380, 369, 0xe6f0ff, 29);
    const art = this.add.graphics().fillStyle(0xffffff, 0.62).fillCircle(719, 257, 141);
    art.fillStyle(0xd1e3fd).fillEllipse(716, 398, 251, 29);
    this.root.add(art);
    panel(this, this.root, 558, 115, 136, 69, 0xffffff, 12);
    fileIcon(this, this.root, 591, 148, "cat", 0.68);
    text(this, this.root, 620, 134, ".jpg", 12, MUTED);
    text(this, this.root, 620, 154, "✓", 18, "#389e81");
    folderIcon(this, this.root, 842, 327, 0xf1c363);
    this.actor = new FinderActor(this, 724, 280, 1.14).setReducedMotion(this.settings.reducedMotion);
    this.root.add(this.actor);
    const equipped = CARDS.find(card => card.id === this.progress.load().save.equippedCardId)!;
    this.actor.setPose(equipped.pose);
    panel(this, this.root, 548, 405, 338, 51, 0xffffff, 18);
    text(this, this.root, 717, 418, equipped.localized[this.locale].name, 10, MUTED, 318).setOrigin(0.5);
    text(this, this.root, 717, 439, FINDER_PERSONALITIES[equipped.id][this.locale].greeting, 12, "#3c698f", 318).setOrigin(0.5).setAlign("center");
    button(this, this.root, 527, 467, 116, 35, c.full.collection, () => this.openDesk("cards"), { small: true, name: "open-cards" });
    button(this, this.root, 653, 467, 116, 35, c.full.drawer, () => this.openDesk("discoveries"), { small: true, name: "open-drawer" });
    button(this, this.root, 779, 467, 128, 35, c.full.stories, () => this.openDesk("stories"), { small: true, name: "open-stories" });
    const progress = this.progress.load();
    if (progress.save.story.holidayPending || progress.save.story.friendPending) button(this, this.root, 577, 84, 294, 33, c.full.unclassifiedFile, () => this.openDesk("stories"), { primary: true, small: true, name: "pending-story" });
    const saveHint = progress.issue ? this.saveWarning() : `${c.full.completedRuns} ${progress.save.completedRuns} · ${c.full.highestScore} ${progress.save.bestScores[this.settings.mode]}`;
    text(this, this.root, 717, 518, saveHint, 11, MUTED, 374).setOrigin(0.5);
  }

  private visibleFiles(state: RunSnapshot): readonly VirtualFile[] {
    const mission = state.mission;
    if (!mission || mission.kind === "wipe" || mission.kind === "catch") return [];
    return mission.kind === "boss" ? mission.steps[state.bossStep]!.files : mission.files;
  }

  private workbench(state: RunSnapshot): void {
    const mission = state.mission!;
    const c = this.copy.missions[mission.kind];
    let condition = c.condition;
    if (mission.kind === "find") condition = formatCopy(this.copy.full.findTarget, { file: this.copy.files[mission.targetFileId as keyof FinderCopy["files"]] });
    if (mission.kind === "boss") condition = formatCopy(this.copy.full.bossStep, { current: state.bossStep + 1, total: 3 }) + " · " + (state.bossStep === 0 ? this.copy.full.bossFind : state.bossStep === 1 ? this.copy.full.bossSort : this.copy.full.bossSend);
    text(this, this.root, 112, 72, c.title, 30).setFontStyle("bold");
    text(this, this.root, 112, 114, condition, this.locale === "en" ? 16 : 18, MUTED, 595);
    text(this, this.root, 54, 81, `${String(state.missionIndex + 1).padStart(2, "0")}`, 25, "#4292df").setOrigin(0.5);
    this.timerText = text(this, this.root, 862, 75, "", 28).setOrigin(0.5, 0);
    panel(this, this.root, 786, 118, 128, 5, 0xdfe8f3, 2);
    this.timerFill = this.add.graphics(); this.root.add(this.timerFill);
    for (let index = 0; index < state.missionCount; index++) {
      const outcome = state.outcomes[index];
      const color = outcome ? outcome.status === "success" ? 0xdff3e9 : 0xf5e8df : index === state.missionIndex ? 0xddebff : 0xeaf0f7;
      panel(this, this.root, 31, 152 + index * 32, 44, 27, color, 9);
      text(this, this.root, 53, 165 + index * 32, outcome ? outcome.status === "success" ? "✓" : "–" : String(index + 1), 15, "#4281b8").setOrigin(0.5);
    }
    panel(this, this.root, 110, 154, 804, 305, 0xeaf1fa, 24);
    if (mission.kind === "wipe") this.wipeBoard(state);
    else if (mission.kind === "catch") this.catchBoard(state);
    else {
      const files = this.visibleFiles(state);
      const width = Math.min(182, 748 / files.length - 16);
      files.forEach((file, index) => this.drawFile(file, 134 + 756 * (index + 0.5) / files.length, 240, state, width));
      if (mission.kind === "sort" || (mission.kind === "boss" && state.bossStep === 1)) {
        this.destination("photos", 197, 360, 254, 73, this.copy.folders.photos);
        this.destination("documents", 537, 360, 254, 73, this.copy.folders.documents);
      } else if (mission.kind === "bundle") {
        this.destination("bundle-tray", 217, 366, 300, 67, this.copy.common.tray, true);
        const token = this.controller.captureToken();
        button(this, this.root, 545, 376, 217, 48, this.copy.full.bundleConfirm, () => { this.controller.confirmBundle(performance.now(), token); this.refresh(); }, { primary: true, name: "bundle-confirm" });
      } else {
        const destinationId = mission.kind === "boss" ? mission.steps[state.bossStep]!.destinationId : mission.destinationId;
        const label = destinationId === "photos" ? this.copy.folders.photos : destinationId === "desk" ? this.copy.full.desk : this.copy.common.tray;
        this.destination(destinationId, 349, 366, 287, 67, label, destinationId === "tray");
      }
      this.actor = new FinderActor(this, 853, 377, 0.44).setReducedMotion(this.settings.reducedMotion);
      this.root.add(this.actor);
      if (mission.kind === "sort") this.actor.setPose("work");
      if (mission.kind === "latest") this.actor.setPose("search");
      if (mission.kind === "boss") {
        text(this, this.root, 817, 175, [0, 1, 2].map(i => i < state.bossStep ? "✓" : i === state.bossStep ? "●" : "○").join("  "), 17, "#2774bb").setOrigin(0.5);
      }
    }
    this.statusText = text(this, this.root, 510, 478, c.tutorialHint, 14, MUTED, 792).setOrigin(0.5, 0);
    text(this, this.root, 510, 515, `${this.copy.full.score} ${state.score}  ·  ${this.copy.full.combo} ${state.combo}`, 12, MUTED).setOrigin(0.5);
    if (state.phase === "briefing") {
      panel(this, this.root, 387, 278, 204, 56, 0x2387ec, 18);
      text(this, this.root, 489, 306, c.title, 24, "#ffffff").setOrigin(0.5);
    }
    if (state.phase === "resolving") {
      const success = state.outcome?.status === "success";
      panel(this, this.root, 270, 199, 461, 121, success ? 0xe5f6ed : 0xfff0e4, 23, success ? 0xc0e9d5 : 0xf4d6bc);
      text(this, this.root, 500, 217, success ? `✓  ${this.copy.common.success}` : this.copy.common.failure, 25, INK).setOrigin(0.5, 0);
      const reaction = success ? c.success : this.copy.failures[state.outcome!.reason as keyof FinderCopy["failures"]];
      text(this, this.root, 500, 263, reaction, 15, MUTED, 422).setOrigin(0.5, 0);
    }
  }

  private catchBoard(state: RunSnapshot): void {
    const labels = [this.copy.full.catchLeft, this.copy.full.catchCenter, this.copy.full.catchRight];
    for (let lane = 0; lane < 3; lane++) {
      const x = 167 + lane * 226;
      panel(this, this.root, x, 176, 211, 263, 0xffffff, 18, 0xd9e5f3);
      text(this, this.root, x + 105, 413, labels[lane]!, 17, MUTED).setOrigin(0.5);
      this.lanes.push({ id: String(lane), lane: lane as 0 | 1 | 2, rect: { x, y: 176, width: 211, height: 263 } });
    }
    this.actor = new FinderActor(this, 499, 365, 0.40).setReducedMotion(this.settings.reducedMotion).setPose("carry");
    this.root.add(this.actor);
    this.fallingFile = fileIcon(this, this.root, 499, 205, "note", 0.65);
    this.catchLabel = text(this, this.root, 510, 165, formatCopy(this.copy.full.catchCount, { count: state.catchIndex, total: state.missionCount }), 13, "#2774bb").setOrigin(0.5);
  }

  private drawFile(file: VirtualFile, x: number, y: number, state: RunSnapshot, width = 182): void {
    const root = this.add.container(x, y); this.root.add(root);
    panel(this, root, -width / 2, -60, width, 141, 0xffffff, 16, 0xd9e5f3);
    const selected = this.add.graphics().lineStyle(3, BLUE).strokeRoundedRect(-width / 2, -60, width, 141, 16).setVisible(false); root.add(selected);
    fileIcon(this, root, 0, file.modifiedAt === undefined ? -13 : -24, file.icon, 0.8);
    text(this, root, 0, file.modifiedAt === undefined ? 35 : 20, this.copy.files[file.id as keyof FinderCopy["files"]], width < 170 ? 12 : 14, INK, width - 14).setOrigin(0.5);
    if (file.modifiedAt !== undefined) text(this, root, 0, 53, `${String(Math.floor(file.modifiedAt / 60)).padStart(2, "0")}:${String(file.modifiedAt % 60).padStart(2, "0")}`, 21, "#2774bb").setOrigin(0.5);
    const check = text(this, root, width / 2 - 20, -40, "✓", 21, "#2e9877").setOrigin(0.5).setVisible(false);
    this.fileViews.set(file.id, { root, selected, check });
    this.files.push({ id: file.id, rect: { x: x - width / 2, y: y - 60, width, height: 141 } });
    root.setName(`file-${file.id}`);
    if (state.completedIds.includes(file.id)) root.setAlpha(0.38);
  }

  private destination(id: string, x: number, y: number, w: number, h: number, label: string, tray = false): void {
    panel(this, this.root, x, y, w, h, tray ? 0xdbeaff : 0xffffff, 16, tray ? 0xa7c8f6 : 0xd6e3f2);
    if (tray) text(this, this.root, x + 33, y + h / 2, "↓", 26, "#3986ce").setOrigin(0.5);
    else folderIcon(this, this.root, x + 43, y + h / 2, id === "photos" ? 0x74b9f6 : 0xe8bc66);
    text(this, this.root, x + w / 2 + 16, y + h / 2, label, 18).setOrigin(0.5);
    this.destinations.push({ id, rect: { x, y, width: w, height: h } });
  }

  private wipeBoard(state: RunSnapshot): void {
    if (state.mission?.kind !== "wipe") return;
    this.root.add(drawFinderFace(this, 485, 285, 355));
    const frames = this.add.graphics();
    frames.fillStyle(0xe9f8ff, 0.23).fillRoundedRect(337, 243, 155, 100, 31).fillRoundedRect(508, 243, 155, 100, 31);
    frames.lineStyle(7, 0x31567b).strokeRoundedRect(337, 243, 155, 100, 31).strokeRoundedRect(508, 243, 155, 100, 31);
    frames.lineBetween(492, 283, 508, 283).lineBetween(314, 271, 337, 281).lineBetween(663, 281, 686, 271);
    this.root.add(frames);
    state.mission.stains.forEach((stain) => {
      const root = this.add.container(stain.x, stain.y).setName(stain.id); this.root.add(root);
      const g = this.add.graphics();
      g.fillStyle(0x92786e, 0.7).fillEllipse(0, 0, stain.radius * 2, stain.radius * 1.6);
      g.fillStyle(0xb39d91, 0.6).fillCircle(-9, -10, stain.radius * 0.68).fillCircle(10, 6, stain.radius * 0.6);
      g.fillStyle(0xe0d4c8, 0.52).fillEllipse(-5, -9, 12, 7);
      root.add(g); this.stains.set(stain.id, root);
    });
    text(this, this.root, 500, 426, "✧  ✧  ✧", 21, "#73a5c4").setOrigin(0.5);
  }

  private updateMissionVisuals(state: RunSnapshot): void {
    for (const [id, view] of this.fileViews) {
      view.selected.setVisible(state.selectedId === id || state.selectedIds.includes(id));
      view.check.setVisible(state.completedIds.includes(id));
      view.root.setAlpha(state.completedIds.includes(id) ? 0.36 : 1);
    }
    for (const [id, stain] of this.stains) stain.setVisible(!state.completedIds.includes(id));
    if (this.timerText) {
      this.timerText.setText(state.phase === "tutorial" ? "∞" : `${Math.ceil(state.remainingMs / 1000)}${this.copy.common.seconds}`);
      this.timerText.setColor(state.remainingMs < 2500 && state.phase === "playing" ? "#bd724e" : INK);
    }
    if (this.timerFill) {
      this.timerFill.clear().fillStyle(BLUE).fillRoundedRect(786, 118, 128 * (state.remainingMs / state.deadlineMs), 5, 2);
    }
    const drag = this.inputAdapter.snapshot.drag;
    if (drag) {
      if (!this.ghost) {
        this.ghost = this.add.container(0, 0).setDepth(50);
        const file = this.visibleFiles(state).find((item) => item.id === drag.fileId);
        fileIcon(this, this.ghost, 0, 0, file?.icon ?? "note", 0.8);
      }
      this.ghost.setPosition(drag.x, drag.y).setAlpha(0.88);
      if (this.actor && !this.settings.reducedMotion) this.actor.setPosition(Math.min(861, Math.max(150, drag.x + 60)), Math.min(405, Math.max(245, drag.y + 42)));
    } else {
      this.ghost?.destroy(true); this.ghost = null;
      if (this.actor && state.phase === "playing" && state.mission?.kind !== "wipe" && state.mission?.kind !== "catch") {
        this.actor.setPosition(853, 377);
      }
    }
    if (this.actor && state.phase === "playing" && state.mission?.kind !== "catch") this.actor.setPose(state.selectedId || drag ? "carry" : state.mission?.kind === "sort" ? "work" : state.mission?.kind === "latest" ? "search" : "idle");
    if (state.mission?.kind === "catch") {
      this.actor?.setPosition(272 + state.catchLane * 226, 360);
      this.catchLabel?.setText(formatCopy(this.copy.full.catchCount, { count: state.catchIndex, total: 3 }));
      this.fallingFile?.setVisible(!!state.catchNext);
      if (state.catchNext) this.fallingFile?.setPosition(272 + state.catchNext.lane * 226, 201 + state.catchNext.progress * 137).setAlpha(state.catchNext.preview ? 0.4 : 1);
    }
  }

  private result(state: RunSnapshot): void {
    const c = this.copy.result;
    const f = this.copy.full;
    const practice = state.runKind === "practice";
    panel(this, this.root, 52, 86, 855, 371, 0xffffff, 27, 0xe4ebf5);
    text(this, this.root, 94, 111, practice ? f.practiceResult : c.eyebrow, 14, "#338fca");
    text(this, this.root, 94, 147, state.goalAchieved ? c.allTitle : c.imperfectTitle, this.locale === "ko" ? 28 : 26, INK, 525).setFontStyle("bold");
    text(this, this.root, 96, 207, formatCopy(c.progress, { count: state.successes, total: state.missionCount }), 22).setFontStyle("bold");
    text(this, this.root, 96, 245, `${f.score} ${state.score} · ${state.mode === "normal" ? this.copy.lobby.normal : this.copy.lobby.relaxed}`, 18, MUTED);
    text(this, this.root, 96, 278, practice ? f.practiceNotice : state.goalAchieved ? f.goalAchieved : `${f.goalNext}: ${f.goalSeven}`, 13, MUTED, 490);
    state.outcomes.forEach((outcome, i) => {
      const x = 98 + i * 45;
      panel(this, this.root, x, 317, 36, 32, outcome.status === "success" ? 0xe7f6ee : 0xf1f3f7, 9);
      text(this, this.root, x + 18, 333, outcome.status === "success" ? "✓" : "–", 17).setOrigin(0.5);
    });
    const names = this.newCardIds.map(id => CARDS.find(card => card.id === id)!.localized[this.locale].name);
    text(this, this.root, 97, 364, names.length ? `${f.newCards}: ${names.join(" · ")}` : practice ? f.practiceNotice : f.noNewCards, 13, "#377daa", 485);
    button(this, this.root, 97, 412, 147, 31, f.collection, () => this.openDesk("cards"), { small: true, name: "open-cards" });
    button(this, this.root, 256, 412, 140, 31, f.drawer, () => this.openDesk("discoveries"), { small: true, name: "open-drawer" });
    button(this, this.root, 408, 412, 158, 31, this.progress.load().save.story.friendPending ? f.unclassifiedFile : f.stories, () => this.openDesk("stories"), { small: true, name: "open-stories" });
    this.actor = new FinderActor(this, 748, 269, 1.18).setReducedMotion(this.settings.reducedMotion).setPose(state.goalAchieved ? "success" : "rest");
    this.root.add(this.actor);
    text(this, this.root, 749, 430, this.saveWarning() || c.thanks, 12, MUTED, 243).setOrigin(0.5);
    button(this, this.root, 52, 475, 320, 43, this.copy.discovery.open, () => this.openDiscovery(), { primary: true, name: "open-discovery" });
    button(this, this.root, 388, 475, 247, 43, c.retry, () => this.beginRun(), { name: "restart" });
    button(this, this.root, 651, 475, 256, 43, c.lobby, () => this.returnToLobby(), { name: "return-lobby" });
  }

  private saveWarning(): string {
    const issue = this.progress.load().issue;
    return issue === "corrupt" ? this.copy.full.storageCorrupt : issue === "future-version" ? this.copy.full.storageFuture : issue ? this.copy.full.storageUnavailable : "";
  }

  private openDesk(view: DeskView): void {
    const state = this.controller.snapshot();
    if (state.phase !== "lobby" && state.phase !== "result") return;
    this.dismissDiscovery();
    this.modal = "desk";
    this.audio.play(view === "stories" ? "story" : "card");
    this.input.enabled = false;
    this.desk = new DeskDialogs({ view, locale: this.locale, copy: this.copy, store: this.progress, reducedMotion: this.settings.reducedMotion,
      files: this.progress.load().save.handledFileIds.map(id => this.copy.files[id as keyof FinderCopy["files"]] ?? id),
      onClose: () => { this.dismissDiscovery(); this.refresh(true); },
      onRead: id => this.openDiscovery(id),
      onRestart: () => this.beginRun("regular"), onLobby: () => this.returnToLobby(), onChange: () => this.audio.play("card"),
    });
    this.refresh();
  }

  private openDiscovery(id?: string, other = false, origin?: "result" | "drawer"): void {
    const state = this.controller.snapshot();
    if (state.phase !== "result" && state.phase !== "lobby") return;
    const readerOrigin = origin ?? (this.modal === "desk" || state.phase === "lobby" ? "drawer" : "result");
    const fromDrawer = readerOrigin === "drawer";
    this.dismissDiscovery();
    if (other) this.recommendationId = this.progress.recommend(localDateKey(), DISCOVERIES, true).discoveryId ?? "D02";
    const discovery = DISCOVERIES.find(item => item.id === (id ?? this.recommendationId)) ?? TODAY_DISCOVERY;
    this.progress.openDiscovery(discovery.id);
    this.progress.markRead(discovery.id);
    this.modal = "discovery";
    this.input.enabled = false;
    this.reader = new DiscoveryReader({
      id: discovery.id, locale: this.locale, content: discovery.localized[this.locale], copy: this.copy,
      backLabel: fromDrawer ? this.copy.full.drawer : this.copy.discovery.backToResult,
      onOther: this.progress.load().save.completedRuns > 0 ? () => this.openDiscovery(undefined, true, readerOrigin) : undefined,
      onAction: () => this.progress.openAction(discovery.id),
      onDone: discovery.recordsAction ? () => this.progress.doneAction(discovery.id) : undefined,
      actionDone: this.progress.load().save.discovery.actionDoneIds.includes(discovery.id),
      onClose: () => { this.dismissDiscovery(); if (fromDrawer) this.openDesk("discoveries"); else this.refresh(true); },
      onRestart: () => this.beginRun(), onLobby: () => this.returnToLobby(),
    });
    this.refresh();
  }

  private dismissDiscovery(): void {
    this.reader?.destroy(); this.reader = null;
    this.desk?.destroy(); this.desk = null;
    if (this.modal === "discovery" || this.modal === "desk") this.modal = null;
    this.input.enabled = true;
    this.clearGesture();
  }

  private scrim(x: number, y: number, w: number, h: number): void {
    const shade = this.add.rectangle(480, 270, 960, 540, 0x294766, 0.32).setInteractive();
    shade.on("pointerdown", (_p: unknown, _x: number, _y: number, e: Phaser.Types.Input.EventData) => e.stopPropagation());
    shade.on("pointerup", (_p: unknown, _x: number, _y: number, e: Phaser.Types.Input.EventData) => e.stopPropagation());
    this.overlay.add(shade);
    panel(this, this.overlay, x, y, w, h, 0xffffff, 24, 0xdde8f5);
  }

  private tutorial(state: RunSnapshot): void {
    const c = this.copy.missions[state.mission!.kind];
    this.scrim(200, 138, 560, 304);
    const personality = FINDER_PERSONALITIES[this.runFinderId][this.locale];
    text(this, this.overlay, 480, 160, personality.missions[state.mission!.kind], 13, "#3c698f", 500).setOrigin(0.5).setAlign("center");
    text(this, this.overlay, 480, 185, formatCopy(this.copy.common.missionProgress, { current: state.missionIndex + 1, total: state.missionCount }), 12, "#3886bf").setOrigin(0.5);
    text(this, this.overlay, 480, 210, c.tutorialTitle, 25).setOrigin(0.5);
    text(this, this.overlay, 480, 253, c.tutorialBody, 16, MUTED, 496).setOrigin(0.5, 0).setAlign("center");
    text(this, this.overlay, 480, 326, c.tutorialHint, 13, "#3d77a9", 500).setOrigin(0.5);
    const token = this.controller.captureToken();
    button(this, this.overlay, 329, 366, 302, 49, this.copy.common.start, () => {
      this.audio.unlock(); this.clearGesture(); this.controller.ready(performance.now(), token); this.refresh();
    }, { primary: true, name: "tutorial-start" });
  }

  private languageGate(): void {
    this.scrim(206, 143, 548, 265);
    text(this, this.overlay, 480, 175, this.copy.languageGate.title, 26).setOrigin(0.5);
    text(this, this.overlay, 480, 225, this.copy.languageGate.body, 16, MUTED).setOrigin(0.5);
    button(this, this.overlay, 262, 290, 205, 59, this.copy.languageGate.korean, () => this.chooseLocale("ko"), { primary: true, name: "language-ko" });
    button(this, this.overlay, 490, 290, 205, 59, this.copy.languageGate.english, () => this.chooseLocale("en"), { name: "language-en" });
  }

  private settingsDialog(): void {
    const c = this.copy.settings;
    this.scrim(199, 92, 562, 399);
    text(this, this.overlay, 238, 121, c.title, 26).setFontStyle("bold");
    const atLobby = this.controller.snapshot().phase === "lobby";
    if (atLobby) {
      text(this, this.overlay, 240, 184, c.language, 16);
      button(this, this.overlay, 453, 174, 120, 37, "한국어", () => this.chooseLocale("ko", true), { small: true, selected: this.locale === "ko" });
      button(this, this.overlay, 587, 174, 128, 37, "English", () => this.chooseLocale("en", true), { small: true, selected: this.locale === "en" });
    } else text(this, this.overlay, 239, 183, c.languageAtLobby, 14, MUTED, 480);
    text(this, this.overlay, 240, 242, c.muted, 16);
    button(this, this.overlay, 453, 231, 262, 37, this.settings.muted ? c.soundOff : c.soundOn, () => this.updateSettings({ muted: !this.settings.muted }), { small: true, selected: !this.settings.muted, name: "toggle-sound" });
    text(this, this.overlay, 240, 297, c.reducedMotion, 16);
    button(this, this.overlay, 584, 286, 131, 37, this.settings.reducedMotion ? c.enabled : c.disabled, () => this.updateSettings({ reducedMotion: !this.settings.reducedMotion }), { small: true, selected: this.settings.reducedMotion, name: "toggle-motion" });
    text(this, this.overlay, 240, 344, this.store.load().storageAvailable ? c.savedLocally : c.storageUnavailable, 13, MUTED, 465);
    button(this, this.overlay, 324, 412, 312, 47, this.copy.common.close, () => { this.modal = null; this.refresh(); }, { primary: true, name: "close-settings" });
  }

  private pauseDialog(): void {
    const c = this.copy.pause;
    this.scrim(232, 143, 497, 284);
    text(this, this.overlay, 480, 176, this.pauseFromHidden ? c.hiddenTitle : c.title, 28).setOrigin(0.5);
    text(this, this.overlay, 480, 229, this.pauseFromHidden ? c.hiddenBody : c.body, 15, MUTED, 430).setOrigin(0.5).setAlign("center");
    button(this, this.overlay, 275, 282, 410, 48, c.resume, () => this.resume(), { primary: true, name: "resume" });
    button(this, this.overlay, 275, 350, 195, 43, c.restart, () => this.beginRun(), { small: true, name: "pause-restart" });
    button(this, this.overlay, 488, 350, 197, 43, c.lobby, () => this.returnToLobby(), { small: true, name: "pause-lobby" });
  }

  private beginRun(kind?: RunKind): void {
    const runKind = kind ?? this.controller.snapshot().runKind;
    this.transactionId = this.progress.createRunId();
    this.newCardIds = [];
    this.runFinderId = this.progress.load().save.equippedCardId;
    this.dismissDiscovery();
    this.modal = null;
    this.clearGesture();
    this.tweens.resumeAll();
    const seed = crypto.getRandomValues(new Uint32Array(1))[0]!;
    this.controller.begin(this.locale, this.settings.mode, seed, performance.now(), runKind);
    this.audioNeedsGesture = false;
    this.audio.setPaused(false); this.audio.unlock();
    this.refresh(true);
  }

  private returnToLobby(): void {
    this.dismissDiscovery();
    this.clearGesture(); this.tweens.resumeAll(); this.controller.reset(performance.now()); this.modal = null;
    this.audioNeedsGesture = false; this.audio.setPaused(false); this.audio.unlock(); this.refresh(true);
  }

  private pause(hidden: boolean): void {
    if (!this.controller.pause(performance.now())) return;
    this.pauseFromHidden = hidden;
    this.clearGesture(); this.tweens.pauseAll(); this.refresh();
  }

  private resume(): void {
    this.clearGesture(); this.controller.resume(performance.now()); this.tweens.resumeAll();
    this.audioNeedsGesture = false; this.audio.setPaused(false); this.audio.unlock(); this.refresh();
  }

  private clearGesture(): void { this.inputAdapter?.cancel(); this.ghost?.destroy(true); this.ghost = null; }

  private chooseLocale(locale: LocaleId, keepSettings = false): void {
    this.settings = this.store.update({ locale }).settings;
    this.locale = locale; this.copy = getCopy(locale); this.modal = keepSettings ? "settings" : null; this.refresh(true);
  }

  private updateSettings(patch: Partial<Settings>): void {
    this.settings = this.store.update(patch).settings;
    this.audio.muted = this.settings.muted;
    this.audio.unlock();
    this.refresh(true);
  }

  private applyDocumentCopy(): void {
    document.documentElement.lang = this.locale;
    document.title = this.copy.lobby.titleLines.join(" ");
    document.querySelector("#game-container")?.setAttribute("aria-label", this.copy.common.windowTitle);
    this.updatePortraitHint();
  }

  private updatePortraitHint(): void {
    if (!this.portraitHint) return;
    this.portraitHint.textContent = this.copy.common.rotateHint;
    this.portraitHint.hidden = !(innerWidth < 760 && innerHeight > innerWidth);
  }
}
