// workflow 탭 gallery. 실제 WorkflowPage를 Workspace 없이 세운다(card만 같은 모양으로 두른다).
// 바탕은 fake source가 정하고 사람이 하는 것(dialog 열기, 입력 채우기)은 drive가 한다. 화면에 gallery 전용 prop은 없다.
import { useMemo, useState } from "react";
import { createEventClient } from "../../../../../packages/shell/renderer/desktop/connection/events/client.ts";
import { createFakeSource } from "../../../../../packages/shell/renderer/desktop/connection/events/fake-source.ts";
import { EventsProvider } from "../../../../../packages/shell/renderer/desktop/connection/events/hooks.tsx";
import { ContentCard } from "../../../../../packages/shell/renderer/shell/content-card.tsx";
import type { FaceOf } from "../../../../../packages/shell/renderer/workflow/model.ts";
import { WorkflowPage } from "../../../../../packages/shell/renderer/workflow/workflow-page.tsx";
import {
  FAKE_WORKFLOW_INSTANCES,
  FAKE_WORKFLOWS,
  fakeWorkspaceSource,
} from "../../../../../packages/shell/renderer/workspace/fake-source.ts";
import { workflowTab } from "../../../../../packages/shell/renderer/workspace/kinds/workflow.tsx";
import { PaddedTab } from "../../../../../packages/shell/renderer/workspace/padded-tab.tsx";
import type { WorkspaceSource } from "../../../../../packages/shell/renderer/workspace/source.ts";
import { click, type, useDrive } from "../../../mock/drive.ts";

const noop = () => {};

// FAKE_WORKFLOW_INSTANCES의 순서: running, humanTurn, notHanded, restarted, ended, stopped,
// 그 뒤에 nightly-flow의 도는 것, program_exited로 닫힌 것, 켜질 때 닫힌 것,
// 그 뒤에 다른 컴퓨터로 넘긴 step이 거기서 사람을 기다리는 것과 거기서 돌지 못한 것.
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
  REMOTE_HELD,
  REMOTE_FAILED,
] = FAKE_WORKFLOW_INSTANCES.map((detail) => detail.instance.id);

const PROJECT = FAKE_WORKFLOWS[0].project;

// 참가자 agent의 얼굴. 실제 창은 agent 목록에서 읽는다.
const FACES: Readonly<Record<string, ReturnType<FaceOf>>> = {
  lophn: {
    name: "lophn",
    avatar: { kind: "character", shape: "square", color: "coral" },
  },
  "Eval analyst": {
    name: "Eval analyst",
    avatar: { kind: "character", shape: "arch", color: "sage" },
  },
};
const faceOf: FaceOf = (handle) => FACES[handle];

/** workflow 탭 한 개가 선 창. 본문은 실제 card처럼 여백 없이 붙고 page가 스스로 여백을 둔다. */
function WorkflowWindow({
  name,
  instance = null,
  source: given,
  asking = false,
}: {
  name: string;
  /** 탭이 처음 고른 run. 없으면 workflow 화면이다. */
  instance?: string | null;
  source?: WorkspaceSource;
  /** step을 받은 session이 사람의 답을 기다린다. */
  asking?: boolean;
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
                    faceOf={faceOf}
                    dotOf={() => (asking ? "waiting" : "working")}
                    onInstance={setSelected}
                    onOpenArtifact={noop}
                    onOpenSession={noop}
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

export const Home = () => <WorkflowWindow name="eval-loop" />;
export const Empty = () => <WorkflowWindow name="paper-review" />;
export const Running = () => (
  <WorkflowWindow name="eval-loop" instance={RUNNING} />
);
export const Asking = () => (
  <WorkflowWindow name="eval-loop" instance={RUNNING} asking />
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
export const RemoteHeld = () => (
  <WorkflowWindow name="eval-loop" instance={REMOTE_HELD} />
);
export const RemoteFailed = () => (
  <WorkflowWindow name="eval-loop" instance={REMOTE_FAILED} />
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

// 새 run 칸에 입력 글을 채운다.
const fillStart = async () => {
  await type(
    "[data-start-box] textarea",
    "Compare the quest tool changes on the full ftb quests scenario set",
  );
};

export function Start() {
  useDrive(fillStart);
  return <WorkflowWindow name="eval-loop" />;
}

export function StartFlow() {
  useDrive(fillStart);
  return <WorkflowWindow name="nightly-flow" />;
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
    await fillStart();
    await click("[data-start]");
  });
  return <WorkflowWindow name="eval-loop" source={source} />;
}
