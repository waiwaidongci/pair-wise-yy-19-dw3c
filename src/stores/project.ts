import { atom } from 'jotai';
import { atomWithStorage } from 'jotai/utils';
import { createInitialProject } from '../utils/project';
import type { ManualPosition, WoodworkingProject } from '../types/woodworking';
import { IncrementalNestingEngine } from '../domain/incrementalNesting';

export const projectAtom = atomWithStorage<WoodworkingProject>(
  'joinery-nest:project',
  createInitialProject(),
);

export const manualPositionsAtom = atomWithStorage<Record<string, ManualPosition>>(
  'joinery-nest:manual',
  {},
);

export const selectedPartIdAtom = atom<string | null>('part-side-l');
export const selectedJointIdAtom = atom<string | null>(null);
export const revisionAtom = atom(0);

/**
 * 增量排料引擎为模块级单例：跨渲染保留上一次排料图，
 * 零件改动时只让依赖它的排料图和成本失效，其余沿用。
 */
const nestingEngine = new IncrementalNestingEngine();

export const nestingResultAtom = atom((get) =>
  nestingEngine.compute(get(projectAtom), get(manualPositionsAtom)),
);

/** 「重新排料」按钮调用：丢弃缓存整批重算 */
export const forceRenestAtom = atom(null, (get, set) => {
  nestingEngine.invalidate();
  set(manualPositionsAtom, {});
  set(revisionAtom, (value) => value + 1);
  void get;
});

export const selectedPartAtom = atom((get) => {
  const selectedId = get(selectedPartIdAtom);
  return get(projectAtom).parts.find((part) => part.id === selectedId) ?? null;
});

export const projectStatsAtom = atom((get) => {
  const project = get(projectAtom);
  const result = get(nestingResultAtom);
  const totalQuantity = project.parts.reduce((sum, part) => sum + part.quantity, 0);
  return {
    totalQuantity,
    partKinds: new Set(project.parts.map((part) => part.kind)).size,
    joints: project.joinery.reduce((sum, item) => sum + item.count, 0),
    result,
  };
});
