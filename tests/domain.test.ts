import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CloudLedgerStore,
  IncrementalNestingEngine,
  RemnantLedger,
  SyncCoordinator,
  WriteFailedError,
  type LedgerStorage,
  type RegisterInput,
} from '../src/domain';
import { createInitialProject } from '../src/utils/project';
import type { WoodworkingProject } from '../src/types/woodworking';

/* ------------------------------ 测试夹具 ------------------------------ */

class FakeClock {
  t = 1_700_000_000_000;
  now() {
    this.t += 1000;
    return this.t;
  }
}

class MemoryStorage implements LedgerStorage {
  main: string | null = null;
  backup: string | null = null;
  pending: string | null = null;
  failNextMain = 0;
  failNextBackup = 0;
  load() {
    return this.main;
  }
  save(value: string) {
    if (this.failNextMain > 0) {
      this.failNextMain -= 1;
      throw new Error('QuotaExceededError: 存储已满');
    }
    this.main = value;
  }
  loadBackup() {
    return this.backup;
  }
  saveBackup(value: string) {
    if (this.failNextBackup > 0) {
      this.failNextBackup -= 1;
      throw new Error('backup write failed');
    }
    this.pending = value;
  }
  commitBackup() {
    this.backup = this.pending;
    this.pending = null;
  }
}

