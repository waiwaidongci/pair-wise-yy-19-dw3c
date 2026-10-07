import { atom } from 'jotai';
import { atomWithStorage } from 'jotai/utils';
import { createOffcutState, type OffcutState } from '../lib/offcuts';
import { emptyNestingCache, type NestingCacheState } from '../lib/nestingCache';
import { createRecovery, type RecoveryState } from '../lib/recovery';
import type { SyncConflict, SyncLogEntry, SyncSnapshot } from '../lib/syncDemo';

// 余料台账（编号 / 长宽厚 / 板材 / 位号 / 归属）
export const offcutStateAtom = atomWithStorage<OffcutState>('joinery-nest:offcuts', createOffcutState(6));

// 增量排料缓存（零件 → 排料图 → 成本）
export const nestingCacheAtom = atom<NestingCacheState>(emptyNestingCache());

// 写入恢复：事务提交 + 幂等键 + 最近可用状态
export const recoveryAtom = atomWithStorage<RecoveryState<OffcutState>>(
  'joinery-nest:recovery',
  createRecovery(createOffcutState(6)),
);

// 断网同步快照
export type { SyncConflict, SyncLogEntry, SyncSnapshot };

export const syncBaseAtom = atomWithStorage<SyncSnapshot | null>('joinery-nest:sync-base', null);
export const syncRemoteAtom = atomWithStorage<SyncSnapshot | null>('joinery-nest:sync-remote', null);
export const syncStatusAtom = atom<'online' | 'offline'>('online');
export const syncConflictsAtom = atom<SyncConflict[]>([]);
export const syncLogAtom = atomWithStorage<SyncLogEntry[]>('joinery-nest:sync-log', []);
