import type { FinderRunController } from './FinderRunController';
import type { CommandToken, Lane, Point, RunSnapshot } from './types';

export interface PointerRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface PointerTarget {
  readonly id: string;
  readonly rect: PointerRect;
}

export interface PointerLayout {
  readonly files: readonly PointerTarget[];
  readonly destinations: readonly PointerTarget[];
  readonly lanes?: readonly { readonly lane: Lane; readonly rect: PointerRect }[];
}

export interface PointerSnapshot {
  readonly drag: { readonly fileId: string; readonly x: number; readonly y: number } | null;
}

type GestureTarget =
  | { readonly kind: 'file'; readonly fileId: string; readonly rect: PointerRect }
  | { readonly kind: 'destination'; readonly destinationId: string; readonly fileId: string; readonly rect: PointerRect }
  | { readonly kind: 'blank' }
  | { readonly kind: 'wipe' }
  | { readonly kind: 'catch' };

interface Gesture {
  readonly owner: number;
  readonly token: CommandToken;
  readonly start: Point;
  readonly target: GestureTarget;
  previous: Point;
  current: Point;
  maxTravel: number;
}

export const DRAG_THRESHOLD = 10;

function validPoint(point: Point): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function contains(rect: PointerRect, point: Point): boolean {
  return point.x >= rect.x && point.x <= rect.x + rect.width
    && point.y >= rect.y && point.y <= rect.y + rect.height;
}

/** Pointer ownership and hit testing only; all mission judgments stay in the controller. */
export class FinderPointerInput {
  private gesture: Gesture | null = null;

  constructor(
    private readonly controller: FinderRunController,
    private readonly getLayout: () => PointerLayout,
  ) {}

  get snapshot(): PointerSnapshot {
    const gesture = this.gesture;
    if (!gesture || !this.isCurrent(gesture) || gesture.target.kind !== 'file'
      || gesture.maxTravel < DRAG_THRESHOLD) return { drag: null };
    return {
      drag: { fileId: gesture.target.fileId, x: gesture.current.x, y: gesture.current.y },
    };
  }

  down(id: number, point: Point, now: number): void {
    if (!validPoint(point) || !Number.isFinite(id) || !Number.isFinite(now)) return;
    if (this.gesture && !this.isCurrent(this.gesture)) this.cancel();
    // A second finger cannot replace, complete, or cancel the owning gesture.
    if (this.gesture) return;
    const before = this.controller.snapshot();
    if (before.phase !== 'playing' || before.paused) return;
    const state = this.controller.advance(now);
    if (state.phase !== 'playing' || state.paused || state.runId !== before.runId
      || state.missionId !== before.missionId) return;
    const layout = this.getLayout();
    let target: GestureTarget = { kind: 'blank' };
    if (state.mission?.kind === 'wipe') {
      target = { kind: 'wipe' };
    } else if (state.mission?.kind === 'catch') {
      target = { kind: 'catch' };
    } else {
      const file = layout.files.find((candidate) => contains(candidate.rect, point)
        && !state.completedIds.includes(candidate.id));
      const destination = layout.destinations.find((candidate) => contains(candidate.rect, point));
      if (file) target = { kind: 'file', fileId: file.id, rect: { ...file.rect } };
      else if (destination && state.selectedId) {
        target = {
          kind: 'destination', fileId: state.selectedId,
          destinationId: destination.id, rect: { ...destination.rect },
        };
      }
    }
    this.gesture = {
      owner: id, token: this.controller.captureToken(), start: { ...point },
      previous: { ...point }, current: { ...point }, maxTravel: 0, target,
    };
    if (target.kind === 'wipe') {
      this.controller.stroke(point, point, now, this.gesture.token);
      if (!this.isCurrent(this.gesture)) this.cancel();
    } else if (target.kind === 'catch') {
      this.moveBasket(point, now, this.gesture.token);
      if (!this.isCurrent(this.gesture)) this.cancel();
    }
  }

  move(id: number, point: Point, now: number): void {
    const gesture = this.acceptOwner(id, point, now);
    if (!gesture) return;
    this.trackPoint(gesture, point);
    if (gesture.target.kind === 'wipe') {
      this.controller.stroke(gesture.previous, point, now, gesture.token);
    } else if (gesture.target.kind === 'catch') {
      this.moveBasket(point, now, gesture.token);
    } else {
      this.controller.advance(now);
    }
    gesture.previous = { ...point };
    if (!this.isCurrent(gesture)) this.cancel();
  }

  up(id: number, point: Point, now: number, outside = false): void {
    if (this.gesture?.owner !== id) return;
    if (outside) {
      this.cancel();
      return;
    }
    const gesture = this.acceptOwner(id, point, now);
    if (!gesture) return;
    this.trackPoint(gesture, point);
    // Release ownership before calling rules, which may synchronously settle the mission.
    this.gesture = null;
    const target = gesture.target;
    if (target.kind === 'wipe') {
      this.controller.stroke(gesture.previous, point, now, gesture.token);
    } else if (target.kind === 'catch') {
      this.moveBasket(point, now, gesture.token);
    } else if (target.kind === 'file') {
      if (gesture.maxTravel < DRAG_THRESHOLD) {
        if (contains(target.rect, point)) {
          const selected = this.controller.snapshot().selectedId;
          this.controller.select(this.controller.snapshot().mission?.kind === 'bundle' ? target.fileId : selected === target.fileId ? null : target.fileId, now, gesture.token);
        }
      } else {
        const destination = this.getLayout().destinations.find((candidate) => contains(candidate.rect, point));
        if (destination) this.controller.submit(target.fileId, destination.id, now, gesture.token);
      }
    } else if (target.kind === 'destination') {
      if (gesture.maxTravel < DRAG_THRESHOLD && contains(target.rect, point)) {
        const destination = this.getLayout().destinations.find((candidate) =>
          candidate.id === target.destinationId && contains(candidate.rect, point));
        if (destination) this.controller.submit(target.fileId, destination.id, now, gesture.token);
      }
    } else if (gesture.maxTravel < DRAG_THRESHOLD) {
      const layout = this.getLayout();
      if (![...layout.files, ...layout.destinations].some((candidate) => contains(candidate.rect, point))) {
        this.controller.select(null, now, gesture.token);
      }
    }
  }

  /** The scene calls this for pause, restart, resize, pointercancel, and mission replacement. */
  cancel(): void {
    this.gesture = null;
  }

  private acceptOwner(id: number, point: Point, now: number): Gesture | null {
    const gesture = this.gesture;
    if (!gesture || gesture.owner !== id) return null;
    if (!this.isCurrent(gesture) || !validPoint(point) || !Number.isFinite(now)) {
      this.cancel();
      return null;
    }
    return gesture;
  }

  private isCurrent(gesture: Gesture): boolean {
    const state: RunSnapshot = this.controller.snapshot();
    return state.phase === 'playing' && !state.paused
      && state.runId === gesture.token.runId && state.missionId === gesture.token.missionId
      && state.bossStep === gesture.token.bossStep;
  }

  private trackPoint(gesture: Gesture, point: Point): void {
    gesture.current = { ...point };
    gesture.maxTravel = Math.max(gesture.maxTravel,
      Math.hypot(point.x - gesture.start.x, point.y - gesture.start.y));
  }

  private moveBasket(point: Point, now: number, token: CommandToken): void {
    const lane = this.getLayout().lanes?.find((candidate) => contains(candidate.rect, point));
    if (lane) this.controller.selectLane(lane.lane, now, token);
    else this.controller.advance(now);
  }
}
