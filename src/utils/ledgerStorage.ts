import type { LedgerStorage } from '../domain';

/**
 * localStorage 三通道实现：
 * - main：完整台账（权威）；
 * - backup：最近一次成功提交的后备副本（写入失败 / 半截时恢复用）；
 * - backup-pending：两阶段提交的暂存，主记录未确认成功前不被当作可用状态。
 */
export function localStorageLedger(
  mainKey = 'joinery-nest:remnant-ledger',
  backupKey = 'joinery-nest:remnant-ledger:backup',
  pendingKey = 'joinery-nest:remnant-ledger:backup-pending',
): LedgerStorage {
  const target = typeof localStorage === 'undefined' ? null : localStorage;
  return {
    load() {
      try {
        return target?.getItem(mainKey) ?? null;
      } catch {
        return null;
      }
    },
    save(serialized) {
      target?.setItem(mainKey, serialized);
    },
    loadBackup() {
      try {
        return target?.getItem(backupKey) ?? null;
      } catch {
        return null;
      }
    },
    saveBackup(serialized) {
      // 两阶段：先写 pending，再由 commitBackup 提升为正式后备
      target?.setItem(pendingKey, serialized);
    },
    commitBackup() {
      const pending = target?.getItem(pendingKey);
      if (pending !== null && pending !== undefined) target?.setItem(backupKey, pending);
      target?.removeItem(pendingKey);
    },
  };
}
