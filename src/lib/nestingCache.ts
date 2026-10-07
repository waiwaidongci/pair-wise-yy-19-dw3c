import { nestStock, type StockNesting } from '../utils/nesting';
import type { ManualPosition, NestingResult, Part, StockSheet, WoodworkingProject } from '../types/woodworking';

// 依赖图：零件 → 板材排料图 → 成本。
// 某零件改尺寸时，只有依赖它的那张板材排料图与对应成本失效重算，其余沿用缓存。

function partSignature(part: Part): string {
  return [part.id, part.stockId, part.length, part.width, part.thickness, part.quantity, part.grain].join('|');
}

function stockSignature(stock: StockSheet): string {
  return [stock.id, stock.length, stock.width, stock.thickness, stock.price].join('|');
}

function manualSignature(parts: Part[], manual: Record<string, ManualPosition>): string {
  const keys = parts.flatMap((part) =>
    Array.from({ length: Math.max(1, part.quantity) }, (_, instance) => `${part.id}:${instance}`),
  ).sort();
  return keys.map((key) => {
    const position = manual[key];
    return position
      ? `${key}@${position.sheetIndex},${position.x},${position.y},${position.rotated}`
      : `${key}@auto`;
  }).join(';');
}

export interface StockCacheEntry {
  stockId: string;
  signature: string;
  result: StockNesting;
  dependsOn: string[];       // 依赖的零件 id
  computedAt: number;
  recomputes: number;        // 累计重算次数
}

export interface NestingCacheState {
  byStock: Record<string, StockCacheEntry>;
  costSignature: string;
  cost: number;
  costRecomputes: number;
}

export const emptyNestingCache = (): NestingCacheState => ({
  byStock: {},
  costSignature: '',
  cost: 0,
  costRecomputes: 0,
});

export interface NestingCacheOutcome {
  result: NestingResult;
  cache: NestingCacheState;
  recomputedStocks: string[];   // 本次失效重算的板材
  reusedStocks: string[];       // 本次沿用的板材
  costRecomputed: boolean;      // 成本是否重算
}

export function getNestingWithCache(
  project: WoodworkingProject,
  manual: Record<string, ManualPosition>,
  cache: NestingCacheState,
  now: number,
): NestingCacheOutcome {
  const stockById = new Map(project.stocks.map((stock) => [stock.id, stock]));
  const partsByStock = new Map<string, Part[]>();
  project.parts.forEach((part) => {
    if (!stockById.has(part.stockId)) return;
    const list = partsByStock.get(part.stockId) ?? [];
    list.push(part);
    partsByStock.set(part.stockId, list);
  });

  const next: NestingCacheState = { byStock: {}, costSignature: '', cost: 0, costRecomputes: cache.costRecomputes };
  const recomputedStocks: string[] = [];
  const reusedStocks: string[] = [];
  let layoutChanged = false;

  for (const stock of project.stocks) {
    const parts = partsByStock.get(stock.id) ?? [];
    const signature = [
      stockSignature(stock),
      parts.map(partSignature).sort().join(';'),
      `kerf=${project.kerf}`,
      `trim=${project.trim}`,
      manualSignature(parts, manual),
    ].join('::');

    const previous = cache.byStock[stock.id];
    if (previous && previous.signature === signature) {
      // 沿用：依赖未变，排料图不重算
      next.byStock[stock.id] = previous;
      reusedStocks.push(stock.id);
    } else {
      const result = nestStock(stock, parts, project, manual);
      next.byStock[stock.id] = {
        stockId: stock.id,
        signature,
        result,
        dependsOn: parts.map((part) => part.id),
        computedAt: now,
        recomputes: (previous?.recomputes ?? 0) + 1,
      };
      recomputedStocks.push(stock.id);
      layoutChanged = true;
    }
  }

  // 成本：随排料图失效。任一板材排料图重算，成本即重算；否则沿用。
  const costSignature = [
    project.stocks.map((stock) => `${stock.id}:${stock.price}`).sort().join(';'),
    Object.values(next.byStock).map((entry) => `${entry.stockId}:${entry.result.sheetCount}`).sort().join(';'),
  ].join('|');
  let costRecomputed = false;
  if (costSignature === cache.costSignature && !layoutChanged) {
    next.cost = cache.cost;
  } else {
    next.cost = Object.values(next.byStock).reduce((sum, entry) => sum + entry.result.purchaseCost, 0);
    next.costSignature = costSignature;
    next.costRecomputes = cache.costRecomputes + 1;
    costRecomputed = true;
  }

  const stockResults = project.stocks.map((stock) => next.byStock[stock.id].result);
  const layouts = stockResults.flatMap((result) => result.layouts);
  const placements = stockResults.flatMap((result) => result.placements);
  const unplaced = stockResults.flatMap((result) => result.unplaced);
  const usedArea = stockResults.reduce((sum, result) => sum + result.usedArea, 0);
  const sheetArea = stockResults.reduce((sum, result) => sum + result.sheetArea, 0);
  const wasteArea = stockResults.reduce((sum, result) => sum + result.wasteArea, 0);
  const sheetCount = stockResults.reduce((sum, result) => sum + result.sheetCount, 0);
  const collisions = stockResults.flatMap((result) => result.collisions);
  const utilization = sheetArea > 0 ? (usedArea / sheetArea) * 100 : 0;

  const result: NestingResult = {
    layouts,
    placements,
    totalParts: project.parts.reduce((sum, part) => sum + Math.max(1, part.quantity), 0),
    placedParts: placements.length,
    unplaced,
    usedArea,
    sheetArea,
    utilization,
    wasteArea,
    purchaseCost: next.cost,
    sheetCount,
    elapsedMs: 0,
    collisions,
  };

  return { result, cache: next, recomputedStocks, reusedStocks, costRecomputed };
}
