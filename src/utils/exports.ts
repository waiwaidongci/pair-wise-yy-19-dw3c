import type { NestingResult, WoodworkingProject } from '../types/woodworking';
import { formatArea } from './nesting';

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function downloadProject(project: WoodworkingProject) {
  downloadBlob(
    new Blob([JSON.stringify(project, null, 2)], { type: 'application/json;charset=utf-8' }),
    `${project.name}.joinery.json`,
  );
}

export function loadProjectFile(file: File): Promise<WoodworkingProject> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const project = JSON.parse(String(reader.result)) as WoodworkingProject;
        if (!Array.isArray(project.parts) || !Array.isArray(project.stocks)) throw new Error('文件结构不完整');
        resolve(project);
      } catch (error) {
        reject(error);
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

export function downloadCutList(project: WoodworkingProject) {
  const rows = [
    ['零件名', '类型', '材质', '长(mm)', '宽(mm)', '厚(mm)', '数量', '纹理', '封边', '备注'],
    ...project.parts.map((part) => {
      const stock = project.stocks.find((item) => item.id === part.stockId);
      return [
        part.name,
        part.kind,
        stock?.material ?? '',
        part.length,
        part.width,
        part.thickness,
        part.quantity,
        part.grain === 'length' ? '长边顺纹' : part.grain === 'width' ? '短边顺纹' : '不限',
        part.edgeBanding,
        part.notes,
      ];
    }),
  ];
  const csv = rows
    .map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(','))
    .join('\n');
  downloadBlob(new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' }), `${project.name}-零件表.csv`);
}

export function downloadPurchaseList(project: WoodworkingProject, result: NestingResult) {
  const stockCount = new Map<string, number>();
  result.layouts.forEach((layout) => stockCount.set(layout.stockId, (stockCount.get(layout.stockId) ?? 0) + 1));
  const lines = [
    `项目：${project.name}`,
    `客户 / 安装位置：${project.client} / ${project.sheet}`,
    `锯缝：${project.kerf} mm，四周修边：${project.trim} mm`,
    `预计板材：${result.sheetCount} 张，利用率：${result.utilization.toFixed(1)}%，废料：${formatArea(result.wasteArea)}`,
    `预计材料成本：￥${result.purchaseCost.toFixed(2)}`,
    '',
    ...project.stocks.map((stock) => {
      const count = stockCount.get(stock.id) ?? 0;
      return `${stock.name} | ${stock.material} | ${stock.length} × ${stock.width} × ${stock.thickness} mm | 排料需要 ${count} 张 | 单价 ￥${stock.price} | 小计 ￥${(count * stock.price).toFixed(2)}`;
    }),
    '',
    '采购说明：',
    '1. 同一材质的板材应尽量同批采购，避免色差。',
    '2. 到货后按排料图标号复核尺寸、翘曲和含水率。',
    '3. 开料前先进行四面修边，按实际锯片锯缝复核尺寸。',
    '4. 门板和桌面应在恒温环境存放 48 小时后再精裁。',
  ];
  downloadBlob(new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' }), `${project.name}-采购用料说明.txt`);
}

export function downloadNestingSvg(project: WoodworkingProject, result: NestingResult) {
  const margin = 30;
  const maxWidth = Math.max(900, ...result.layouts.map((layout) => layout.stock.length));
  let yOffset = 0;
  const pieces: string[] = [];
  result.layouts.forEach((layout) => {
    pieces.push(`<text x="0" y="${yOffset + 18}" font-size="14" font-family="sans-serif" font-weight="700">${layout.stock.name} · 第 ${layout.sheetIndex + 1} 张</text>`);
    pieces.push(`<rect x="0" y="${yOffset + 30}" width="${layout.stock.length}" height="${layout.stock.width}" fill="#f5e7c8" stroke="#8b6f47" stroke-width="3"/>`);
    pieces.push(`<rect x="${project.trim}" y="${yOffset + 30 + project.trim}" width="${layout.stock.length - project.trim * 2}" height="${layout.stock.width - project.trim * 2}" fill="none" stroke="#b79b70" stroke-dasharray="8 6"/>`);
    layout.placements.forEach((placement) => {
      const part = project.parts.find((item) => item.id === placement.partId);
      pieces.push(`<rect x="${placement.x}" y="${yOffset + 30 + placement.y}" width="${placement.width}" height="${placement.height}" fill="#d8b77e" stroke="#5f4935" stroke-width="1.5"/>`);
      pieces.push(`<text x="${placement.x + 6}" y="${yOffset + 30 + placement.y + 18}" font-size="12" font-family="sans-serif">${part?.name ?? ''}</text>`);
    });
    yOffset += layout.stock.width + 70;
  });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${maxWidth + margin * 2}" height="${yOffset + margin * 2}" viewBox="${-margin} ${-margin} ${maxWidth + margin * 2} ${yOffset + margin * 2}">
    <rect x="${-margin}" y="${-margin}" width="${maxWidth + margin * 2}" height="${yOffset + margin * 2}" fill="#fffdf8"/>
    ${pieces.join('\n')}
  </svg>`;
  downloadBlob(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }), `${project.name}-排料图.svg`);
}

