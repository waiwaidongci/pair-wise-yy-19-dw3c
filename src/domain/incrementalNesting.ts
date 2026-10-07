import type {
  ManualPosition,
  NestingResult,
  Part,
  Placement,
  SheetLayout,
  StockSheet,
  WoodworkingProject,
} from '../types/woodworking';

/* ----------------------------- 几何辅助 ----------------------------- */

interface ExpandedInstance {
  part: Part;
  instance: number;
  key: string;
}

function expand(parts: Part[]): ExpandedInstance[] {
  return parts.flatMap((part) =>
    Array.from({ length: Math.max(1, part.quantity) }, (_, instance) => ({
      part,
      instance,
      key: `${part.id}:${instance}`,
    })),
  );
}

function sizeOf(part: Part, rotated: boolean) {
  return rotated
    ? { width: part.width, height: part.length }
    : { width: part.length, height: part.width };
}

/** 按锯缝膨胀后的占位，用来给两个零件留出锯缝 */
function collide(a: Placement, b: Placement, kerf: number) {
  if (a.sheetIndex !== b.sheetIndex || a.stockId !== b.stockId) return false;
  const k = kerf / 2;
  return !(
    a.x + a.width + k <= b.x - k ||
    b.x + b.width + k <= a.x - k ||
    a.y + a.height + k <= b.y - k ||
    b.y + b.height + k <= a.y - k
  );
}

/* ----------------------------- 失效判定 ----------------------------- */

interface ProjectSignature {
  kerf: number;
  trim: number;
  stocks: string; // 板材规格 / 价格变化会影响所有排料图
}

function signature(project: WoodworkingProject): ProjectSignature {
  return {
    kerf: project.kerf,
    trim: project.trim,
    stocks: JSON.stringify(
      project.stocks.map((s) => [s.id, s.length, s.width, s.thickness, s.price, s.quantity]),
    ),
  };
}

/**
 * 判定本次变化影响哪些零件：
 * - null：全局参数（锯缝、修边、板材规格、价格）变化，全部排料图失效；
 * - 集合：只有依赖这些零件的排料图和成本失效，其余沿用。
 */
function changedParts(prev: WoodworkingProject | null, next: WoodworkingProject): string[] | null {
  if (!prev) return null;
  const p = signature(prev);
  const n = signature(next);
  if (p.kerf !== n.kerf || p.trim !== n.trim || p.stocks !== n.stocks) return null;

  const ids = new Set<string>();
  const prevById = new Map(prev.parts.map((part) => [part.id, part]));
  const nextById = new Map(next.parts.map((part) => [part.id, part]));
  for (const part of next.parts) {
    const old = prevById.get(part.id);
    if (!old || JSON.stringify(old) !== JSON.stringify(part)) ids.add(part.id);
  }
  for (const part of prev.parts) {
    if (!nextById.has(part.id)) ids.add(part.id);
  }
  return [...ids];
}

/* ----------------------------- 增量排料 ----------------------------- */

interface CacheEntry {
  project: WoodworkingProject;
  manualPositions: Record<string, ManualPosition>;
  result: NestingResult;
}

/**
 * 带失效控制的排料引擎。
 *
 * 保留上一次排料图：零件改动时只重排「放了该零件的排料图」，
 * 其它排料图连同成本一起沿用；全局参数变化才全量重算。
 */
export class IncrementalNestingEngine {
  private cache: CacheEntry | null = null;

  compute(project: WoodworkingProject, manualPositions: Record<string, ManualPosition>): NestingResult {
    const startedAt = performance.now();
    const changed = changedParts(this.cache?.project ?? null, project);

    // 无零件变化时：先沿用上一结果，仅同步手动微调
    if (changed !== null && changed.length === 0 && this.cache) {
      return this.reuseCached(project, manualPositions, startedAt);
    }
    // 全局参数变化或首次计算：全量重算
    if (changed === null || !this.cache) {
      return this.fullRecompute(project, manualPositions, startedAt);
    }
    return this.partialRecompute(project, manualPositions, changed, startedAt);
  }

  /** 手动清空缓存（如「重新排料」按钮） */
  invalidate() {
    this.cache = null;
  }

  /* ----------------------------- 全量 ----------------------------- */

