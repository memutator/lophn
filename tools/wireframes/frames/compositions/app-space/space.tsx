// 앱 공간 틀. title bar 아래는 앱 화면이 전부 쓰고, 오른쪽에 agent·터미널 pane과 운영 패널(앱 상세)이 앱 화면 옆에 붙는다.
// 탭 줄은 없다. 실제 TopBar·LauncherButton과 design component를 쓰고, agent select 메뉴는 펼친 모양을 고정하려고 같은 CSS Module로 짠 look-alike다.
import { Flag, type LucideIcon } from "lucide-react";
import { useState } from "react";
import {
  Avatar,
  Button,
  Icon,
  IconButton,
  iconPixels,
  StatusMark,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  Tooltip,
  VendorIcon,
} from "@lophn/design/components";
import {
  appSpaceIcons,
  conversationIcons,
  editorIcons,
  workspaceIcons,
} from "../../../../../packages/shell/renderer/icons/mod.ts";

import { LauncherButton } from "../../../../../packages/shell/renderer/workspace/launcher-button.tsx";
import menuStyles from "../../../../../packages/design/components/menu/menu.module.css";

import {
  PaletteButton,
  TopBar,
} from "../../../../../packages/shell/renderer/desktop/top-bar/top-bar.tsx";
import { APP_NAME } from "./data.ts";
import { AccessTab } from "./access-tab.tsx";
import { ActivityTab } from "./activity-tab.tsx";
import { type Annotation, AnnotationPanel } from "./annotate.tsx";
import type { CodingScene } from "./coding-tab.tsx";
import { IssuesTab } from "./issues-tab.tsx";
import { OrdersView, type ViewMarks } from "./orders-view.tsx";
import { ProjectPicker } from "./project-picker.tsx";
import { ReportDialog } from "./report-dialog.tsx";
import type { RewindStage } from "./rewind-panel.tsx";
import { AGENT_ICON, type PaneView, SidePane } from "./side-pane.tsx";
import { PaneToast } from "./toast.tsx";
import { type ActivationState, VersionTab } from "./version-tab.tsx";
import styles from "./app-space.module.css";

export type OpsTab = "version" | "access" | "activity" | "issues";

export interface AppSpaceProps {
  /** 처음에 열린 운영 패널 탭. 없으면 패널이 닫혀 있다. */
  readonly panel?: OpsTab;
  readonly version?: ActivationState;
  /** Access 탭에서 이미 거두기를 요청한 항목. */
  readonly revoking?: readonly string[];
  readonly activity?: {
    readonly open?: string | null;
    readonly rewind?: RewindStage | null;
  };
  readonly issue?: string | null;
  /** agent select를 펼친 채 시작한다. */
  readonly agentMenu?: boolean;
  /** 제보 dialog를 연 채 시작한다. */
  readonly report?: {
    readonly existing?: boolean;
    readonly chosen?: string | null;
  };
  /** annotate mode를 켠 채 시작한다. */
  readonly annotate?: {
    readonly marks: ViewMarks;
    readonly items: readonly Annotation[];
    /** 모은 annotation 목록을 보인다. */
    readonly list?: boolean;
  };
  /** project를 정하지 못한 채 열려 project 고르기를 보인다. */
  readonly picker?: boolean;
  /** 옆 pane을 열어 둔다. 보이는 것과 agent. */
  readonly pane?: { readonly view?: PaneView; readonly agent?: string };
  /** lophn이 연 coding 터미널이 있다. pane 머리에서 agent와 바꿔 본다. */
  readonly terminal?: CodingScene;
  /** 열려 있는 pane 위쪽에 toast를 띄운 채 시작한다. */
  readonly openedToast?: boolean;
}

const AGENTS = [
  "lophn",
  "App Engineer",
  "Order analyst",
  "Shipping planner",
] as const;

