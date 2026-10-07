// 断网改动回网后按编号合并。
// 以最近一次同步的快照为 base，对 local / remote 做三方合并：
//  - 只有一边改过：采用那一边；
//  - 两边都改过（或一边改、一边删）：判为冲突，各留一份进入待处置，不自动覆盖。

export interface Conflict<T> {
  id: string;
  kind: 'both-modified' | 'modify-delete';
  base: T | null;
  local: T | null;
  remote: T | null;
}

export interface MergeDecision {
  id: string;
  action: 'take-local' | 'take-remote' | 'take-base' | 'deleted';
}

export interface MergeOutcome<T> {
  merged: Record<string, T>;
  conflicts: Conflict<T>[];
  decisions: MergeDecision[];
}

function isDifferent<T>(a: T | undefined, b: T | undefined, equal: (a: T, b: T) => boolean): boolean {
  if (a === undefined && b === undefined) return false;
  if (a === undefined || b === undefined) return true;
  return !equal(a, b);
}

export function threeWayMerge<T>(
  base: Record<string, T>,
  local: Record<string, T>,
  remote: Record<string, T>,
  equal: (a: T, b: T) => boolean = (a, b) => JSON.stringify(a) === JSON.stringify(b),
): MergeOutcome<T> {
  const ids = new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)]);
  const merged: Record<string, T> = {};
  const conflicts: Conflict<T>[] = [];
  const decisions: MergeDecision[] = [];

  ids.forEach((id) => {
    const b = base[id];
    const l = local[id];
    const r = remote[id];
    const localChanged = isDifferent(b, l, equal);
    const remoteChanged = isDifferent(b, r, equal);

    if (localChanged && remoteChanged) {
      if (l === undefined || r === undefined) {
        conflicts.push({ id, kind: 'modify-delete', base: b ?? null, local: l ?? null, remote: r ?? null });
      } else {
        conflicts.push({ id, kind: 'both-modified', base: b ?? null, local: l ?? null, remote: r ?? null });
      }
      decisions.push({ id, action: 'take-base' }); // 待处置期间先沿用 base，不覆盖
      return;
    }

    if (localChanged) {
      if (l !== undefined) {
        merged[id] = l;
        decisions.push({ id, action: 'take-local' });
      } else {
        decisions.push({ id, action: 'deleted' });
      }
      return;
    }

    if (remoteChanged) {
      if (r !== undefined) {
        merged[id] = r;
        decisions.push({ id, action: 'take-remote' });
      } else {
        decisions.push({ id, action: 'deleted' });
      }
      return;
    }

    if (b !== undefined) {
      merged[id] = b;
      decisions.push({ id, action: 'take-base' });
    } else {
      decisions.push({ id, action: 'deleted' });
    }
  });

  return { merged, conflicts, decisions };
}

export type ConflictResolution = 'take-local' | 'take-remote' | 'keep-both';

// 处置冲突：采用本地 / 采用远程 / 两边都留（各自换一个新编号入库）。
export function resolveConflict<T>(
  merged: Record<string, T>,
  conflict: Conflict<T>,
  resolution: ConflictResolution,
  rekey: (record: T, suffix: string) => T,
): Record<string, T> {
  const next = { ...merged };
  if (resolution === 'take-local' && conflict.local !== null) {
    next[conflict.id] = conflict.local;
  } else if (resolution === 'take-remote' && conflict.remote !== null) {
    next[conflict.id] = conflict.remote;
  } else if (resolution === 'keep-both') {
    if (conflict.local !== null) next[`${conflict.id}#本地`] = rekey(conflict.local, '本地');
    if (conflict.remote !== null) next[`${conflict.id}#远程`] = rekey(conflict.remote, '远程');
  }
  return next;
}