  private fullRecompute(
    project: WoodworkingProject,
    manualPositions: Record<string, ManualPosition>,
    startedAt: number,
  ): NestingResult {
    const packed = this.packAll(project, manualPositions, null);
    const elapsedMs = Math.round((performance.now() - startedAt) * 10) / 10;
    const result: NestingResult = {
      ...packed,
      elapsedMs,
      incremental: {
        changedPartIds: null,
        reusedSheets: [],
        recomputedSheets: packed.layouts.map(layoutKey),
        createdSheets: packed.layouts.map(layoutKey),
        costsRecomputed: true,
        fromCache: false,
        elapsedMs,
      },
    };
    this.cache = { project, manualPositions, result };
    return result;
  }

  /* ----------------------------- 无变化沿用 ----------------------------- */

  private reuseCached(
    project: WoodworkingProject,
    manualPositions: Record<string, ManualPosition>,
    startedAt: number,
  ): NestingResult {
    const previous = this.cache!.result;
    // 手动坐标变化只影响被拖动的零件；不改动其它排料图
    const touchedManual = new Set(
      [...Object.keys(manualPositions), ...Object.keys(this.cache!.manualPositions)],
    );
    const layouts = previous.layouts.map((layout) => {
      if (!layout.placements.some((p) => touchedManual.has(p.key))) {
        return { ...layout, recomputed: false };
      }
      const placements = layout.placements.map((p) => applyManual(project, p, manualPositions));
      return this.buildLayout(project, layout.stockId, layout.sheetIndex, placements, true);
    });
    const allPlacements = layouts.flatMap((l) => l.placements);
    const collisions: string[] = [];
    allPlacements.forEach((p, i) => {
      allPlacements.slice(i + 1).forEach((o) => {
        if (collide(p, o, project.kerf)) collisions.push(`${p.key}|${o.key}`);
      });
    });
    const elapsedMs = Math.round((performance.now() - startedAt) * 10) / 10;
    const result: NestingResult = {
      ...previous,
      layouts,
      placements: allPlacements,
      collisions,
      elapsedMs,
      incremental: {
        changedPartIds: [],
        reusedSheets: layouts.filter((l) => l.recomputed === false).map(layoutKey),
        recomputedSheets: layouts.filter((l) => l.recomputed).map(layoutKey),
        createdSheets: [],
        costsRecomputed: false,
        fromCache: true,
        elapsedMs,
      },
    };
    this.cache = { project, manualPositions, result };
    return result;
  }

  /* ----------------------------- 增量重排 ----------------------------- */

