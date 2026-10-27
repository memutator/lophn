// Kit · navigation. @lophn/ui/navigation의 Tabs·TabList·Tab·TabPanel과 Sidebar.
import { BookOpen, LayoutDashboard, Settings } from "lucide-react";
import { Sidebar, Tab, TabList, TabPanel, Tabs } from "@lophn/ui/navigation";
import { AppShell } from "@lophn/ui/layout";

import { kit, Page, Row, Section } from "../kit.tsx";

const PLAIN = [
  { id: "overview", label: "Overview" },
  { id: "guide", label: "Guide" },
  { id: "settings", label: "Settings" },
];

const WITH_ICONS = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "guide", label: "Guide", icon: BookOpen },
  { id: "settings", label: "Settings", icon: Settings },
];

function Demo({
  size,
  selected = "connections",
  disabled = false,
}: {
  size?: "sm" | "md" | "lg";
  selected?: string;
  disabled?: boolean;
}) {
  return (
    <Tabs defaultValue={selected}>
      <TabList>
        <Tab value="connections" size={size}>
          Connections
        </Tab>
        <Tab value="general" size={size}>
          General
        </Tab>
        <Tab value="update" size={size} disabled={disabled}>
          Update
        </Tab>
      </TabList>
      <TabPanel value="connections">
        <p className={kit.note}>Connections panel</p>
      </TabPanel>
      <TabPanel value="general">
        <p className={kit.note}>General panel</p>
      </TabPanel>
      <TabPanel value="update">
        <p className={kit.note}>Update panel</p>
      </TabPanel>
    </Tabs>
  );
}

function Nav({
  items,
  current,
}: {
  items: typeof PLAIN | typeof WITH_ICONS;
  current?: string;
}) {
  return (
    <div style={{ width: "var(--layout-container-card)" }}>
      <Sidebar items={items} current={current} onSelect={() => {}} />
    </div>
  );
}

export function KitNavigation() {
  return (
    <Page>
      <Section
        title="Tabs · Tab · TabList · TabPanel"
        note="일반 탭. 한 화면 안의 같은 층 보기를 오간다. 작업대의 문서 탭 줄은 따로 있다."
      >
        <Row label="first selected">
          <Demo />
        </Row>
        <Row label="second selected">
          <Demo selected="general" />
        </Row>
        <Row label="disabled tab">
          <Demo disabled />
        </Row>
        <Row label="size sm">
          <Demo size="sm" />
        </Row>
        <Row label="size md">
          <Demo size="md" />
        </Row>
        <Row label="size lg">
          <Demo size="lg" />
        </Row>
      </Section>
      <Section
        title="Sidebar"
        note="앱 화면 사이를 오가는 목록이다. 한 화면 안의 보기 전환은 Tabs다. 좁은 영역에서는 AppShell이 가로 한 줄로 바꾼다."
      >
        <Row label="no current">
          <Nav items={PLAIN} />
        </Row>
        <Row label="current item">
          <Nav items={PLAIN} current="guide" />
        </Row>
        <Row label="with icons">
          <Nav items={WITH_ICONS} current="overview" />
        </Row>
        <Row label="in panel AppShell">
          <div
            className={kit.frameStage}
            style={{ width: "480px", height: 160 }}
          >
            <AppShell
              title="Orders"
              nav={
                <Sidebar
                  items={WITH_ICONS}
                  current="overview"
                  onSelect={() => {}}
                />
              }
            >
              <p className={kit.note}>screen</p>
            </AppShell>
          </div>
        </Row>
      </Section>
    </Page>
  );
}
