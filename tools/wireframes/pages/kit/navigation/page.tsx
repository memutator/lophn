// Kit · navigation. @lophn/ui/navigation의 Tabs.
import { Tab, TabList, TabPanel, Tabs } from "@lophn/ui/navigation";

import { kit, Page, Section } from "../kit.tsx";

export function KitNavigation() {
  return (
    <Page>
      <Section title="Tabs" note="일반 탭. 작업대의 문서 탭 줄은 따로 있다.">
        <Tabs defaultValue="connections">
          <TabList>
            <Tab value="connections">Connections</Tab>
            <Tab value="general">General</Tab>
            <Tab value="update" disabled>Update</Tab>
          </TabList>
          <TabPanel value="connections">
            <p className={kit.note}>활성 탭 아래 2px 표시와 본문 간격 24px.</p>
          </TabPanel>
          <TabPanel value="general">{null}</TabPanel>
          <TabPanel value="update">{null}</TabPanel>
        </Tabs>
      </Section>
    </Page>
  );
}
