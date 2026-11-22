// workflow 탭 kind. project의 workflow 하나가 탭 하나이고(key `workflow:<name>`), 그 안에서 instance를 고른다.
// 고른 instance는 필드가 가진다. 탭을 닫고 다시 열어도 같은 instance가 선다.
import { useMemo } from "react";

import { useFollowedRead } from "../../desktop/connection/core-read.ts";
import { commonIcons } from "../../icons/mod.ts";
import type { FaceOf } from "../../workflow/model.ts";
import { WorkflowPage } from "../../workflow/workflow-page.tsx";
import { codingFaceOf } from "../agents/coding-face.ts";
import type { TabItem } from "../model.ts";
import { PaddedTab } from "../padded-tab.tsx";
import { openWorkflowArtifact } from "./artifact.tsx";
import type { TabHost } from "./host.ts";
import type { TabKindDef } from "./kind.ts";

/** 탭 값 하나. `host`를 모른다(workflow-shell의 자리 seed도 이 값을 쓴다). */
export function workflowTab(name: string, instance?: string): TabItem {
  return {
    key: `workflow:${name}`,
    kind: "workflow",
    title: name,
    fields:
      instance === undefined
        ? { workflow: name }
        : { workflow: name, instance },
  };
}

/** workflow 탭을 연다. 이미 열려 있으면 고르기만 한다. */
export function openWorkflow(
  host: TabHost,
  workflow: string,
  instance?: string,
): void {
  host.openTab(workflowTab(workflow, instance));
}

export const workflowKind: TabKindDef = {
  kind: "workflow",
  labelKey: "workflow.label.kind",
  icon: commonIcons.workflow,
  homeDesk(tab) {
    const workflow = tab.fields?.workflow;
    return typeof workflow === "string" ? workflow : undefined;
  },
  fromStored(stored, { key }) {
    const { workflow, instance } = stored;
    if (typeof workflow !== "string") return null;
    return {
      ...workflowTab(
        workflow,
        typeof instance === "string" ? instance : undefined,
      ),
      key,
    };
  },
  toStored(tab) {
    const { workflow, instance } = tab.fields ?? {};
    if (typeof workflow !== "string") return null;
    return {
      kind: "workflow",
      key: tab.key,
      workflow,
      ...(typeof instance === "string" ? { instance } : {}),
    };
  },
  render(tab, _active, host) {
    const workflow = tab.fields?.workflow;
    if (typeof workflow !== "string") return null;
    const project = host.projectId;
    if (project === null) return null;
    const instance = tab.fields?.instance;
    return (
      <PaddedTab bare>
        <WorkflowTabBody
          key={tab.key}
          tab={tab}
          host={host}
          project={project}
          workflow={workflow}
          instance={typeof instance === "string" ? instance : null}
        />
      </PaddedTab>
    );
  },
};

/** 참가자 agent의 얼굴을 agent 목록에서 읽어 handle로 찾게 한다. 목록을 읽을 통로가 없으면 얼굴 없이 그린다. */
function useFaces(host: TabHost, project: string): FaceOf | undefined {
  const source = host.agents?.source;
  const { loaded } = useFollowedRead(
    async () =>
      source === undefined
        ? { ok: false as const }
        : await source.list(project),
    ["agents"],
    `${source === undefined ? "" : "source"}|${project}`,
  );
  return useMemo(() => {
    if (loaded.state !== "ready" || source === undefined) return undefined;
    const faces = new Map(
      loaded.value.map((row) => [
        row.handle,
        {
          name: row.name,
          avatar:
            codingFaceOf(row.assignment) ??
            (row.avatar.kind === "character"
              ? row.avatar
              : {
                  kind: "image" as const,
                  src: source.imageSrc(
                    project,
                    row.assignment,
                    row.avatar.image,
                  ),
                }),
        },
      ]),
    );
    return (handle: string) => faces.get(handle);
  }, [loaded, source, project]);
}

function WorkflowTabBody({
  tab,
  host,
  project,
  workflow,
  instance,
}: {
  tab: TabItem;
  host: TabHost;
  project: string;
  workflow: string;
  instance: string | null;
}) {
  const faceOf = useFaces(host, project);
  const agentView = host.agentView;
  return (
    <WorkflowPage
      project={project}
      workflow={workflow}
      instance={instance}
      source={host.props.source}
      faceOf={faceOf}
      dotOf={
        agentView === null ? undefined : (session) => agentView.dotOf(session)
      }
      onInstance={(next) =>
        host.patchTab(tab.key, () => ({
          fields: next === null ? { workflow } : { workflow, instance: next },
        }))
      }
      onOpenArtifact={(view, picked) =>
        openWorkflowArtifact(host, {
          project,
          workflow,
          view,
          instance: picked,
        })
      }
      canOpenSession={
        agentView === null
          ? undefined
          : (session) => agentView.nameOf(session) !== undefined
      }
      onOpenSession={
        agentView === null
          ? null
          : // step을 받은 대화는 workflow 탭 옆 칸에 열어 run을 보면서 말하게 한다.
            (session) =>
              agentView.openSession(session, {
                options: { after: tab.key, beside: true },
              })
      }
    />
  );
}
