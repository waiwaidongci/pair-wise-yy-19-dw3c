import assert from 'node:assert/strict';
import {
  claimOffcut,
  createOffcutState,
  registerOffcut,
  releaseOffcut,
  useOffcut,
  occupiedSlots,
} from '../src/lib/offcuts';
import { threeWayMerge } from '../src/lib/sync';
import { commit, createRecovery, type Mutation } from '../src/lib/recovery';
import { getNestingWithCache, emptyNestingCache } from '../src/lib/nestingCache';
import { createInitialProject } from '../src/utils/project';
import type { OffcutState } from '../src/types/offcut';

let passed = 0;
const check = (name: string, fn: () => void) => {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
};

// ---- 余料：先到先得 + 排队补位 + 幂等 ----
check('余料登记：位满排队，空位补位', () => {
  let s = createOffcutState(2);
  const r1 = registerOffcut(s, { length: 800, width: 200, thickness: 18, material: '黑胡桃', source: '工单1' }, '甲', 1);
  s = r1.state; assert.equal(r1.result.kind, 'stored');
  const r2 = registerOffcut(s, { length: 700, width: 200, thickness: 18, material: '黑胡桃', source: '工单1' }, '甲', 2);
  s = r2.state; assert.equal(r2.result.kind, 'stored');
  const r3 = registerOffcut(s, { length: 600, width: 200, thickness: 18, material: '杨木', source: '工单1' }, '甲', 3);
  s = r3.state; assert.equal(r3.result.kind, 'queued');
  if (r3.result.kind !== 'queued') throw new Error('should queue');
  assert.equal(r3.result.position, 1);
  assert.equal(occupiedSlots(s), 2);
  // 领用第一件，腾出架位，等位队首补上
  const used = useOffcut(s, r1.result.offcut.id, '甲', 4);
  s = used.state;
  assert.equal(used.result.kind, 'used');
  if (used.result.kind !== 'used') throw new Error('should use');
  assert.ok(used.result.admitted, '等位补位');
  assert.equal(used.result.admitted!.id, r3.result.offcut.id);
  assert.equal(used.result.admitted!.status, 'available');
});

check('两人同时占用只认先到的，后到改选别的料', () => {
  let s = createOffcutState(6);
  const r = registerOffcut(s, { length: 800, width: 200, thickness: 18, material: '黑胡桃', source: '工单1' }, '甲', 1);
  s = r.state;
  const id = r.result.offcut.id;
  const c1 = claimOffcut(s, id, '甲', 2);
  s = c1.state; assert.equal(c1.result.kind, 'claimed');
  const c2 = claimOffcut(s, id, '乙', 3);
  assert.equal(c2.result.kind, 'taken');
  if (c2.result.kind !== 'taken') throw new Error('should be taken');
  assert.equal(c2.result.by, '甲');
  // 乙改选别的料
  const rOther = registerOffcut(s, { length: 700, width: 200, thickness: 18, material: '黑胡桃', source: '工单1' }, '乙', 4);
  s = rOther.state;
  const c3 = claimOffcut(s, rOther.result.offcut.id, '乙', 5);
  assert.equal(c3.result.kind, 'claimed');
});

check('只有占用者本人能释放', () => {
  let s = createOffcutState(6);
  const r = registerOffcut(s, { length: 800, width: 200, thickness: 18, material: '黑胡桃', source: '工单1' }, '甲', 1);
  s = r.state;
  const id = r.result.offcut.id;
  s = claimOffcut(s, id, '甲', 2).state;
  const bad = releaseOffcut(s, id, '乙', 3);
  assert.equal(bad.result.kind, 'not-owner');
  const good = releaseOffcut(bad.state, id, '甲', 4);
  assert.equal(good.result.kind, 'released');
});

check('同一编号只入库一次（幂等）', () => {
  let s = createOffcutState(6);
  const r1 = registerOffcut(s, { id: 'offcut-fixed', length: 800, width: 200, thickness: 18, material: '黑胡桃', source: '工单1' }, '甲', 1);
  s = r1.state;
  const r2 = registerOffcut(s, { id: 'offcut-fixed', length: 999, width: 999, thickness: 99, material: '杨木', source: '工单2' }, '乙', 2);
  assert.equal(r2.result.kind, 'exists');
  assert.equal(Object.keys(s.offcuts).length, 1);
});

