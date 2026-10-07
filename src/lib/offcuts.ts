import type { ClaimRecord, Offcut, OffcutEvent, OffcutInput, OffcutStatus } from '../types/offcut';

// 余料台账：余料写编号、长宽厚和板材；两人同时占用只认先到的；位满排队等位。
// 全部为纯函数，状态可序列化，便于断网合并与失败回滚。

export interface OffcutState {
  offcuts: Record<string, Offcut>;
  slotTotal: number;                 // 货架总位
  waitlist: string[];                // 等位队列（余料编号，FIFO）
  events: OffcutEvent[];             // 归属流水
}

export const createOffcutState = (slotTotal = 6): OffcutState => ({
  offcuts: {},
  slotTotal,
  waitlist: [],
  events: [],
});

const genId = () => `offcut-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const evtId = () => `evt-${Math.random().toString(36).slice(2, 9)}`;

function log(state: OffcutState, evt: Omit<OffcutEvent, 'id'>): OffcutState {
  return { ...state, events: [...state.events, { ...evt, id: evtId() }] };
}

// 在架（占用位）的状态：available / claimed；queued 还没上位，used 已消耗退位
const occupiesSlot = (status: OffcutStatus) => status === 'available' || status === 'claimed';

export function occupiedSlots(state: OffcutState): number {
  return Object.values(state.offcuts).filter((offcut) => occupiesSlot(offcut.status)).length;
}

function lowestFreeSlot(state: OffcutState): number | null {
  const used = new Set(
    Object.values(state.offcuts)
      .filter((offcut) => occupiesSlot(offcut.status) && offcut.slot != null)
      .map((offcut) => offcut.slot as number),
  );
  for (let i = 0; i < state.slotTotal; i += 1) {
    if (!used.has(i)) return i;
  }
  return null;
}

export type RegisterResult =
  | { kind: 'stored'; offcut: Offcut }
  | { kind: 'queued'; offcut: Offcut; position: number }
  | { kind: 'exists'; offcut: Offcut };

// 登记余料。编号即幂等键：同一编号只入库一次，重复登记原样返回。
export function registerOffcut(
  state: OffcutState,
  input: OffcutInput,
  actor: string,
  now: number,
): { state: OffcutState; result: RegisterResult } {
  const id = input.id?.trim() || genId();
  const existing = state.offcuts[id];
  if (existing) {
    return { state, result: { kind: 'exists', offcut: existing } };
  }
  const slot = lowestFreeSlot(state);
  const offcut: Offcut = {
    id,
    length: input.length,
    width: input.width,
    thickness: input.thickness,
    material: input.material,
    source: input.source,
    status: slot == null ? 'queued' : 'available',
    slot,
    claimedBy: null,
    claimedAt: null,
    version: 1,
    createdAt: now,
  };
  let next: OffcutState = {
    ...state,
    offcuts: { ...state.offcuts, [id]: offcut },
    waitlist: slot == null ? [...state.waitlist, id] : state.waitlist,
  };
  next = log(next, {
    at: now,
    actor,
    offcutId: id,
    type: slot == null ? 'queue' : 'register',
    detail: slot == null ? `位满，排队等位（第 ${next.waitlist.length} 位）` : `登记入库，位号 ${slot! + 1}`,
  });
  return {
    state: next,
    result: slot == null
      ? { kind: 'queued', offcut, position: next.waitlist.length }
      : { kind: 'stored', offcut },
  };
}

export type ClaimResult =
  | { kind: 'claimed'; offcut: Offcut }
  | { kind: 'taken'; by: string; at: number }
  | { kind: 'unavailable'; status: OffcutStatus }
  | { kind: 'missing' };

// 占用余料。两人同时占用只认先到的：仅当 status 为 available 时条件写入成功，
// 否则返回先占者，后到者改选别的料。
export function claimOffcut(
  state: OffcutState,
  offcutId: string,
  actor: string,
  now: number,
): { state: OffcutState; result: ClaimResult } {
  const offcut = state.offcuts[offcutId];
  if (!offcut) return { state, result: { kind: 'missing' } };
  if (offcut.status === 'claimed') {
    return { state, result: { kind: 'taken', by: offcut.claimedBy ?? '未知', at: offcut.claimedAt ?? 0 } };
  }
  if (offcut.status !== 'available') {
    return { state, result: { kind: 'unavailable', status: offcut.status } };
  }
  const updated: Offcut = {
    ...offcut,
    status: 'claimed',
    claimedBy: actor,
    claimedAt: now,
    version: offcut.version + 1,
  };
  const next = log(
    { ...state, offcuts: { ...state.offcuts, [offcutId]: updated } },
    { at: now, actor, offcutId, type: 'claim', detail: `占用 ${offcut.length}×${offcut.width}×${offcut.thickness} mm ${offcut.material}` },
  );
  return { state: next, result: { kind: 'claimed', offcut: updated } };
}

export type ReleaseResult =
  | { kind: 'released'; offcut: Offcut }
  | { kind: 'not-owner'; by: string | null }
  | { kind: 'unavailable'; status: OffcutStatus }
  | { kind: 'missing' };

// 释放占用（只有占用者本人能释放）。释放后余料回到在架可用状态，位仍保留。
export function releaseOffcut(
  state: OffcutState,
  offcutId: string,
  actor: string,
  now: number,
): { state: OffcutState; result: ReleaseResult } {
  const offcut = state.offcuts[offcutId];
  if (!offcut) return { state, result: { kind: 'missing' } };
  if (offcut.status !== 'claimed') return { state, result: { kind: 'unavailable', status: offcut.status } };
  if (offcut.claimedBy !== actor) return { state, result: { kind: 'not-owner', by: offcut.claimedBy } };
  const updated: Offcut = { ...offcut, status: 'available', claimedBy: null, claimedAt: null, version: offcut.version + 1 };
  const next = log(
    { ...state, offcuts: { ...state.offcuts, [offcutId]: updated } },
    { at: now, actor, offcutId, type: 'release', detail: '释放占用，回到在架' },
  );
  return { state: next, result: { kind: 'released', offcut: updated } };
}

export interface UseResult {
  kind: 'used';
  offcut: Offcut;
  admitted: Offcut | null;   // 空位后补进来的等位余料
}

// 领用消耗：余料被用掉，腾出架位，等位队首补上。
export function useOffcut(
  state: OffcutState,
  offcutId: string,
  actor: string,
  now: number,
): { state: OffcutState; result: UseResult | { kind: 'missing' } } {
  const offcut = state.offcuts[offcutId];
  if (!offcut) return { state, result: { kind: 'missing' } };
  const freedSlot = offcut.slot;
  const updated: Offcut = { ...offcut, status: 'used', slot: null, version: offcut.version + 1 };
  let next: OffcutState = { ...state, offcuts: { ...state.offcuts, [offcutId]: updated } };

  let admitted: Offcut | null = null;
  const headId = next.waitlist[0];
  if (freedSlot != null && headId && next.offcuts[headId]?.status === 'queued') {
    const [, ...rest] = next.waitlist;
    const queued = next.offcuts[headId];
    admitted = { ...queued, status: 'available', slot: freedSlot, version: queued.version + 1 };
    next = {
      ...next,
      waitlist: rest,
      offcuts: { ...next.offcuts, [headId]: admitted },
    };
    next = log(next, { at: now, actor, offcutId: headId, type: 'admit', detail: `等位补位，位号 ${freedSlot + 1}` });
  }
  next = log(next, { at: now, actor, offcutId, type: 'use', detail: '领用消耗，腾出架位' });
  return { state: next, result: { kind: 'used', offcut: updated, admitted } };
}

export function claimRecords(state: OffcutState): ClaimRecord[] {
  return Object.values(state.offcuts)
    .filter((offcut) => offcut.status === 'claimed' && offcut.claimedBy)
    .map((offcut) => ({ offcutId: offcut.id, by: offcut.claimedBy as string, at: offcut.claimedAt ?? 0 }));
}
