/**
 * 余料台账领域模型。
 *
 * 每条记录都带编号与归属信息（登记人 / 占用人 / 时间戳），
 * 让「同一块余料被两人认领」的争议可以凭记录裁决：占用只认先到的一笔。
 */

export type RemnantStatus =
  /** 在库可用 */
  | 'available'
  /** 已被某班组占用（占用记录可归属） */
  | 'occupied'
  /** 已被领用消耗，台账留痕 */
  | 'consumed'
  /** 断网合并时双方都改过，等待人工处置 */
  | 'conflict';

export interface Attribution {
  /** 操作人 / 班组，例如「开料甲班」 */
  worker: string;
  /** 设备标识，断网时用来区分来源本机 */
  deviceId: string;
  at: number;
}

export interface Remnant {
  /** 余料编号，全局唯一；断网合并按编号对齐 */
  id: string;
  length: number;
  width: number;
  thickness: number;
  /** 板材名称 / 牌号，例如「北美黑胡桃 18mm」 */
  material: string;
  /** 来源：哪一单 / 哪张排料图切下来的 */
  sourceJobId: string;
  status: RemnantStatus;
  /** 登记归属 */
  registeredBy: Attribution;
  /** 当前占用归属；status 为 occupied 时存在 */
  occupiedBy?: Attribution;
  /** 已领用时的归属 */
  consumedBy?: Attribution;
  /** 最近一次修改归属 */
  lastChangedBy: Attribution;
  version: number;
}

/**
 * 待处置冲突：同一编号两边都改过，服务端不替人决定，
 * 两边版本各保留一份（local / remote），由人工选择或合并后再处置。
 */
export interface RemnantConflict {
  id: string;
  /** 共同祖先（断网前的最近一致状态），可为空表示各自新建 */
  base: Remnant | null;
  /** 本机版本 */
  local: Remnant;
  /** 对端 / 服务端版本 */
  remote: Remnant;
  detectedAt: number;
  status: 'pending' | 'resolved';
  /** 处置结果与处置人 */
  resolution?: { picked: 'local' | 'remote' | 'merged'; by: Attribution };
}

export type LedgerRequestStatus = 'queued' | 'accepted' | 'rejected';

/** 排队等位记录：余料位满时先排队，有位再按 FIFO 放行 */
export interface QueueEntry {
  position: number;
  remnantId: string;
  worker: string;
  deviceId: string;
  queuedAt: number;
}

export interface OccupyResult {
  status: LedgerRequestStatus;
  remnant: Remnant;
  /** 被排队时返回队伍位置（1 起） */
  queuePosition?: number;
  /** 占用被拒时说明原因，提示改选别的料 */
  reason?: string;
}
