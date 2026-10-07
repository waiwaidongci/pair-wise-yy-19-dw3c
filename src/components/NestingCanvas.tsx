import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { Box, Flex, HStack, Text } from '@chakra-ui/react';
import type { ManualPosition, NestingResult, WoodworkingProject } from '../types/woodworking';

interface NestingCanvasProps {
  project: WoodworkingProject;
  result: NestingResult;
  selectedKey: string | null;
  manualPositions: Record<string, ManualPosition>;
  onSelect: (key: string) => void;
  onMove: (key: string, position: ManualPosition) => void;
}

export function NestingCanvas({
  project,
  result,
  selectedKey,
  manualPositions,
  onSelect,
  onMove,
}: NestingCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(1000);
  const dragRef = useRef<{ key: string; offsetX: number; offsetY: number } | null>(null);
  const layoutHeights = result.layouts.map((layout) => Math.round((layout.stock.width / layout.stock.length) * width) + 62);
  const totalHeight = Math.max(520, layoutHeights.reduce((sum, height) => sum + height, 0) + 20);
  const layoutOffsets = useMemo(() => {
    let offset = 0;
    return result.layouts.map((layout) => {
      const current = { layout, offset };
      offset += Math.round((layout.stock.width / layout.stock.length) * width) + 62;
      return current;
    });
  }, [result.layouts, width]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(620, entry.contentRect.width)));
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = width * dpr;
    canvas.height = totalHeight * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${totalHeight}px`;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, totalHeight);
    context.fillStyle = '#eef2f5';
    context.fillRect(0, 0, width, totalHeight);

    layoutOffsets.forEach(({ layout, offset }) => {
      const scale = width / layout.stock.length;
      const sheetHeight = layout.stock.width * scale;
      context.save();
      context.translate(0, offset);
      context.fillStyle = '#334155';
      context.font = '800 12px "Avenir Next", sans-serif';
      context.fillText(`${layout.stock.name} · 第 ${layout.sheetIndex + 1} 张`, 12, 18);
      context.fillStyle = '#64748b';
      context.font = '10px "Avenir Next", sans-serif';
      context.fillText(`${layout.stock.length} × ${layout.stock.width} × ${layout.stock.thickness} mm`, 240, 18);

      context.fillStyle = '#f2dfb6';
      context.strokeStyle = '#8b6f47';
      context.lineWidth = 3;
      context.fillRect(0, 30, width, sheetHeight);
      context.strokeRect(0, 30, width, sheetHeight);

      context.setLineDash([6, 5]);
      context.strokeStyle = '#b59a72';
      context.lineWidth = 1;
      context.strokeRect(
        project.trim * scale,
        30 + project.trim * scale,
        (layout.stock.length - project.trim * 2) * scale,
        (layout.stock.width - project.trim * 2) * scale,
      );
      context.setLineDash([]);

      layout.placements.forEach((placement) => {
        const part = project.parts.find((item) => item.id === placement.partId);
        const selected = selectedKey === placement.key;
        const x = placement.x * scale;
        const y = 30 + placement.y * scale;
        const pieceWidth = placement.width * scale;
        const pieceHeight = placement.height * scale;
        const collision = result.collisions.some((pair) => pair.split('|').includes(placement.key));
        context.fillStyle = selected ? '#2c7a72' : collision ? '#e53e3e' : placement.manual ? '#c48850' : '#cda36a';
        context.strokeStyle = selected ? '#0f172a' : collision ? '#9b2c2c' : '#6e5136';
        context.lineWidth = selected ? 3 : 1.3;
        context.fillRect(x, y, pieceWidth, pieceHeight);
        context.strokeRect(x, y, pieceWidth, pieceHeight);
        if (pieceWidth > 45 && pieceHeight > 18) {
          context.save();
          context.beginPath();
          context.rect(x + 2, y + 2, pieceWidth - 4, pieceHeight - 4);
          context.clip();
          context.fillStyle = selected ? '#fff' : '#2f251b';
          context.font = '700 11px "Avenir Next", sans-serif';
          context.fillText(part?.name ?? placement.partId, x + 6, y + 15);
          context.font = '9px "Avenir Next", sans-serif';
          context.fillStyle = selected ? 'rgba(255,255,255,.85)' : 'rgba(47,37,27,.72)';
          context.fillText(`${placement.width}×${placement.height}${placement.rotated ? ' 旋转' : ''}`, x + 6, y + 28);
          context.restore();
        }
        if (placement.manual) {
          context.fillStyle = '#0f766e';
          context.beginPath();
          context.arc(x + pieceWidth - 7, y + 7, 4, 0, Math.PI * 2);
          context.fill();
        }
      });
      context.restore();
    });
  }, [layoutOffsets, project, result, selectedKey, totalHeight, width]);

  function toCanvasPoint(event: ReactPointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function findPlacement(point: { x: number; y: number }) {
    for (const { layout, offset } of layoutOffsets) {
      if (point.y < offset + 30 || point.y > offset + 30 + layout.stock.width * (width / layout.stock.length)) continue;
      const scale = width / layout.stock.length;
      return [...layout.placements].reverse().find((placement) => {
        const x = placement.x * scale;
        const y = offset + 30 + placement.y * scale;
        return point.x >= x && point.x <= x + placement.width * scale && point.y >= y && point.y <= y + placement.height * scale;
      }) ?? null;
    }
    return null;
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    const point = toCanvasPoint(event);
    const placement = findPlacement(point);
    if (!placement) return;
    onSelect(placement.key);
    const layout = result.layouts.find((item) => item.stockId === placement.stockId && item.sheetIndex === placement.sheetIndex);
    if (!layout) return;
    const scale = width / layout.stock.length;
    const x = placement.x * scale;
    const y = 30 + placement.y * scale;
    dragRef.current = { key: placement.key, offsetX: point.x - x, offsetY: point.y - y };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!dragRef.current) return;
    const placement = result.placements.find((item) => item.key === dragRef.current?.key);
    if (!placement) return;
    const layout = result.layouts.find((item) => item.stockId === placement.stockId && item.sheetIndex === placement.sheetIndex);
    if (!layout) return;
    const point = toCanvasPoint(event);
    const scale = width / layout.stock.length;
    const offset = layoutOffsets.find((item) => item.layout.stockId === layout.stockId && item.layout.sheetIndex === layout.sheetIndex)?.offset ?? 0;
    const x = Math.max(project.trim, Math.min(layout.stock.length - project.trim - placement.width, (point.x - dragRef.current.offsetX) / scale));
    const y = Math.max(project.trim, Math.min(layout.stock.width - project.trim - placement.height, (point.y - offset - 30 - dragRef.current.offsetY) / scale));
    onMove(placement.key, {
      sheetIndex: placement.sheetIndex,
      x: Math.round(x / 5) * 5,
      y: Math.round(y / 5) * 5,
      rotated: placement.rotated,
    });
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!dragRef.current) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    dragRef.current = null;
  }

  return (
    <Box ref={hostRef} borderWidth="1px" borderColor="slate.200" borderRadius="10px" bg="slate.100" overflow="auto" maxH="720px">
      {result.layouts.length ? (
        <canvas
          ref={canvasRef}
          style={{ display: 'block', cursor: 'grab', touchAction: 'none' }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        />
      ) : (
        <Flex h="320px" align="center" justify="center" color="slate.500">当前板材无法容纳任何零件</Flex>
      )}
      <HStack position="sticky" bottom="0" px="12px" py="7px" bg="rgba(255,255,255,.92)" borderTopWidth="1px" fontSize="10px" color="slate.600">
        <Text>拖动零件微调位置，自动吸附 5 mm</Text>
        <Text>● 橙色点表示手动位置</Text>
        {selectedKey && <Text color="teal.700">已选：{selectedKey}</Text>}
      </HStack>
    </Box>
  );
}

