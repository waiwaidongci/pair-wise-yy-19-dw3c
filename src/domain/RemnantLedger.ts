import type { Attribution, OccupyResult, QueueEntry, Remnant } from './types';
import { DuplicateIdError, WriteFailedError } from './errors';
import type { Clock } from './clock';

/**
 * 底层持久化抽象；生产用 localStorage，测试可注入故障。
 * save 写主记录，saveBackup / commitBackup 组成两阶段后备提交，
 * 主记录写坏（半截、被清）时用「已确认后备」恢复到最近可用状态。
 */
export interface LedgerStorage {
  load(): string | null;
  save(serialized: string): void;
  loadBackup(): string | null;
  /** 阶段一：把新状态暂存为待确认后备（此时还不能当作可用状态） */
  saveBackup(serialized: string): void;
  /** 阶段二：主记录写入成功后，把待确认后备提升为正式后备 */
  commitBackup(): void;
}

/** 排队条目的完整持久化数据：靠它可以在恢复 / 合并后重建待入库存记录 */
export interface PersistedQueueEntry {
  remnantId: string;
  worker: string;
  deviceId: string;
  queuedAt: number;
  length: number;
  width: number;
  thickness: number;
  material: string;
  sourceJobId: string;
}

export interface RemnantLedgerSnapshot {
  records: Remnant[];
  queue: PersistedQueueEntry[];
  savedAt: number;
  savedBy: string;
}

interface PersistShape {
  records: Remnant[];
  queue: PersistedQueueEntry[];
  snapshots: RemnantLedgerSnapshot[];
}

export interface RegisterInput {
  id: string;
  length: number;
  width: number;
  thickness: number;
  material: string;
  sourceJobId: string;
  worker: string;
  deviceId: string;
}

const MAX_SNAPSHOTS = 10;

function occupiesSlot(status: Remnant['status']) {
  // consumed 已离场留痕；available/occupied 正常占位；
  // conflict 的料还在料场隔离区，仍占一个隔离位，不能让排队件趁机超员
  return status === 'available' || status === 'occupied' || status === 'conflict';
}

function entryToRemnant(entry: PersistedQueueEntry, by: Attribution): Remnant {
  return {
    id: entry.remnantId,
    length: entry.length,
    width: entry.width,
    thickness: entry.thickness,
    material: entry.material,
    sourceJobId: entry.sourceJobId,
    status: 'available',
    registeredBy: by,
    lastChangedBy: by,
    version: 1,
  };
}

function inputToQueueEntry(input: RegisterInput, queuedAt: number): PersistedQueueEntry {
  return {
    remnantId: input.id,
    worker: input.worker,
    deviceId: input.deviceId,
    queuedAt,
    length: input.length,
    width: input.width,
    thickness: input.thickness,
    material: input.material,
    sourceJobId: input.sourceJobId,
  };
}

export class RemnantLedger {
  private records = new Map<string, Remnant>();
  private queue: PersistedQueueEntry[] = [];
  private snapshots: RemnantLedgerSnapshot[] = [];
  private loaded = false;

  constructor(
    private readonly storage: LedgerStorage,
    private readonly clock: Clock,
    /** 余料位总数：在库 + 占用中的记录数不得超过它 */
    readonly capacity: number,
  ) {}

  /* ----------------------------- 查询 ----------------------------- */

  get(id: string): Remnant | undefined {
    this.ensureLoaded();
    return this.records.get(id);
  }

  list(): Remnant[] {
    this.ensureLoaded();
    return [...this.records.values()].sort((a, b) =>
      a.registeredBy.at === b.registeredBy.at
        ? a.id.localeCompare(b.id)
        : a.registeredBy.at - b.registeredBy.at,
    );
  }

  pendingQueue(): QueueEntry[] {
    this.ensureLoaded();
    return this.queue.map((entry, index) => ({
      position: index + 1,
      remnantId: entry.remnantId,
      worker: entry.worker,
      deviceId: entry.deviceId,
      queuedAt: entry.queuedAt,
    }));
  }

  usedSlots(): number {
    this.ensureLoaded();
    return [...this.records.values()].filter((r) => occupiesSlot(r.status)).length;
  }

  latestSnapshot(): RemnantLedgerSnapshot | undefined {
    this.ensureLoaded();
    return this.snapshots.at(-1);
  }

  /* ----------------------------- 写入 ----------------------------- */

