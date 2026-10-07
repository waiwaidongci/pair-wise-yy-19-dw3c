import { useState } from 'react';
import {
  Badge,
  Box,
  Button,
  Divider,
  Flex,
  FormControl,
  FormLabel,
  Grid,
  GridItem,
  HStack,
  NumberInput,
  NumberInputField,
  Progress,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  Tooltip,
} from '@chakra-ui/react';
import { AlertTriangle, RefreshCw, RotateCw } from 'lucide-react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { manualPositionsAtom, nestingResultAtom, projectAtom, revisionAtom } from '../stores/project';
import { NestingCanvas } from '../components/NestingCanvas';
import { formatArea } from '../utils/nesting';
import type { ManualPosition } from '../types/woodworking';

export function NestingView() {
  const [project, setProject] = useAtom(projectAtom);
  const [manualPositions, setManualPositions] = useAtom(manualPositionsAtom);
  const setRevision = useSetAtom(revisionAtom);
  const result = useAtomValue(nestingResultAtom);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const selected = result.placements.find((placement) => placement.key === selectedKey) ?? null;
  const selectedPart = project.parts.find((part) => part.id === selected?.partId) ?? null;

  const updateManual = (key: string, position: ManualPosition) => {
    setManualPositions((current) => ({ ...current, [key]: position }));
  };

  const rebuild = () => {
    setManualPositions({});
    setRevision((value) => value + 1);
    setSelectedKey(null);
  };

  return (
    <main className="page-shell">
      <Flex justify="space-between" align="end" mb="14px" gap="12px" wrap="wrap">
        <Box>
          <Text className="eyebrow">STEP 02 · 板材排料</Text>
          <Text className="page-title">排料图与利用率</Text>
          <Text className="page-desc">算法按纹理限制、锯缝和修边余量自动排布；拖动零件可做最后的人工调整。</Text>
        </Box>
        <Button colorScheme="teal" leftIcon={<RefreshCw size={16} />} onClick={rebuild}>重新排料</Button>
      </Flex>

      <SimpleGrid columns={{ base: 2, lg: 5 }} spacing="10px" mb="14px">
        <Metric label="板材用量" value={`${result.sheetCount} 张`} accent="teal" />
        <Metric label="材料利用率" value={`${result.utilization.toFixed(1)}%`} accent={result.utilization > 75 ? 'green' : 'orange'} />
        <Metric label="已排零件" value={`${result.placedParts}/${result.totalParts}`} accent={result.unplaced.length ? 'red' : 'blue'} />
        <Metric label="废料面积" value={formatArea(result.wasteArea)} accent="gray" />
        <Metric label="预计成本" value={`￥${result.purchaseCost.toFixed(0)}`} accent="purple" />
      </SimpleGrid>

      <Grid templateColumns={{ base: '1fr', xl: 'minmax(0, 1fr) 310px' }} gap="14px" alignItems="start">
        <NestingCanvas
          project={project}
          result={result}
          selectedKey={selectedKey}
          manualPositions={manualPositions}
          onSelect={setSelectedKey}
          onMove={updateManual}
        />

        <Stack spacing="12px">
          <Box borderWidth="1px" borderColor="slate.200" borderRadius="10px" bg="white" p="14px">
            <Text fontSize="12px" fontWeight="800" mb="10px">排料参数</Text>
            <Grid templateColumns="1fr 1fr" gap="10px">
              <FormControl>
                <FormLabel fontSize="10px">锯缝宽度 (mm)</FormLabel>
                <NumberInput min={0} max={12} step={0.1} value={project.kerf} onChange={(_, value) => setProject((current) => ({ ...current, kerf: value || 0 }))}>
                  <NumberInputField />
                </NumberInput>
              </FormControl>
              <FormControl>
                <FormLabel fontSize="10px">四周修边 (mm)</FormLabel>
                <NumberInput min={0} max={30} value={project.trim} onChange={(_, value) => setProject((current) => ({ ...current, trim: value || 0 }))}>
                  <NumberInputField />
                </NumberInput>
              </FormControl>
            </Grid>
            <Text mt="9px" fontSize="10px" color="slate.500">计算耗时 {result.elapsedMs} ms · 当前共 {project.parts.length} 个零件规格</Text>
          </Box>

          <Box borderWidth="1px" borderColor="slate.200" borderRadius="10px" bg="white" p="14px">
            <Flex justify="space-between" align="center" mb="10px">
              <Text fontSize="12px" fontWeight="800">手动微调</Text>
              {selected && <Badge colorScheme="teal">已选择</Badge>}
            </Flex>
            {selected && selectedPart ? (
              <Stack spacing="10px">
                <Text fontSize="13px" fontWeight="800">{selectedPart.name} #{selected.instance + 1}</Text>
                <Text fontSize="10px" color="slate.500">板材：{project.stocks.find((stock) => stock.id === selected.stockId)?.name} · 第 {selected.sheetIndex + 1} 张</Text>
                <Grid templateColumns="1fr 1fr" gap="8px">
                  <FormControl>
                    <FormLabel fontSize="10px">X 坐标 (mm)</FormLabel>
                    <NumberInput value={selected.x} step={5} min={0} onChange={(_, value) => updateManual(selected.key, { ...manualPositions[selected.key], sheetIndex: selected.sheetIndex, x: value || 0, y: selected.y, rotated: selected.rotated })}>
                      <NumberInputField />
                    </NumberInput>
                  </FormControl>
                  <FormControl>
                    <FormLabel fontSize="10px">Y 坐标 (mm)</FormLabel>
                    <NumberInput value={selected.y} step={5} min={0} onChange={(_, value) => updateManual(selected.key, { ...manualPositions[selected.key], sheetIndex: selected.sheetIndex, x: selected.x, y: value || 0, rotated: selected.rotated })}>
                      <NumberInputField />
                    </NumberInput>
                  </FormControl>
                </Grid>
                <HStack>
                  <Button size="xs" variant="outline" leftIcon={<RotateCw size={13} />} isDisabled={selectedPart.grain !== 'none'} onClick={() => updateManual(selected.key, {
                    sheetIndex: selected.sheetIndex,
                    x: selected.x,
                    y: selected.y,
                    rotated: !selected.rotated,
                  })}>
                    旋转 90°
                  </Button>
                  <Button size="xs" variant="ghost" onClick={() => {
                    setManualPositions((current) => {
                      const next = { ...current };
                      delete next[selected.key];
                      return next;
                    });
                  }}>恢复自动位置</Button>
                </HStack>
                {selectedPart.grain !== 'none' && (
                  <Text fontSize="10px" color="orange.600">该零件有纹理方向限制，不能旋转 90°。</Text>
                )}
              </Stack>
            ) : (
              <Text fontSize="11px" color="slate.500">在排料图中点选零件后，可输入精确坐标或旋转。</Text>
            )}
          </Box>

          <Box borderWidth="1px" borderColor="slate.200" borderRadius="10px" bg="white" p="14px">
            <Text fontSize="12px" fontWeight="800" mb="10px">板材规格</Text>
            <Stack spacing="9px">
              {project.stocks.map((stock) => (
                <Box key={stock.id}>
                  <Flex justify="space-between" gap="8px">
                    <Text fontSize="11px" fontWeight="750">{stock.name}</Text>
                    <Badge variant="outline">{stock.length}×{stock.width}</Badge>
                  </Flex>
                  <Progress mt="5px" size="xs" colorScheme="teal" value={Math.min(100, (result.layouts.filter((item) => item.stockId === stock.id).length / Math.max(1, stock.quantity)) * 100)} borderRadius="full" />
                </Box>
              ))}
            </Stack>
          </Box>

          {result.collisions.length > 0 && (
            <Box borderWidth="1px" borderColor="red.200" borderRadius="10px" bg="red.50" p="14px">
              <HStack color="red.700"><AlertTriangle size={17} /><Text fontSize="12px" fontWeight="800">发现 {result.collisions.length} 组重叠</Text></HStack>
              <Text mt="6px" fontSize="10px" color="red.700">红色零件与相邻件重叠，请拖动或输入坐标分离，至少保留 {project.kerf} mm 锯缝。</Text>
            </Box>
          )}
          {result.unplaced.length > 0 && (
            <Box borderWidth="1px" borderColor="orange.200" borderRadius="10px" bg="orange.50" p="14px">
              <Text fontSize="12px" fontWeight="800" color="orange.800">有 {result.unplaced.length} 件未排入</Text>
              {result.unplaced.map((item) => {
                const part = project.parts.find((candidate) => candidate.id === item.partId);
                return <Text key={`${item.partId}-${item.instance}`} mt="4px" fontSize="10px" color="orange.800">{part?.name}：{item.reason}</Text>;
              })}
            </Box>
          )}
        </Stack>
      </Grid>
    </main>
  );
}

function Metric({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <Box borderWidth="1px" borderColor="slate.200" borderRadius="10px" bg="white" p="12px">
      <Text fontSize="9px" color="slate.500" textTransform="uppercase" letterSpacing=".06em" fontWeight="800">{label}</Text>
      <Text mt="5px" fontSize="20px" fontWeight="900" color={`${accent}.700`}>{value}</Text>
    </Box>
  );
}

