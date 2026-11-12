// workflow 탭 gallery. 실제 WorkflowPage를 Workspace 없이 세운다(card만 같은 모양으로 두른다).
// 바탕은 fake source가 정하고 사람이 하는 것(dialog 열기, 입력 채우기)은 drive가 한다. 화면에 gallery 전용 prop은 없다.
import { useMemo, useState } from "react";

import { EventsProvider } from "../../../../../packages/shell/renderer/desktop/connection/events/hooks.tsx";
import { createEventClient } from "../../../../../packages/shell/renderer/desktop/connection/events/client.ts";
import { createFakeSource } from "../../../../../packages/shell/renderer/desktop/connection/events/fake-source.ts";
import { ContentCard } from "../../../../../packages/shell/renderer/shell/content-card.tsx";
import { workflowTab } from "../../../../../packages/shell/renderer/workspace/kinds/workflow.tsx";
import {
  FAKE_WORKFLOW_INSTANCES,
  FAKE_WORKFLOWS,
  fakeWorkspaceSource,
} from "../../../../../packages/shell/renderer/workspace/fake-source.ts";
import { PaddedTab } from "../../../../../packages/shell/renderer/workspace/padded-tab.tsx";
import { WorkflowPage } from "../../../../../packages/shell/renderer/workflow/workflow-page.tsx";
import type { WorkspaceSource } from "../../../../../packages/shell/renderer/workspace/source.ts";
import { click, type, useDrive } from "../../../mock/drive.ts";

const noop = () => {};

// FAKE_WORKFLOW_INSTANCES의 순서: running, humanTurn, notHanded, restarted, ended, stopped,
// 그 뒤에 nightly-flow의 도는 것, program_exited로 닫힌 것, 켜질 때 닫힌 것.
const [
  RUNNING,
  HUMAN_TURN,
  NOT_HANDED,
  RESTARTED,
  ENDED,
  STOPPED,
  FLOW_RUNNING,
  FLOW_EXITED,
  FLOW_RESTARTED,
] = FAKE_WORKFLOW_INSTANCES.map((detail) => detail.instance.id);

const PROJECT = FAKE_WORKFLOWS[0].project;

/** workflow 탭 한 개가 선 창. 본문은 실제 card처럼 여백 없이 붙고 page가 스스로 여백을 둔다. */
function WorkflowWindow({
  name,
  instance = null,
  source: given,
}: {
  name: string;
  /** 탭이 처음 고른 instance. */
  instance?: string | null;
  source?: WorkspaceSource;
}) {
  const source = useMemo(() => given ?? fakeWorkspaceSource(), [given]);
  const client = useMemo(() => createEventClient(createFakeSource()), []);
  const [selected, setSelected] = useState(instance);
  const tab = workflowTab(name);
  return (
    <EventsProvider client={client}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          padding: "var(--space-4)",
          background: "var(--color-surface-shell)",
        }}
      >
        <ContentCard
          panes={[
            {
              key: tab.key,
              crumbs: ["phroner", tab.title],
              body: (
                <PaddedTab bare>
                  <WorkflowPage
                    project={PROJECT}
                    workflow={name}
                    instance={selected}
                    source={source}
                    onInstance={setSelected}
                    onOpenArtifact={noop}
                    onOpenConversation={noop}
                  />
                </PaddedTab>
              ),
            },
          ]}
          focus="a"
          deskLabel="Main"
          onFocus={noop}
          onAction={noop}
          onEmptyAction={noop}
        />
      </div>
    </EventsProvider>
  );
}

export const Empty = () => <WorkflowWindow name="paper-review" />;
export const Running = () => (
  <WorkflowWindow name="eval-loop" instance={RUNNING} />
);
export const HumanTurn = () => (
  <WorkflowWindow name="eval-loop" instance={HUMAN_TURN} />
);
export const Ended = () => <WorkflowWindow name="eval-loop" instance={ENDED} />;
export const Stopped = () => (
  <WorkflowWindow name="eval-loop" instance={STOPPED} />
);
export const NotHanded = () => (
  <WorkflowWindow name="eval-loop" instance={NOT_HANDED} />
);
export const Restarted = () => (
  <WorkflowWindow name="eval-loop" instance={RESTARTED} />
);
export const Invalid = () => <WorkflowWindow name="broken-draft" />;

export const Flow = () => (
  <WorkflowWindow name="nightly-flow" instance={FLOW_RUNNING} />
);
export const FlowExited = () => (
  <WorkflowWindow name="nightly-flow" instance={FLOW_EXITED} />
);
export const FlowRestarted = () => (
  <WorkflowWindow name="nightly-flow" instance={FLOW_RESTARTED} />
);

export function FlowMissing() {
  // disabled [Start]는 focus를 못 받아서 tooltip을 받는 틀에 focus를 준다.
  useDrive(async () => {
    await click("[data-start-tip]");
    document.querySelector<HTMLElement>("[data-start-tip]")?.focus();
  });
  return <WorkflowWindow name="missing-flow" />;
}

// [Start]를 눌러 dialog를 열고 입력 글을 채운다.
const fillStartDialog = async () => {
  await click("[data-start]");
  await type(
    '[role="dialog"] textarea',
    "Compare the quest tool changes on the full ftb quests scenario set",
  );
};

export function StartDialog() {
  useDrive(fillStartDialog);
  return <WorkflowWindow name="eval-loop" instance={RUNNING} />;
}

export function StartDialogFlow() {
  useDrive(fillStartDialog);
  return <WorkflowWindow name="nightly-flow" instance={FLOW_RUNNING} />;
}

export function StartFailed() {
  const source = useMemo(
    () => ({
      ...fakeWorkspaceSource(),
      startWorkflow: () =>
        Promise.resolve({ ok: false as const, message: "internal" }),
    }),
    [],
  );
  useDrive(async () => {
    await fillStartDialog();
    await click('[role="dialog"] button', "Start");
  });
  return <WorkflowWindow name="eval-loop" instance={RUNNING} source={source} />;
}
