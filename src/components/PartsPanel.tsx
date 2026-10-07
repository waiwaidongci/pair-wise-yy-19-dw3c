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
  IconButton,
  Input,
  NumberDecrementStepper,
  NumberIncrementStepper,
  NumberInput,
  NumberInputField,
  NumberInputStepper,
  Select,
  Stack,
  Text,
  Textarea,
  Tooltip,
  VStack,
} from '@chakra-ui/react';
import { Copy, Plus, Trash2 } from 'lucide-react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { projectAtom, selectedPartAtom, selectedPartIdAtom } from '../stores/project';
import { GRAIN_LABELS, PART_KINDS, createId } from '../utils/project';
import type { GrainDirection, PartKind } from '../types/woodworking';

export function PartsPanel() {
  const [project, setProject] = useAtom(projectAtom);
  const selectedPart = useAtomValue(selectedPartAtom);
  const setSelectedId = useSetAtom(selectedPartIdAtom);

  const updateSelected = (patch: Partial<typeof selectedPart>) => {
    if (!selectedPart) return;
    setProject((current) => ({
      ...current,
      updatedAt: Date.now(),
      parts: current.parts.map((part) => (part.id === selectedPart.id ? { ...part, ...patch } : part)),
    }));
  };

  const addPart = () => {
    const part = {
      id: createId('part'),
      name: '新零件',
      kind: '搁板' as PartKind,
      stockId: project.stocks[0]?.id ?? '',
      length: 500,
      width: 300,
      thickness: project.stocks[0]?.thickness ?? 18,
      quantity: 1,
      grain: 'length' as GrainDirection,
      edgeBanding: '前缘',
      notes: '',
    };
    setProject((current) => ({ ...current, parts: [...current.parts, part] }));
    setSelectedId(part.id);
  };

  const duplicatePart = () => {
    if (!selectedPart) return;
    const copy = { ...selectedPart, id: createId('part'), name: `${selectedPart.name} 副本` };
    setProject((current) => ({ ...current, parts: [...current.parts, copy] }));
    setSelectedId(copy.id);
  };

  const deletePart = () => {
    if (!selectedPart) return;
    setProject((current) => ({
      ...current,
      parts: current.parts.filter((part) => part.id !== selectedPart.id),
      joinery: current.joinery.filter(
        (joint) => joint.partAId !== selectedPart.id && joint.partBId !== selectedPart.id,
      ),
    }));
    setSelectedId(project.parts.find((part) => part.id !== selectedPart.id)?.id ?? null);
  };

  return (
    <Grid templateColumns={{ base: '1fr', xl: '300px minmax(0, 1fr)' }} gap="14px" h="100%">
      <Box borderWidth="1px" borderColor="slate.200" borderRadius="10px" bg="white" overflow="hidden">
        <Flex p="12px" align="center" justify="space-between" borderBottomWidth="1px">
          <Box>
            <Text fontSize="12px" fontWeight="800">零件明细</Text>
            <Text fontSize="10px" color="slate.500">{project.parts.length} 个规格 · {project.parts.reduce((sum, part) => sum + part.quantity, 0)} 件</Text>
          </Box>
          <Button size="xs" colorScheme="teal" leftIcon={<Plus size={14} />} onClick={addPart}>新增</Button>
        </Flex>
        <VStack align="stretch" gap="0" maxH="calc(100vh - 205px)" overflowY="auto">
          {project.parts.map((part) => (
            <button
              key={part.id}
              className={`part-list-item ${selectedPart?.id === part.id ? 'active' : ''}`}
              onClick={() => setSelectedId(part.id)}
            >
              <span>
                <b>{part.name}</b>
                <small>{part.length} × {part.width} × {part.thickness} mm</small>
              </span>
              <Badge colorScheme={part.grain === 'none' ? 'gray' : 'teal'}>×{part.quantity}</Badge>
            </button>
          ))}
        </VStack>
      </Box>

      <Box borderWidth="1px" borderColor="slate.200" borderRadius="10px" bg="white" p={{ base: '14px', xl: '20px' }} overflowY="auto">
        {selectedPart ? (
          <Stack spacing="18px">
            <Flex justify="space-between" align="start">
              <Box>
                <Text fontSize="10px" color="teal.700" fontWeight="800" letterSpacing=".1em" textTransform="uppercase">零件编辑器</Text>
                <Text fontSize="21px" fontWeight="850">{selectedPart.name}</Text>
                <HStack mt="5px">
                  <Badge colorScheme="teal">{selectedPart.kind}</Badge>
                  <Badge variant="outline">{project.stocks.find((stock) => stock.id === selectedPart.stockId)?.material}</Badge>
                </HStack>
              </Box>
              <HStack>
                <Tooltip label="复制零件">
                  <IconButton aria-label="复制零件" size="sm" icon={<Copy size={16} />} onClick={duplicatePart} />
                </Tooltip>
                <Tooltip label="删除零件及关联榫卯">
                  <IconButton aria-label="删除零件" size="sm" colorScheme="red" variant="outline" icon={<Trash2 size={16} />} onClick={deletePart} />
                </Tooltip>
              </HStack>
            </Flex>

            <Grid templateColumns={{ base: '1fr', md: 'repeat(2, 1fr)' }} gap="14px">
              <GridItem>
                <FormControl>
                  <FormLabel>零件名称</FormLabel>
                  <Input value={selectedPart.name} onChange={(event) => updateSelected({ name: event.target.value })} />
                </FormControl>
              </GridItem>
              <GridItem>
                <FormControl>
                  <FormLabel>零件类型</FormLabel>
                  <Select value={selectedPart.kind} onChange={(event) => updateSelected({ kind: event.target.value as PartKind })}>
                    {PART_KINDS.map((kind) => <option key={kind}>{kind}</option>)}
                  </Select>
                </FormControl>
              </GridItem>
              <GridItem colSpan={{ base: 1, md: 2 }}>
                <FormControl>
                  <FormLabel>所属板材</FormLabel>
                  <Select value={selectedPart.stockId} onChange={(event) => {
                    const stock = project.stocks.find((item) => item.id === event.target.value);
                    updateSelected({ stockId: event.target.value, thickness: stock?.thickness ?? selectedPart.thickness });
                  }}>
                    {project.stocks.map((stock) => (
                      <option key={stock.id} value={stock.id}>
                        {stock.name} · {stock.length}×{stock.width}×{stock.thickness} mm
                      </option>
                    ))}
                  </Select>
                </FormControl>
              </GridItem>
            </Grid>

            <Divider />
            <Text fontSize="12px" fontWeight="800">成品尺寸</Text>
            <Grid templateColumns={{ base: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' }} gap="12px">
              {([
                ['长 (mm)', 'length', 10],
                ['宽 (mm)', 'width', 10],
                ['厚 (mm)', 'thickness', 1],
                ['数量', 'quantity', 1],
              ] as const).map(([label, key, step]) => (
                <FormControl key={key}>
                  <FormLabel>{label}</FormLabel>
                  <NumberInput
                    min={1}
                    step={step}
                    value={selectedPart[key]}
                    onChange={(_, value) => updateSelected({ [key]: Number.isFinite(value) ? value : 1 })}
                  >
                    <NumberInputField />
                    <NumberInputStepper><NumberIncrementStepper /><NumberDecrementStepper /></NumberInputStepper>
                  </NumberInput>
                </FormControl>
              ))}
            </Grid>

            <Grid templateColumns={{ base: '1fr', md: 'repeat(2, 1fr)' }} gap="14px">
              <FormControl>
                <FormLabel>纹理方向</FormLabel>
                <Select value={selectedPart.grain} onChange={(event) => updateSelected({ grain: event.target.value as GrainDirection })}>
                  {Object.entries(GRAIN_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </Select>
              </FormControl>
              <FormControl>
                <FormLabel>封边要求</FormLabel>
                <Input value={selectedPart.edgeBanding} onChange={(event) => updateSelected({ edgeBanding: event.target.value })} />
              </FormControl>
            </Grid>
            <FormControl>
              <FormLabel>加工备注</FormLabel>
              <Textarea rows={3} value={selectedPart.notes} onChange={(event) => updateSelected({ notes: event.target.value })} />
            </FormControl>

            <Box p="12px" bg="teal.50" borderRadius="8px" borderWidth="1px" borderColor="teal.200">
              <Text fontSize="11px" fontWeight="800" color="teal.800">开料尺寸提示</Text>
              <Text mt="5px" fontSize="11px" color="teal.800">
                成品 {selectedPart.length} × {selectedPart.width} mm；若四边需要修整，请在开料时额外计入锯路与加工余量。
                纹理方向为“{GRAIN_LABELS[selectedPart.grain]}”，排料算法会据此限制旋转。
              </Text>
            </Box>
          </Stack>
        ) : (
          <Flex h="300px" align="center" justify="center" color="slate.500">选择或新增零件开始编辑</Flex>
        )}
      </Box>
    </Grid>
  );
}

