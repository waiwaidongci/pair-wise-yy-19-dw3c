import { useRef, useState } from 'react';
import {
  Badge,
  Box,
  Button,
  Divider,
  Flex,
  Grid,
  HStack,
  SimpleGrid,
  Stack,
  Table,
  TableContainer,
  Tbody,
  Td,
  Text,
  Th,
  Thead,
  Tr,
  useToast,
} from '@chakra-ui/react';
import { Download, FileDown, FileJson, FileText, Image, Upload } from 'lucide-react';
import { useAtomValue, useSetAtom } from 'jotai';
import { nestingResultAtom, projectAtom, selectedPartIdAtom } from '../stores/project';
import {
  downloadCutList,
  downloadNestingSvg,
  downloadProject,
  downloadPurchaseList,
  loadProjectFile,
} from '../utils/exports';
import { formatArea } from '../utils/nesting';

export function ExportView() {
  const project = useAtomValue(projectAtom);
  const result = useAtomValue(nestingResultAtom);
  const setProject = useSetAtom(projectAtom);
  const setSelectedId = useSetAtom(selectedPartIdAtom);
  const fileRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const toast = useToast();

  const loadFile = async (file: File | undefined) => {
    if (!file) return;
    setLoading(true);
    try {
      const loaded = await loadProjectFile(file);
      setProject(loaded);
      setSelectedId(loaded.parts[0]?.id ?? null);
      toast({ title: '项目已载入', description: `${loaded.name} · ${loaded.parts.length} 个零件规格`, status: 'success' });
    } catch {
      toast({ title: '无法载入项目', description: '请选择由本工具导出的 .joinery.json 文件。', status: 'error' });
    } finally {
      setLoading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <main className="page-shell">
      <Box mb="14px">
        <Text className="eyebrow">STEP 03 · 交付文件</Text>
        <Text className="page-title">切割清单与采购说明</Text>
        <Text className="page-desc">零件和连接变更已同步到清单及排料结果，可分别交给开料工、采购人员和安装现场。</Text>
      </Box>

      <SimpleGrid columns={{ base: 1, md: 4 }} spacing="10px" mb="14px">
        <ExportCard icon={<FileText />} title="零件表" description="尺寸、数量、材质、纹理和封边要求" action="导出 CSV" onClick={() => downloadCutList(project)} />
        <ExportCard icon={<Image />} title="排料图" description={`${result.sheetCount} 张板 · 利用率 ${result.utilization.toFixed(1)}%`} action="导出 SVG" onClick={() => downloadNestingSvg(project, result)} />
        <ExportCard icon={<Download />} title="采购用料说明" description={`预计 ￥${result.purchaseCost.toFixed(0)} · 废料 ${formatArea(result.wasteArea)}`} action="导出 TXT" onClick={() => downloadPurchaseList(project, result)} />
        <ExportCard icon={<FileJson />} title="项目文件" description="保留全部零件、榫卯和板材参数" action="保存 JSON" onClick={() => downloadProject(project)} />
      </SimpleGrid>

      <Grid templateColumns={{ base: '1fr', xl: 'minmax(0, 1fr) 300px' }} gap="14px" alignItems="start">
        <Box borderWidth="1px" borderColor="slate.200" borderRadius="10px" bg="white" overflow="hidden">
          <Flex p="13px" justify="space-between" align="center" borderBottomWidth="1px">
            <Box>
              <Text fontSize="12px" fontWeight="800">切割清单</Text>
              <Text fontSize="10px" color="slate.500">{project.parts.length} 个规格 · {result.totalParts} 件成品</Text>
            </Box>
            <Badge colorScheme={result.unplaced.length || result.collisions.length ? 'red' : 'green'}>
              {result.unplaced.length || result.collisions.length ? '排料需复核' : '排料可行'}
            </Badge>
          </Flex>
          <TableContainer maxH="620px" overflowY="auto">
            <Table size="sm">
              <Thead position="sticky" top="0" bg="slate.100" zIndex="1">
                <Tr>
                  <Th>零件</Th>
                  <Th>材质 / 板材</Th>
                  <Th isNumeric>长</Th>
                  <Th isNumeric>宽</Th>
                  <Th isNumeric>厚</Th>
                  <Th isNumeric>数量</Th>
                  <Th>纹理</Th>
                  <Th>封边</Th>
                </Tr>
              </Thead>
              <Tbody>
                {project.parts.map((part) => {
                  const stock = project.stocks.find((item) => item.id === part.stockId);
                  return (
                    <Tr key={part.id} cursor="pointer" onClick={() => setSelectedId(part.id)} _hover={{ bg: 'teal.50' }}>
                      <Td><Text fontSize="11px" fontWeight="750">{part.name}</Text><Text fontSize="9px" color="slate.500">{part.kind}</Text></Td>
                      <Td><Text fontSize="10px">{stock?.material}</Text><Text fontSize="9px" color="slate.500">{stock?.name}</Text></Td>
                      <Td isNumeric fontSize="10px">{part.length}</Td>
                      <Td isNumeric fontSize="10px">{part.width}</Td>
                      <Td isNumeric fontSize="10px">{part.thickness}</Td>
                      <Td isNumeric fontSize="10px" fontWeight="800">{part.quantity}</Td>
                      <Td><Badge variant="outline" fontSize="9px">{part.grain === 'length' ? '长边' : part.grain === 'width' ? '短边' : '不限'}</Badge></Td>
                      <Td fontSize="10px">{part.edgeBanding}</Td>
                    </Tr>
                  );
                })}
              </Tbody>
            </Table>
          </TableContainer>
        </Box>

        <Stack spacing="12px">
          <Box borderWidth="1px" borderColor="slate.200" borderRadius="10px" bg="white" p="14px">
            <Text fontSize="12px" fontWeight="800">项目文件</Text>
            <Text mt="5px" fontSize="10px" color="slate.500">载入 JSON 会替换当前编辑项目，浏览器中的自动保存也会同步更新。</Text>
            <input
              ref={fileRef}
              hidden
              type="file"
              accept=".json,.joinery.json,application/json"
              onChange={(event) => loadFile(event.target.files?.[0])}
            />
            <Button mt="12px" width="100%" variant="outline" leftIcon={<Upload size={15} />} isLoading={loading} onClick={() => fileRef.current?.click()}>
              载入项目文件
            </Button>
          </Box>

          <Box borderWidth="1px" borderColor="slate.200" borderRadius="10px" bg="teal.900" color="white" p="14px">
            <Text fontSize="12px" fontWeight="800">采购摘要</Text>
            <Text mt="10px" fontSize="28px" fontWeight="900">{result.sheetCount}<span style={{ fontSize: 12 }}> 张板材</span></Text>
            <Divider my="10px" borderColor="teal.700" />
            <HStack justify="space-between" fontSize="11px"><span>材料利用率</span><b>{result.utilization.toFixed(1)}%</b></HStack>
            <HStack mt="7px" justify="space-between" fontSize="11px"><span>废料面积</span><b>{formatArea(result.wasteArea)}</b></HStack>
            <HStack mt="7px" justify="space-between" fontSize="11px"><span>预计成本</span><b>￥{result.purchaseCost.toFixed(2)}</b></HStack>
          </Box>

          <Box borderWidth="1px" borderColor="slate.200" borderRadius="10px" bg="white" p="14px">
            <HStack><FileDown size={16} /><Text fontSize="12px" fontWeight="800">开料提示</Text></HStack>
            <Stack mt="10px" spacing="7px" fontSize="10px" color="slate.600">
              <Text>• 先按整张板材修边，再按排料顺序开料。</Text>
              <Text>• 每片零件保留 5–10 mm 精裁余量。</Text>
              <Text>• 纹理相同零件连续加工，减少色差。</Text>
              <Text>• 门板与桌面应在恒温环境静置后再精修。</Text>
            </Stack>
          </Box>
        </Stack>
      </Grid>
    </main>
  );
}

function ExportCard({
  icon,
  title,
  description,
  action,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  action: string;
  onClick: () => void;
}) {
  return (
    <Box borderWidth="1px" borderColor="slate.200" borderRadius="10px" bg="white" p="14px">
      <Box color="teal.700" w="30px">{icon}</Box>
      <Text mt="9px" fontSize="12px" fontWeight="800">{title}</Text>
      <Text mt="4px" fontSize="10px" color="slate.500" minH="30px">{description}</Text>
      <Button mt="9px" width="100%" size="xs" variant="outline" colorScheme="teal" onClick={onClick}>{action}</Button>
    </Box>
  );
}

