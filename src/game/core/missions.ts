import type { Mission, MissionKind, Point, RunKind, Stain, VirtualFile } from './types';

export const BASIC_KINDS = ['find', 'sort', 'wipe', 'latest', 'bundle', 'catch'] as const;

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(values: readonly T[], random: () => number): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [result[index], result[other]] = [result[other]!, result[index]!];
  }
  return result;
}

export function freezeMission<T extends Mission>(mission: T): T {
  const freeze = (value: unknown): void => {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return;
    for (const nested of Object.values(value)) freeze(nested);
    Object.freeze(value);
  };
  freeze(mission);
  return mission;
}

function unique(ids: readonly string[], label: string): void {
  if (!ids.length || ids.some((id) => !id) || new Set(ids).size !== ids.length) throw new Error(`Invalid ${label}: IDs must be nonempty and unique`);
}

function validateFiles(files: readonly VirtualFile[]): void {
  unique(files.map((file) => file.id), 'files');
  if (files.some((file) => !['photo', 'document'].includes(file.kind))) throw new Error('Unknown file kind');
}

export function validateMission(mission: Mission): void {
  if (!mission.id) throw new Error('Mission ID is required');
  if (!Number.isFinite(mission.baseDeadlineMs) || mission.baseDeadlineMs <= 0) throw new Error('Invalid mission deadline');
  if (mission.kind === 'catch') {
    if (mission.lanes.length !== 3 || mission.lanes.some((lane) => ![0, 1, 2].includes(lane))) throw new Error('Catch needs three serial lanes');
    if (![mission.previewMs, mission.fallMs].every((time) => Number.isFinite(time) && time > 0)
      || (mission.previewMs + mission.fallMs) * mission.lanes.length >= mission.baseDeadlineMs) throw new Error('Catch schedule must finish before the deadline');
    return;
  }
  if (mission.kind === 'boss') {
    if (mission.steps.length !== 3) throw new Error('Boss requires three steps');
    for (const step of mission.steps) {
      validateFiles(step.files);
      if (!step.destinationId || !step.files.some((file) => file.id === step.targetFileId)) throw new Error('Invalid boss answer');
      unique(step.allowedDestinationIds, 'boss destinations');
      if (!step.allowedDestinationIds.includes(step.destinationId)) throw new Error('Missing correct boss destination');
    }
    return;
  }
  if (mission.kind === 'wipe') {
    unique(mission.stains.map((stain) => stain.id), 'stains');
    for (const stain of mission.stains) {
      if (![stain.x, stain.y, stain.radius].every(Number.isFinite) || stain.radius <= 0) throw new Error('Invalid stain geometry');
    }
    return;
  }
  validateFiles(mission.files);
  if (mission.kind === 'find' || mission.kind === 'latest') {
    if (!mission.destinationId || !mission.files.some((file) => file.id === mission.targetFileId)) throw new Error('Missing find target or destination');
    if (mission.kind === 'latest') {
      const times = mission.files.map((file) => file.modifiedAt);
      if (times.some((time) => time === undefined || !Number.isInteger(time) || time < 0 || time >= 1440)
        || new Set(times).size !== times.length || mission.files.some((file) => file.icon !== 'pdf')) throw new Error('Latest PDF timestamps must be distinct visible minutes of one day');
      if (mission.files.find((file) => file.id === mission.targetFileId)!.modifiedAt !== Math.max(...times as number[])) throw new Error('Latest answer must have greatest timestamp');
    }
    return;
  }
  if (mission.kind === 'bundle') {
    unique(mission.targetFileIds, 'bundle targets');
    if (!mission.destinationId || mission.targetFileIds.some((id) => !mission.files.some((file) => file.id === id && file.kind === 'photo'))) throw new Error('Bundle requires existing photo targets');
    return;
  }
  unique(mission.folders.map((folder) => folder.id), 'folders');
  unique(mission.requiredFileIds, 'required files');
  if (mission.requiredFileIds.length !== mission.files.length) throw new Error('Every visible sort file must be required');
  for (const fileId of mission.requiredFileIds) {
    const file = mission.files.find((candidate) => candidate.id === fileId);
    const folder = mission.folders.find((candidate) => candidate.id === mission.expectedFolderByFileId[fileId]);
    if (!file || !folder || file.kind !== folder.kind) throw new Error('Invalid sort answer');
  }
}

