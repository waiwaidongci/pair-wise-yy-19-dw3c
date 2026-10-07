// 写入恢复：写前先记意图（WAL），整批写入要么全部生效，要么回滚到最近可用状态；
// 每个写入带幂等键，同一编号只入库一次，重试不会重复。

export interface RecoveryIntent {
  key: string;        // 幂等键（如余料编号）
  at: number;
  label: string;
}

export interface RecoveryState<S> {
  committed: S;                       // 最近可用（已提交）状态
  appliedKeys: string[];              // 已提交的幂等键
  intents: RecoveryIntent[];          // 写前意图流水
  lastFailure: { at: number; label: string; reason: string } | null;
  lastRecoveredAt: number | null;
}

export function createRecovery<S>(initial: S): RecoveryState<S> {
  return { committed: initial, appliedKeys: [], intents: [], lastFailure: null, lastRecoveredAt: null };
}

export interface Mutation<S> {
  key: string;          // 幂等键
  label: string;
  apply: (draft: S) => S;
}

export interface CommitOutcome<S> {
  state: RecoveryState<S>;
  ok: boolean;
  skipped: string[];     // 幂等跳过（同编号已入库）
  applied: string[];
  failedKey: string | null;
  reason: string | null;
  rolledBack: boolean;
}

export function commit<S>(
  state: RecoveryState<S>,
  mutations: Mutation<S>[],
  now: number,
  options: { failKey?: string } = {},
): CommitOutcome<S> {
  const checkpoint = state.committed;                    // 最近可用状态
  const appliedKeys = new Set(state.appliedKeys);
  const intents = [...state.intents];
  const skipped: string[] = [];
  const applied: string[] = [];
  let draft = checkpoint;
  let failedKey: string | null = null;
  let reason: string | null = null;

  for (const mutation of mutations) {
    intents.push({ key: mutation.key, at: now, label: mutation.label });   // 写前意图
    if (appliedKeys.has(mutation.key)) {
      skipped.push(mutation.key);                        // 幂等：同一编号只入库一次
      continue;
    }
    try {
      if (options.failKey === mutation.key) throw new Error('模拟写入失败：校验未通过，整批回滚');
      draft = mutation.apply(draft);
      appliedKeys.add(mutation.key);
      applied.push(mutation.key);
    } catch (error) {
      failedKey = mutation.key;
      reason = error instanceof Error ? error.message : String(error);
      break;
    }
  }

  if (failedKey !== null) {
    // 回滚到最近可用状态
    return {
      state: {
        committed: checkpoint,
        appliedKeys: state.appliedKeys,
        intents,
        lastFailure: { at: now, label: mutations.find((m) => m.key === failedKey)?.label ?? failedKey, reason: reason ?? '写入失败' },
        lastRecoveredAt: now,
      },
      ok: false,
      skipped,
      applied,
      failedKey,
      reason,
      rolledBack: true,
    };
  }

  return {
    state: {
      committed: draft,
      appliedKeys: [...appliedKeys],
      intents,
      lastFailure: state.lastFailure,
      lastRecoveredAt: state.lastRecoveredAt,
    },
    ok: true,
    skipped,
    applied,
    failedKey: null,
    reason: null,
    rolledBack: false,
  };
}