function AgentSelect(
  { open, pane, onToggle, onPick }: {
    open: boolean;
    /** 옆 pane이 열려 있으면 단추가 눌린 모양이다. */
    pane: boolean;
    onToggle: () => void;
    onPick: (agent: string | null) => void;
  },
) {
  return (
    <span className={styles.barAnchor}>
      <Tooltip content="Agent">
        <Button
          variant="ghost"
          icon={conversationIcons.dock}
          aria-label="Agent"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-pressed={pane || open}
          onClick={onToggle}
        >
          <Icon icon={editorIcons.detailsClosed} pixels={iconPixels("small")} />
        </Button>
      </Tooltip>
      {open
        ? (
          <div
            className={`${menuStyles.menu} ${styles.menuDrop}`}
            role="menu"
            style={{ minWidth: "200px" }}
          >
            {AGENTS.map((agent) => (
              <div
                key={agent}
                role="menuitem"
                className={menuStyles.item}
                onClick={() => onPick(agent)}
              >
                <Avatar
                  profile={{ kind: "icon", icon: AGENT_ICON[agent] }}
                  size="sm"
                />
                <span>{agent}</span>
              </div>
            ))}
            <div
              role="menuitem"
              className={menuStyles.item}
              onClick={() => onPick(null)}
            >
              Manage
            </div>
          </div>
        )
        : null}
    </span>
  );
}

/** 위쪽 바의 아이콘 단추. 글자 없이 tooltip(label)만 있고, 켜져 있으면 눌린 모양이다. */
function BarIcon(
  { icon, label, pressed, onClick }: {
    icon: LucideIcon;
    label: string;
    pressed?: boolean;
    onClick: () => void;
  },
) {
  return (
    <Tooltip content={label}>
      <IconButton
        icon={icon}
        label={label}
        aria-pressed={pressed}
        onClick={onClick}
      />
    </Tooltip>
  );
}

