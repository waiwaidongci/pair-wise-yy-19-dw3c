// 余料（开料班组做完一单后剩下的板头/板边）作为可归属记录

export type OffcutStatus = 'available' | 'claimed' | 'used' | 'queued';

export interface Offcut {
  id: string;              // 编号（幂等键，同一编号只入库一次）
  length: number;          // 长 mm
  width: number;           // 宽 mm
  thickness: number;      // 厚 mm
  material: string;        // 板材（材质）
  source: string;          // 来源工单
  status: OffcutStatus;
  slot: number | null;     // 架位号（null 表示暂未上位）
  claimedBy: string | null;   // 归属人
  claimedAt: number | null;   // 占用时间（先到先得的判定依据）
  version: number;        // 乐观并发版本
  createdAt: number;
}

export interface ClaimRecord {
  offcutId: string;
  by: string;
  at: number;
}

export interface OffcutEvent {
  id: string;
  at: number;
  actor: string;
  type: 'register' | 'claim' | 'release' | 'use' | 'admit' | 'queue';
  offcutId: string;
  detail: string;
}

export interface OffcutInput {
  id?: string;
  length: number;
  width: number;
  thickness: number;
  material: string;
  source: string;
}
