import type { Joinery, Part } from '../types/woodworking';
import { JOINT_STRENGTH } from './project';

export function jointStrength(joints: Joinery[]) {
  if (!joints.length) return 0;
  const weighted = joints.reduce((sum, joint) => sum + JOINT_STRENGTH[joint.type].score * joint.count, 0);
  const count = joints.reduce((sum, joint) => sum + joint.count, 0);
  return Math.round(weighted / Math.max(1, count));
}

export function jointLabel(joint: Joinery, parts: Part[]) {
  const a = parts.find((part) => part.id === joint.partAId)?.name ?? '未知零件';
  const b = parts.find((part) => part.id === joint.partBId)?.name ?? '未知零件';
  return `${a} ↔ ${b}`;
}

export function validateJoins(joinery: Joinery[], parts: Part[]) {
  const errors: string[] = [];
  joinery.forEach((joint) => {
    if (joint.partAId === joint.partBId) errors.push(`${joint.type} 不能连接同一个零件`);
    const a = parts.find((part) => part.id === joint.partAId);
    const b = parts.find((part) => part.id === joint.partBId);
    if (!a || !b) errors.push('连接引用了已删除的零件');
    if (a && b && Math.max(a.thickness, b.thickness) < joint.depth * 0.65 && joint.type.includes('榫')) {
      errors.push(`${a.name} / ${b.name} 的榫深超过板厚安全范围`);
    }
  });
  return [...new Set(errors)];
}

