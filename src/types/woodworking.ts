export type GrainDirection = 'length' | 'width' | 'none';
export type PartKind = '侧板' | '顶底板' | '门板' | '背板' | '搁板' | '桌腿' | '横撑' | '抽屉件';

export type JointType = '直榫' | '燕尾榫' | '搭槽' | '圆木榫' | '饼干榫' | '45°斜接';

export interface StockSheet {
  id: string;
  name: string;
  material: string;
  length: number;
  width: number;
  thickness: number;
  price: number;
  quantity: number;
}

export interface Part {
  id: string;
  name: string;
  kind: PartKind;
  stockId: string;
  length: number;
  width: number;
  thickness: number;
  quantity: number;
  grain: GrainDirection;
  edgeBanding: string;
  notes: string;
}

export interface Joinery {
  id: string;
  partAId: string;
  partBId: string;
  type: JointType;
  count: number;
  depth: number;
  offset: number;
  notes: string;
}

export interface WoodworkingProject {
  id: string;
  name: string;
  client: string;
  sheet: string;
  kerf: number;
  trim: number;
  stocks: StockSheet[];
  parts: Part[];
  joinery: Joinery[];
  updatedAt: number;
}

export interface Placement {
  key: string;
  partId: string;
  instance: number;
  stockId: string;
  sheetIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  rotated: boolean;
  manual: boolean;
}

export interface SheetLayout {
  stockId: string;
  sheetIndex: number;
  stock: StockSheet;
  placements: Placement[];
  usedArea: number;
  usableArea: number;
  wasteArea: number;
  /** 本次更新中是否重算（false 表示沿用上一次结果） */
  recomputed?: boolean;
}

/** 增量排料统计：哪些排料图重算、哪些沿用 */
export interface IncrementalStats {
  /** null 表示全局参数变化导致全量重算 */
  changedPartIds: string[] | null;
  reusedSheets: string[];
  recomputedSheets: string[];
  createdSheets: string[];
  /** 受影响排料图的成本已重算；其余沿用 */
  costsRecomputed: boolean;
  fromCache: boolean;
  elapsedMs: number;
}

export interface NestingResult {
  layouts: SheetLayout[];
  placements: Placement[];
  totalParts: number;
  placedParts: number;
  unplaced: Array<{ partId: string; instance: number; reason: string }>;
  usedArea: number;
  sheetArea: number;
  utilization: number;
  wasteArea: number;
  purchaseCost: number;
  sheetCount: number;
  elapsedMs: number;
  collisions: string[];
  incremental?: IncrementalStats;
}

export interface ManualPosition {
  sheetIndex: number;
  x: number;
  y: number;
  rotated: boolean;
}

