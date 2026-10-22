// workflow 탭과 activity bar의 wireframe page 목록. 사람이 gallery에서 함께 보고 승인한다.
import { type ReactNode, useState } from "react";
import { Workflow } from "lucide-react";
import { Icon } from "@lophn/ui/primitives";
import { iconPixels } from "@lophn/ui/shared";

import {
  type TabItem,
  TabStrip,
} from "../../../../packages/shell/renderer/parts/tab-strip/tab-strip.tsx";
import type { Page } from "../../pages/types.ts";
import { stripTabsOf } from "../../pages/screens/project-window.tsx";
import { documentTab } from "../../mock/phroner-data.ts";
import { click, type, useDrive } from "../../mock/drive.ts";
import {
  DETAILS,
  entryOf,
  EVAL_DETAILS,
  EVAL_SUMMARIES,
  RUNNING_COUNTS,
  WORKFLOWS,
} from "../../mock/workflow-data.ts";
import { ExplorerPanel, Stage, WorkflowFrame } from "./frame.tsx";
import { InstanceView } from "./instance-view.tsx";
import { SidebarWorkflows } from "./sidebar-workflows.tsx";
import { WorkflowBody, type WorkflowNotice } from "./workflow-body.tsx";
import styles from "./workflow.module.css";

const noop = () => {};

const workflowTab = (name: string, title = name): TabItem => ({
  key: `workflow:${name}`,
  title,
  icon: <Icon icon={Workflow} pixels={iconPixels("small")} />,
});

const [DOC_TAB] = stripTabsOf([documentTab("loop/findings/F-009.md")]);

const bodies = (open: string | null) => ({
  explorer: <ExplorerPanel />,
  workflows: (
    <SidebarWorkflows
      entries={WORKFLOWS}
      running={RUNNING_COUNTS}
      open={open}
      onOpen={noop}
    />
  ),
});

type Key = keyof typeof DETAILS;

/** 탭 본문. 목록에서 instance를 고를 수 있다(나머지 단추는 아무것도 하지 않는다). */
function TabBody(
  { name, select = null, notice = null }: {
    name: string;
    select?: Key | null;
    notice?: WorkflowNotice | null;
  },
) {
  const entry = entryOf(name);
  const instances = name === "eval-loop" ? EVAL_SUMMARIES : [];
  const [selected, setSelected] = useState(
    select === null ? null : DETAILS[select].instance.id,
  );
  const [shown, setShown] = useState(notice);
  const detail = EVAL_DETAILS.find((item) => item.instance.id === selected) ??
    null;
  return (
    <WorkflowBody
      entry={entry}
      instances={instances}
      selected={selected}
      detail={detail}
      notice={shown}
      onSelect={setSelected}
      onStart={noop}
      onStop={noop}
      onOpenArtifact={noop}
      onOpenConversation={noop}
      onRefresh={noop}
      onCloseNotice={() => setShown(null)}
    />
  );
}

/** workflow 탭 하나가 선 창. 왼쪽 panel은 Workflows가 열려 있다. */
function TabWindow(
  { name, select, notice, focusItem }: {
    name: string;
    select?: Key | null;
    notice?: WorkflowNotice;
    focusItem?: string;
  },
) {
  return (
    <Stage>
      <WorkflowFrame
        initialPanel="workflows"
        bodies={bodies(name)}
        tabs={[workflowTab(name), DOC_TAB]}
        selected={`workflow:${name}`}
        crumbs={["phroner", name]}
        focusItem={focusItem}
      >
        <TabBody name={name} select={select} notice={notice} />
      </WorkflowFrame>
    </Stage>
  );
}

function StartDialogPage() {
  useDrive(async () => {
    await click("[data-start]");
    await type(
      '[role="dialog"] textarea',
      "Compare the quest tool changes on the full ftb quests scenario set",
    );
  });
  return <TabWindow name="eval-loop" select="running" />;
}

function FlowPage() {
  // disabled [Start]는 focus를 못 받아서 tooltip을 받는 틀에 focus를 준다.
  useDrive(async () => {
    await click("[data-start-tip]");
    document.querySelector<HTMLElement>("[data-start-tip]")?.focus();
  });
  return <TabWindow name="nightly-flow" />;
}

/** activity bar가 열린 Explorer, Workflows, 접힌 모양, 좁은 창. */
function BarWindow(
  { panel, focusItem, narrow }: {
    panel: string | null;
    focusItem?: string;
    narrow?: boolean;
  },
) {
  return (
    <Stage>
      <WorkflowFrame
        initialPanel={panel}
        bodies={bodies("eval-loop")}
        tabs={[workflowTab("eval-loop"), DOC_TAB]}
        selected="workflow:eval-loop"
        crumbs={["phroner", "eval-loop"]}
        focusItem={focusItem}
        narrow={narrow}
      >
        <TabBody name="eval-loop" select="running" />
      </WorkflowFrame>
    </Stage>
  );
}