// ---- 断网合并：按编号三方合并，两边都改过各留一份 ----
check('三方合并：两边都改过 → 冲突待处置', () => {
  const base = { a: { id: 'a', v: 1 } };
  const local = { a: { id: 'a', v: 2 } };
  const remote = { a: { id: 'a', v: 3 } };
  const out = threeWayMerge(base, local, remote);
  assert.equal(out.conflicts.length, 1);
  assert.equal(out.conflicts[0].kind, 'both-modified');
  assert.equal(Object.keys(out.merged).length, 0, '冲突件不自动并入');
});

check('三方合并：只有一边改过 → 采用那一边', () => {
  const base = { a: { id: 'a', v: 1 } };
  const local = { a: { id: 'a', v: 2 } };
  const remote = { a: { id: 'a', v: 1 } };
  const out = threeWayMerge(base, local, remote);
  assert.equal(out.conflicts.length, 0);
  assert.deepEqual(out.merged.a, { id: 'a', v: 2 });
});

check('三方合并：一边改一边删 → 改/删冲突', () => {
  const base = { a: { id: 'a', v: 1 } };
  const local = { a: { id: 'a', v: 2 } };
  const remote = {};
  const out = threeWayMerge(base, local, remote);
  assert.equal(out.conflicts.length, 1);
  assert.equal(out.conflicts[0].kind, 'modify-delete');
});

// ---- 写入恢复：失败回滚 + 幂等重试 ----
check('写入失败回滚到最近可用状态', () => {
  const recovery = createRecovery<OffcutState>(createOffcutState(6));
  const mutations: Mutation<OffcutState>[] = [
    { key: 'k1', label: '写入1', apply: (d) => ({ ...d, offcuts: { ...d.offcuts, k1: { id: 'k1' } as never } }) },
    { key: 'k2', label: '写入2', apply: (d) => ({ ...d, offcuts: { ...d.offcuts, k2: { id: 'k2' } as never } }) },
  ];
  const out = commit(recovery, mutations, 10, { failKey: 'k2' });
  assert.equal(out.ok, false);
  assert.equal(out.rolledBack, true);
  assert.equal(Object.keys(out.state.committed.offcuts).length, 0, '整批回滚');
  assert.equal(out.state.lastFailure !== null, true);
});

check('幂等重试：同一编号只入库一次', () => {
  let recovery = createRecovery<OffcutState>(createOffcutState(6));
  const m1: Mutation<OffcutState> = { key: 'k1', label: '写入1', apply: (d) => ({ ...d, offcuts: { ...d.offcuts, k1: { id: 'k1' } as never } }) };
  const out1 = commit(recovery, [m1], 10);
  recovery = out1.state;
  const out2 = commit(recovery, [m1], 11);
  assert.equal(out2.skipped.length, 1, '重复写入被跳过');
  assert.equal(Object.keys(out2.state.committed.offcuts).length, 1);
});

// ---- 依赖重算：只有依赖该零件的板材重算，其余沿用 ----
check('零件改尺寸：只失效重算依赖它的板材', () => {
  const project = createInitialProject();
  const manual = {};
  let cache = emptyNestingCache();
  const first = getNestingWithCache(project, manual, cache, 1);
  cache = first.cache;
  assert.ok(first.recomputedStocks.length > 0, '首次全部重算');
  // 第二次：无变化，全部沿用
  const second = getNestingWithCache(project, manual, cache, 2);
  assert.equal(second.recomputedStocks.length, 0);
  assert.equal(second.reusedStocks.length, project.stocks.length);
  // 改一个零件尺寸：只有用到它的板材重算
  const target = project.parts[0];
  const modified = { ...project, parts: project.parts.map((p) => p.id === target.id ? { ...p, length: p.length + 100 } : p) };
  const third = getNestingWithCache(modified, manual, cache, 3);
  assert.ok(third.recomputedStocks.length >= 1, '依赖该零件的板材重算');
  assert.ok(third.reusedStocks.length >= 1, '其余板材沿用');
  assert.equal(third.recomputedStocks.length + third.reusedStocks.length, project.stocks.length);
});

console.log(`\n全部通过：${passed} 项`);
