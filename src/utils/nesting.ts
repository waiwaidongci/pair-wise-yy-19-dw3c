import type {
  ManualPosition,
  NestingResult,
  Part,
  Placement,
  SheetLayout,
  StockSheet,
  WoodworkingProject,
} from '../types/woodworking';

function expandedParts(parts: Part[]) {
  return parts.flatMap((part) =>
    Array.from({ length: Math.max(1, part.quantity) }, (_, instance) => ({ part, instance })),
  );
}

function canRotate(part: Part) {
  return part.grain === 'none';
}

function dimensions(part: Part, rotated: boolean) {
  return rotated
    ? { width: part.width, height: part.length }
    : { width: part.length, height: part.width };
}

function overlaps(a: Placement, b: Placement) {
  if (a.sheetIndex !== b.sheetIndex || a.stockId !== b.stockId) return false;
  return !(
    a.x + a.width <= b.x ||
    b.x + b.width <= a.x ||
    a.y + a.height <= b.y ||
    b.y + b.height <= a.y
  );
}

export function getPartPlacementSize(part: Part, rotated = false) {
  return dimensions(part, rotated);
}

export function nestProject(
  project: WoodworkingProject,
  manualPositions: Record<string, ManualPosition>,
): NestingResult {
  const startedAt = performance.now();
  const stockById = new Map(project.stocks.map((stock) => [stock.id, stock]));
  const expanded = expandedParts(project.parts)
    .filter(({ part }) => stockById.has(part.stockId))
    .sort((a, b) => {
      const areaA = a.part.length * a.part.width;
      const areaB = b.part.length * b.part.width;
      if (a.part.grain !== 'none' && b.part.grain === 'none') return -1;
      if (a.part.grain === 'none' && b.part.grain !== 'none') return 1;
      return areaB - areaA || b.part.length - a.part.length;
    });

  const placements: Placement[] = [];
  const unplaced: NestingResult['unplaced'] = [];
  const sheetCounter = new Map<string, number>();

  expanded.forEach(({ part, instance }) => {
    const stock = stockById.get(part.stockId)!;
    const usableWidth = stock.length - project.trim * 2;
    const usableHeight = stock.width - project.trim * 2;
    const candidates = part.grain === 'none' ? [false, true] : [part.grain === 'width'];
    let placed: Placement | null = null;

    for (const rotated of candidates) {
      const size = dimensions(part, rotated);
      if (size.width > usableWidth || size.height > usableHeight) continue;
      const availableSheets = Math.max(1, sheetCounter.get(stock.id) ?? 0);
      for (let sheetIndex = 0; sheetIndex <= availableSheets && !placed; sheetIndex += 1) {
        const sheetPlacements = placements.filter(
          (item) => item.stockId === stock.id && item.sheetIndex === sheetIndex,
        );
        const rows = new Map<number, { y: number; height: number; usedWidth: number }>();
        sheetPlacements.forEach((item) => {
          const row = rows.get(item.y) ?? { y: item.y, height: 0, usedWidth: 0 };
          row.height = Math.max(row.height, item.height);
          row.usedWidth = Math.max(row.usedWidth, item.x - project.trim + item.width);
          rows.set(item.y, row);
        });

        for (const row of [...rows.values()].sort((a, b) => a.y - b.y)) {
          if (size.height > row.height + 0.001) continue;
          const x = project.trim + row.usedWidth + (row.usedWidth > 0 ? project.kerf : 0);
          if (x + size.width > project.trim + usableWidth) continue;
          placed = {
            key: `${part.id}:${instance}`,
            partId: part.id,
            instance,
            stockId: stock.id,
            sheetIndex,
            x,
            y: row.y,
            width: size.width,
            height: size.height,
            rotated,
            manual: false,
          };
          row.usedWidth = row.usedWidth + (row.usedWidth > 0 ? project.kerf : 0) + size.width;
          break;
        }

        if (!placed) {
          const sortedRows = [...rows.values()].sort((a, b) => a.y - b.y);
          const lastRow = sortedRows.at(-1);
          const y = lastRow ? lastRow.y + lastRow.height + project.kerf : project.trim;
          if (y + size.height <= project.trim + usableHeight) {
            placed = {
              key: `${part.id}:${instance}`,
              partId: part.id,
              instance,
              stockId: stock.id,
              sheetIndex,
              x: project.trim,
              y,
              width: size.width,
              height: size.height,
              rotated,
              manual: false,
            };
          }
        }

        if (placed) {
          sheetCounter.set(stock.id, Math.max(sheetCounter.get(stock.id) ?? 0, sheetIndex + 1));
        }
      }
      if (placed) break;
    }

    if (!placed) {
      unplaced.push({ partId: part.id, instance, reason: '尺寸超过板材可用区域' });
      return;
    }

    const manual = manualPositions[placed.key];
    if (manual && manual.sheetIndex < 20) {
      const size = dimensions(part, manual.rotated);
      placements.push({
        ...placed,
        sheetIndex: manual.sheetIndex,
        x: manual.x,
        y: manual.y,
        width: size.width,
        height: size.height,
        rotated: manual.rotated,
        manual: true,
      });
      sheetCounter.set(placed.stockId, Math.max(sheetCounter.get(placed.stockId) ?? 0, manual.sheetIndex + 1));
    } else {
      placements.push(placed);
    }
  });

  const collisions: string[] = [];
  placements.forEach((placement, index) => {
    placements.slice(index + 1).forEach((other) => {
      if (overlaps(placement, other)) collisions.push(`${placement.key}|${other.key}`);
    });
  });

  const layouts: SheetLayout[] = [];
  sheetCounter.forEach((count, stockId) => {
    const stock = stockById.get(stockId);
    if (!stock) return;
    for (let sheetIndex = 0; sheetIndex < count; sheetIndex += 1) {
      const sheetPlacements = placements.filter(
        (item) => item.stockId === stockId && item.sheetIndex === sheetIndex,
      );
      const usedArea = sheetPlacements.reduce((sum, item) => sum + item.width * item.height, 0);
      const usableArea = (stock.length - project.trim * 2) * (stock.width - project.trim * 2);
      layouts.push({
        stockId,
        sheetIndex,
        stock,
        placements: sheetPlacements,
        usedArea,
        usableArea,
        wasteArea: Math.max(0, usableArea - usedArea),
      });
    }
  });

  const usedArea = placements.reduce((sum, item) => sum + item.width * item.height, 0);
  const sheetArea = layouts.reduce((sum, layout) => sum + layout.stock.length * layout.stock.width, 0);
  const purchaseCost = layouts.reduce((sum, layout) => sum + layout.stock.price, 0);
  const utilization = sheetArea > 0 ? (usedArea / sheetArea) * 100 : 0;

  return {
    layouts,
    placements,
    totalParts: expanded.length,
    placedParts: placements.length,
    unplaced,
    usedArea,
    sheetArea,
    utilization,
    wasteArea: layouts.reduce((sum, layout) => sum + layout.wasteArea, 0),
    purchaseCost,
    sheetCount: layouts.length,
    elapsedMs: Math.round((performance.now() - startedAt) * 10) / 10,
    collisions,
  };
}

export function formatArea(area: number) {
  return `${(area / 1_000_000).toFixed(2)} m²`;
}