/** Workflows panel의 두 상태를 위아래로 둔다: 줄이 있는 project, 비어 있는 project. */
function WorkflowsPanelPage() {
  return (
    <Stage>
      <WorkflowFrame
        initialPanel="workflows"
        bodies={bodies("eval-loop")}
        tabs={[workflowTab("eval-loop"), DOC_TAB]}
        selected="workflow:eval-loop"
        crumbs={["phroner", "eval-loop"]}
      >
        <TabBody name="eval-loop" select="running" />
      </WorkflowFrame>
      <div>
        <p className={styles.caption}>A project without workflows</p>
        <aside className={styles.panel} aria-label="Workflows">
          <div className={styles.panelHead}>Workflows</div>
          <div className={styles.panelBody}>
            <SidebarWorkflows
              entries={[]}
              running={{}}
              open={null}
              onOpen={noop}
            />
          </div>
        </aside>
      </div>
    </Stage>
  );
}

function IdentityOption(
  { caption, tabs, selected, children }: {
    caption: string;
    tabs: readonly TabItem[];
    selected: string;
    children: ReactNode;
  },
) {
  return (
    <div className={styles.identity}>
      <p className={styles.caption}>{caption}</p>
      <TabStrip tabs={tabs} selected={selected} />
      <div className={styles.identityBody}>{children}</div>
    </div>
  );
}

/** 탭 줄 두 줄: workflow당 탭 하나 / instance당 탭 하나. 같은 workflow의 instance 둘이 열렸을 때다. */
function TabIdentityPage() {
  const first = DETAILS.running;
  const second = DETAILS.humanTurn;
  return (
    <Stage>
      <IdentityOption
        caption="A · One tab per workflow (recommended). Both instances live inside the eval-loop tab."
        tabs={[workflowTab("eval-loop"), workflowTab("paper-review"), DOC_TAB]}
        selected="workflow:eval-loop"
      >
        <TabBody name="eval-loop" select="running" />
      </IdentityOption>
      <IdentityOption
        caption="B · One tab per instance. The same workflow takes two tabs."
        tabs={[
          workflowTab(
            `eval-loop:${first.instance.id}`,
            "eval-loop · Plan the next round…",
          ),
          workflowTab(
            `eval-loop:${second.instance.id}`,
            "eval-loop · Check whether the chest…",
          ),
          workflowTab("paper-review"),
          DOC_TAB,
        ]}
        selected={`workflow:eval-loop:${first.instance.id}`}
      >
        <div className={styles.page}>
          <InstanceView
            detail={first}
            hasArtifact
            onStop={noop}
            onOpenArtifact={noop}
            onOpenConversation={noop}
          />
        </div>
      </IdentityOption>
    </Stage>
  );
}

