/** 写入失败：可能是存储满、序列化失败或被外部中断 */
export class WriteFailedError extends Error {
  constructor(
    message: string,
    /** 触发失败的写入内容，调用方可据此重试或告警 */
    readonly payload?: unknown,
  ) {
    super(message);
    this.name = 'WriteFailedError';
  }
}

/** 余料位已占满（在库 + 占用数量达到容量） */
export class CapacityFullError extends Error {
  constructor(readonly capacity: number) {
    super(`余料位已满（容量 ${capacity}），请排队等位`);
    this.name = 'CapacityFullError';
  }
}

/** 占用请求与已有占用冲突：先到先得，后来者改选别的料 */
export class AlreadyOccupiedError extends Error {
  constructor(
    readonly remnantId: string,
    readonly holder: string,
  ) {
    super(`余料 ${remnantId} 已由 ${holder} 先占用`);
    this.name = 'AlreadyOccupiedError';
  }
}

/** 同一编号重复入库 */
export class DuplicateIdError extends Error {
  constructor(readonly remnantId: string) {
    super(`余料编号 ${remnantId} 已存在，同一编号只入库一次`);
    this.name = 'DuplicateIdError';
  }
}
