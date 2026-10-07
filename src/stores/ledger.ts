import { atom } from 'jotai';
import {
  CloudLedgerStore,
  RemnantLedger,
  SyncCoordinator,
  mergeLedgers,
  resolveConflict,
  systemClock,
  type Attribution,
  type Remnant,
  type RemnantConflict,
} from '../domain';
import type { PersistedQueueEntry } from '../domain';
import { localStorageLedger } from '../utils/ledgerStorage';

/** 余料位容量：满了新登记先排队等位 */
export const REMNANT_CAPACITY = 12;

export interface LedgerStore {
  coordinator: SyncCoordinator;
}

/**
 * 班组身份（演示用固定两套，对应「两个开料班组」）。
 * 真实部署换成登录态。
 */
export interface WorkerIdentity {
  worker: string;
  deviceId: string;
}

/** 「云端」也落在 localStorage，模拟回网合并的对端 */
function cloudStorageAdapter() {
  const cloud = new CloudLedgerStore();
  const key = 'joinery-nest:remnant-cloud';
  if (typeof localStorage !== 'undefined') {
    const raw = localStorage.getItem(key);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        cloud.push(parsed);
      } catch {
        /* ignore */
      }
    }
    const originalPush = cloud.push.bind(cloud);
    cloud.push = (state) => {
      originalPush(state);
      localStorage.setItem(key, JSON.stringify(state));
    };
  }
  return cloud;
}

const cloud = cloudStorageAdapter();

function createCoordinator(identity: WorkerIdentity): SyncCoordinator {
  const storage = localStorageLedger(
    `joinery-nest:remnant-ledger:${identity.deviceId}`,
    `joinery-nest:remnant-ledger:${identity.deviceId}:backup`,
    `joinery-nest:remnant-ledger:${identity.deviceId}:pending`,
  );
  const ledger = new RemnantLedger(storage, systemClock, REMNANT_CAPACITY);
  return new SyncCoordinator(ledger, storage, cloud, systemClock);
}

/** 当前操作身份：默认甲班，可在页面切换模拟两班组 */
export const activeWorkerAtom = atom<WorkerIdentity>({ worker: '开料甲班', deviceId: 'device-A' });

export const workerA: WorkerIdentity = { worker: '开料甲班', deviceId: 'device-A' };
export const workerB: WorkerIdentity = { worker: '开料乙班', deviceId: 'device-B' };

const coordinators = new Map<string, SyncCoordinator>();

export function getCoordinator(identity: WorkerIdentity): SyncCoordinator {
  const existing = coordinators.get(identity.deviceId);
  if (existing) return existing;
  const created = createCoordinator(identity);
  coordinators.set(identity.deviceId, created);
  return created;
}

/** 页面初始化时就把两个班组的本机台账都建好，方便演示断网两边各自操作 */
export function bootstrapCrews(): [SyncCoordinator, SyncCoordinator] {
  return [getCoordinator(workerA), getCoordinator(workerB)];
}

/** 网络状态：false 时各班组只写本机台账 */
export const onlineAtom = atom<boolean>(true);

/** 每次操作后自增，驱动 React 重新读取台账 */
export const ledgerTickAtom = atom(0);

/* ---------------------- 双班会话（断网 / 回网演示） ---------------------- */

interface SessionBase {
  records: Remnant[];
  queue: PersistedQueueEntry[];
  at: number;
}

/** 断网瞬间的共同基线；回网时三方合并的 base */
export const sessionBaseAtom = atom<SessionBase | null>(null);

/** 回网合并产生、尚未处置的冲突（两边都改过，各留一份） */
export const sessionConflictsAtom = atom<RemnantConflict[]>([]);

/** 一起断网：各自后续只写本机，基线定格为云端当前状态 */
export function beginOfflineSession() {
  coordinators.forEach((c) => c.setOffline());
  const pulled = cloud.pull();
  return {
    records: pulled.records.map((r) => structuredClone(r)),
    queue: pulled.queue.map((q) => ({ ...q })),
    at: systemClock.now(),
  } satisfies SessionBase;
}

export interface SessionSyncResult {
  conflicts: RemnantConflict[];
  takenA: string[];
  takenB: string[];
}

/**
 * 回网：基线 + 甲班本机 + 乙班本机做一次三方合并。
 * 结果同时写入两台本机与云端；两边都改的编号各留一份进冲突清单。
 */
export function finishOfflineSession(base: SessionBase): SessionSyncResult {
  const [a, b] = bootstrapCrews();
  const stateA = a.exportSessionState();
  const stateB = b.exportSessionState();
  const merged = mergeLedgers(base, stateA, stateB, systemClock.now());

  a.applySessionMerge(merged.records, merged.queue);
  b.applySessionMerge(merged.records, merged.queue);
  cloud.push({ records: merged.records, queue: merged.queue });
  a.markSessionBase(merged.records, merged.queue);
  b.markSessionBase(merged.records, merged.queue);

  return {
    conflicts: merged.conflicts,
    takenA: merged.takenLocal,
    takenB: merged.takenRemote,
  };
}

/** 人工处置一个会话冲突：选定甲或乙的版本，两台本机与云端同步收敛为唯一一条 */
export function resolveSessionConflict(
  conflicts: RemnantConflict[],
  conflictId: string,
  pick: 'local' | 'remote',
  by: Attribution,
): RemnantConflict[] {
  const conflict = conflicts.find((c) => c.id === conflictId && c.status === 'pending');
  if (!conflict) return conflicts;
  const [a] = bootstrapCrews();
  const current = a.exportSessionState();
  const records = resolveConflict(
    current.records,
    conflict,
    { pick },
    by,
  );
  const updatedConflicts = conflicts.map((c) =>
    c.id === conflictId
      ? { ...c, status: 'resolved' as const, resolution: { picked: pick, by } }
      : c,
  );
  finishConflictResolution(records, current.queue);
  return updatedConflicts;
}

function finishConflictResolution(records: Remnant[], queue: PersistedQueueEntry[]) {
  const [a, b] = bootstrapCrews();
  a.applySessionMerge(records, queue);
  b.applySessionMerge(records, queue);
  cloud.push({ records, queue });
  a.markSessionBase(records, queue);
  b.markSessionBase(records, queue);
}
