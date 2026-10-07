import type { Attribution, Remnant, RemnantConflict } from './types';
import type { PersistedQueueEntry } from './RemnantLedger';

/** 某次同步成功后的共同祖先快照（本机与对端一致的状态） */
export interface SyncBase {
  records: Remnant[];
  queue: PersistedQueueEntry[];
  at: number;
}

interface RecordMap {
  records: Remnant[];
  queue: PersistedQueueEntry[];
}

/** 参与比较时忽略归属时间戳以外的易变字段差异：以版本号 + 内容判定是否改动 */
function comparable(remnant: Remnant) {
  const { occupiedBy, consumedBy, registeredBy, lastChangedBy, ...rest } = remnant;
  return JSON.stringify({
    ...rest,
    occupiedBy: occupiedBy ? { worker: occupiedBy.worker, at: occupiedBy.at } : null,
    consumedBy: consumedBy ? { worker: consumedBy.worker, at: consumedBy.at } : null,
  });
}

function isEqual(a: Remnant | undefined, b: Remnant | undefined) {
  if (!a || !b) return a === b;
  return comparable(a) === comparable(b);
}

export interface MergeResult {
  records: Remnant[];
  queue: PersistedQueueEntry[];
  /** 两边都改过同一编号：两份版本各自保留，等待人工处置 */
  conflicts: RemnantConflict[];
  /** 仅本机改动而采纳的编号 */
  takenLocal: string[];
  /** 仅对端改动而采纳的编号 */
  takenRemote: string[];
}

/**
 * 按编号做三方合并（共同祖先 base + 本机 local + 对端 remote）。
 *
 * - 只有一边有 / 只有一边改：直接采纳，后传不盖先写（另一边没动才采纳）；
 * - 两边都改过同一编号：谁也不覆盖谁，local / remote 各留一份进冲突清单，
 *   台账里该编号隔离为 conflict，处置前不可占用。
 */
export function mergeLedgers(base: SyncBase, local: RecordMap, remote: RecordMap, now: number): MergeResult {
  const baseMap = new Map(base.records.map((r) => [r.id, r]));
  const localMap = new Map(local.records.map((r) => [r.id, r]));
  const remoteMap = new Map(remote.records.map((r) => [r.id, r]));
  const conflicts: RemnantConflict[] = [];
  const merged = new Map<string, Remnant>();
  const takenLocal: string[] = [];
  const takenRemote: string[] = [];

  const ids = new Set<string>([...localMap.keys(), ...remoteMap.keys()]);
  for (const id of ids) {
    const l = localMap.get(id);
    const r = remoteMap.get(id);
    const b = baseMap.get(id);

    if (l && !r) {
      merged.set(id, l);
      takenLocal.push(id);
      continue;
    }
    if (r && !l) {
      merged.set(id, r);
      takenRemote.push(id);
      continue;
    }
    if (!l || !r) continue; // 类型上不可能，窄化用

    if (isEqual(l, r)) {
      merged.set(id, l);
      continue;
    }
    const localChanged = !isEqual(l, b);
    const remoteChanged = !isEqual(r, b);

    if (!localChanged) {
      merged.set(id, r);
      takenRemote.push(id);
    } else if (!remoteChanged) {
      merged.set(id, l);
      takenLocal.push(id);
    } else {
      // 两边都改：两份都保留；台账记录隔离为待处置，避免被继续占用
      merged.set(id, { ...l, status: 'conflict' });
      conflicts.push({
        id,
        base: b ? structuredClone(b) : null,
        local: structuredClone(l),
        remote: structuredClone(r),
        detectedAt: now,
        status: 'pending',
      });
    }
  }

  // 排队等位也按编号合并去重：编号已经入库（含冲突隔离）的排队项一律丢弃，
  // 不得在合并后绕过「同一编号只入库一次」
  const queueMap = new Map<string, PersistedQueueEntry>();
  [...base.queue, ...local.queue, ...remote.queue].forEach((entry) => {
    if (merged.has(entry.remnantId)) return;
    const existing = queueMap.get(entry.remnantId);
    if (!existing || entry.queuedAt < existing.queuedAt) queueMap.set(entry.remnantId, entry);
  });
  const queue = [...queueMap.values()].sort((a, b) => a.queuedAt - b.queuedAt);

  return {
    records: [...merged.values()].sort((a, b) => a.id.localeCompare(b.id)),
    queue,
    conflicts,
    takenLocal,
    takenRemote,
  };
}

/**
 * 人工处置冲突：选定一份版本（或基于两份合并出一条），
 * 处置后该编号退出隔离。同一编号最终仍只有一条入库记录。
 */
export function resolveConflict(
  records: Remnant[],
  conflict: RemnantConflict,
  decision: { pick: 'local' | 'remote' } | { pick: 'merged'; remnant: Remnant },
  by: Attribution,
): Remnant[] {
  const chosen: Remnant =
    decision.pick === 'merged'
      ? { ...decision.remnant, id: conflict.id, status: decision.remnant.status === 'conflict' ? 'available' : decision.remnant.status, lastChangedBy: by }
      : {
          ...(decision.pick === 'local' ? conflict.local : conflict.remote),
          lastChangedBy: by,
        };
  return records.map((r) => (r.id === conflict.id ? chosen : r));
}