export function AppSpace(props: AppSpaceProps = {}) {
  const { panel, version, revoking, activity, issue, terminal } = props;
  const [panelTab, setPanelTab] = useState<OpsTab>(panel ?? "version");
  const [panelOpen, setPanelOpen] = useState(panel !== undefined);
  const [menu, setMenu] = useState(props.agentMenu ?? false);
  const [report, setReport] = useState(props.report !== undefined);
  const [annotating, setAnnotating] = useState(props.annotate !== undefined);
  const [hint, setHint] = useState(true);
  const [sent, setSent] = useState<number | null>(null);
  const items: readonly Annotation[] = props.annotate?.items ?? [];
  const [listOpen, setListOpen] = useState(props.annotate?.list ?? false);
  const [removed, setRemoved] = useState<ReadonlySet<number>>(new Set());
  const [picker, setPicker] = useState(props.picker ?? false);
  const [project, setProject] = useState<string | null>(null);
  const [pane, setPane] = useState(
    props.pane === undefined ? null : {
      view: props.pane.view ?? "agent",
      agent: props.pane.agent ?? "App Engineer",
    },
  );
  const [opened, setOpened] = useState(props.openedToast ?? false);

  const marks = props.annotate?.marks ?? {};
  const shown: ViewMarks = {
    ...marks,
    picked: Object.fromEntries(
      Object.entries(marks.picked ?? {}).filter(([, mark]) =>
        !removed.has(mark.n)
      ),
    ),
    area: marks.area?.n !== undefined && removed.has(marks.area.n)
      ? undefined
      : marks.area,
  };

  return (
    <div className={styles.window}>
      <div className={styles.topBar}>
        <TopBar
          platform="linux"
          leading={
            <div className={styles.barLeading}>
              <LauncherButton onLauncher={() => {}} />
              <span className={styles.barName}>{APP_NAME}</span>
              <StatusMark tone="good" label="Running" />
              {project === null
                ? null
                : <span className={styles.muted}>· {project}</span>}
            </div>
          }
          trailing={
            <div className={styles.barTrailing}>
              <BarIcon
                icon={editorIcons.edit}
                label="Annotate"
                pressed={annotating}
                onClick={() => {
                  setAnnotating(!annotating);
                  setHint(true);
                  setSent(null);
                }}
              />
              <BarIcon
                icon={Flag}
                label="Report a problem"
                onClick={() => setReport(true)}
              />
              <span className={styles.barSep} aria-hidden="true" />
              <AgentSelect
                open={menu}
                pane={pane !== null}
                onToggle={() => setMenu(!menu)}
                onPick={(agent) => {
                  setMenu(false);
                  if (agent !== null) setPane({ view: "agent", agent });
                }}
              />
              <BarIcon
                icon={appSpaceIcons.appDetails}
                label="App details"
                pressed={panelOpen}
                onClick={() => setPanelOpen(!panelOpen)}
              />
              <span className={styles.barSep} aria-hidden="true" />
              <PaletteButton />
            </div>
          }
        />
      </div>
      <div className={styles.content}>
        <div className={styles.appWrap}>
          <OrdersView marks={annotating ? shown : {}} />
          {annotating && listOpen
            ? (
              <AnnotationPanel
                items={items.filter((item) => !removed.has(item.n))}
                onRemove={(n) => setRemoved(new Set([...removed, n]))}
                onClear={() => setRemoved(new Set(items.map((i) => i.n)))}
                onSend={() => {
                  setSent(items.length - removed.size);
                  setListOpen(false);
                  setAnnotating(false);
                }}
              />
            )
            : null}
          {sent !== null
            ? (
              <PaneToast
                title={`${sent} annotations sent to App Engineer`}
                body="They arrive in its session as one message."
                onClose={() => setSent(null)}
              />
            )
            : annotating && hint
            ? (
              <PaneToast
                title="Annotate is on"
                body="Click an element or drag an area, then write a note."
                action={{
                  label: "Done",
                  onClick: () => setAnnotating(false),
                }}
                onClose={() => setHint(false)}
              />
            )
            : null}
          {picker
            ? (
              <ProjectPicker
                onPick={(name) => {
                  setProject(name);
                  setPicker(false);
                }}
              />
            )
            : null}
        </div>
        {pane === null ? null : (
          <SidePane
            view={pane.view}
            agent={pane.agent}
            terminal={terminal}
            onView={(view) => setPane({ ...pane, view })}
            onClose={() => setPane(null)}
            toast={opened
              ? (
                <PaneToast
                  below
                  lead={<VendorIcon vendor="claude-code" size={16} />}
                  title="App Engineer opened Claude Code for ticket ORD-12"
                  body="Round discounted totals to the nearest cent"
                  action={{
                    label: "Show terminal",
                    onClick: () => {
                      setPane({ ...pane, view: "terminal" });
                      setOpened(false);
                    },
                  }}
                  onClose={() => setOpened(false)}
                />
              )
              : undefined}
          />
        )}
        {panelOpen
          ? (
            <aside className={styles.panel} aria-label="App details">
              <div className={styles.panelHead}>
                <h2 className={styles.panelTitle}>App details</h2>
                <IconButton
                  icon={workspaceIcons.close}
                  label="Close"
                  size="sm"
                  onClick={() => setPanelOpen(false)}
                />
              </div>
              <div className={styles.panelBody}>
                <h3 className={styles.appName}>{APP_NAME}</h3>
                <Tabs
                  value={panelTab}
                  onValueChange={(value) => setPanelTab(value as OpsTab)}
                >
                  <TabList>
                    <Tab value="version" size="sm">Version</Tab>
                    <Tab value="access" size="sm">Access</Tab>
                    <Tab value="activity" size="sm">Activity</Tab>
                    <Tab value="issues" size="sm">Issues</Tab>
                  </TabList>
                  <TabPanel value="version">
                    <VersionTab state={version} />
                  </TabPanel>
                  <TabPanel value="access">
                    <AccessTab revoking={revoking} />
                  </TabPanel>
                  <TabPanel value="activity">
                    <ActivityTab
                      open={activity?.open}
                      rewind={activity?.rewind}
                    />
                  </TabPanel>
                  <TabPanel value="issues">
                    <IssuesTab open={issue} />
                  </TabPanel>
                </Tabs>
              </div>
            </aside>
          )
          : null}
      </div>
      <ReportDialog
        open={report}
        onOpenChange={setReport}
        existing={props.report?.existing}
        chosen={props.report?.chosen}
      />
    </div>
  );
}