/** All candidates, answers, and serial schedules are fixed before the run. */
export function createMissions(seed: number, runKind: RunKind = 'regular'): readonly Mission[] {
  if (!Number.isFinite(seed)) throw new Error('Seed must be finite');
  if (runKind !== 'regular' && runKind !== 'practice') throw new Error('Unknown run kind');
  const random = seededRandom(seed);
  const cat: VirtualFile = { id: 'cat-photo', kind: 'photo', icon: 'cat' };
  const dog: VirtualFile = { id: 'dog-photo', kind: 'photo', icon: 'dog' };
  const note: VirtualFile = { id: 'note', kind: 'document', icon: 'note' };
  const photoFolder: VirtualFile = { id: 'photo-folder', kind: 'photo', icon: 'folder' };
  const schedule: MissionKind[] = runKind === 'practice' ? ['find', 'sort', 'wipe'] : [...BASIC_KINDS];
  if (runKind === 'regular') {
    for (let i = 0; i < 3; i++) {
      const choices = BASIC_KINDS.filter((kind) => kind !== schedule.at(-1));
      schedule.push(choices[Math.floor(random() * choices.length)]!);
    }
    schedule.push('boss');
  }
  const missions = schedule.map((kind, index): Mission => {
    const variant = index >= 6 && index < 9;
    const common = { id: variant ? `${kind}-variant-${index + 1}` : kind,
      baseDeadlineMs: kind === 'boss' ? 12_000 : index < 3 ? 8_000 : index < 6 ? 7_000 : 6_000 };
    switch (kind) {
      case 'find': return { ...common, kind, files: shuffled([cat, dog, note], random), targetFileId: variant ? 'dog-photo' : 'cat-photo', destinationId: 'tray' };
      case 'sort': {
        const files = shuffled(variant ? [cat, dog, note] : [cat, note], random);
        return { ...common, kind, files, folders: [{ id: 'photos', kind: 'photo' }, { id: 'documents', kind: 'document' }], requiredFileIds: files.map((file) => file.id),
          expectedFolderByFileId: Object.fromEntries(files.map((file) => [file.id, file.kind === 'photo' ? 'photos' : 'documents'])) };
      }
      case 'wipe': return { ...common, kind, stains: [
        { id: 'stain-left', x: 393 + random() * 12 - 6, y: 278 + random() * 12 - 6, radius: variant ? 22 : 25 },
        { id: 'stain-middle', x: 552 + random() * 12 - 6, y: 279 + random() * 12 - 6, radius: variant ? 22 : 24 },
        { id: 'stain-right', x: 611 + random() * 12 - 6, y: 309 + random() * 12 - 6, radius: variant ? 22 : 23 },
      ] };
      case 'latest': {
        const times = shuffled(variant ? [1045, 1050, 1055] : [1040, 1060, 1075], random);
        const files: VirtualFile[] = ['final-pdf', 'really-final-pdf', 'revised-pdf'].map((id, i) => ({ id, kind: 'document', icon: 'pdf', modifiedAt: times[i]! }));
        return { ...common, kind, files: shuffled(files, random), targetFileId: files.find((file) => file.modifiedAt === Math.max(...times))!.id, destinationId: 'tray' };
      }
      case 'bundle': return { ...common, kind, files: shuffled([cat, dog, note], random), targetFileIds: ['cat-photo', 'dog-photo'], destinationId: 'bundle-tray' };
      case 'catch': return { ...common, kind, lanes: shuffled([0, 1, 2] as const, random), previewMs: 300, fallMs: 1200 };
      case 'boss': return { ...common, kind, steps: [
        { files: shuffled([cat, dog, note], random), targetFileId: cat.id, destinationId: 'tray', allowedDestinationIds: ['tray'] },
        { files: [cat], targetFileId: cat.id, destinationId: 'photos', allowedDestinationIds: ['photos', 'documents'] },
        { files: [photoFolder], targetFileId: photoFolder.id, destinationId: 'desk', allowedDestinationIds: ['desk'] },
      ] };
    }
  });
  unique(missions.map((mission) => mission.id), 'missions');
  missions.forEach((mission) => { validateMission(mission); freezeMission(mission); });
  return Object.freeze(missions);
}

export function segmentIntersectsStain(from: Point, to: Point, stain: Stain): boolean {
  if (![from.x, from.y, to.x, to.y, stain.x, stain.y, stain.radius].every(Number.isFinite) || stain.radius <= 0) return false;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lengthSquared = dx * dx + dy * dy;
  const projection = lengthSquared === 0 ? 0 : ((stain.x - from.x) * dx + (stain.y - from.y) * dy) / lengthSquared;
  const t = Math.max(0, Math.min(1, projection));
  return (from.x + t * dx - stain.x) ** 2 + (from.y + t * dy - stain.y) ** 2 <= stain.radius ** 2;
}