  /**
   * 余料登记入库。同一编号只入库一次（含排队中）；余料位满时不拒收，
   * 先排队等位，待余料位空出按 FIFO 自动放行。
   */
  register(input: RegisterInput): OccupyResult {
    this.ensureLoaded();
    if (this.records.has(input.id) || this.queue.some((q) => q.remnantId === input.id)) {
      throw new DuplicateIdError(input.id);
    }
    const by: Attribution = { worker: input.worker, deviceId: input.deviceId, at: this.clock.now() };

    if (this.usedSlots() >= this.capacity) {
      const queueEntry = inputToQueueEntry(input, by.at);
      return this.withCommit(() => {
        this.queue.push(queueEntry);
        return {
          status: 'queued' as const,
          remnant: entryToRemnant(queueEntry, by),
          queuePosition: this.queue.findIndex((q) => q.remnantId === input.id) + 1,
          reason: `余料位已满（${this.capacity} 位），已排队等位`,
        };
      });
    }

    const queueEntry = inputToQueueEntry(input, by.at);
    return this.withCommit(() => {
      const remnant = entryToRemnant(queueEntry, by);
      this.records.set(remnant.id, remnant);
      return { status: 'accepted' as const, remnant };
    });
  }

  /**
   * 占用余料：只认先到的一笔。余料已被占用时后到请求被拒，
   * 调用方应改选别的料；已有占用归属绝不被后写覆盖。
   */
  occupy(id: string, worker: string, deviceId: string): OccupyResult {
    this.ensureLoaded();
    const remnant = this.records.get(id);
    if (!remnant) {
      return { status: 'rejected', remnant: undefined as never, reason: `余料 ${id} 不存在` };
    }
    if (remnant.status === 'occupied' && remnant.occupiedBy) {
      const holder = remnant.occupiedBy;
      return {
        status: 'rejected',
        remnant,
        reason: `${holder.worker} 已于 ${formatTime(holder.at)} 先占用，请改选别的料`,
      };
    }
    if (remnant.status !== 'available') {
      return { status: 'rejected', remnant, reason: `余料当前为「${statusLabel(remnant.status)}」，不可占用` };
    }

    return this.withCommit(() => {
      const by: Attribution = { worker, deviceId, at: this.clock.now() };
      const updated: Remnant = {
        ...remnant,
        status: 'occupied',
        occupiedBy: by,
        lastChangedBy: by,
        version: remnant.version + 1,
      };
      this.records.set(id, updated);
      return { status: 'accepted' as const, remnant: updated };
    });
  }

  /**
   * 复测更正尺寸 / 板材：只允许在库料上改，归属和版本号随之推进，
   * 断网两端都改同一条时由同步器按「两边都改过」处理。
   */
  remeasure(
    id: string,
    patch: Partial<Pick<Remnant, 'length' | 'width' | 'thickness' | 'material'>>,
    worker: string,
    deviceId: string,
  ): Remnant {
    this.ensureLoaded();
    const remnant = this.requireStatus(id, 'available');
    return this.withCommit(() => {
      const by: Attribution = { worker, deviceId, at: this.clock.now() };
      const updated: Remnant = {
        ...remnant,
        ...patch,
        lastChangedBy: by,
        version: remnant.version + 1,
      };
      this.records.set(id, updated);
      return updated;
    });
  }

  /** 释放占用（改选别的料后让出），余料回到在库 */
  release(id: string, worker: string, deviceId: string): Remnant {
    this.ensureLoaded();
    const remnant = this.requireStatus(id, 'occupied');
    return this.withCommit(() => {
      const by: Attribution = { worker, deviceId, at: this.clock.now() };
      const updated: Remnant = {
        ...remnant,
        status: 'available',
        occupiedBy: undefined,
        lastChangedBy: by,
        version: remnant.version + 1,
      };
      this.records.set(id, updated);
      return updated;
    });
  }

  /** 领用消耗：腾出余料位，并自动放行排队首位 */
  consume(id: string, worker: string, deviceId: string): Remnant[] {
    this.ensureLoaded();
    const remnant = this.requireStatus(id, 'occupied');
    return this.withCommit(() => {
      const by: Attribution = { worker, deviceId, at: this.clock.now() };
      const updated: Remnant = {
        ...remnant,
        status: 'consumed',
        occupiedBy: undefined,
        consumedBy: by,
        lastChangedBy: by,
        version: remnant.version + 1,
      };
      this.records.set(id, updated);
      return this.admitQueue();
    });
  }

  /**
   * 有位时按 FIFO 放行进库，返回本次放行的余料。
   * 只能在 withCommit 事务内调用：与触发它的操作一起落盘 / 一起回滚。
   */
  private admitQueue(): Remnant[] {
    const admitted: Remnant[] = [];
    while (this.queue.length > 0 && this.usedSlots() < this.capacity) {
      const pending = this.queue.shift()!;
      if (this.records.has(pending.remnantId)) continue; // 合并后已入库，不重复
      const by: Attribution = {
        worker: pending.worker,
        deviceId: pending.deviceId,
        at: this.clock.now(),
      };
      const remnant = entryToRemnant(pending, by);
      this.records.set(remnant.id, remnant);
      admitted.push(remnant);
    }
    return admitted;
  }

  /* --------------------------- 断网合并支持 --------------------------- */

  /** 导出本机台账（断网期间的离线副本） */
  exportState(): PersistShape {
    this.ensureLoaded();
    return this.currentShape();
  }