export const workflowPages: readonly Page[] = [
  {
    id: "draft-workflow-tab-empty",
    title: "Workflow tab · no instances",
    description:
      "instance가 없는 workflow의 탭이다. 머리에 이름과 [Start]가 있고 본문에는 안내 한 문장과 [Start]가 있다. 왼쪽 Workflows panel이 열려 있다.",
    render: () => <TabWindow name="paper-review" />,
  },
  {
    id: "draft-workflow-tab-running",
    title: "Workflow tab · running",
    description:
      "도는 instance를 고른 탭이다. step마다 담당, 마지막 report 글, 줄 펼침이 있고 지금 step은 In progress로 보이며 줄이 펼쳐져 있다. 머리에 [Stop]이 있다.",
    render: () => <TabWindow name="eval-loop" select="running" />,
  },
  {
    id: "draft-workflow-tab-human-turn",
    title: "Workflow tab · your turn",
    description:
      "사람 step이다. Your turn 표시와 그 step을 받은 agent 이름, 오른쪽 끝 [Open conversation]이 있다. 이 단추는 이 wireframe이 새로 더한 것이다.",
    render: () => <TabWindow name="eval-loop" select="humanTurn" />,
  },
  {
    id: "draft-workflow-tab-ended",
    title: "Workflow tab · ended",
    description:
      "끝난 instance다. 모든 step이 Reported이고 머리 아래 Ended 줄이 있다. [Stop]이 없다.",
    render: () => <TabWindow name="eval-loop" select="ended" />,
  },
  {
    id: "draft-workflow-tab-stopped",
    title: "Workflow tab · stopped",
    description:
      "사람이 멈춘 instance다. 상태가 Stopped이고 멈춘 step에 Stopped here, 머리 아래에 멈춘 시각이 보인다. [Stop]이 없다.",
    render: () => <TabWindow name="eval-loop" select="stopped" />,
  },
  {
    id: "draft-workflow-tab-not-handed",
    title: "Workflow tab · couldn't send a step",
    description:
      "다음 step을 넘기지 못한 instance다. 그 step 줄 안에 이유 글 한 줄이 보인다. 상태는 그대로 Running이다.",
    render: () => <TabWindow name="eval-loop" select="notHanded" />,
  },
  {
    id: "draft-workflow-tab-restarted",
    title: "Workflow tab · lophn restarted",
    description:
      "lophn이 다시 켜져 넘긴 step이 끊겼을 수 있는 instance다. 그 step 줄에 lophn이 다시 켜졌고 다시 넘겨야 할 수 있다는 글이 보인다. 상태는 바꾸지 않는다.",
    render: () => <TabWindow name="eval-loop" select="restarted" />,
  },
  {
    id: "draft-workflow-tab-invalid",
    title: "Workflow tab · invalid declaration",
    description:
      "선언이 틀린 workflow다. 머리 아래에 이유 글이 있고 [Start]가 없다. Workflows panel의 줄에도 오류 표시가 있다.",
    render: () => <TabWindow name="broken-draft" />,
  },
  {
    id: "draft-workflow-tab-flow",
    title: "Workflow tab · flow",
    description:
      "kind가 flow인 workflow다. [Start]가 꺼져 있고 이유를 tooltip으로 보인다(열어 둠).",
    render: () => <FlowPage />,
  },
  {
    id: "draft-workflow-tab-artifact",
    title: "Workflow tab · with artifacts",
    description:
      "artifact가 있는 workflow다. [Open artifact]가 둘이다: 머리의 것은 workflow 전체(static), instance 머리의 [Open instance artifact]는 고른 instance 것을 연다.",
    render: () => <TabWindow name="eval-loop" select="ended" />,
  },
  {
    id: "draft-workflow-start-dialog",
    title: "Start dialog",
    description:
      "[Start]가 여는 dialog다. 입력 글(필수)과 시작할 step을 받고 기본은 첫 step이다. 글을 채워 [Start]를 누를 수 있는 상태다.",
    render: () => <StartDialogPage />,
  },
  {
    id: "draft-workflow-start-failed",
    title: "Start failed",
    description:
      "시작이 실패해 탭 위쪽에 toast가 뜬 상태다. 색 띠나 상자를 쓰지 않고 design Toast를 쓴다. 멈춤이 실패해도 같은 자리다.",
    render: () => (
      <TabWindow
        name="eval-loop"
        select="running"
        notice={{
          title: "Couldn't start eval-loop",
          body:
            "The step review is gone from the declaration. Pick another step and try again.",
        }}
      />
    ),
  },
  {
    id: "draft-activity-bar-explorer",
    title: "Activity bar · Explorer open",
    description:
      "왼쪽 끝 56px icon 줄이다. 위쪽에 Explorer, Agents, Artifacts, Domains, Workflows, 아래쪽에 Terminal, Agent, Search 바로 가기가 있다. 열린 Explorer에 왼쪽 띠와 배경이 있다.",
    render: () => <BarWindow panel="explorer" />,
  },
  {
    id: "draft-activity-bar-workflows",
    title: "Activity bar · Workflows open",
    description:
      "Workflows panel이다. 도는 instance가 있는 줄, 아무것도 안 도는 줄, 오류 workflow 줄, flow 줄이 위에 있고 workflow가 없는 project의 안내가 아래에 있다.",
    render: () => <WorkflowsPanelPage />,
  },
  {
    id: "draft-activity-bar-collapsed",
    title: "Activity bar · collapsed",
    description:
      "열린 icon을 다시 누르면 panel이 접히고 bar만 남는다. 열린 항목 표시도 없다. Workflows icon에 tooltip이 열려 있다.",
    render: () => <BarWindow panel={null} focusItem="workflows" />,
  },
  {
    id: "draft-activity-bar-narrow",
    title: "Activity bar · narrow window",
    description:
      "창이 좁을 때(640px)다. panel이 자동으로 접혀 bar만 남고 탭 줄과 본문은 줄어든 폭 안에서 겹치거나 잘리지 않는다.",
    render: () => <BarWindow panel={null} narrow />,
  },
  {
    id: "draft-workflow-tab-identity",
    title: "Workflow tab identity",
    description:
      "탭의 정체성 두 안을 탭 줄로 비교한다. A는 workflow 하나가 탭 하나(추천)이고 instance는 탭 안에서 고른다. B는 instance 하나가 탭 하나라서 같은 workflow의 instance 둘이 탭 둘이 된다.",
    render: () => <TabIdentityPage />,
  },
];
