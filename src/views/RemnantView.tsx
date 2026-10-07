import { useMemo, useState } from 'react';
import {
  Badge,
  Box,
  Button,
  Flex,
  FormControl,
  FormLabel,
  Grid,
  HStack,
  Input,
  NumberDecrementStepper,
  NumberIncrementStepper,
  NumberInput,
  NumberInputField,
  NumberInputStepper,
  Select,
  SimpleGrid,
  Stack,
  Text,
  Tooltip,
  useToast,
} from '@chakra-ui/react';
import {
  AlertTriangle,
  CheckCircle2,
  Cloud,
  CloudOff,
  History,
  Link2,
  Link2Off,
  ListOrdered,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react';
import { useAtom } from 'jotai';
import {
  activeWorkerAtom,
  beginOfflineSession,
  bootstrapCrews,
  finishOfflineSession,
  getCoordinator,
  ledgerTickAtom,
  onlineAtom,
  REMNANT_CAPACITY,
  resolveSessionConflict,
  sessionBaseAtom,
  sessionConflictsAtom,
  workerA,
  workerB,
} from '../stores/ledger';
import { generateRemnantId, systemClock, WriteFailedError } from '../domain';
import type { Remnant, RemnantConflict, SyncReport } from '../domain';

const STATUS_META: Record<Remnant['status'], { label: string; color: string }> = {
  available: { label: '在库可用', color: 'teal' },
  occupied: { label: '已占用', color: 'blue' },
  consumed: { label: '已领用', color: 'gray' },
  conflict: { label: '冲突待处置', color: 'red' },
};

interface RegisterFormState {
  id: string;
  length: string;
  width: string;
  thickness: string;
  material: string;
  sourceJobId: string;
}

const initialForm: RegisterFormState = {
  id: '',
  length: '600',
  width: '220',
  thickness: '18',
  material: '北美黑胡桃',
  sourceJobId: '餐边柜-01',
};

export function RemnantView() {
  const [worker, setWorker] = useAtom(activeWorkerAtom);
  const [online, setOnline] = useAtom(onlineAtom);
  const [sessionBase, setSessionBase] = useAtom(sessionBaseAtom);
  const [conflicts, setConflicts] = useAtom(sessionConflictsAtom);
  const [tick, setTick] = useAtom(ledgerTickAtom);
  const [form, setForm] = useState<RegisterFormState>(initialForm);
  const [remeasureTarget, setRemeasureTarget] = useState<string | null>(null);
  const [remeasureLength, setRemeasureLength] = useState('');
  const [lastReport, setLastReport] = useState<SyncReport | null>(null);
  const toast = useToast();

  // 两个班组的本机台账都建出来，断网演示时切换身份即可看到各自独立记录
  bootstrapCrews();
  const coordinator = getCoordinator(worker);
  void tick; // 操作后由 bump() 自增强制重读
  const bump = () => setTick((v) => v + 1);

  const records = useMemo(() => coordinator.list(), [coordinator, tick]);
  const queue = useMemo(() => coordinator.pendingQueue(), [coordinator, tick]);
  const usedSlots = useMemo(() => coordinator.usedSlots(), [coordinator, tick]);
  const pendingConflicts = conflicts.filter((c) => c.status === 'pending');

  const patchForm = (patch: Partial<RegisterFormState>) => setForm((f) => ({ ...f, ...patch }));

  const guard = (fn: () => unknown, success?: string) => {
    try {
      const report = fn();
      bump();
      if (report && typeof report === 'object' && 'online' in report) setLastReport(report as SyncReport);
      if (success) {
        toast({ status: 'success', title: success, duration: 1800, position: 'top' });
      }
    } catch (err) {
      if (err instanceof WriteFailedError) {
        toast({
          status: 'error',
          title: '写入失败，已恢复到最近可用状态',
          description: err.message,
          duration: 4000,
          isClosable: true,
          position: 'top',
        });
      } else {
        toast({
          status: 'warning',
          title: (err as Error).message,
          duration: 2600,
          position: 'top',
        });
      }
      bump();
    }
  };

  const handleRegister = () => {
    guard(() => {
      const id = form.id.trim() || generateRemnantId(systemClock);
      coordinator.register({
        id,
        length: Number(form.length) || 0,
        width: Number(form.width) || 0,
        thickness: Number(form.thickness) || 0,
        material: form.material,
        sourceJobId: form.sourceJobId,
        worker: worker.worker,
        deviceId: worker.deviceId,
      });
      patchForm({ id: '' });
    }, '余料已登记');
  };

  const handleOccupy = (id: string) => {
    guard(() => {
      const result = coordinator.occupy(id, worker.worker, worker.deviceId);
      if (result.status === 'rejected') {
        toast({
          status: 'warning',
          title: `${id} 没占上`,
          description: result.reason,
          duration: 3500,
          isClosable: true,
          position: 'top',
        });
      } else {
        toast({ status: 'success', title: `${id} 占用成功，归属 ${worker.worker}`, duration: 1800, position: 'top' });
      }
    });
  };

  const handleRelease = (id: string) => {
    guard(() => coordinator.release(id, worker.worker, worker.deviceId), `${id} 已释放`);
  };

  const handleConsume = (id: string) => {
    guard(() => {
      const admitted = coordinator.consume(id, worker.worker, worker.deviceId);
      toast({
        status: 'success',
        title: `${id} 已领用${admitted.length ? `，排队的 ${admitted.map((r) => r.id).join('、')} 已放行` : ''}`,
        duration: 2200,
        position: 'top',
      });
    });
  };

  const handleRemeasure = () => {
    if (!remeasureTarget) return;
    const length = Number(remeasureLength);
    guard(() => {
      coordinator.remeasure(
        remeasureTarget,
        Number.isFinite(length) && length > 0 ? { length } : {},
        worker.worker,
        worker.deviceId,
      );
    }, `${remeasureTarget} 复测尺寸已更新`);
    setRemeasureTarget(null);
    setRemeasureLength('');
  };

  const toggleNetwork = () => {
    if (online) {
      setSessionBase(beginOfflineSession());
      setOnline(false);
      setLastReport(null);
      bump();
      toast({
        status: 'info',
        title: '已断网：切换甲班 / 乙班可各自登记、占用、复测',
        duration: 3000,
        position: 'top',
      });
      return;
    }

    guard(() => {
      const result = finishOfflineSession(sessionBase!);
      setConflicts((prev) => {
        const freshIds = new Set(result.conflicts.map((c) => c.id));
        return [
          ...prev.filter((c) => c.status === 'pending' && !freshIds.has(c.id)),
          ...result.conflicts,
        ];
      });
      setOnline(true);
      setSessionBase(null);
      setLastReport({
        online: true,
        conflicts: result.conflicts,
        takenLocal: result.takenA,
        takenRemote: result.takenB,
      });
    }, '回网合并完成');
  };

  const switchWorker = (identity: typeof workerA) => {
    setWorker(identity);
  };;

  const handleResolve = (conflict: RemnantConflict, pick: 'local' | 'remote') => {
    guard(() => {
      const updated = resolveSessionConflict(
        conflicts,
        conflict.id,
        pick,
        { worker: worker.worker, deviceId: worker.deviceId, at: systemClock.now() },
      );
      setConflicts(updated);
    }, `${conflict.id} 已按${pick === 'local' ? '甲班（本机）' : '乙班（对端）'}版本处置`);
  };

  const injectFailure = () => {
    coordinator.injectNextWriteFailure();
    toast({ status: 'info', title: '已让下一次写入失败，可再做一次登记观察恢复', duration: 3000, position: 'top' });
  };

  return (
    <main className="page-shell">
      <Flex justify="space-between" align="end" mb="14px" gap="12px" wrap="wrap">
        <Box>
          <Text className="eyebrow">STEP 03 · 余料台账</Text>
          <Text className="page-title">可归属的余料记录与断网合并</Text>
          <Text className="page-desc">
            每块余料写入编号、长宽厚、板材和归属班组；两人同时占用只认先到的，后到的改选别的料。
            断网各自登记，回网按编号三方合并——后传不盖先写，两边都改则各留一份待处置。
          </Text>
        </Box>
        <HStack>
          <Button
            size="sm"
            variant="outline"
            leftIcon={<ShieldAlert size={15} />}
            onClick={injectFailure}
          >
            模拟下次写入失败
          </Button>
          <Button
            size="sm"
            colorScheme={online ? 'teal' : 'orange'}
            leftIcon={online ? <Cloud size={15} /> : <CloudOff size={15} />}
            onClick={toggleNetwork}
          >
            {online ? '切换为断网' : '回网合并'}
          </Button>
        </HStack>
      </Flex>

      <SimpleGrid columns={{ base: 2, lg: 4 }} spacing="10px" mb="14px">
        <IdentityCard workerA={workerA} workerB={workerB} current={worker} onSwitch={switchWorker} online={online} />
        <StatCard label="余料位" value={`${usedSlots}/${REMNANT_CAPACITY}`} accent={usedSlots >= REMNANT_CAPACITY ? 'orange' : 'teal'} icon={<ListOrdered size={15} />} />
        <StatCard label="在库可占用" value={String(records.filter((r) => r.status === 'available').length)} accent="green" icon={<CheckCircle2 size={15} />} />
        <StatCard label="待处置冲突" value={String(pendingConflicts.length)} accent={pendingConflicts.length ? 'red' : 'gray'} icon={<AlertTriangle size={15} />} />
      </SimpleGrid>

      {!online && (
        <OfflineBanner />
      )}
      {lastReport && <SyncReportCard report={lastReport} />}

      <Grid templateColumns={{ base: '1fr', xl: '340px minmax(0, 1fr)' }} gap="14px" alignItems="start">
        <Stack spacing="12px">
          <RegisterFormCard
            form={form}
            onChange={patchForm}
            onSubmit={handleRegister}
            full={usedSlots >= REMNANT_CAPACITY}
          />
          <QueueCard queue={queue} />
        </Stack>

        <Stack spacing="12px">
          {pendingConflicts.length > 0 && (
            <ConflictCard conflicts={pendingConflicts} onResolve={handleResolve} currentWorker={worker.worker} />
          )}
          <RemnantTable
            records={records}
            currentWorker={worker.worker}
            onOccupy={handleOccupy}
            onRelease={handleRelease}
            onConsume={handleConsume}
            onRemeasure={(id, currentLength) => {
              setRemeasureTarget(id);
              setRemeasureLength(String(currentLength));
            }}
          />
        </Stack>
      </Grid>

      {remeasureTarget && (
        <RemeasureDialog
          id={remeasureTarget}
          value={remeasureLength}
          onChange={setRemeasureLength}
          onCancel={() => setRemeasureTarget(null)}
          onConfirm={handleRemeasure}
        />
      )}
    </main>
  );
}

/* ------------------------------- 子组件 ------------------------------- */

function IdentityCard({
  workerA: a,
  workerB: b,
  current,
  onSwitch,
  online,
}: {
  workerA: typeof workerA;
  workerB: typeof workerB;
  current: typeof workerA;
  onSwitch: (w: typeof workerA) => void;
  online: boolean;
}) {
  return (
    <Box borderWidth="1px" borderColor="slate.200" borderRadius="10px" bg="white" p="12px">
      <Text fontSize="9px" color="slate.500" fontWeight="800" letterSpacing=".06em">当前操作班组</Text>
      <HStack mt="8px" spacing="6px">
        {[a, b].map((w) => (
          <Button
            key={w.deviceId}
            size="xs"
            variant={current.deviceId === w.deviceId ? 'solid' : 'outline'}
            colorScheme="teal"
            onClick={() => onSwitch(w)}
          >
            {w.worker}
          </Button>
        ))}
      </HStack>
      <HStack mt="8px" fontSize="10px" color="slate.500">
        {online ? <Link2 size={12} /> : <Link2Off size={12} />}
        <Text>{current.deviceId} · {online ? '写入即同步' : '仅写本机，回网合并'}</Text>
      </HStack>
    </Box>
  );
}

function StatCard({ label, value, accent, icon }: { label: string; value: string; accent: string; icon: React.ReactNode }) {
  return (
    <Box borderWidth="1px" borderColor="slate.200" borderRadius="10px" bg="white" p="12px">
      <HStack color="slate.500">
        {icon}
        <Text fontSize="9px" fontWeight="800" letterSpacing=".06em">{label}</Text>
      </HStack>
      <Text mt="5px" fontSize="20px" fontWeight="900" color={`${accent}.700`}>{value}</Text>
    </Box>
  );
}

function OfflineBanner() {
  return (
    <Box borderWidth="1px" borderColor="orange.200" bg="orange.50" borderRadius="10px" px="12px" py="8px" mb="12px">
      <HStack fontSize="10px" color="orange.800" spacing="10px">
        <CloudOff size={14} />
        <Text fontWeight="800">断网中：登记 / 占用 / 复测都只写本机；可切换到乙班模拟两边各自操作，然后回网合并。</Text>
      </HStack>
    </Box>
  );
}

function SyncReportCard({ report }: { report: SyncReport }) {
  if (!report.online) return null;
  return (
    <Box borderWidth="1px" borderColor="blue.200" bg="blue.50" borderRadius="10px" px="12px" py="8px" mb="12px">
      <HStack fontSize="10px" color="blue.800" spacing="12px" wrap="wrap">
        <HStack spacing="6px"><RefreshCw size={12} /><Text fontWeight="800">最近一次回网合并</Text></HStack>
        <Text>采纳本机 {report.takenLocal.length} 条</Text>
        <Text>采纳对端 {report.takenRemote.length} 条</Text>
        <Text color={report.conflicts.length ? 'red.700' : 'blue.800'} fontWeight="800">
          两边都改、各留一份待处置：{report.conflicts.length} 条
        </Text>
      </HStack>
    </Box>
  );
}

function RegisterFormCard({
  form,
  onChange,
  onSubmit,
  full,
}: {
  form: RegisterFormState;
  onChange: (patch: Partial<RegisterFormState>) => void;
  onSubmit: () => void;
  full: boolean;
}) {
  return (
    <Box borderWidth="1px" borderColor="slate.200" borderRadius="10px" bg="white" p="14px">
      <Text fontSize="12px" fontWeight="800" mb="10px">余料登记</Text>
      <Stack spacing="9px">
        <FormControl>
          <FormLabel fontSize="10px">编号（留空自动生成）</FormLabel>
          <Input
            size="xs"
            value={form.id}
            placeholder="例如 YL20261007-A1B2"
            onChange={(e) => onChange({ id: e.target.value })}
          />
        </FormControl>
        <Grid templateColumns="1fr 1fr 1fr" gap="8px">
          <FormControl>
            <FormLabel fontSize="10px">长 mm</FormLabel>
            <NumberInput size="xs" value={form.length} onChange={(v) => onChange({ length: v })}>
              <NumberInputField />
              <NumberInputStepper><NumberIncrementStepper /><NumberDecrementStepper /></NumberInputStepper>
            </NumberInput>
          </FormControl>
          <FormControl>
            <FormLabel fontSize="10px">宽 mm</FormLabel>
            <NumberInput size="xs" value={form.width} onChange={(v) => onChange({ width: v })}>
              <NumberInputField />
              <NumberInputStepper><NumberIncrementStepper /><NumberDecrementStepper /></NumberInputStepper>
            </NumberInput>
          </FormControl>
          <FormControl>
            <FormLabel fontSize="10px">厚 mm</FormLabel>
            <NumberInput size="xs" value={form.thickness} onChange={(v) => onChange({ thickness: v })}>
              <NumberInputField />
              <NumberInputStepper><NumberIncrementStepper /><NumberDecrementStepper /></NumberInputStepper>
            </NumberInput>
          </FormControl>
        </Grid>
        <FormControl>
          <FormLabel fontSize="10px">板材</FormLabel>
          <Select size="xs" value={form.material} onChange={(e) => onChange({ material: e.target.value })}>
            <option>北美黑胡桃</option>
            <option>白橡木</option>
            <option>杨木多层板</option>
            <option>榉木</option>
          </Select>
        </FormControl>
        <FormControl>
          <FormLabel fontSize="10px">来源单号 / 排料图</FormLabel>
          <Input size="xs" value={form.sourceJobId} onChange={(e) => onChange({ sourceJobId: e.target.value })} />
        </FormControl>
        <Button size="sm" colorScheme="teal" onClick={onSubmit}>
          {full ? '登记并入队等位' : '登记入库'}
        </Button>
        {full && (
          <Text fontSize="10px" color="orange.700">余料位已满：本次登记会先排队，有位时按先后顺序自动放行。</Text>
        )}
      </Stack>
    </Box>
  );
}

function QueueCard({ queue }: { queue: ReturnType<ReturnType<typeof getCoordinator>['pendingQueue']> }) {
  return (
    <Box borderWidth="1px" borderColor="slate.200" borderRadius="10px" bg="white" p="14px">
      <HStack mb="10px">
        <History size={14} />
        <Text fontSize="12px" fontWeight="800">等位队列</Text>
        <Badge colorScheme={queue.length ? 'orange' : 'gray'}>{queue.length}</Badge>
      </HStack>
      {queue.length === 0 ? (
        <Text fontSize="10px" color="slate.500">暂无排队，余料位有空。</Text>
      ) : (
        <Stack spacing="7px">
          {queue.map((q) => (
            <Flex key={q.remnantId} justify="space-between" fontSize="10px">
              <HStack spacing="8px">
                <Badge colorScheme="orange" variant="outline">#{q.position}</Badge>
                <Text fontWeight="800">{q.remnantId}</Text>
              </HStack>
              <Text color="slate.500">{q.worker} 等入位</Text>
            </Flex>
          ))}
        </Stack>
      )}
    </Box>
  );
}

function RemnantTable({
  records,
  currentWorker,
  onOccupy,
  onRelease,
  onConsume,
  onRemeasure,
}: {
  records: Remnant[];
  currentWorker: string;
  onOccupy: (id: string) => void;
  onRelease: (id: string) => void;
  onConsume: (id: string) => void;
  onRemeasure: (id: string, length: number) => void;
}) {
  return (
    <Box borderWidth="1px" borderColor="slate.200" borderRadius="10px" bg="white" p="14px" overflowX="auto">
      <Text fontSize="12px" fontWeight="800" mb="10px">余料台账（{records.length} 条）</Text>
      <Box minW="760px">
        <Grid templateColumns="1.1fr .7fr 1fr .8fr 1.4fr 1.6fr" gap="8px" px="6px" pb="6px" borderBottomWidth="1px" borderColor="slate.100">
          {['编号 / 来源', '尺寸 (mm)', '板材', '状态', '归属', '操作'].map((h) => (
            <Text key={h} fontSize="9px" color="slate.500" fontWeight="800">{h}</Text>
          ))}
        </Grid>
        {records.length === 0 && (
          <Text fontSize="11px" color="slate.500" py="16px" textAlign="center">还没有余料，先在左侧登记一块。</Text>
        )}
        {records.map((r) => (
          <Grid
            key={r.id}
            templateColumns="1.1fr .7fr 1fr .8fr 1.4fr 1.6fr"
            gap="8px"
            px="6px"
            py="9px"
            borderBottomWidth="1px"
            borderColor="slate.50"
            alignItems="center"
          >
            <Box>
              <Text fontSize="11px" fontWeight="800">{r.id}</Text>
              <Text fontSize="9px" color="slate.500">来源：{r.sourceJobId} · v{r.version}</Text>
            </Box>
            <Text fontSize="10px">{r.length}×{r.width}×{r.thickness}</Text>
            <Text fontSize="10px">{r.material}</Text>
            <Badge colorScheme={STATUS_META[r.status].color} variant="subtle" justifySelf="start">
              {STATUS_META[r.status].label}
            </Badge>
            <Box fontSize="9px" color="slate.500">
              <Text>登记：{r.registeredBy.worker}</Text>
              {r.occupiedBy && (
                <Text color="blue.700" fontWeight="700">
                  占用：{r.occupiedBy.worker} · {new Date(r.occupiedBy.at).toLocaleTimeString('zh-CN', { hour12: false })}
                </Text>
              )}
              {r.consumedBy && <Text>领用：{r.consumedBy.worker}</Text>}
            </Box>
            <HStack spacing="4px">
              {r.status === 'available' && (
                <Button size="xs" colorScheme="blue" variant="outline" onClick={() => onOccupy(r.id)}>占用</Button>
              )}
              {r.status === 'occupied' && (
                <>
                  {r.occupiedBy?.worker === currentWorker ? (
                    <>
                      <Button size="xs" colorScheme="teal" onClick={() => onConsume(r.id)}>领用</Button>
                      <Button size="xs" variant="ghost" onClick={() => onRelease(r.id)}>让出</Button>
                    </>
                  ) : (
                    <Tooltip label="别人先占用了，改选别的料">
                      <Button size="xs" variant="outline" isDisabled>已被先占</Button>
                    </Tooltip>
                  )}
                </>
              )}
              {r.status === 'available' && (
                <Button size="xs" variant="ghost" onClick={() => onRemeasure(r.id, r.length)}>复测</Button>
              )}
              {r.status === 'conflict' && (
                <Text fontSize="9px" color="red.700">见上方冲突区处置</Text>
              )}
            </HStack>
          </Grid>
        ))}
      </Box>
    </Box>
  );
}

function ConflictCard({
  conflicts,
  onResolve,
  currentWorker,
}: {
  conflicts: RemnantConflict[];
  onResolve: (conflict: RemnantConflict, pick: 'local' | 'remote') => void;
  currentWorker: string;
}) {
  return (
    <Box borderWidth="1px" borderColor="red.200" bg="red.50" borderRadius="10px" p="14px">
      <HStack mb="10px" color="red.800">
        <AlertTriangle size={16} />
        <Text fontSize="12px" fontWeight="900">两边都改过，各留一份待处置（{conflicts.length}）</Text>
      </HStack>
      <Stack spacing="10px">
        {conflicts.map((c) => (
          <Box key={c.id} bg="white" borderRadius="8px" borderWidth="1px" borderColor="red.100" p="10px">
            <Text fontSize="11px" fontWeight="800">{c.id}</Text>
            <Grid templateColumns="1fr 1fr" gap="10px" mt="8px">
              <ConflictSide title="本机版本" r={c.local} highlight={c.local.lastChangedBy.worker === currentWorker} />
              <ConflictSide title="对端版本" r={c.remote} highlight={c.remote.lastChangedBy.worker === currentWorker} />
            </Grid>
            <HStack mt="8px" spacing="8px">
              <Button size="xs" colorScheme="blue" onClick={() => onResolve(c, 'local')}>采用本机</Button>
              <Button size="xs" colorScheme="teal" variant="outline" onClick={() => onResolve(c, 'remote')}>采用对端</Button>
              <Text fontSize="9px" color="slate.500">处置后该编号解除隔离，全端只有一条记录</Text>
            </HStack>
          </Box>
        ))}
      </Stack>
    </Box>
  );
}

function ConflictSide({ title, r, highlight }: { title: string; r: Remnant; highlight: boolean }) {
  return (
    <Box
      borderWidth="1px"
      borderColor={highlight ? 'blue.200' : 'slate.200'}
      bg={highlight ? 'blue.50' : 'slate.50'}
      borderRadius="8px"
      p="8px"
    >
      <Text fontSize="9px" fontWeight="800" color="slate.600">{title} · {r.lastChangedBy.worker}</Text>
      <Text fontSize="10px" mt="4px">{r.length}×{r.width}×{r.thickness} · {r.material}</Text>
      <Text fontSize="9px" color="slate.500" mt="2px">
        {r.occupiedBy ? `占用 ${r.occupiedBy.worker}` : '未占用'} · v{r.version}
      </Text>
    </Box>
  );
}

function RemeasureDialog({
  id,
  value,
  onChange,
  onCancel,
  onConfirm,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Box position="fixed" inset="0" bg="blackAlpha.300" display="flex" alignItems="center" justifyContent="center" zIndex="1000" onClick={onCancel}>
      <Box bg="white" borderRadius="12px" p="16px" w="320px" onClick={(e) => e.stopPropagation()}>
        <Text fontSize="13px" fontWeight="900">复测更正：{id}</Text>
        <FormControl mt="10px">
          <FormLabel fontSize="10px">新的长度 mm（断网两边各改一次可演示冲突）</FormLabel>
          <Input size="sm" value={value} onChange={(e) => onChange(e.target.value)} />
        </FormControl>
        <HStack mt="12px" justify="flex-end">
          <Button size="xs" variant="ghost" onClick={onCancel}>取消</Button>
          <Button size="xs" colorScheme="teal" onClick={onConfirm}>保存更正</Button>
        </HStack>
      </Box>
    </Box>
  );
}
