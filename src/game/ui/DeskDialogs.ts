import { CARDS, type CardDescriptor, type CardId, type CardPose } from '../content/cards';
import { DISCOVERIES, type Discovery, type TopicId } from '../content/discoveries';
import { STORIES, type StoryId } from '../content/stories';
import { formatCopy, type FinderCopy, type LocaleId, type MissionId } from '../i18n';
import { localDateKey, type FinderProgressStore, type StoryChoice } from '../progress';
import './desk-dialogs.css';

export type DeskView = 'cards' | 'discoveries' | 'stories' | 'guide';

export interface DeskDialogOptions {
  view: DeskView;
  locale: LocaleId;
  copy: FinderCopy;
  store: FinderProgressStore;
  reducedMotion: boolean;
  files: string[];
  onClose: () => void;
  onRead: (id: string) => void;
  onRestart: () => void;
  onLobby: () => void;
  onChange?: () => void;
}

interface StoryClip {
  id: StoryId;
  choice?: StoryChoice;
  replay: boolean;
  step: number;
  elapsed: number;
  done: boolean;
}

const FRAMES: Readonly<Record<Exclude<CardPose, 'perfect'>, number>> = {
  idle: 0, search: 1, work: 2, rest: 3, cool: 4, success: 5, holiday: 6, friend: 7,
};

function node<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, value?: string): HTMLElementTagNameMap[K] {
  const result = document.createElement(tag);
  result.className = className;
  if (value !== undefined) result.textContent = value;
  return result;
}

/** Native galleries and story presentation. Rewards commit before any scene begins. */
export class DeskDialogs {
  private readonly dialog = node('dialog', 'desk-dialog');
  private readonly lifetime = new AbortController();
  private renderEvents = new AbortController();
  private view: DeskView;
  private cardId: CardId | null = null;
  private storyId: StoryId | null = null;
  private clip: StoryClip | null = null;
  private replayingPose = false;
  private clock: ReturnType<typeof setInterval> | null = null;
  private lastTick = 0;
  private destroyed = false;
  private recommendation: string | null = null;