  private partialRecompute(
    project: WoodworkingProject,
    manualPositions: Record<string, ManualPosition>,
    changedPartIds: string[],
    startedAt: number,
  ) {
    const previous = this.cache!.result;
    const changedSet = new Set(changedPartIds);
    const stockById = new Map(project.stocks.map((s) => [s.id, s]));

    // 受影响排料图：放了任一被改零件的图；被删零件的旧图也在其中
    const affectedSheets = new Set<string>();
    for (const p of previous.placements) {
      if (changedSet.has(p.partId)) affectedSheets.add(sheetKeyOf(p.stockId, p.sheetIndex));
    }

    // 未受影响的图：排料图与成本整体沿用
    const retainedLayouts = previous.layouts.filter(
      (l) => !affectedSheets.has(sheetKeyOf(l.stockId, l.sheetIndex)),
    );
    const retainedPlacements = previous.placements.filter(
      (p) => !affectedSheets.has(sheetKeyOf(p.stockId, p.sheetIndex)),
    );

    // 只取受影响图上、且零件本身没改的零件，保留它们的位置
    const changedKeys = new Set<string>();
    const instances = expand(project.parts).filter(({ part }) => stockById.has(part.stockId));
    const keyToInstance = new Map(instances.map((i) => [i.key, i]));
    const seeds: Placement[] = [];
    for (const p of previous.placements) {
      if (!affectedSheets.has(sheetKeyOf(p.stockId, p.sheetIndex))) continue;
      const instance = keyToInstance.get(p.key);
      if (instance && !changedSet.has(instance.part.id)) {
        seeds.push({ ...p, manual: !!manualPositions[p.key] });
      } else if (instance && changedSet.has(instance.part.id)) {
        changedKeys.add(p.key);
      }
    }

    // 被改 / 新增零件 + 受影响图上原有但现在没被保留的件，全部参与重排
    const toPack = instances.filter((i) => {
      if (changedSet.has(i.part.id)) return true;
      const prev = previous.placements.find((p) => p.key === i.key);
      if (!prev) return true; // 新增实例
      return affectedSheets.has(sheetKeyOf(prev.stockId, prev.sheetIndex))
        && !seeds.some((s) => s.key === i.key);
    });

    const { placements: repacked, unplaced } = this.packInstances(
      project,
      manualPositions,
      toPack,
      seeds,
      retainedPlacements,
    );

    const allPlacements = [...retainedPlacements, ...repacked];
    const collisions: string[] = [];
    allPlacements.forEach((p, i) => {
      allPlacements.slice(i + 1).forEach((o) => {
        if (collide(p, o, project.kerf)) collisions.push(`${p.key}|${o.key}`);
      });
    });

    // 组装排料图：沿用图保持 recomputed=false；重算 / 新建图 true
    const sheetKeys = new Set(allPlacements.map((p) => sheetKeyOf(p.stockId, p.sheetIndex)));
    const repackedSheetKeys = new Set(repacked.map((p) => sheetKeyOf(p.stockId, p.sheetIndex)));
    const layouts: SheetLayout[] = [];
    [...sheetKeys].sort().forEach((key) => {
      const [stockId, indexText] = key.split('@');
      const sheetIndex = Number(indexText);
      const existing = previous.layouts.find(
        (l) => sheetKeyOf(l.stockId, l.sheetIndex) === key,
      );
      const sheetPlacements = allPlacements.filter(
        (p) => p.stockId === stockId && p.sheetIndex === sheetIndex,
      );
      layouts.push(
        this.buildLayout(
          project,
          stockId,
          sheetIndex,
          sheetPlacements,
          repackedSheetKeys.has(key),
          existing ? existing : undefined,
        ),
      );
    });

    // 成本：只有重算 / 新建图按现价重算，沿用图使用已缓存成本（这里直接取 stock.price，
    // 价格变动属于全局变化会触发全量；沿用图价格因此必然未变）
    const usedArea = allPlacements.reduce((sum, p) => sum + p.width * p.height, 0);
    const sheetArea = layouts.reduce((sum, l) => sum + l.stock.length * l.stock.width, 0);
    const purchaseCost = layouts.reduce((sum, l) => sum + l.stock.price, 0);
    const result: NestingResult = {
      layouts,
      placements: allPlacements,
      totalParts: instances.length,
      placedParts: allPlacements.length,
      unplaced,
      usedArea,
      sheetArea,
      utilization: sheetArea > 0 ? (usedArea / sheetArea) * 100 : 0,
      wasteArea: layouts.reduce((sum, l) => sum + l.wasteArea, 0),
      purchaseCost,
      sheetCount: layouts.length,
      elapsedMs: Math.round((performance.now() - startedAt) * 10) / 10,
      collisions,
      incremental: {
        changedPartIds,
        reusedSheets: layouts.filter((l) => l.recomputed === false).map(layoutKey),
        recomputedSheets: layouts.filter((l) => l.recomputed).map(layoutKey),
        createdSheets: layouts
          .filter((l) => l.recomputed && !previous.layouts.some(
            (p) => sheetKeyOf(p.stockId, p.sheetIndex) === sheetKeyOf(l.stockId, l.sheetIndex),
          ))
          .map(layoutKey),
        costsRecomputed: true,
        fromCache: false,
        elapsedMs: 0,
      },
    };
    this.cache = { project, manualPositions, result };
    return result;
  }

  /* ----------------------------- 排料核心 ----------------------------- */

  private packAll(
    project: WoodworkingProject,
    manualPositions: Record<string, ManualPosition>,
    _seeds: null,
  ): NestingResult {
    const stockById = new Map(project.stocks.map((s) => [s.id, s]));
    const instances = expand(project.parts)
      .filter(({ part }) => stockById.has(part.stockId))
      .sort(compareInstances);
    const { placements, unplaced } = this.packInstances(project, manualPositions, instances, [], []);

    const collisions: string[] = [];
    placements.forEach((p, i) => {
      placements.slice(i + 1).forEach((o) => {
        if (collide(p, o, project.kerf)) collisions.push(`${p.key}|${o.key}`);
      });
    });

    const layouts = this.groupLayouts(project, placements);
    const usedArea = placements.reduce((sum, p) => sum + p.width * p.height, 0);
    const sheetArea = layouts.reduce((sum, l) => sum + l.stock.length * l.stock.width, 0);
    return {
      layouts,
      placements,
      totalParts: instances.length,
      placedParts: placements.length,
      unplaced,
      usedArea,
      sheetArea,
      utilization: sheetArea > 0 ? (usedArea / sheetArea) * 100 : 0,
      wasteArea: layouts.reduce((sum, l) => sum + l.wasteArea, 0),
      purchaseCost: layouts.reduce((sum, l) => sum + l.stock.price, 0),
      sheetCount: layouts.length,
      elapsedMs: 0,
      collisions,
    };
  }

