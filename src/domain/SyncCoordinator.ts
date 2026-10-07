import type { Attribution, Remnant, RemnantConflict } from './types';
import type { LedgerStorage, PersistedQueueEntry, RemnantLedger, RegisterInput } from './RemnantLedger';
import { mergeLedgers, resolveConflict, type SyncBase } from './sync';

interface CloudState {
  records: Remnant[];
  queue: PersistedQueueEntry[];
}

/**
 * 「云端」台账存储的模拟：回网后以这里的状态为对端。
 * 真实系统替换为服务端 REST / CRDT 端点即可，合并逻辑不变。
 */
export class CloudLedgerStore {
  private state: CloudState = { records: [], queue: [] };

  pull(): CloudState {
    return {
      records: this.state.records.map((r) => structuredClone(r)),
      queue: this.state.queue.map((q) => ({ ...q })),
    };
  }

  push(state: CloudState) {
    this.state = {
      records: state.records.map((r) => structuredClone(r)),
      queue: state.queue.map((q) => ({ ...q })),
    };
  }
}

export interface SyncReport {
  online: boolean;
  /** 新产生的待处置冲突（两边都改过） */
  conflicts: RemnantConflict[];
  takenLocal: string[];
  takenRemote: string[];
}

export interface ConflictResolutionInput {
  conflictId: string;
  decision: { pick: 'local' | 'remote' } | { pick: 'merged'; remnant: Remnant };
  by: Attribution;
}

/**
 * 离线优先的同步协调器：
 * - 在线：本地写入立即推到云端，共同祖先随之推进；
 * - 离线：写入只落本机；回网时按编号与云端三方合并，
 *   后传不会盖掉先写（只有一边改才采纳），两边都改则各留一份待处置。
 */
export class SyncCoordinator {
  private online = true;
  private base: SyncBase;
  private conflicts: RemnantConflict[] = [];

  constructor(
    private readonly ledger: RemnantLedger,
    private readonly storage: LedgerStorage,
    private readonly cloud: CloudLedgerStore,
    private readonly clock: { now(): number },
  ) {
    const snapshot = ledger.recover();
    const remote = cloud.pull();
    if (snapshot.records.length === 0 && remote.records.length > 0) {
      // 新设备 / 清空过本机：以云端为共同状态落到本机，不拿空台账覆盖云端
      ledger.replaceWith(remote.records, remote.queue);
      const pulled = ledger.exportState();
      this.base = {
        records: pulled.records.map((r) => structuredClone(r)),
        queue: pulled.queue.map((q) => ({ ...q })),
        at: this.clock.now(),
      };
    } else if (remote.records.length === 0 && snapshot.records.length > 0) {
      // 首台设备：把本机共同起点推到云端
      cloud.push({ records: snapshot.records, queue: snapshot.queue });
      this.base = {
        records: snapshot.records.map((r) => structuredClone(r)),
        queue: snapshot.queue.map((q) => ({ ...q })),
        at: snapshot.savedAt,
      };
    } else {
      this.base = {
        records: snapshot.records.map((r) => structuredClone(r)),
        queue: snapshot.queue.map((q) => ({ ...q })),
        at: snapshot.savedAt,
      };
    }
  }

  isOnline() {
    return this.online;
  }

  setOnline() {
    this.online = true;
  }

  setOffline() {
    this.online = false;
  }

  pendingConflicts(): RemnantConflict[] {
    return this.conflicts;
  }

