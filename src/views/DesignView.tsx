import { Box, Tab, TabList, TabPanel, TabPanels, Tabs, Text } from '@chakra-ui/react';
import { PartsPanel } from '../components/PartsPanel';
import { JoineryPanel } from '../components/JoineryPanel';

export function DesignView() {
  return (
    <main className="page-shell">
      <Box mb="14px">
        <Text className="eyebrow">STEP 01 · 结构与连接</Text>
        <Text className="page-title">零件与榫卯设计</Text>
        <Text className="page-desc">定义每个零件的成品尺寸、板材归属和纹理方向，再配置榫卯连接方式。任何修改都会立即可用于排料。</Text>
      </Box>
      <Tabs colorScheme="teal" variant="soft-rounded">
        <TabList mb="14px">
          <Tab fontSize="12px" fontWeight="700">零件建模</Tab>
          <Tab fontSize="12px" fontWeight="700">榫卯连接</Tab>
        </TabList>
        <TabPanels>
          <TabPanel p="0"><PartsPanel /></TabPanel>
          <TabPanel p="0"><JoineryPanel /></TabPanel>
        </TabPanels>
      </Tabs>
    </main>
  );
}