function input(over: Partial<RegisterInput> = {}): RegisterInput {
  return {
    id: `YL${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    length: 800,
    width: 300,
    thickness: 18,
    material: '北美黑胡桃',
    sourceJobId: 'job-001',
    worker: '开料甲班',
    deviceId: 'device-A',
    ...over,
  };
}

/* ------------------------------ 余料台账 ------------------------------ */

test('余料登记：写入编号、长宽厚、板材与归属', () => {
  const ledger = new RemnantLedger(new MemoryStorage(), new FakeClock(), 20);
  const result = ledger.register(input({ id: 'YL001', length: 1234, material: '白橡木' }));
  assert.equal(result.status, 'accepted');
  const saved = ledger.get('YL001')!;
  assert.equal(saved.length, 1234);
  assert.equal(saved.width, 300);
  assert.equal(saved.thickness, 18);
  assert.equal(saved.material, '白橡木');
  assert.equal(saved.registeredBy.worker, '开料甲班');
  assert.equal(saved.version, 1);
});

test('占用只认先到的：后来者被拒且应改选别的料', () => {
  const clock = new FakeClock();
  const ledger = new RemnantLedger(new MemoryStorage(), clock, 20);
  ledger.register(input({ id: 'YL100' }));

  const first = ledger.occupy('YL100', '开料甲班', 'device-A');
  const second = ledger.occupy('YL100', '开料乙班', 'device-B');

  assert.equal(first.status, 'accepted');
  assert.equal(first.remnant.occupiedBy?.worker, '开料甲班');
  assert.equal(second.status, 'rejected');
  assert.match(second.reason ?? '', /先占用/);
  assert.match(second.reason ?? '', /改选别的料/);
  // 先到的归属没有被后写覆盖
  assert.equal(ledger.get('YL100')!.occupiedBy?.worker, '开料甲班');

  // 被拒一方改选另一块料，可以正常占用
  ledger.register(input({ id: 'YL101', worker: '开料乙班', deviceId: 'device-B' }));
  const alternative = ledger.occupy('YL101', '开料乙班', 'device-B');
  assert.equal(alternative.status, 'accepted');
});

test('同一编号只入库一次：重复登记直接拒绝', () => {
  const ledger = new RemnantLedger(new MemoryStorage(), new FakeClock(), 20);
  ledger.register(input({ id: 'YL-DUP' }));
  assert.throws(() => ledger.register(input({ id: 'YL-DUP' })), /只入库一次/);
});

test('余料位满先排队等位，领用腾出位后按 FIFO 放行', () => {
  const ledger = new RemnantLedger(new MemoryStorage(), new FakeClock(), 2);
  ledger.register(input({ id: 'YL-A' }));
  ledger.register(input({ id: 'YL-B' }));
  const queued1 = ledger.register(input({ id: 'YL-C' }));
  const queued2 = ledger.register(input({ id: 'YL-D' }));
  assert.equal(queued1.status, 'queued');
  assert.equal(queued1.queuePosition, 1);
  assert.equal(queued2.queuePosition, 2);
  assert.equal(ledger.usedSlots(), 2);
  assert.equal(ledger.pendingQueue().length, 2);

  ledger.occupy('YL-A', '甲', 'd1');
  const admitted = ledger.consume('YL-A', '甲', 'd1');
  assert.deepEqual(admitted.map((r) => r.id), ['YL-C']);
  assert.equal(ledger.get('YL-C')?.status, 'available');
  assert.equal(ledger.pendingQueue()[0]?.remnantId, 'YL-D');
});

test('写入失败：回滚到最近可用状态，同一编号不会出现两份', () => {
  const storage = new MemoryStorage();
  const ledger = new RemnantLedger(storage, new FakeClock(), 20);
  ledger.register(input({ id: 'YL-OK' }));

  // 下一次主存储写入失败：本次改动回滚
  storage.failNextMain = 1;
  assert.throws(
    () => ledger.register(input({ id: 'YL-FAIL' })),
    (err: unknown) => err instanceof WriteFailedError,
  );
  assert.equal(ledger.get('YL-FAIL'), undefined);
  assert.equal(ledger.get('YL-OK')?.id, 'YL-OK');

  // 重启实例从持久层恢复，仍是最近可用状态
  const reopened = new RemnantLedger(storage, new FakeClock(), 20);
  const snapshot = reopened.recover();
  assert.ok(snapshot.records.some((r) => r.id === 'YL-OK'));
  assert.equal(reopened.get('YL-FAIL'), undefined);

  // 主记录损坏时，独立后备通道仍能恢复到最近可用状态
  storage.main = '{ 半截写入...';
  const recovered = new RemnantLedger(storage, new FakeClock(), 20);
  const restored = recovered.recover();
  assert.ok(restored.records.some((r) => r.id === 'YL-OK'));
});

/* ------------------------------ 断网合并 ------------------------------ */

test('断网各自登记，回网按编号合并，后传不盖先写', () => {
  const cloud = new CloudLedgerStore();
  const storageA = new MemoryStorage();
  const storageB = new MemoryStorage();
  const clock = new FakeClock();

  const a = new SyncCoordinator(new RemnantLedger(storageA, clock, 50), storageA, cloud, clock);
  const b = new SyncCoordinator(new RemnantLedger(storageB, clock, 50), storageB, cloud, clock);

  // 共同起点：甲登记一块料
  a.register(input({ id: 'YL-SHARE' }));
  // 乙先拉取到共同状态
  b.syncNow();

  a.setOffline();
  b.setOffline();
  // 断网期间各自登记不同编号
  a.register(input({ id: 'YL-A-ONLY', worker: '甲班', deviceId: 'device-A' }));
  b.register(input({ id: 'YL-B-ONLY', worker: '乙班', deviceId: 'device-B' }));
  // 甲先占用共享料
  const occupied = a.occupy('YL-SHARE', '甲班', 'device-A');
  assert.equal(occupied.status, 'accepted');

  // 乙回网先传，甲后传：甲的占用不能被乙的未改动版本盖掉
  b.setOnline();
  b.syncNow();
  a.setOnline();
  const report = a.syncNow();
  assert.deepEqual(report.conflicts, []);
  assert.ok(report.takenRemote.includes('YL-B-ONLY'));
  assert.ok(report.takenLocal.includes('YL-A-ONLY'));

  // 乙再同步，看到甲的占用
  const reportB = b.syncNow();
  assert.ok(reportB.takenRemote.includes('YL-A-ONLY'));
  assert.equal(b['ledger'].get('YL-SHARE')!.occupiedBy?.worker, '甲班');
});

test('两边都改过同一编号：各留一份待处置，处置后编号唯一', () => {
  const cloud = new CloudLedgerStore();
  const storageA = new MemoryStorage();
  const storageB = new MemoryStorage();
  const clock = new FakeClock();
  const a = new SyncCoordinator(new RemnantLedger(storageA, clock, 50), storageA, cloud, clock);
  const b = new SyncCoordinator(new RemnantLedger(storageB, clock, 50), storageB, cloud, clock);

  a.register(input({ id: 'YL-EDIT', length: 500 }));
  b.syncNow();

  a.setOffline();
  b.setOffline();
  a.remeasure('YL-EDIT', { length: 600 }, '甲班', 'device-A');
  b.remeasure('YL-EDIT', { length: 700 }, '乙班', 'device-B');

  b.setOnline();
  b.syncNow();
  a.setOnline();
  const report = a.syncNow();
  assert.equal(report.conflicts.length, 1);
  const conflict = report.conflicts[0]!;
  assert.equal(conflict.local.length, 600);
  assert.equal(conflict.remote.length, 700);
  assert.equal(a.pendingConflicts()[0]!.status, 'pending');
  // 隔离中不可再占用
  const occupyAttempt = a.occupy('YL-EDIT', '丙', 'device-C');
  assert.equal(occupyAttempt.status, 'rejected');

  // 人工各留一份审完后选定甲的版本；云端与本机该编号最终只有一条
  a.resolveConflict({
    conflictId: 'YL-EDIT',
    decision: { pick: 'local' },
    by: { worker: '班长', deviceId: 'device-A', at: clock.now() },
  });
  assert.equal(a.pendingConflicts().filter((c) => c.status === 'pending').length, 0);
  assert.equal(a['ledger'].list().filter((r) => r.id === 'YL-EDIT').length, 1);
  assert.equal(a['ledger'].get('YL-EDIT')!.length, 600);

  // 乙回网同步后也只保留一条，编号不重复
  const reportB = b.syncNow();
  assert.equal(reportB.conflicts.length, 0);
  assert.equal(b['ledger'].list().filter((r) => r.id === 'YL-EDIT').length, 1);
  assert.equal(b['ledger'].get('YL-EDIT')!.length, 600);
});

test('新设备首次打开：从云端拉取共同台账，不拿空本机覆盖云端', () => {
  const cloud = new CloudLedgerStore();
  const storageA = new MemoryStorage();
  const clock = new FakeClock();
  const a = new SyncCoordinator(new RemnantLedger(storageA, clock, 50), storageA, cloud, clock);
  a.register(input({ id: 'YL-SEED' }));

  const storageB = new MemoryStorage();
  const b = new SyncCoordinator(new RemnantLedger(storageB, clock, 50), storageB, cloud, clock);
  assert.ok(b.get('YL-SEED'), '新设备应看到云端已有余料');
  assert.equal(cloud.pull().records.length, 1);
});

test('断网两人各占同一块料：回网两边占用记录都保留待处置，不会互相覆盖', () => {
  const cloud = new CloudLedgerStore();
  const storageA = new MemoryStorage();
  const storageB = new MemoryStorage();
  const clock = new FakeClock();
  const a = new SyncCoordinator(new RemnantLedger(storageA, clock, 50), storageA, cloud, clock);
  const b = new SyncCoordinator(new RemnantLedger(storageB, clock, 50), storageB, cloud, clock);
  a.register(input({ id: 'YL-RACE' }));
  b.syncNow();

  a.setOffline();
  b.setOffline();
  assert.equal(a.occupy('YL-RACE', '甲班', 'device-A').status, 'accepted');
  assert.equal(b.occupy('YL-RACE', '乙班', 'device-B').status, 'accepted');

  b.setOnline();
  b.syncNow();
  a.setOnline();
  const report = a.syncNow();
  assert.equal(report.conflicts.length, 1);
  assert.equal(report.conflicts[0]!.local.occupiedBy?.worker, '甲班');
  assert.equal(report.conflicts[0]!.remote.occupiedBy?.worker, '乙班');
});

test('排队合并：同一编号一端已入库另一端还在排队，不会重复入库', () => {
  const cloud = new CloudLedgerStore();
  const storageA = new MemoryStorage();
  const storageB = new MemoryStorage();
  const clock = new FakeClock();
  const a = new SyncCoordinator(new RemnantLedger(storageA, clock, 50), storageA, cloud, clock);
  const b = new SyncCoordinator(new RemnantLedger(storageB, clock, 1), storageB, cloud, clock);
  a.register(input({ id: 'YL-HOLD' }));
  b.syncNow();

  // 乙在小容量（1 位）且离线状态下排队登记
  b.setOffline();
  const queued = b.register(input({ id: 'YL-Q', worker: '乙班', deviceId: 'device-B' }));
  assert.equal(queued.status, 'queued');
  // 甲那边同一编号已直接入库（容量更大）
  a.register(input({ id: 'YL-Q', worker: '甲班', deviceId: 'device-A' }));
  b.setOnline();
  b.syncNow();
  const report = b.syncNow();
  assert.equal(report.conflicts.length, 0);
  assert.equal(b.list().filter((r) => r.id === 'YL-Q').length, 1);
  assert.equal(b.pendingQueue().filter((q) => q.remnantId === 'YL-Q').length, 0);
});

/* ------------------------------ 增量失效 ------------------------------ */

function cloneProject(project: WoodworkingProject): WoodworkingProject {
  return structuredClone({ ...project, updatedAt: 0 });
}

test('改一个零件尺寸：只重算依赖它的排料图与成本，其余沿用', () => {
  const engine = new IncrementalNestingEngine();
  const project = createInitialProject();
  const first = engine.compute(cloneProject(project), {});
  assert.ok(first.layouts.length >= 2);

  // 找到放在胡桃木板（stock-walnut）上的一个零件
  const walnutSheetKey = first.layouts.find((l) => l.stockId === 'stock-walnut')!;
  const targetPartId = walnutSheetKey.placements[0]!.partId;
  const affectedBefore = new Set(
    first.placements.filter((p) => p.partId === targetPartId).map((p) => `${p.stockId}@${p.sheetIndex}`),
  );

  const changed = cloneProject(project);
  const target = changed.parts.find((p) => p.id === targetPartId)!;
  target.length = Math.round(target.length * 0.9);
  const second = engine.compute(changed, {});

  assert.deepEqual(second.incremental!.changedPartIds, [targetPartId]);
  // 含被改零件的排料图重算
  for (const key of affectedBefore) {
    const [stockId, indexText] = key.split('@');
    const layout = second.layouts.find((l) => l.stockId === stockId && l.sheetIndex === Number(indexText));
    if (layout) assert.equal(layout.recomputed, true, `${key} 应重算`);
  }
  // 完全不相关的板材（杨木背板）排料图沿用
  const poplarLayout = second.layouts.find((l) => l.stockId === 'stock-poplar');
  assert.ok(poplarLayout);
  assert.equal(poplarLayout!.recomputed, false);
  assert.ok(second.incremental!.reusedSheets.includes('stock-poplar@0'));
  // 沿用图的零件坐标不变
  const beforePoplar = first.placements.filter((p) => p.stockId === 'stock-poplar');
  const afterPoplar = second.placements.filter((p) => p.stockId === 'stock-poplar');
  assert.deepEqual(
    afterPoplar.map((p) => [p.key, p.x, p.y]),
    beforePoplar.map((p) => [p.key, p.x, p.y]),
  );
});

test('无关改动不触发重算：排料图全部沿用', () => {
  const engine = new IncrementalNestingEngine();
  const project = createInitialProject();
  engine.compute(cloneProject(project), {});

  const changed = cloneProject(project);
  changed.name = '改个项目名而已';
  changed.updatedAt = 999;
  const second = engine.compute(changed, {});
  assert.deepEqual(second.incremental!.changedPartIds, []);
  assert.equal(second.incremental!.reusedSheets.length, second.layouts.length);
  assert.equal(second.incremental!.recomputedSheets.length, 0);
});

test('锯缝 / 板材价格变化属于全局变化：整批重算', () => {
  const engine = new IncrementalNestingEngine();
  const project = createInitialProject();
  const first = engine.compute(cloneProject(project), {});

  const changed = cloneProject(project);
  changed.kerf = 5;
  const second = engine.compute(changed, {});
  assert.equal(second.incremental!.changedPartIds, null);
  assert.equal(second.incremental!.reusedSheets.length, 0);
  assert.equal(second.incremental!.recomputedSheets.length, second.layouts.length);
  assert.notEqual(first.elapsedMs, undefined);
});
