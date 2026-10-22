// job 제목 줄의 page. 새 CSS 없이 기존 sidebar·workflow class만 쓴다(그래서 stage의 배치는 inline style이다).
import type { CSSProperties, ReactNode } from "react";
import { t } from "@lophn/wording";

import type { Page } from "../../pages/types.ts";
import { SIDEBAR_WIDTH } from "../../../../packages/shell/renderer/workspace/model.ts";
import sidebar from "../../../../packages/shell/renderer/workspace/sidebar/project-sidebar.module.css";
import {
  APP_RUNS,
  INSTANCES,
  SIDEBAR_RUNS,
} from "../../mock/jobs-origin-data.ts";
import { InstanceHead, InstanceRows } from "./instance-rows.tsx";
import { RunRows } from "./run-rows.tsx";

const STAGE: CSSProperties = {
  position: "absolute",
  inset: "var(--space-0)",
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "center",
  gap: "var(--space-9)",
  padding: "var(--space-9)",
  overflow: "auto",
  background: "var(--color-surface-base)",
  color: "var(--color-text-primary)",
  fontFamily: "var(--font-sans)",
};

const COLUMN: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-4)",
  width: `${SIDEBAR_WIDTH + 40}px`,
};

const CAPTION: CSSProperties = {
  margin: 0,
  color: "var(--color-text-muted)",
  fontSize: "var(--type-caption-size)",
  lineHeight: "var(--type-caption-line)",
};

// 두 목록이 놓이는 면. sidebar는 바탕보다 한 단 낮은 면이고 앱 공간 panel은 바탕과 같다.
const sidebarFace = (low: boolean): CSSProperties => ({
  padding: "var(--space-4)",
  border: "var(--border-width) solid var(--color-border-base)",
  borderRadius: "var(--radius-md)",
  background: low ? "var(--color-surface-subtle)" : "var(--color-surface-base)",
});

function Column(
  { caption, children }: { caption: string; children: ReactNode },
) {
  return (
    <div style={COLUMN}>
      <p style={CAPTION}>{caption}</p>
      {children}
    </div>
  );
}

export const jobsOriginPages: readonly Page[] = [
  {
    id: "draft-jobs-origin-runs",
    title: "Background · scheduled jobs",
    description:
      "Background 묶음에 일반 run 줄과 job이 연 run 줄이 나란히 있다(왼쪽 project sidebar, 오른쪽 앱 공간). job 줄은 이름 자리에 job 제목, 둘째 줄에 'agent 이름 또는 tool 이름 · 시각'이고 avatar는 받은 agent 그대로다. 지운 job의 옛 줄은 일반 줄과 같다. 제목을 붙이는 모양을 정한다.",
    render: () => (
      <div style={STAGE}>
        <Column caption="Project sidebar · Background">
          <div style={sidebarFace(true)}>
            <h2 className={sidebar.sectionLabel}>
              {t("run-list.heading.background")}
            </h2>
            <RunRows runs={SIDEBAR_RUNS} />
          </div>
        </Column>
        <Column caption="App space · Background">
          <div style={sidebarFace(false)}>
            <RunRows runs={APP_RUNS} />
          </div>
        </Column>
      </div>
    ),
  },
  {
    id: "draft-jobs-origin-instances",
    title: "Workflow · started by a job",
    description:
      "workflow 탭의 instance 목록 줄과 instance 머리에 시작한 쪽이 job이면 'Scheduled job · 제목'과 'Started by Scheduled job 제목'이 붙는다. 사람이 시작한 줄에는 아무것도 붙지 않고, 지운 job이 시작한 것은 제목 없이 'Scheduled job'과 'Started by a scheduled job'이다. 시작한 쪽을 보이는 모양을 정한다.",
    render: () => (
      <div style={{ ...STAGE, flexDirection: "column", alignItems: "center" }}>
        <Column caption="Instances">
          <InstanceRows instances={INSTANCES} selected={INSTANCES[0].id} />
        </Column>
        <Column caption="Instance · started by a job">
          <InstanceHead item={INSTANCES[0]} />
        </Column>
        <Column caption="Instance · job deleted">
          <InstanceHead item={INSTANCES[2]} />
        </Column>
      </div>
    ),
  },
];