  /**
   * 把 toPack 放进余料（seeds + retained 不动）所在的排料图，
   * 优先复用已有图的空位，放不下才追加新图。
   */
  private packInstances(
    project: WoodworkingProject,
    manualPositions: Record<string, ManualPosition>,
    toPack: ExpandedInstance[],
    seeds: Placement[],
    retained: Placement[],
  ): { placements: Placement[]; unplaced: NestingResult['unplaced'] } {
    const stockById = new Map(project.stocks.map((s) => [s.id, s]));
    const placements = seeds.map((p) => ({ ...p }));
    const occupied = [...retained, ...placements]; // 找位置时要避让所有既占位
    const unplaced: NestingResult['unplaced'] = [];
    const groupSize = new Map<string, number>();
    seeds.forEach((p) => groupSize.set(p.stockId, Math.max(groupSize.get(p.stockId) ?? 0, p.sheetIndex + 1)));
    retained.forEach((p) => groupSize.set(p.stockId, Math.max(groupSize.get(p.stockId) ?? 0, p.sheetIndex + 1)));

    for (const { part, instance, key } of toPack.slice().sort(compareInstances)) {
      const stock = stockById.get(part.stockId)!;

      // 手动微调优先：落在有效区域且不撞件则直接采用
      const manual = manualPositions[key];
      if (manual && manual.sheetIndex < 20) {
        const m = sizeOf(part, manual.rotated);
        const candidate: Placement = {
          key,
          partId: part.id,
          instance,
          stockId: stock.id,
          sheetIndex: manual.sheetIndex,
          x: manual.x,
          y: manual.y,
          width: m.width,
          height: m.height,
          rotated: manual.rotated,
          manual: true,
        };
        if (
          fitsSheet(candidate, stock, project.trim) &&
          !occupied.some((o) => o.key !== key && collide(candidate, o, project.kerf))
        ) {
          placements.push(candidate);
          occupied.push(candidate);
          groupSize.set(stock.id, Math.max(groupSize.get(stock.id) ?? 0, manual.sheetIndex + 1));
          continue;
        }
      }

      const candidates = part.grain === 'none' ? [false, true] : [part.grain === 'width'];
      let placed: Placement | null = null;
      for (const rotated of candidates) {
        const size = sizeOf(part, rotated);
        const sheets = groupSize.get(stock.id) ?? 0;
        for (let sheetIndex = 0; sheetIndex <= sheets && !placed; sheetIndex += 1) {
          const found = findSpot(size, stock, project.trim, project.kerf, occupied, stock.id, sheetIndex);
          if (found) {
            placed = {
              key,
              partId: part.id,
              instance,
              stockId: stock.id,
              sheetIndex,
              x: found.x,
              y: found.y,
              width: size.width,
              height: size.height,
              rotated,
              manual: false,
            };
          }
        }
        if (placed) break;
      }

      if (!placed) {
        unplaced.push({ partId: part.id, instance, reason: '尺寸超过板材可用区域或余料空间不足' });
        continue;
      }
      placements.push(placed);
      occupied.push(placed);
      groupSize.set(stock.id, Math.max(groupSize.get(stock.id) ?? 0, placed.sheetIndex + 1));
    }

    return { placements, unplaced };
  }

  private buildLayout(
    project: WoodworkingProject,
    stockId: string,
    sheetIndex: number,
    placements: Placement[],
    recomputed: boolean,
    previous?: SheetLayout,
  ): SheetLayout {
    const stock = project.stocks.find((s) => s.id === stockId) ?? previous?.stock!;
    const usedArea = placements.reduce((sum, p) => sum + p.width * p.height, 0);
    const usableArea = (stock.length - project.trim * 2) * (stock.width - project.trim * 2);
    return {
      stockId,
      sheetIndex,
      stock,
      placements,
      usedArea,
      usableArea,
      wasteArea: Math.max(0, usableArea - usedArea),
      recomputed,
    };
  }

