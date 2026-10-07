import type { Offcut } from '../types/offcut';
import type { Part, WoodworkingProject } from '../types/woodworking';
import { threeWayMerge, type Conflict } from './sync';

// 断网合并演示用的快照与辅助函数

export interface SyncSnapshot {
  parts: Record<string, Part>;
  offcuts: Record<string, Offcut>;
}

export interface SyncConflict {
  id: string;
  field: 'part' | 'offcut';
  kind: 'both-modified' | 'modify-delete';
  base: Part | Offcut | null;
  local: Part | Offcut | null;
  remote: Part | Offcut | null;
}

export interface SyncLogEntry {
  at: number;
  message: string;
}

export function snapshotFromProject(
  project: WoodworkingProject,
  offcuts: Record<string, Offcut>,
): SyncSnapshot {
  return {
    parts: Object.fromEntries(project.parts.map((part) => [part.id, part])),
    offcuts,
  };
}

export function applyPartsToProject(
  project: WoodworkingProject,
  parts: Record<string, Part>,
): WoodworkingProject {
  return { ...project, parts: Object.values(parts), updatedAt: Date.now() };
}

function toConflicts(conflicts: Conflict<Part | Offcut>[], field: 'part' | 'offcut'): SyncConflict[] {
  return conflicts.map((conflict) => ({
    id: conflict.id,
    field,
    kind: conflict.kind,
    base: conflict.base,
    local: conflict.local,
    remote: conflict.remote,
  }));
}

export interface MergedSnapshots {
  merged: SyncSnapshot;
  conflicts: SyncConflict[];
  adoptedCount: number;
}

export function mergeSnapshots(
  base: SyncSnapshot,
  local: SyncSnapshot,
  remote: SyncSnapshot,
): MergedSnapshots {
  const partsMerge = threeWayMerge(base.parts, local.parts, remote.parts);
  const offcutsMerge = threeWayMerge(base.offcuts, local.offcuts, remote.offcuts);
  const conflicts = [
    ...toConflicts(partsMerge.conflicts, 'part'),
    ...toConflicts(offcutsMerge.conflicts, 'offcut'),
  ];
  const adoptedCount = [...partsMerge.decisions, ...offcutsMerge.decisions]
    .filter((decision) => decision.action === 'take-local' || decision.action === 'take-remote')
    .length;
  return {
    merged: { parts: partsMerge.merged, offcuts: offcutsMerge.merged },
    conflicts,
    adoptedCount,
  };
}

// 冲突处置后，把对应记录写回 merged 快照
export function applyResolution(
  merged: SyncSnapshot,
  conflict: SyncConflict,
  resolution: 'take-local' | 'take-remote' | 'keep-both',
): SyncSnapshot {
  const next: SyncSnapshot = {
    parts: { ...merged.parts },
    offcuts: { ...merged.offcuts },
  };
  const bucket = conflict.field === 'part' ? next.parts : next.offcuts;
  if (resolution === 'take-local' && conflict.local !== null) {
    bucket[conflict.id] = conflict.local as Part & Offcut;
  } else if (resolution === 'take-remote' && conflict.remote !== null) {
    bucket[conflict.id] = conflict.remote as Part & Offcut;
  } else if (resolution === 'keep-both') {
    if (conflict.local !== null) {
      const localCopy = { ...conflict.local, id: `${conflict.id}#本地` };
      bucket[`${conflict.id}#本地`] = localCopy as Part & Offcut;
    }
    if (conflict.remote !== null) {
      const remoteCopy = { ...conflict.remote, id: `${conflict.id}#远程` };
      bucket[`${conflict.id}#远程`] = remoteCopy as Part & Offcut;
    }
  }
  return next;
}