  /** 回网：拉云端 → 三方合并 → 写回本机并推送 → 推进共同祖先 */
  syncNow(): SyncReport {
    if (!this.online) {
      return { online: false, conflicts: [], takenLocal: [], takenRemote: [] };
    }
    const local = this.ledger.exportState();
    const remote = this.cloud.pull();
    const merged = mergeLedgers(this.base, local, remote, this.clock.now());

    const newConflicts = merged.conflicts.filter(
      (c) => !this.conflicts.some((existing) => existing.id === c.id && existing.status === 'resolved'),
    );
    this.conflicts = [
      ...this.conflicts.filter((c) => c.status === 'pending'),
      ...newConflicts,
    ];

    this.ledger.replaceWith(merged.records, merged.queue);
    const pushed = this.ledger.exportState();
    this.cloud.push({ records: pushed.records, queue: pushed.queue });
    this.base = {
      records: pushed.records.map((r) => structuredClone(r)),
      queue: pushed.queue.map((q) => ({ ...q })),
      at: this.clock.now(),
    };

    return {
      online: true,
      conflicts: newConflicts,
      takenLocal: merged.takenLocal,
      takenRemote: merged.takenRemote,
    };
  }

  /* ----------------------- 本地操作包装 ----------------------- */

  register(input: RegisterInput) {
    const result = this.ledger.register(input);
    this.autoSync();
    return result;
  }

  occupy(id: string, worker: string, deviceId: string) {
    const result = this.ledger.occupy(id, worker, deviceId);
    this.autoSync();
    return result;
  }

  release(id: string, worker: string, deviceId: string) {
    const result = this.ledger.release(id, worker, deviceId);
    this.autoSync();
    return result;
  }

  remeasure(
    id: string,
    patch: Parameters<RemnantLedger['remeasure']>[1],
    worker: string,
    deviceId: string,
  ) {
    const result = this.ledger.remeasure(id, patch, worker, deviceId);
    this.autoSync();
    return result;
  }

  consume(id: string, worker: string, deviceId: string) {
    const admitted = this.ledger.consume(id, worker, deviceId);
    this.autoSync();
    return admitted;
  }

  /**
   * 人工处置冲突：选定一份（或合并出一条），编号解除隔离；
   * 处置结果立刻同步，云端只存最终一条，编号仍唯一。
   */
  resolveConflict(input: ConflictResolutionInput): void {
    const conflict = this.conflicts.find((c) => c.id === input.conflictId && c.status === 'pending');
    if (!conflict) throw new Error(`冲突 ${input.conflictId} 不存在或已处置`);
    const state = this.ledger.exportState();
    const records = resolveConflict(state.records, conflict, input.decision, input.by);
    this.ledger.replaceWith(records, state.queue);
    this.conflicts = this.conflicts.map((c) =>
      c.id === conflict.id
        ? {
            ...c,
            status: 'resolved',
            resolution: { picked: input.decision.pick, by: input.by },
          }
        : c,
    );
    this.autoSync();
  }

  private autoSync() {
    if (this.online) this.syncNow();
  }

  /* ----------------------- 双班会话（外部合并器） ----------------------- */

  /** 导出台账记录与队列，供外部三方合并器读取 */
  exportSessionState() {
    const state = this.ledger.exportState();
    return { records: state.records, queue: state.queue };
  }

  /** 外部合并器把结果写回本机组 */
  applySessionMerge(records: Remnant[], queue: PersistedQueueEntry[]) {
    return this.ledger.replaceWith(records, queue);
  }

  /** 合并收敛后推进本机共同基线 */
  markSessionBase(records: Remnant[], queue: PersistedQueueEntry[]) {
    this.base = {
      records: records.map((r) => structuredClone(r)),
      queue: queue.map((q) => ({ ...q })),
      at: this.clock.now(),
    };
  }

  /* ----------------------- 只读视图 ----------------------- */

  list() {
    return this.ledger.list();
  }

  get(id: string) {
    return this.ledger.get(id);
  }

  pendingQueue() {
    return this.ledger.pendingQueue();
  }

  usedSlots() {
    return this.ledger.usedSlots();
  }

  /* ----------------------- 测试 / 诊断 ----------------------- */

  baseSnapshot(): SyncBase {
    return this.base;
  }

  /** 让下一次台账主存储写入失败（演示 / 自检失败回滚） */
  injectNextWriteFailure() {
    const s = this.storage as unknown as { failNextMain?: number };
    if (typeof s.failNextMain === 'number') s.failNextMain += 1;
  }

  storageRef(): LedgerStorage {
    return this.storage;
  }
}
