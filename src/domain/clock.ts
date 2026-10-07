import type { Attribution } from './types';

/**
 * 逻辑时钟：所有需要裁决先后的操作（占用、入库）都经它打戳。
 * 真实部署里换成服务端授时 / 混合逻辑时钟；单机测试可注入固定序列。
 */
export interface Clock {
  now(): number;
}

export const systemClock: Clock = { now: () => Date.now() };

export interface DeviceIdentity {
  worker: string;
  deviceId: string;
}

export function attribution(identity: DeviceIdentity, clock: Clock, atOverride?: number) {
  const next: Attribution = {
    worker: identity.worker,
    deviceId: identity.deviceId,
    at: atOverride ?? clock.now(),
  };
  return next;
}

/**
 * 余料编号：YL + 日期 + 4 位随机，登记时生成。
 * 编号一旦写过就稳定不变，断网合并按它对齐。
 */
export function generateRemnantId(clock: Clock): string {
  const day = new Date(clock.now()).toISOString().slice(0, 10).replace(/-/g, '');
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase().padStart(4, '0');
  return `YL${day}-${rand}`;
}
