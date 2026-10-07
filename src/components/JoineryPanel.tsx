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
  IconButton,
  NumberInput,
  NumberInputField,
  Progress,
  Select,
  Stack,
  Text,
  Textarea,
  Tooltip,
} from '@chakra-ui/react';
import { Link2, Plus, Trash2 } from 'lucide-react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { selectedJointIdAtom, projectAtom, selectedPartIdAtom } from '../stores/project';
import { JOINT_STRENGTH, JOINT_TYPES, createId } from '../utils/project';
import { jointLabel, jointStrength, validateJoins } from '../utils/joinery';
import type { JointType } from '../types/woodworking';

export function JoineryPanel() {
  const [project, setProject] = useAtom(projectAtom);
  const selectedJointId = useAtomValue(selectedJointIdAtom);
  const setSelectedJointId = useSetAtom(selectedJointIdAtom);
  const setSelectedPartId = useSetAtom(selectedPartIdAtom);
  const selectedJoint = project.joinery.find((joint) => joint.id === selectedJointId) ?? null;
  const errors = validateJoins(project.joinery, project.parts);
  const strength = jointStrength(project.joinery);

  const addJoint = () => {
    const joint = {
      id: createId('joint'),
      partAId: project.parts[0]?.id ?? '',
      partBId: project.parts[1]?.id ?? project.parts[0]?.id ?? '',
      type: '直榫' as JointType,
      count: 1,
      depth: 20,
      offset: 12,
      notes: '',
    };
    setProject((current) => ({ ...current, joinery: [...current.joinery, joint] }));
    setSelectedJointId(joint.id);
  };

  const updateJoint = (patch: Partial<typeof selectedJoint>) => {
    if (!selectedJoint) return;
    setProject((current) => ({
      ...current,
      updatedAt: Date.now(),
      joinery: current.joinery.map((joint) => (joint.id === selectedJoint.id ? { ...joint, ...patch } : joint)),
    }));
  };

  const removeJoint = () => {
    if (!selectedJoint) return;
    setProject((current) => ({ ...current, joinery: current.joinery.filter((joint) => joint.id !== selectedJoint.id) }));
    setSelectedJointId(null);
  };

  return (
    <Grid templateColumns={{ base: '1fr', xl: '330px minmax(0, 1fr)' }} gap="14px">
      <Box borderWidth="1px" borderColor="slate.200" borderRadius="10px" bg="white" overflow="hidden">
        <Flex p="12px" align="center" justify="space-between" borderBottomWidth="1px">
          <Box>
            <Text fontSize="12px" fontWeight="800">榫卯连接</Text>
            <Text fontSize="10px" color="slate.500">{project.joinery.length} 组连接 · 强度 {strength}</Text>
          </Box>
          <Button size="xs" colorScheme="teal" leftIcon={<Plus size={14} />} onClick={addJoint}>新增</Button>
        </Flex>
        <Stack spacing="0" maxH="540px" overflowY="auto">
          {project.joinery.map((joint) => (
            <button
              key={joint.id}
              className={`joint-list-item ${selectedJointId === joint.id ? 'active' : ''}`}
              onClick={() => setSelectedJointId(joint.id)}
            >
              <span className="joint-icon">{JOINT_STRENGTH[joint.type].icon}</span>
              <span>
                <b>{jointLabel(joint, project.parts)}</b>
                <small>{joint.type} × {joint.count} · 深度 {joint.depth} mm</small>
              </span>
            </button>
          ))}
        </Stack>
      </Box>

      <Box borderWidth="1px" borderColor="slate.200" borderRadius="10px" bg="white" p="18px">
        {selectedJoint ? (
          <Stack spacing="16px">
            <Flex justify="space-between" align="start">
              <Box>
                <Text fontSize="10px" color="teal.700" fontWeight="800" letterSpacing=".1em">连接编辑器</Text>
                <Text fontSize="20px" fontWeight="850">{selectedJoint.type}</Text>
                <Text fontSize="11px" color="slate.500" mt="4px">{jointLabel(selectedJoint, project.parts)}</Text>
              </Box>
              <Tooltip label="删除连接">
                <IconButton aria-label="删除连接" colorScheme="red" variant="outline" size="sm" icon={<Trash2 size={16} />} onClick={removeJoint} />
              </Tooltip>
            </Flex>

            <Grid templateColumns={{ base: '1fr', md: '1fr 1fr' }} gap="12px">
              <FormControl>
                <FormLabel>零件 A</FormLabel>
                <Select value={selectedJoint.partAId} onChange={(event) => updateJoint({ partAId: event.target.value })}>
                  {project.parts.map((part) => <option key={part.id} value={part.id}>{part.name}</option>)}
                </Select>
              </FormControl>
              <FormControl>
                <FormLabel>零件 B</FormLabel>
                <Select value={selectedJoint.partBId} onChange={(event) => updateJoint({ partBId: event.target.value })}>
                  {project.parts.map((part) => <option key={part.id} value={part.id}>{part.name}</option>)}
                </Select>
              </FormControl>
              <FormControl>
                <FormLabel>连接类型</FormLabel>
                <Select value={selectedJoint.type} onChange={(event) => updateJoint({ type: event.target.value as JointType })}>
                  {JOINT_TYPES.map((type) => <option key={type}>{type}</option>)}
                </Select>
              </FormControl>
              <FormControl>
                <FormLabel>数量</FormLabel>
                <NumberInput min={1} value={selectedJoint.count} onChange={(_, value) => updateJoint({ count: value || 1 })}>
                  <NumberInputField />
                </NumberInput>
              </FormControl>
              <FormControl>
                <FormLabel>榫深 / 槽深 (mm)</FormLabel>
                <NumberInput min={0} value={selectedJoint.depth} onChange={(_, value) => updateJoint({ depth: value || 0 })}>
                  <NumberInputField />
                </NumberInput>
              </FormControl>
              <FormControl>
                <FormLabel>边距 / 定位 (mm)</FormLabel>
                <NumberInput min={0} value={selectedJoint.offset} onChange={(_, value) => updateJoint({ offset: value || 0 })}>
                  <NumberInputField />
                </NumberInput>
              </FormControl>
            </Grid>
            <FormControl>
              <FormLabel>加工备注</FormLabel>
              <Textarea rows={3} value={selectedJoint.notes} onChange={(event) => updateJoint({ notes: event.target.value })} />
            </FormControl>

            <Divider />
            <Box p="14px" borderRadius="8px" bg="slate.50" borderWidth="1px">
              <HStack justify="space-between">
                <Text fontSize="11px" fontWeight="800">连接强度参考</Text>
                <Badge colorScheme={JOINT_STRENGTH[selectedJoint.type].score > 80 ? 'green' : 'orange'}>
                  {JOINT_STRENGTH[selectedJoint.type].score}/100
                </Badge>
              </HStack>
              <Progress mt="8px" value={JOINT_STRENGTH[selectedJoint.type].score} colorScheme="teal" size="sm" borderRadius="full" />
              <Text mt="8px" fontSize="11px" color="slate.600">{JOINT_STRENGTH[selectedJoint.type].note}</Text>
            </Box>
            <HStack>
              <Button size="sm" variant="outline" leftIcon={<Link2 size={15} />} onClick={() => {
                setSelectedPartId(selectedJoint.partAId);
                window.location.hash = '#/design';
              }}>定位零件 A</Button>
              <Button size="sm" variant="ghost" onClick={() => {
                setSelectedPartId(selectedJoint.partBId);
                window.location.hash = '#/design';
              }}>定位零件 B</Button>
            </HStack>
          </Stack>
        ) : (
          <Flex h="280px" align="center" justify="center" color="slate.500">选择一组榫卯连接进行编辑</Flex>
        )}
        {errors.length > 0 && (
          <Box mt="16px" p="10px" borderRadius="8px" bg="red.50" borderWidth="1px" borderColor="red.200">
            <Text fontSize="11px" fontWeight="800" color="red.700">连接检查</Text>
            {errors.map((error) => <Text key={error} mt="4px" fontSize="10px" color="red.700">• {error}</Text>)}
          </Box>
        )}
      </Box>
    </Grid>
  );
}

