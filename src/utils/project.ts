import type {
  GrainDirection,
  Joinery,
  JointType,
  Part,
  PartKind,
  WoodworkingProject,
} from '../types/woodworking';

export const createId = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

export const GRAIN_LABELS: Record<GrainDirection, string> = {
  length: '长边顺纹',
  width: '短边顺纹',
  none: '不限方向',
};

export const PART_KINDS: PartKind[] = ['侧板', '顶底板', '门板', '背板', '搁板', '桌腿', '横撑', '抽屉件'];

export const JOINT_TYPES: JointType[] = ['直榫', '燕尾榫', '搭槽', '圆木榫', '饼干榫', '45°斜接'];

export const JOINT_STRENGTH: Record<JointType, { score: number; note: string; icon: string }> = {
  直榫: { score: 78, note: '抗拉稳定，适合横撑与腿足', icon: '⊞' },
  燕尾榫: { score: 95, note: '抗拉强，适合抽屉与箱体角接', icon: '⋈' },
  搭槽: { score: 82, note: '定位准确，适合柜体中隔板', icon: '▥' },
  圆木榫: { score: 66, note: '施工快速，适合定位辅助', icon: '••' },
  饼干榫: { score: 70, note: '适合板件平接与拼板定位', icon: '◖' },
  '45°斜接': { score: 58, note: '外观干净，需要内部加强', icon: '◇' },
};

export function createInitialProject(): WoodworkingProject {
  const stocks = [
    { id: 'stock-walnut', name: '黑胡桃拼板', material: '北美黑胡桃', length: 2440, width: 1220, thickness: 18, price: 980, quantity: 2 },
    { id: 'stock-walnut-25', name: '黑胡桃腿料板', material: '北美黑胡桃', length: 1200, width: 600, thickness: 25, price: 420, quantity: 1 },
    { id: 'stock-poplar', name: '杨木背板', material: '杨木多层板', length: 1220, width: 800, thickness: 18, price: 120, quantity: 1 },
    { id: 'stock-oak', name: '白橡木门板', material: '白橡木', length: 1500, width: 600, thickness: 20, price: 240, quantity: 1 },
  ];
  const parts: Part[] = [
    { id: 'part-side-l', name: '左侧板', kind: '侧板', stockId: 'stock-walnut', length: 720, width: 420, thickness: 18, quantity: 1, grain: 'length', edgeBanding: '前缘', notes: '与顶底板搭槽连接' },
    { id: 'part-side-r', name: '右侧板', kind: '侧板', stockId: 'stock-walnut', length: 720, width: 420, thickness: 18, quantity: 1, grain: 'length', edgeBanding: '前缘', notes: '与左侧板镜像' },
    { id: 'part-top', name: '顶板', kind: '顶底板', stockId: 'stock-walnut', length: 1080, width: 420, thickness: 18, quantity: 1, grain: 'length', edgeBanding: '四周', notes: '前缘圆角 R8' },
    { id: 'part-bottom', name: '底板', kind: '顶底板', stockId: 'stock-walnut', length: 1080, width: 420, thickness: 18, quantity: 1, grain: 'length', edgeBanding: '前缘', notes: '可拆卸结构' },
    { id: 'part-shelf', name: '活动搁板', kind: '搁板', stockId: 'stock-walnut', length: 1036, width: 390, thickness: 18, quantity: 2, grain: 'width', edgeBanding: '前缘', notes: '两侧各留 4 mm 活动间隙' },
    { id: 'part-back', name: '背板', kind: '背板', stockId: 'stock-poplar', length: 1080, width: 720, thickness: 18, quantity: 1, grain: 'length', edgeBanding: '无', notes: '背面开 6 mm 通气槽' },
    { id: 'part-door-l', name: '左门板', kind: '门板', stockId: 'stock-oak', length: 690, width: 530, thickness: 20, quantity: 1, grain: 'length', edgeBanding: '四周', notes: '与门框 45°斜接' },
    { id: 'part-door-r', name: '右门板', kind: '门板', stockId: 'stock-oak', length: 690, width: 530, thickness: 20, quantity: 1, grain: 'length', edgeBanding: '四周', notes: '与门框 45°斜接' },
    { id: 'part-leg-front-l', name: '左前腿', kind: '桌腿', stockId: 'stock-walnut-25', length: 760, width: 65, thickness: 25, quantity: 1, grain: 'length', edgeBanding: '无', notes: '底部收 6 mm' },
    { id: 'part-leg-front-r', name: '右前腿', kind: '桌腿', stockId: 'stock-walnut-25', length: 760, width: 65, thickness: 25, quantity: 1, grain: 'length', edgeBanding: '无', notes: '底部收 6 mm' },
    { id: 'part-rail-front', name: '前横撑', kind: '横撑', stockId: 'stock-walnut-25', length: 1020, width: 75, thickness: 25, quantity: 1, grain: 'length', edgeBanding: '无', notes: '两腿间直榫连接' },
  ];
  const joinery: Joinery[] = [
    { id: createId('joint'), partAId: 'part-side-l', partBId: 'part-top', type: '搭槽', count: 1, depth: 8, offset: 120, notes: '槽宽 18.2 mm，预留胶层' },
    { id: createId('joint'), partAId: 'part-side-r', partBId: 'part-bottom', type: '搭槽', count: 1, depth: 8, offset: 120, notes: '两侧同深' },
    { id: createId('joint'), partAId: 'part-side-l', partBId: 'part-shelf', type: '圆木榫', count: 4, depth: 12, offset: 50, notes: '可调孔位，孔距 32 mm' },
    { id: createId('joint'), partAId: 'part-door-l', partBId: 'part-door-r', type: '45°斜接', count: 1, depth: 0, offset: 0, notes: '内部加饼干榫定位' },
    { id: createId('joint'), partAId: 'part-leg-front-l', partBId: 'part-rail-front', type: '直榫', count: 1, depth: 32, offset: 18, notes: '榫厚 8 mm' },
  ];
  return {
    id: createId('project'),
    name: '胡桃木餐边柜',
    client: '林先生住宅项目',
    sheet: '一层餐厅',
    kerf: 3.2,
    trim: 8,
    stocks,
    parts,
    joinery,
    updatedAt: Date.now(),
  };
}