  constructor(private readonly options: DeskDialogOptions) {
    this.view = options.view;
    this.dialog.dataset.testid = 'desk-dialog';
    this.dialog.dataset.reducedMotion = String(options.reducedMotion);
    this.dialog.lang = options.locale;
    this.dialog.setAttribute('aria-labelledby', 'desk-dialog-title');
    this.dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      if (this.clip) this.finishClip(); else this.options.onClose();
    }, { signal: this.lifetime.signal });
    document.addEventListener('visibilitychange', () => {
      // Both sides of a visibility change reset the clock: hidden time never counts.
      this.lastTick = performance.now();
    }, { signal: this.lifetime.signal });
    this.render();
    document.body.append(this.dialog);
    document.body.classList.add('discovery-open');
    this.dialog.showModal();
    this.focusTitle();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.stopClock();
    this.renderEvents.abort();
    this.lifetime.abort();
    this.clip = null;
    this.dialog.close();
    this.dialog.remove();
    if (!document.querySelector('.desk-dialog[open], .discovery-reader[open]')) {
      document.body.classList.remove('discovery-open');
    }
  }

  private render(): void {
    if (this.destroyed) return;
    this.stopClock();
    this.renderEvents.abort();
    this.renderEvents = new AbortController();
    this.dialog.replaceChildren();
    this.dialog.dataset.view = this.view;
    this.dialog.dataset.story = this.clip?.id ?? this.storyId ?? '';
    this.dialog.dataset.clipStep = this.clip ? String(this.clip.step) : '';
    const full = this.options.copy.full;
    const heading = this.clip ? STORIES[this.clip.id].localized[this.options.locale].title
      : this.cardId ? this.card(this.cardId).localized[this.options.locale].name
        : this.storyId ? STORIES[this.storyId].localized[this.options.locale].title
          : this.view === 'cards' ? full.collection : this.view === 'discoveries' ? full.drawer
            : this.view === 'guide' ? this.options.copy.guide.title : full.stories;
    const header = node('header', 'desk-dialog-header');
    const title = node('h1', 'desk-dialog-title', heading);
    title.id = 'desk-dialog-title';
    title.tabIndex = -1;
    header.append(title, this.button(this.options.copy.common.close, 'desk-close', () => {
      if (this.clip) this.finishClip(); else this.options.onClose();
    }, 'desk-button quiet'));
    this.dialog.append(header);

    if (!this.clip) {
      const tabs = node('nav', 'desk-tabs');
      tabs.setAttribute('aria-label', full.collection);
      for (const [view, label] of [['cards', full.collection], ['discoveries', full.drawer], ['stories', full.stories], ['guide', this.options.copy.guide.title]] as const) {
        const tab = this.button(label, `tab-${view}`, () => {
          this.view = view; this.cardId = null; this.storyId = null; this.replayingPose = false;
          this.render(); this.focusTitle();
        }, `desk-tab${this.view === view ? ' selected' : ''}`);
        tab.setAttribute('aria-current', this.view === view ? 'page' : 'false');
        tabs.append(tab);
      }
      this.dialog.append(tabs);
    }

    const content = node('div', 'desk-dialog-scroll');
    content.tabIndex = 0;
    const issue = this.options.store.load().issue;
    if (issue) {
      content.append(node('p', 'desk-save-notice', issue === 'future-version' ? full.storageFuture
        : issue === 'corrupt' ? full.storageCorrupt : full.storageUnavailable));
    }
    if (this.clip) this.renderClip(content);
    else if (this.cardId) this.renderCard(content, this.card(this.cardId));
    else if (this.storyId) this.renderStoryFile(content, this.storyId);
    else if (this.view === 'cards') this.renderCards(content);
    else if (this.view === 'discoveries') this.renderDrawer(content);
    else if (this.view === 'guide') this.renderGuide(content);
    else this.renderStories(content);
    this.dialog.append(content);
    if (this.clip && !this.clip.done && !this.options.reducedMotion) this.startClock();
  }

  private renderGuide(parent: HTMLElement): void {
    const copy = this.options.copy;
    const guide = copy.guide;
    const article = node('article', 'desk-guide');
    article.dataset.testid = 'game-guide';
    article.append(node('p', 'desk-guide-intro', guide.intro));
    const steps = node('ol', 'desk-guide-steps');
    for (const step of guide.steps) {
      const item = node('li', 'desk-guide-step');
      item.append(node('h2', '', step.title), node('p', '', step.body));
      steps.append(item);
    }
    article.append(steps);
    const notes = node('aside', 'desk-guide-notes');
    notes.append(node('p', '', guide.completion), node('p', '', guide.practice));
    article.append(notes, node('h2', 'desk-section-heading', guide.controlsTitle));
    const controls = node('dl', 'desk-guide-controls');
    for (const kind of ['find', 'sort', 'wipe', 'latest', 'bundle', 'catch', 'boss'] as const satisfies readonly MissionId[]) {
      const item = node('div', 'desk-guide-control');
      item.dataset.testid = `guide-control-${kind}`;
      item.append(node('dt', '', copy.missions[kind].title), node('dd', '', guide.controls[kind]));
      controls.append(item);
    }
    article.append(controls, node('h2', 'desk-section-heading', guide.cardsTitle));
    const table = node('table', 'desk-guide-cards');
    table.dataset.testid = 'guide-card-conditions';
    const head = node('thead', '');
    const labels = node('tr', '');
    for (const label of [guide.cardColumn, guide.conditionColumn]) {
      const cell = node('th', '', label); cell.scope = 'col'; labels.append(cell);
    }
    head.append(labels);
    const body = node('tbody', '');
    for (const card of CARDS) {
      const row = node('tr', '');
      const name = node('th', '', card.localized[this.options.locale].name); name.scope = 'row';
      row.append(name, node('td', '', card.localized[this.options.locale].condition));
      body.append(row);
    }
    table.append(head, body);
    article.append(table, node('p', 'desk-guide-orientation', guide.portrait));
    parent.append(article);
  }

  private renderCards(parent: HTMLElement): void {
    const save = this.options.store.load().save;
    const full = this.options.copy.full;
    parent.append(node('p', 'desk-summary', formatCopy(full.allCards, { count: save.unlockedCardIds.length, total: CARDS.length })));
    if (save.unlockedCardIds.length === CARDS.length) parent.append(node('p', 'desk-notice', full.allCollected));
    const grid = node('div', 'desk-card-grid');
    for (const card of CARDS) {
      const copy = card.localized[this.options.locale];
      const unlocked = save.unlockedCardIds.includes(card.id);
      const button = this.button('', `cards-open-${card.id}`, () => {
        this.cardId = card.id; this.replayingPose = false; this.render(); this.focusTitle();
      }, `desk-card${unlocked ? '' : ' locked'}`);
      button.append(this.art(card.pose, copy.name), node('span', 'desk-card-name', copy.name),
        node('span', 'desk-card-status', unlocked ? save.equippedCardId === card.id ? full.equipped : full.details : full.locked),
        node('span', 'desk-card-condition', copy.condition));
      grid.append(button);
    }
    parent.append(grid);
  }

  private renderCard(parent: HTMLElement, card: CardDescriptor): void {
    const save = this.options.store.load().save;
    const unlocked = save.unlockedCardIds.includes(card.id);
    const copy = card.localized[this.options.locale];
    const full = this.options.copy.full;
    const detail = node('section', `desk-card-detail${unlocked ? '' : ' locked'}`);
    const art = this.art(card.pose, copy.name);
    if (this.replayingPose && !this.options.reducedMotion) art.classList.add('replaying');
    const text = node('div', 'desk-card-text');
    text.append(node('h2', '', copy.name), node('p', 'desk-story-prose', unlocked ? copy.story : full.locked),
      node('p', 'desk-condition', copy.condition));
    const actions = node('div', 'desk-inline-actions');
    if (unlocked) {
      const equipped = save.equippedCardId === card.id;
      const equip = this.button(equipped ? full.equipped : full.equip, `equip-${card.id}`, () => {
        this.options.store.equip(card.id); this.options.onChange?.(); this.render();
      }, 'desk-button primary');
      equip.disabled = equipped;
      actions.append(equip, this.button(full.replay, `card-replay-${card.id}`, () => {
        this.replayingPose = true; this.render();
      }));
    }
    actions.append(this.button(full.back, 'card-back', () => { this.cardId = null; this.render(); this.focusTitle(); }));
    text.append(actions); detail.append(art, text); parent.append(detail);
  }

  private renderDrawer(parent: HTMLElement): void {
    let save = this.options.store.load().save;
    const full = this.options.copy.full;
    if (save.completedRuns < 1) {
      parent.append(node('p', 'desk-empty', full.discoveryLocked));
      return;
    }
    parent.append(node('p', 'desk-notice', full.chooseTopic));
    const topics = node('div', 'desk-topic-options');
    for (const [topic, label] of [[null, full.topicAll], ['organize', full.topicOrganize], ['create', full.topicCreate], ['rest', full.topicRest]] as const) {
      const selected = save.settings.preferredTopic === topic;
      const control = this.button(label, `topic-${topic ?? 'all'}`, () => {
        this.options.store.setTopic(topic as TopicId | null);
        this.recommendation = this.options.store.recommend(localDateKey(), DISCOVERIES).discoveryId;
        this.options.onChange?.(); this.render();
      }, `desk-topic${selected ? ' selected' : ''}`);
      control.setAttribute('aria-pressed', String(selected));
      topics.append(control);
    }
    parent.append(topics);
    this.recommendation = this.options.store.recommend(localDateKey(), DISCOVERIES).discoveryId;
    save = this.options.store.load().save;
    const recommended = DISCOVERIES.find((item) => item.id === this.recommendation);
    if (recommended) {
      const feature = node('section', 'desk-recommendation');
      feature.append(node('p', 'desk-eyebrow', this.options.copy.discovery.heading));
      this.discoveryCard(feature, recommended, true);
      feature.append(this.button(full.otherDiscovery, 'other-discovery', () => {
        this.recommendation = this.options.store.recommend(localDateKey(), DISCOVERIES, true).discoveryId;
        this.options.onChange?.(); this.render();
      }));
      parent.append(feature);
    }
    parent.append(node('h2', 'desk-section-heading', full.received));
    const grid = node('div', 'desk-discovery-grid');
    // The original editable sample remains reachable after the first regular run.
    const received = new Set(['D02', ...save.discovery.receivedBundleIds, ...save.discovery.openedBundleIds]);
    for (const item of DISCOVERIES) {
      if (!received.has(item.id)) continue;
      const card = node('section', 'desk-discovery-card');
      this.discoveryCard(card, item, false);
      grid.append(card);
    }
    parent.append(grid);
  }

  private discoveryCard(parent: HTMLElement, item: Discovery, featured: boolean): void {
    const copy = item.localized[this.options.locale];
    const read = this.options.store.load().save.discovery.readBundleIds.includes(item.id);
    parent.append(node('p', 'desk-topic-label', copy.topic), node(featured ? 'h2' : 'h3', '', copy.title),
      node('p', 'desk-read-status', read ? this.options.copy.full.seen : this.options.copy.full.unopened),
      this.button(this.options.copy.full.read, `${featured ? 'recommended-read' : 'drawer-read'}-${item.id}`,
        () => this.options.onRead(item.id), featured ? 'desk-button primary' : 'desk-button'));
  }

  private renderStories(parent: HTMLElement): void {
    const save = this.options.store.load().save;
    const full = this.options.copy.full;
    const grid = node('div', 'desk-story-grid');
    for (const id of ['H01', 'H02'] as const) {
      const seen = id === 'H01' ? save.story.holidaySeen : save.story.friendSeen;
      const pending = id === 'H01' ? save.story.holidayPending : save.story.friendPending;
      const available = seen || pending;
      const item = node('section', `desk-story-card${available ? '' : ' locked'}`);
      item.append(this.art(id === 'H01' ? 'holiday' : 'friend', STORIES[id].localized[this.options.locale].title),
        node('h2', '', STORIES[id].localized[this.options.locale].title),
        node('p', 'desk-condition', available ? seen ? full.replay : full.unclassifiedFile : id === 'H01' ? full.storyLocked : full.friendLocked));
      const open = this.button(seen ? full.replay : full.details, `story-open-${id}`, () => {
        this.storyId = id; this.render(); this.focusTitle();
      }, available ? 'desk-button primary' : 'desk-button');
      open.disabled = !available;
      item.append(open); grid.append(item);
    }
    parent.append(grid);
  }

  private renderStoryFile(parent: HTMLElement, id: StoryId): void {
    const save = this.options.store.load().save;
    const seen = id === 'H01' ? save.story.holidaySeen : save.story.friendSeen;
    const pending = id === 'H01' ? save.story.holidayPending : save.story.friendPending;
    const full = this.options.copy.full;
    if (!seen && !pending) {
      parent.append(node('p', 'desk-empty', id === 'H01' ? full.storyLocked : full.friendLocked));
      return;
    }
    const file = node('article', 'desk-story-file');
    const copy = STORIES[id].localized[this.options.locale];
    for (const paragraph of copy.fileText) {
      file.append(node('p', '', paragraph.replace('{files}', this.options.files.length ? this.options.files.join('\n') : full.noFiles)));
    }
    parent.append(file);
    const actions = node('div', 'desk-inline-actions');
    if (seen) {
      actions.append(this.button(full.replay, `story-replay-${id}`, () => {
        this.startClip(id, id === 'H02' ? save.story.friendChoice ?? 'rest' : undefined, true);
      }, 'desk-button primary'));
      if (id === 'H02') {
        actions.append(this.button(`${full.replay} · ${full.rest}`, 'story-replay-rest', () => this.startClip(id, 'rest', true)),
          this.button(`${full.replay} · ${full.continue}`, 'story-replay-continue', () => this.startClip(id, 'continue', true)));
      }
    } else if (id === 'H01') {
      actions.append(this.button(full.approveHoliday, 'story-confirm-H01', () => this.startClip(id), 'desk-button primary'));
    } else {
      actions.append(this.button(full.rest, 'story-rest', () => this.startClip(id, 'rest'), 'desk-button primary'),
        this.button(full.continue, 'story-continue', () => this.startClip(id, 'continue')));
    }
    actions.append(this.button(seen ? full.back : full.later, 'story-later', () => {
      this.options.store.deferStory(id); this.storyId = null; this.render(); this.focusTitle();
    }));
    parent.append(actions);
  }

  private startClip(id: StoryId, choice?: StoryChoice, replay = false): void {
    if (!replay) {
      const result = this.options.store.confirmStory(id, choice);
      if (!result.confirmed) { this.render(); return; }
      this.options.onChange?.();
    }
    this.clip = { id, choice, replay, step: 0, elapsed: 0, done: false };
    this.render(); this.focusTitle();
  }

  private renderClip(parent: HTMLElement): void {
    const clip = this.clip!;
    const full = this.options.copy.full;
    const text = STORIES[clip.id].localized[this.options.locale];
    const lines = clip.id === 'H02' ? (clip.choice === 'rest' ? text.restScenes : text.continueScenes) ?? text.scenes : text.scenes;
    const scene = node('section', `desk-story-scene ${clip.id.toLowerCase()}${this.options.reducedMotion ? '' : ' animated'}`);
    scene.dataset.testid = 'story-scene';
    const poses: readonly CardPose[] = clip.id === 'H01' ? ['cool', 'holiday', 'rest']
      : clip.choice === 'rest' ? ['friend', 'rest', 'friend'] : ['friend', 'success', 'work'];
    const visuals = node('div', 'desk-story-visuals');
    if (clip.id === 'H02' && (clip.choice === 'rest' ? clip.step > 0 : clip.step === 0)) {
      const pair = node('img', 'desk-friend-illustration');
      pair.src = `${import.meta.env.BASE_URL}assets/finder/friend-ending-v1.png`;
      pair.alt = full.collection;
      visuals.append(pair);
    }
    visuals.append(this.art(poses[clip.step] ?? 'friend', text.title));
    const line = node('p', 'desk-story-line', lines[clip.step]);
    line.dataset.testid = 'story-line';
    line.setAttribute('aria-live', 'polite');
    scene.append(visuals, line, node('p', 'desk-step-count', `${clip.step + 1} / ${lines.length}`));
    parent.append(scene);
    const actions = node('div', 'desk-inline-actions desk-story-controls');
    if (!clip.done && this.options.reducedMotion) {
      actions.append(this.button(full.storyNext, 'story-next', () => {
        if (clip.step < lines.length - 1) clip.step++; else clip.done = true;
        this.render();
      }, 'desk-button primary'));
    }
    if (clip.done) actions.append(this.button(full.storyEnd, 'story-end', () => this.finishClip(), 'desk-button primary'));
    actions.append(this.button(full.skip, 'story-skip', () => this.finishClip()));
    parent.append(actions);
  }

  private startClock(): void {
    this.lastTick = performance.now();
    this.clock = setInterval(() => {
      const now = performance.now();
      const delta = Math.max(0, now - this.lastTick);
      this.lastTick = now;
      const clip = this.clip;
      if (this.destroyed || !clip || document.hidden) return;
      clip.elapsed += delta;
      const duration = STORIES[clip.id].durationMs;
      const step = Math.min(2, Math.floor(clip.elapsed / (duration / 3)));
      const done = clip.elapsed >= duration;
      if (clip.step !== step || clip.done !== done) {
        clip.step = step; clip.done = done; this.render();
      }
    }, 80);
  }

  private finishClip(): void {
    const clip = this.clip;
    if (!clip) return;
    this.stopClock();
    this.clip = null;
    this.storyId = null;
    this.view = 'stories';
    if (clip.id === 'H02' && !clip.replay) {
      if (clip.choice === 'continue') this.options.onRestart(); else this.options.onLobby();
    } else { this.render(); this.focusTitle(); }
  }

  private stopClock(): void {
    if (this.clock !== null) clearInterval(this.clock);
    this.clock = null;
  }

  private button(label: string, testId: string, action: () => void, className = 'desk-button'): HTMLButtonElement {
    const button = node('button', className, label);
    button.type = 'button';
    button.dataset.testid = testId;
    button.addEventListener('click', action, { signal: this.renderEvents.signal });
    return button;
  }

  private art(pose: CardPose, label: string): HTMLDivElement {
    const art = node('div', 'desk-pose');
    art.dataset.pose = pose;
    art.setAttribute('role', 'img');
    art.setAttribute('aria-label', label);
    if (pose === 'perfect') {
      art.classList.add('desk-perfect-pose');
      art.style.backgroundImage = `url("${import.meta.env.BASE_URL}assets/finder/perfect-finder-v1.png")`;
      return art;
    }
    const frame = FRAMES[pose];
    art.style.backgroundImage = `url("${import.meta.env.BASE_URL}assets/finder/poses-v2.png")`;
    art.style.backgroundPosition = `${frame % 4 * 100 / 3}% ${Math.floor(frame / 4) * 100}%`;
    return art;
  }

  private card(id: CardId): CardDescriptor { return CARDS.find((card) => card.id === id)!; }

  private focusTitle(): void { this.dialog.querySelector<HTMLElement>('#desk-dialog-title')?.focus({ preventScroll: true }); }
}