  /**
   * 合并器把结果写回：同一编号只入库一次；有位时顺带放行队列。
   * 写入仍走事务，失败回滚到最近可用状态。
   */
  replaceWith(records: Remnant[], queue: PersistedQueueEntry[]): Remnant[] {
    return this.withCommit(() => {
      this.records = new Map(records.map((r) => [r.id, r]));
      this.queue = queue.slice().sort((a, b) => a.queuedAt - b.queuedAt);
      return this.admitQueue();
    });
  }

  /* --------------------------- 持久化与恢复 --------------------------- */

  /**
   * 事务模板：先记住改动前的内存状态，mutate 改内存后再落盘；
   * 落盘失败则整体回滚到改动前——这就是「最近可用状态」。
   */
  private withCommit<T>(mutate: () => T): T {
    const rollback = {
      records: new Map([...this.records].map(([id, r]) => [id, structuredClone(r)])),
      queue: this.queue.map((q) => ({ ...q })),
      snapshots: this.snapshots.map((s) => structuredClone(s)),
    };
    const result = mutate();
    try {
      this.persist();
    } catch (cause) {
      this.records = rollback.records;
      this.queue = rollback.queue;
      this.snapshots = rollback.snapshots;
      throw new WriteFailedError(
        `台账写入失败，已回滚到最近可用状态：${(cause as Error).message}`,
      );
    }
    return result;
  }

  private persist(): void {
    // 两阶段提交：
    // 1) 后备暂存「本次成功后的完整状态」（待确认，恢复时不采用）；
    // 2) 写主记录；
    // 3) 主记录成功后把暂存提升为正式后备——它从此等于最近可用状态。
    this.storage.saveBackup(JSON.stringify(this.currentShape()));
    this.storage.save(JSON.stringify(this.currentShape()));
    this.storage.commitBackup();

    // 主记录确认成功后才推进内存中的快照链
    const records = [...this.records.values()];
    const snapshot: RemnantLedgerSnapshot = {
      records: records.map((r) => structuredClone(r)),
      queue: this.queue.map((q) => ({ ...q })),
      savedAt: this.clock.now(),
      savedBy: records.at(-1)?.lastChangedBy.worker ?? 'system',
    };
    this.snapshots.push(snapshot);
    if (this.snapshots.length > MAX_SNAPSHOTS) this.snapshots.shift();
  }

  /**
   * 启动 / 存储异常后调用：读取持久层；读不出或损坏时，
   * 从内存中最近可用快照恢复，台账不会停在半截状态。
   */
  recover(): RemnantLedgerSnapshot {
    this.loaded = true;
    const raw = this.storage.load();
    if (raw && this.hydrate(raw)) return this.describeCurrent();

    // 主记录缺失 / 半截写坏：退到「已确认后备」，它就是最近可用状态
    const backup = this.storage.loadBackup();
    if (backup && this.hydrate(backup)) return this.describeCurrent();

    this.records = new Map();
    this.queue = [];
    return { records: [], queue: [], savedAt: this.clock.now(), savedBy: 'system' };
  }

  private hydrate(serialized: string): boolean {
    try {
      const parsed = JSON.parse(serialized) as PersistShape;
      if (!Array.isArray(parsed.records) || !Array.isArray(parsed.queue)) return false;
      this.records = new Map(parsed.records.map((r) => [r.id, r]));
      this.queue = parsed.queue.slice().sort((a, b) => a.queuedAt - b.queuedAt);
      this.snapshots = parsed.snapshots ?? [];
      return true;
    } catch {
      return false;
    }
  }

  private describeCurrent(): RemnantLedgerSnapshot {
    const records = [...this.records.values()];
    return {
      records,
      queue: this.queue.map((q) => ({ ...q })),
      savedAt: this.snapshots.at(-1)?.savedAt ?? this.clock.now(),
      savedBy: this.snapshots.at(-1)?.savedBy ?? 'system',
    };
  }

  private ensureLoaded() {
    if (!this.loaded) this.recover();
  }

  private requireStatus(id: string, status: Remnant['status']): Remnant {
    const remnant = this.records.get(id);
    if (!remnant) throw new Error(`余料 ${id} 不存在`);
    if (remnant.status !== status) {
      throw new Error(`余料 ${id} 当前为「${statusLabel(remnant.status)}」，要求「${statusLabel(status)}」`);
    }
    return remnant;
  }

  private currentShape(): PersistShape {
    return {
      records: [...this.records.values()],
      queue: this.queue,
      snapshots: this.snapshots,
    };
  }
}

function statusLabel(status: Remnant['status']) {
  const labels: Record<Remnant['status'], string> = {
    available: '在库可用',
    occupied: '已占用',
    consumed: '已领用',
    conflict: '冲突待处置',
  };
  return labels[status];
}

function formatTime(at: number) {
  return new Date(at).toLocaleTimeString('zh-CN', { hour12: false });
}