  private groupLayouts(project: WoodworkingProject, placements: Placement[]): SheetLayout[] {
    const groups = new Map<string, number>();
    placements.forEach((p) => groups.set(p.stockId, Math.max(groups.get(p.stockId) ?? 0, p.sheetIndex + 1)));
    const layouts: SheetLayout[] = [];
    [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0])).forEach(([stockId, count]) => {
      for (let sheetIndex = 0; sheetIndex < count; sheetIndex += 1) {
        const sheetPlacements = placements.filter(
          (p) => p.stockId === stockId && p.sheetIndex === sheetIndex,
        );
        layouts.push(this.buildLayout(project, stockId, sheetIndex, sheetPlacements, true));
      }
    });
    return layouts;
  }
}

/* ----------------------------- 纯函数辅助 ----------------------------- */

function compareInstances(a: ExpandedInstance, b: ExpandedInstance) {
  const areaA = a.part.length * a.part.width;
  const areaB = b.part.length * b.part.width;
  if (a.part.grain !== 'none' && b.part.grain === 'none') return -1;
  if (a.part.grain === 'none' && b.part.grain !== 'none') return 1;
  return areaB - areaA || b.part.length - a.part.length || a.key.localeCompare(b.key);
}

function fitsSheet(p: Placement, stock: StockSheet, trim: number) {
  return (
    p.x >= trim - 0.001 &&
    p.y >= trim - 0.001 &&
    p.x + p.width <= stock.length - trim + 0.001 &&
    p.y + p.height <= stock.width - trim + 0.001
  );
}

/** 在指定一张图上扫描可用空位（行装算法，允许复用既有图的空位） */
function findSpot(
  size: { width: number; height: number },
  stock: StockSheet,
  trim: number,
  kerf: number,
  occupied: Placement[],
  stockId: string,
  sheetIndex: number,
): { x: number; y: number } | null {
  const usableWidth = stock.length - trim * 2;
  const usableHeight = stock.width - trim * 2;
  if (size.width > usableWidth || size.height > usableHeight) return null;

  const onSheet = occupied.filter((p) => p.stockId === stockId && p.sheetIndex === sheetIndex);
  if (onSheet.length === 0) return { x: trim, y: trim };

  const tryAt = (x: number, y: number) => {
    if (x + size.width > trim + usableWidth || y + size.height > trim + usableHeight) return false;
    const candidate: Placement = {
      key: '__probe__',
      partId: '',
      instance: -1,
      stockId,
      sheetIndex,
      x,
      y,
      width: size.width,
      height: size.height,
      rotated: false,
      manual: false,
    };
    return !onSheet.some((o) => collide(candidate, o, kerf));
  };

  // 候选锚点：原点、每个既占位的右缘与下缘（含锯缝）
  const anchors = new Set<string>([`${trim},${trim}`]);
  onSheet.forEach((p) => {
    anchors.add(`${p.x + p.width + kerf},${p.y}`);
    anchors.add(`${trim},${p.y + p.height + kerf}`);
    onSheet.forEach((q) => {
      anchors.add(`${p.x + p.width + kerf},${q.y}`);
      anchors.add(`${q.x},${p.y + p.height + kerf}`);
    });
  });
  const points = [...anchors]
    .map((text) => {
      const [x, y] = text.split(',').map(Number);
      return { x, y };
    })
    .sort((a, b) => (a.y - b.y) || (a.x - b.x));

  for (const point of points) {
    if (tryAt(point.x, point.y)) return point;
  }
  return null;
}

function applyManual(
  project: WoodworkingProject,
  placement: Placement,
  manualPositions: Record<string, ManualPosition>,
): Placement {
  const manual = manualPositions[placement.key];
  if (!manual || manual.sheetIndex >= 20) return placement;
  const part = project.parts.find((p) => p.id === placement.partId);
  if (!part) return placement;
  const size = sizeOf(part, manual.rotated);
  return {
    ...placement,
    sheetIndex: manual.sheetIndex,
    x: manual.x,
    y: manual.y,
    width: size.width,
    height: size.height,
    rotated: manual.rotated,
    manual: true,
  };
}

function sheetKeyOf(stockId: string, sheetIndex: number) {
  return `${stockId}@${sheetIndex}`;
}

function layoutKey(layout: SheetLayout) {
  return sheetKeyOf(layout.stockId, layout.sheetIndex);
}
