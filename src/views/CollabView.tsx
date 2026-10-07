import { useEffect, useMemo, useState } from 'react';
import {
  Badge,
  Box,
  Button,
  Divider,
  Flex,
  FormControl,
  FormLabel,
  Grid,
  HStack,
  NumberInput,
  NumberInputField,
  Select,
  SimpleGrid,
  Stack,
  Stat,
  StatLabel,
  StatNumber,
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
import { CheckCircle2, CloudOff, Cloudy, History, Link2, Lock, LogIn, LogOut, Play, RefreshCw, RotateCcw, Save, Scissors, Sparkles, Users, XCircle } from 'lucide-react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { manualPositionsAtom, projectAtom } from '../stores/project';
import {
  nestingCacheAtom,
  offcutStateAtom,
  recoveryAtom,
  syncBaseAtom,
  syncConflictsAtom,
  syncLogAtom,
  syncRemoteAtom,
  syncStatusAtom,
  type SyncConflict,
} from '../stores/collab';
import {
  claimOffcut,
  registerOffcut,
  releaseOffcut,
  useOffcut,
  occupiedSlots,
  type OffcutState,
} from '../lib/offcuts';
import { getNestingWithCache } from '../lib/nestingCache';
import { commit, type Mutation } from '../lib/recovery';
import { applyPartsToProject, applyResolution, mergeSnapshots, snapshotFromProject } from '../lib/syncDemo';
import type { Offcut } from '../types/offcut';
import type { Part } from '../types/woodworking';

const WORKER_A = '甲';
const WORKER_B = '乙';

export function CollabView() {
  const toast = useToast();
  const [project, setProject] = useAtom(projectAtom);
  const [offcutState, setOffcutState] = useAtom(offcutStateAtom);
  const manualPositions = useAtomValue(manualPositionsAtom);
  const [cache, setCache] = useAtom(nestingCacheAtom);
  const [recovery, setRecovery] = useAtom(recoveryAtom);
  const [syncBase, setSyncBase] = useAtom(syncBaseAtom);
  const [syncRemote, setSyncRemote] = useAtom(syncRemoteAtom);
  const [syncStatus, setSyncStatus] = useAtom(syncStatusAtom);
  const [conflicts, setConflicts] = useAtom(syncConflictsAtom);
  const [syncLog, setSyncLog] = useAtom(syncLogAtom);

  // 增量排料：零件改动只失效重算依赖它的板材，其余沿用
  const [outcome, setOutcome] = useState(() => getNestingWithCache(project, manualPositions, cache, Date.now()));
  useEffect(() => {
    const next = getNestingWithCache(project, manualPositions, cache, Date.now());
    setOutcome(next);
    if (next.recomputedStocks.length > 0 || next.costRecomputed) {
      setCache(next.cache);
    }
  }, [project, manualPositions, cache, setCache]);

  // 断网快照初始化：以当前项目与余料台账为基准
  useEffect(() => {
    if (syncBase === null) {
      const snap = snapshotFromProject(project, offcutState.offcuts);
      setSyncBase(snap);
      setSyncRemote(snap);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const base = syncBase ?? snapshotFromProject(project, offcutState.offcuts);
  const remote = syncRemote ?? base;
  const localSnap = snapshotFromProject(project, offcutState.offcuts);

  // ---- 余料登记表单 ----
  const [form, setForm] = useState({
    id: '',
    length: 800,
    width: 200,
    thickness: 18,
    material: project.stocks[0]?.material ?? '北美黑胡桃',
    source: '工单-001',
  });

  const register = () => {
    const { state, result } = registerOffcut(
      offcutState,
      { id: form.id, length: form.length, width: form.width, thickness: form.thickness, material: form.material, source: form.source },
      WORKER_A,
      Date.now(),
    );
    setOffcutState(state);
    if (result.kind === 'stored') {
      toast({ title: '余料已登记入库', description: `编号 ${result.offcut.id}，位号 ${result.offcut.slot! + 1}`, status: 'success' });
    } else if (result.kind === 'queued') {
      toast({ title: '位满，已排队等位', description: `编号 ${result.offcut.id}，队列第 ${result.position} 位，空位后自动补位`, status: 'warning' });
    } else {
      toast({ title: '编号已存在', description: `${result.offcut.id} 已在库，同一编号只入库一次`, status: 'info' });
    }
    setForm((f) => ({ ...f, id: '' }));
  };

  const claim = (offcutId: string, worker: string) => {
    const { state, result } = claimOffcut(offcutState, offcutId, worker, Date.now());
    setOffcutState(state);
    if (result.kind === 'claimed') {
      toast({ title: `${worker} 已占用`, description: `${result.offcut.id} 归属 ${worker}`, status: 'success' });
    } else if (result.kind === 'taken') {
      toast({ title: '已被先到者占用', description: `${result.by} 已于 ${new Date(result.at).toLocaleTimeString()} 占用，请改选别的料`, status: 'error' });
    } else {
      toast({ title: '无法占用', description: `当前状态：${result.kind === 'unavailable' ? result.status : '不存在'}`, status: 'warning' });
    }
  };

  const release = (offcutId: string) => {
    const { state, result } = releaseOffcut(offcutState, offcutId, WORKER_A, Date.now());
    setOffcutState(state);
    if (result.kind === 'released') {
      toast({ title: '已释放', description: `${result.offcut.id} 回到在架`, status: 'success' });
    } else if (result.kind === 'not-owner') {
      toast({ title: '无法释放', description: `只有占用者 ${result.by} 能释放`, status: 'warning' });
    }
  };

  const consume = (offcutId: string) => {
    const { state, result } = useOffcut(offcutState, offcutId, WORKER_A, Date.now());
    setOffcutState(state);
    if (result.kind === 'used' && result.admitted) {
      toast({ title: '余料已领用', description: `${result.admitted.id} 等位补位，位号 ${result.admitted.slot! + 1}`, status: 'success' });
    }
  };

  // ---- 依赖重算：改零件尺寸 ----
  const [selectedPartId, setSelectedPartId] = useState<string>(project.parts[0]?.id ?? '');
  const selectedPart = project.parts.find((p) => p.id === selectedPartId) ?? null;
  useEffect(() => {
    if (!selectedPart && project.parts.length) setSelectedPartId(project.parts[0].id);
  }, [selectedPart, project.parts]);
  const updatePartSize = (patch: Partial<Part>) => {
    if (!selectedPart) return;
    setProject((current) => ({
      ...current,
      updatedAt: Date.now(),
      parts: current.parts.map((p) => (p.id === selectedPart.id ? { ...p, ...patch } : p)),
    }));
  };

  // ---- 断网同步 ----
  const toggleOffline = () => {
    setSyncStatus((s) => (s === 'online' ? 'offline' : 'online'));
    if (syncStatus === 'online') {
      setSyncLog((log) => [{ at: Date.now(), message: '已断网：本机改动暂存本地' }, ...log]);
    } else {
      setSyncLog((log) => [{ at: Date.now(), message: '已回网：可合并本机与远程改动' }, ...log]);
    }
  };

  const simulateRemoteEdit = () => {
    const target = selectedPart ?? project.parts[0];
    if (!target) return;
    const updated = { ...target, length: Math.round((target.length + 60) * 10) / 10 };
    setSyncRemote((remoteSnap) => {
      const baseSnap = remoteSnap ?? base;
      return { ...baseSnap, parts: { ...baseSnap.parts, [target.id]: updated } };
    });
    setSyncLog((log) => [{ at: Date.now(), message: `同事乙离线修改「${target.name}」长度 → ${updated.length} mm` }, ...log]);
    toast({ title: '远程已有新改动', description: `乙改了「${target.name}」，回网合并时若本机也改过该件将进入冲突待处置`, status: 'info' });
  };

  const mergeSync = () => {
    const { merged, conflicts: newConflicts, adoptedCount } = mergeSnapshots(base, localSnap, remote);
    setProject((current) => applyPartsToProject(current, merged.parts));
    setOffcutState((current) => ({
      ...current,
      offcuts: merged.offcuts,
      waitlist: current.waitlist.filter((id) => merged.offcuts[id]?.status === 'queued'),
    }));
    setSyncBase(merged);
    setSyncRemote(merged);
    setConflicts((prev) => [...prev.filter((c) => !newConflicts.some((n) => n.id === c.id && n.field === c.field)), ...newConflicts]);
    setSyncLog((log) => [
      { at: Date.now(), message: `合并完成：${adoptedCount} 项采用单边，${newConflicts.length} 项冲突待处置` },
      ...log,
    ]);
    if (newConflicts.length) {
      toast({ title: '合并完成，有待处置冲突', description: `${newConflicts.length} 条记录两边都改过，已各留一份`, status: 'warning' });
    } else {
      toast({ title: '合并完成', description: '无冲突，单边改动已采用', status: 'success' });
    }
  };

  const resolveConflict = (conflict: SyncConflict, resolution: 'take-local' | 'take-remote' | 'keep-both') => {
    const next = applyResolution(base, conflict, resolution);
    setProject((current) => applyPartsToProject(current, next.parts));
    setOffcutState((current) => ({ ...current, offcuts: next.offcuts }));
    setSyncBase(next);
    setSyncRemote(next);
    setConflicts((prev) => prev.filter((c) => !(c.id === conflict.id && c.field === conflict.field)));
    const label = resolution === 'take-local' ? '保留本地' : resolution === 'take-remote' ? '保留远程' : '两边都留';
    setSyncLog((log) => [{ at: Date.now(), message: `处置冲突 ${conflict.id}：${label}` }, ...log]);
  };

  // ---- 写入恢复演示 ----
  const [recoverySeq, setRecoverySeq] = useState(1);
  const buildRecoveryMutations = (): { mutations: Mutation<OffcutState>[]; key: string } => {
    const key = `offcut-恢-${String(recoverySeq).padStart(3, '0')}`;
    const offcut: Offcut = {
      id: key,
      length: 600 + recoverySeq * 10,
      width: 200,
      thickness: 18,
      material: '北美黑胡桃',
      source: '恢复演示',
      status: 'available',
      slot: null,
      claimedBy: null,
      claimedAt: null,
      version: 1,
      createdAt: Date.now(),
    };
    const mutations: Mutation<OffcutState>[] = [
      {
        key,
        label: `登记余料 ${key}`,
        apply: (draft) => ({ ...draft, offcuts: { ...draft.offcuts, [key]: offcut } }),
      },
    ];
    return { mutations, key };
  };

  const recoveryRegister = (injectFail: boolean) => {
    const { mutations, key } = buildRecoveryMutations();
    const outcome = commit(recovery, mutations, Date.now(), injectFail ? { failKey: key } : {});
    setRecovery(outcome.state);
    if (outcome.ok) {
      toast({ title: '写入成功', description: `${key} 已入库，幂等键 ${key}`, status: 'success' });
    } else {
      toast({ title: '写入失败，已回滚', description: `恢复到最近可用状态，${outcome.reason}`, status: 'error' });
    }
    setRecoverySeq((s) => s + 1);
  };

  const recoveryRetrySameKey = () => {
    const key = `offcut-恢-${String(recoverySeq - 1).padStart(3, '0')}`;
    const offcut: Offcut = {
      id: key,
      length: 600,
      width: 200,
      thickness: 18,
      material: '北美黑胡桃',
      source: '恢复演示',
      status: 'available',
      slot: null,
      claimedBy: null,
      claimedAt: null,
      version: 1,
      createdAt: Date.now(),
    };
    const outcome = commit(recovery, [{
      key,
      label: `登记余料 ${key}`,
      apply: (draft) => ({ ...draft, offcuts: { ...draft.offcuts, [key]: offcut } }),
    }], Date.now());
    setRecovery(outcome.state);
    if (outcome.skipped.length) {
      toast({ title: '幂等生效', description: `${key} 已入库过，跳过不重复`, status: 'info' });
    } else {
      toast({ title: '写入成功', description: `${key} 已入库`, status: 'success' });
    }
  };

  const rackOffcuts = Object.values(offcutState.offcuts).sort((a, b) => a.id.localeCompare(b.id));
  const waitlistOffcuts = offcutState.waitlist
    .map((id) => offcutState.offcuts[id])
    .filter(Boolean);
  const occupied = occupiedSlots(offcutState);

  const stockName = (stockId: string) => project.stocks.find((s) => s.id === stockId)?.name ?? stockId;

  const localChangeCount = useMemo(() => {
    const localKeys = Object.keys(localSnap.parts);
    const baseKeys = Object.keys(base.parts);
    let count = 0;
    localKeys.forEach((id) => {
      if (JSON.stringify(localSnap.parts[id]) !== JSON.stringify(base.parts[id] ?? null)) count += 1;
    });
    baseKeys.forEach((id) => {
      if (!(id in localSnap.parts)) count += 1;
    });
    return count;
  }, [localSnap, base]);

  return (
    <main className="page-shell">
      <Box mb="14px">
        <Text className="eyebrow">STEP 04 · 余料与协同</Text>
        <Text className="page-title">可归属的余料记录与断网协同</Text>
        <Text className="page-desc">
          余料写编号、长宽厚和板材，两人同时占用只认先到的；零件改动只失效重算依赖它的排料图与成本；
          断网改动回网按编号合并，两边都改过的各留一份待处置；写入失败回滚到最近可用状态，同一编号只入库一次；位满先排队等位。
        </Text>
      </Box>

      {/* ===== 余料登记与货架 ===== */}
      <SectionTitle icon={<Scissors size={15} />} title="余料登记与货架" hint="编号 · 长宽厚 · 板材 · 先到先得 · 位满排队" />
      <SimpleGrid columns={{ base: 1, lg: 3 }} spacing="12px" mb="14px">
        <Box borderWidth="1px" borderColor="slate.200" borderRadius="10px" bg="white" p="14px">
          <Text fontSize="12px" fontWeight="800" mb="10px">登记余料</Text>
          <Stack spacing="9px">
            <FormControl>
              <FormLabel fontSize="10px">编号（留空自动生成，同号只入库一次）</FormLabel>
              <InputLike value={form.id} placeholder="如 offcut-001" onChange={(v) => setForm((f) => ({ ...f, id: v }))} />
            </FormControl>
            <Grid templateColumns="1fr 1fr 1fr" gap="8px">
              <FormControl>
                <FormLabel fontSize="10px">长 mm</FormLabel>
                <NumberInput size="sm" value={form.length} min={1} onChange={(_, v) => setForm((f) => ({ ...f, length: v || 0 }))}>
                  <NumberInputField />
                </NumberInput>
              </FormControl>
              <FormControl>
                <FormLabel fontSize="10px">宽 mm</FormLabel>
                <NumberInput size="sm" value={form.width} min={1} onChange={(_, v) => setForm((f) => ({ ...f, width: v || 0 }))}>
                  <NumberInputField />
                </NumberInput>
              </FormControl>
              <FormControl>
                <FormLabel fontSize="10px">厚 mm</FormLabel>
                <NumberInput size="sm" value={form.thickness} min={1} onChange={(_, v) => setForm((f) => ({ ...f, thickness: v || 0 }))}>
                  <NumberInputField />
                </NumberInput>
              </FormControl>
            </Grid>
            <FormControl>
              <FormLabel fontSize="10px">板材</FormLabel>
              <Select size="sm" value={form.material} onChange={(e) => setForm((f) => ({ ...f, material: e.target.value }))}>
                {project.stocks.map((s) => <option key={s.id} value={s.material}>{s.name} · {s.material}</option>)}
              </Select>
            </FormControl>
            <FormControl>
              <FormLabel fontSize="10px">来源工单</FormLabel>
              <InputLike value={form.source} placeholder="工单-001" onChange={(v) => setForm((f) => ({ ...f, source: v }))} />
            </FormControl>
            <Button size="sm" colorScheme="teal" leftIcon={<Save size={14} />} onClick={register}>登记入库</Button>
          </Stack>
        </Box>

        <StatCard label="架位占用" value={`${occupied} / ${offcutState.slotTotal}`} hint="在架（可用 + 已占）" />
        <StatCard label="等位队列" value={`${waitlistOffcuts.length} 条`} hint="位满先排队，空位自动补位" accent="orange" />
      </SimpleGrid>

      <Box borderWidth="1px" borderColor="slate.200" borderRadius="10px" bg="white" overflow="hidden" mb="14px">
        <Flex p="12px" justify="space-between" align="center" borderBottomWidth="1px">
          <Text fontSize="12px" fontWeight="800">余料货架</Text>
          <HStack fontSize="10px" color="slate.500"><Users size={13} /><Text>两人同时占用只认先到的，后到改选别的料</Text></HStack>
        </Flex>
        <TableContainer maxH="320px" overflowY="auto">
          <Table size="sm">
            <Thead position="sticky" top="0" bg="slate.100" zIndex="1">
              <Tr>
                <Th>编号</Th><Th>尺寸 (mm)</Th><Th>板材</Th><Th>状态</Th><Th>归属</Th><Th>架位</Th><Th>版本</Th><Th textAlign="right">操作</Th>
              </Tr>
            </Thead>
            <Tbody>
              {rackOffcuts.map((offcut) => (
                <Tr key={offcut.id}>
                  <Td fontSize="10px" fontWeight="700">{offcut.id}</Td>
                  <Td fontSize="10px">{offcut.length}×{offcut.width}×{offcut.thickness}</Td>
                  <Td fontSize="10px">{offcut.material}</Td>
                  <Td><StatusBadge status={offcut.status} /></Td>
                  <Td fontSize="10px">{offcut.claimedBy ?? '—'}</Td>
                  <Td fontSize="10px">{offcut.slot != null ? offcut.slot + 1 : '等位'}</Td>
                  <Td fontSize="10px">v{offcut.version}</Td>
                  <Td>
                    <HStack spacing="4px" justify="flex-end">
                      {offcut.status === 'available' && (
                        <>
                          <Button size="xs" variant="outline" colorScheme="teal" onClick={() => claim(offcut.id, WORKER_A)}>甲 占用</Button>
                          <Button size="xs" variant="outline" colorScheme="blue" onClick={() => claim(offcut.id, WORKER_B)}>乙 占用</Button>
                          <Button size="xs" variant="ghost" onClick={() => consume(offcut.id)}>领用</Button>
                        </>
                      )}
                      {offcut.status === 'claimed' && (
                        <>
                          <Button size="xs" variant="ghost" leftIcon={<LogOut size={12} />} onClick={() => release(offcut.id)}>释放</Button>
                          <Button size="xs" variant="ghost" onClick={() => consume(offcut.id)}>领用</Button>
                        </>
                      )}
                      {offcut.status === 'queued' && <Text fontSize="10px" color="orange.600">排队中…</Text>}
                      {offcut.status === 'used' && <Text fontSize="10px" color="slate.400">已消耗</Text>}
                    </HStack>
                  </Td>
                </Tr>
              ))}
              {rackOffcuts.length === 0 && (
                <Tr><Td colSpan={8}><Text fontSize="11px" color="slate.500" py="10px">暂无余料，登记一条开始</Text></Td></Tr>
              )}
            </Tbody>
          </Table>
        </TableContainer>
      </Box>

      {/* ===== 依赖重算 ===== */}
      <SectionTitle icon={<Link2 size={15} />} title="依赖重算" hint="只有依赖该零件的排料图和成本失效重算，其余沿用" />
      <SimpleGrid columns={{ base: 1, lg: 3 }} spacing="12px" mb="14px">
        <Box borderWidth="1px" borderColor="slate.200" borderRadius="10px" bg="white" p="14px">
          <Text fontSize="12px" fontWeight="800" mb="10px">修改零件尺寸</Text>
          <Stack spacing="9px">
            <FormControl>
              <FormLabel fontSize="10px">选择零件</FormLabel>
              <Select size="sm" value={selectedPartId} onChange={(e) => setSelectedPartId(e.target.value)}>
                {project.parts.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            </FormControl>
            {selectedPart && (
              <>
                <Grid templateColumns="1fr 1fr" gap="8px">
                  <FormControl>
                    <FormLabel fontSize="10px">长 mm</FormLabel>
                    <NumberInput size="sm" value={selectedPart.length} min={1} onChange={(_, v) => updatePartSize({ length: v || 0 })}>
                      <NumberInputField />
                    </NumberInput>
                  </FormControl>
                  <FormControl>
                    <FormLabel fontSize="10px">宽 mm</FormLabel>
                    <NumberInput size="sm" value={selectedPart.width} min={1} onChange={(_, v) => updatePartSize({ width: v || 0 })}>
                      <NumberInputField />
                    </NumberInput>
                  </FormControl>
                </Grid>
                <Text fontSize="10px" color="slate.500">改尺寸后，只有用到该零件的板材排料图会重算，其余沿用缓存。</Text>
              </>
            )}
          </Stack>
        </Box>

        <Box borderWidth="1px" borderColor="slate.200" borderRadius="10px" bg="white" p="14px">
          <Text fontSize="12px" fontWeight="800" mb="10px">板材排料图（按依赖失效）</Text>
          <Stack spacing="7px">
            {project.stocks.map((stock) => {
              const entry = cache.byStock[stock.id];
              const recomputed = outcome.recomputedStocks.includes(stock.id);
              const reused = outcome.reusedStocks.includes(stock.id);
              return (
                <Flex key={stock.id} justify="space-between" align="center" p="7px 9px" borderWidth="1px" borderColor={recomputed ? 'orange.200' : 'slate.200'} borderRadius="7px" bg={recomputed ? 'orange.50' : 'white'}>
                  <Box minW={0}>
                    <Text fontSize="11px" fontWeight="750">{stock.name}</Text>
                    <Text fontSize="9px" color="slate.500" noOfLines={1}>
                      依赖：{entry?.dependsOn.map((id) => project.parts.find((p) => p.id === id)?.name ?? id).join('、') || '无'}
                    </Text>
                  </Box>
                  <HStack spacing="6px" flexShrink={0}>
                    {recomputed && <Badge colorScheme="orange">重算</Badge>}
                    {reused && <Badge colorScheme="teal" variant="outline">沿用</Badge>}
                    <Badge variant="outline" fontSize="9px">×{entry?.recomputes ?? 0}</Badge>
                  </HStack>
                </Flex>
              );
            })}
          </Stack>
        </Box>

        <Box borderWidth="1px" borderColor="slate.200" borderRadius="10px" bg="white" p="14px">
          <Text fontSize="12px" fontWeight="800" mb="10px">成本（随排料图失效）</Text>
          <Stat>
            <StatLabel fontSize="10px" color="slate.500">预计材料成本</StatLabel>
            <StatNumber fontSize="26px">￥{outcome.result.purchaseCost.toFixed(0)}</StatNumber>
          </Stat>
          <Text mt="6px" fontSize="10px" color="slate.500">成本重算 {cache.costRecomputes} 次 · 排料图重算 {Object.values(cache.byStock).reduce((s, e) => s + e.recomputes, 0)} 次</Text>
          <Divider my="9px" />
          <Text fontSize="10px" color="slate.500">未受影响的板材排料图与成本直接沿用，不重复计算。</Text>
        </Box>
      </SimpleGrid>

      {/* ===== 断网同步 ===== */}
      <SectionTitle icon={<Cloudy size={15} />} title="断网同步" hint="按编号合并 · 两边都改过各留一份待处置" />
      <SimpleGrid columns={{ base: 1, lg: 3 }} spacing="12px" mb="14px">
        <Box borderWidth="1px" borderColor="slate.200" borderRadius="10px" bg="white" p="14px">
          <Flex justify="space-between" align="center" mb="10px">
            <Text fontSize="12px" fontWeight="800">本机状态</Text>
            <Badge colorScheme={syncStatus === 'online' ? 'teal' : 'gray'}>
              <HStack spacing="4px">{syncStatus === 'online' ? <Cloudy size={12} /> : <CloudOff size={12} />}<Text>{syncStatus === 'online' ? '在线' : '断网'}</Text></HStack>
            </Badge>
          </Flex>
          <Stack spacing="7px">
            <Button size="sm" variant="outline" leftIcon={syncStatus === 'online' ? <CloudOff size={14} /> : <Cloudy size={14} />} onClick={toggleOffline}>
              {syncStatus === 'online' ? '切换到断网' : '切换回在线'}
            </Button>
            <Button size="sm" variant="outline" colorScheme="blue" leftIcon={<Users size={14} />} onClick={simulateRemoteEdit}>
              模拟同事乙改同一零件
            </Button>
            <Button size="sm" colorScheme="teal" leftIcon={<LogIn size={14} />} onClick={mergeSync}>回网合并</Button>
          </Stack>
          <Text mt="9px" fontSize="10px" color="slate.500">本机相对基准有 {localChangeCount} 处改动；回网后按编号三方合并。</Text>
        </Box>

        <Box borderWidth="1px" borderColor="slate.200" borderRadius="10px" bg="white" p="14px">
          <Text fontSize="12px" fontWeight="800" mb="10px">待处置冲突（两边都改过）</Text>
          <Stack spacing="7px" maxH="220px" overflowY="auto">
            {conflicts.length === 0 && <Text fontSize="11px" color="slate.500">无冲突。两边都改过的记录会各留一份出现在这里。</Text>}
            {conflicts.map((c) => (
              <ConflictCard key={`${c.field}-${c.id}`} conflict={c} onResolve={(r) => resolveConflict(c, r)} />
            ))}
          </Stack>
        </Box>

        <Box borderWidth="1px" borderColor="slate.200" borderRadius="10px" bg="white" p="14px">
          <Text fontSize="12px" fontWeight="800" mb="10px">合并流水</Text>
          <Stack spacing="5px" maxH="220px" overflowY="auto">
            {syncLog.length === 0 && <Text fontSize="11px" color="slate.500">暂无合并记录</Text>}
            {syncLog.map((entry, i) => (
              <Text key={i} fontSize="10px" color="slate.600"><History size={10} style={{ display: 'inline', marginRight: 4 }} />{entry.message}</Text>
            ))}
          </Stack>
        </Box>
      </SimpleGrid>

      {/* ===== 写入恢复 ===== */}
      <SectionTitle icon={<RotateCcw size={15} />} title="写入恢复" hint="失败回滚到最近可用状态 · 同一编号只入库一次" />
      <SimpleGrid columns={{ base: 1, lg: 3 }} spacing="12px" mb="14px">
        <Box borderWidth="1px" borderColor="slate.200" borderRadius="10px" bg="white" p="14px">
          <Text fontSize="12px" fontWeight="800" mb="10px">事务写入</Text>
          <Stack spacing="7px">
            <Button size="sm" colorScheme="teal" leftIcon={<Play size={14} />} onClick={() => recoveryRegister(false)}>登记余料（正常写入）</Button>
            <Button size="sm" variant="outline" colorScheme="red" leftIcon={<XCircle size={14} />} onClick={() => recoveryRegister(true)}>登记余料（注入故障）</Button>
            <Button size="sm" variant="outline" leftIcon={<RefreshCw size={14} />} onClick={recoveryRetrySameKey}>用相同编号重试</Button>
          </Stack>
          {recovery.lastFailure && (
            <Box mt="9px" p="8px" bg="red.50" borderWidth="1px" borderColor="red.200" borderRadius="7px">
              <Text fontSize="10px" color="red.700" fontWeight="700">已回滚：{recovery.lastFailure.label}</Text>
              <Text fontSize="10px" color="red.600">{recovery.lastFailure.reason}</Text>
              <Text fontSize="9px" color="slate.500">已恢复到最近可用状态</Text>
            </Box>
          )}
        </Box>

        <Box borderWidth="1px" borderColor="slate.200" borderRadius="10px" bg="white" p="14px">
          <Text fontSize="12px" fontWeight="800" mb="10px">已入库（幂等键）</Text>
          <Stack spacing="4px" maxH="220px" overflowY="auto">
            {recovery.appliedKeys.length === 0 && <Text fontSize="11px" color="slate.500">暂无已提交记录</Text>}
            {recovery.appliedKeys.map((key) => (
              <HStack key={key} fontSize="10px" color="slate.700"><CheckCircle2 size={12} color="#0f766e" /><Text>{key}</Text></HStack>
            ))}
          </Stack>
        </Box>

        <Box borderWidth="1px" borderColor="slate.200" borderRadius="10px" bg="white" p="14px">
          <Text fontSize="12px" fontWeight="800" mb="10px">写前意图流水（WAL）</Text>
          <Stack spacing="4px" maxH="220px" overflowY="auto">
            {recovery.intents.length === 0 && <Text fontSize="11px" color="slate.500">暂无写入意图</Text>}
            {recovery.intents.slice().reverse().map((intent, i) => (
              <Text key={i} fontSize="10px" color="slate.600"><Lock size={10} style={{ display: 'inline', marginRight: 4 }} />{intent.label}</Text>
            ))}
          </Stack>
        </Box>
      </SimpleGrid>
    </main>
  );
}

function SectionTitle({ icon, title, hint }: { icon: React.ReactNode; title: string; hint: string }) {
  return (
    <Flex align="center" gap="8px" mb="9px" mt="4px">
      <Box color="teal.700">{icon}</Box>
      <Text fontSize="14px" fontWeight="850">{title}</Text>
      <Text fontSize="10px" color="slate.500">{hint}</Text>
      <Box flex="1" />
      <Divider flex="1" borderColor="slate.200" />
    </Flex>
  );
}

function StatCard({ label, value, hint, accent = 'teal' }: { label: string; value: string; hint: string; accent?: 'teal' | 'orange' }) {
  return (
    <Box borderWidth="1px" borderColor="slate.200" borderRadius="10px" bg="white" p="14px">
      <Stat>
        <StatLabel fontSize="10px" color="slate.500">{label}</StatLabel>
        <StatNumber fontSize="24px" color={`${accent}.700`}>{value}</StatNumber>
      </Stat>
      <Text mt="4px" fontSize="10px" color="slate.500">{hint}</Text>
    </Box>
  );
}

function StatusBadge({ status }: { status: Offcut['status'] }) {
  const map: Record<Offcut['status'], { label: string; color: string }> = {
    available: { label: '在架', color: 'teal' },
    claimed: { label: '已占', color: 'blue' },
    used: { label: '已用', color: 'gray' },
    queued: { label: '等位', color: 'orange' },
  };
  const item = map[status];
  return <Badge colorScheme={item.color} fontSize="9px">{item.label}</Badge>;
}

function InputLike({ value, placeholder, onChange }: { value: string; placeholder?: string; onChange: (v: string) => void }) {
  return (
    <input
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      style={{
        width: '100%',
        height: '32px',
        padding: '0 10px',
        fontSize: '12px',
        border: '1px solid #cbd5e1',
        borderRadius: '6px',
        background: '#fff',
      }}
    />
  );
}

function ConflictCard({ conflict, onResolve }: { conflict: SyncConflict; onResolve: (r: 'take-local' | 'take-remote' | 'keep-both') => void }) {
  const isPart = conflict.field === 'part';
  const name = (r: Part | Offcut | null) => (r ? (isPart ? (r as Part).name : (r as Offcut).id) : '—');
  const describe = (r: Part | Offcut | null) => {
    if (!r) return '已删除';
    if (isPart) {
      const p = r as Part;
      return `${p.length}×${p.width}×${p.thickness}`;
    }
    const o = r as Offcut;
    return `${o.length}×${o.width}×${o.thickness} ${o.material}`;
  };
  return (
    <Box p="8px" borderWidth="1px" borderColor="orange.200" borderRadius="7px" bg="orange.50">
      <Flex justify="space-between" align="center" mb="5px">
        <HStack spacing="5px">
          <Badge colorScheme="orange" fontSize="9px">{isPart ? '零件' : '余料'}</Badge>
          <Text fontSize="10px" fontWeight="700">{name(conflict.local)}</Text>
        </HStack>
        <Badge variant="outline" fontSize="9px">{conflict.kind === 'both-modified' ? '两边都改' : '改/删冲突'}</Badge>
      </Flex>
      <Grid templateColumns="1fr 1fr" gap="5px" fontSize="9px">
        <Box p="5px" bg="white" borderRadius="5px">
          <Text color="slate.500">本机</Text>
          <Text fontWeight="700">{describe(conflict.local)}</Text>
        </Box>
        <Box p="5px" bg="white" borderRadius="5px">
          <Text color="slate.500">远程</Text>
          <Text fontWeight="700">{describe(conflict.remote)}</Text>
        </Box>
      </Grid>
      <HStack mt="6px" spacing="4px">
        <Button size="xs" variant="outline" onClick={() => onResolve('take-local')}>保留本地</Button>
        <Button size="xs" variant="outline" onClick={() => onResolve('take-remote')}>保留远程</Button>
        <Button size="xs" variant="outline" colorScheme="teal" leftIcon={<Sparkles size={11} />} onClick={() => onResolve('keep-both')}>两边都留</Button>
      </HStack>
    </Box>
  );
}
