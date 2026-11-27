// workflow 탭 kind. project의 workflow 하나가 탭 하나이고(key `workflow:<name>`), 그 안에서 instance를 고른다.
// 고른 instance는 필드가 가진다. 탭을 닫고 다시 열어도 같은 instance가 선다.
import { useMemo } from "react";

import { useFollowedRead } from "../../desktop/connection/core-read.ts";
import { runToastAction } from "../../desktop/connection/toasts/toast-actions.ts";
import { commonIcons } from "../../icons/mod.ts";
import { type FaceOf, instanceTitle } from "../../workflow/model.ts";
import { WorkflowPage } from "../../workflow/workflow-page.tsx";
import { codingFaceOf } from "../agents/coding-face.ts";
import type { TabItem } from "../model.ts";
import { PaddedTab } from "../padded-tab.tsx";
import { openWorkflowArtifact } from "./artifact.tsx";
import { openFile } from "./document-editor.tsx";
import type { TabHost } from "./host.ts";
import type { TabKindDef } from "./kind.ts";
import { openTerminal, terminalRefOf } from "./terminal.tsx";

/** 탭 값 하나. instance가 없으면 workflow 정의 탭(`workflow:<name>`), 있으면 instance 전용 탭(`workflow-instance:<id>`)이다. */
export function workflowTab(
  name: string,
  instance?: string,
  title?: string,
): TabItem {
  return {
    key:
      instance === undefined
        ? `workflow:${name}`
        : `workflow-instance:${instance}`,
    kind: "workflow",
    title: title !== undefined && title.trim() !== "" ? title : name,
    fields:
      instance === undefined
        ? { workflow: name }
        : { workflow: name, instance },
  };
}

/** workflow 정의 탭을 연다. 이미 열려 있으면 고르기만 한다. */
export function openWorkflow(
  host: TabHost,
  workflow: string,
  instance?: string,
  title?: string,
): void {
  host.openTab(workflowTab(workflow, instance, title));
}

/** workflow instance 전용 desk와 run 탭을 연다. */
export function openWorkflowInstance(
  host: TabHost,
  workflow: string,
  instance: string,
  title?: string,
): void {
  host.openTab(workflowTab(workflow, instance, title));
}

export const workflowKind: TabKindDef = {
  kind: "workflow",
  labelKey: "workflow.label.kind",
  icon: commonIcons.workflow,
  homeDesk(tab) {
    const instance = tab.fields?.instance;
    if (typeof instance === "string") return instance;
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

/** agent의 얼굴을 agent 목록에서 읽어 handle이나 agent id로 찾게 한다. 목록을 읽을 통로가 없으면 얼굴 없이 그린다. */
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
    // step의 참가자는 handle로, session을 돌리는 agent는 id(assignment)로 찾는다.
    const faces = new Map(
      loaded.value.flatMap((row) => {
        const face = {
          name: row.name,
          avatar:
            (row.avatar.kind === "character"
              ? codingFaceOf(row.assignment, row.runtime)
              : codingFaceOf(row.assignment)) ??
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
        };
        return [
          [row.assignment, face],
          [row.handle, face],
        ] as const;
      }),
    );
    return (handleOrId: string) => faces.get(handleOrId);
  }, [loaded, source, project]);
}

const ABSOLUTE_PATH = /^(\/|[A-Za-z]:[\\/])/;

function resolveRefPath(path: string, root: string | undefined): string {
  if (ABSOLUTE_PATH.test(path) || root === undefined) return path;
  return `${root.replace(/\/+$/, "")}/${path.replace(/^\.\/+/, "")}`;
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
  const isInstanceTab = tab.key.startsWith("workflow-instance:");
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
      onStarted={
        isInstanceTab
          ? undefined
          : (started) =>
              openWorkflowInstance(
                host,
                workflow,
                started.instance,
                started.title ?? undefined,
              )
      }
      onOpenActiveInstance={
        isInstanceTab
          ? undefined
          : (item) =>
              openWorkflowInstance(
                host,
                item.workflow,
                item.id,
                instanceTitle(item),
              )
      }
      onInstance={(next) => {
        if (isInstanceTab) {
          if (next === null) openWorkflow(host, workflow);
          else openWorkflowInstance(host, workflow, next);
          return;
        }
        host.patchTab(tab.key, () => ({
          fields: next === null ? { workflow } : { workflow, instance: next },
        }));
      }}
      onOpenArtifact={(view, picked) =>
        openWorkflowArtifact(host, {
          project,
          workflow,
          view,
          instance: picked,
        })
      }
      onOpenFile={(path) =>
        openFile(host, resolveRefPath(path, host.explorerRoot), {
          from: tab.key,
        })
      }
      onOpenSession={(session, node) => {
        const desk = instance ?? workflow;
        const group =
          instance !== null && node?.step !== undefined
            ? `${instance}:${node.step}`
            : undefined;
        if (
          !node?.harness_gui &&
          agentView !== null &&
          agentView.openSession(session, {
            options: {
              after: tab.key,
              beside: true,
              desk,
              deskWorkflow: workflow,
              ...(group === undefined ? {} : { group }),
            },
          })
        ) {
          return;
        }
        const terminalStore = host.props.terminal?.store;
        const cli = node?.cli_session ?? null;
        const liveRef =
          cli !== null ? terminalStore?.terminalOfCliSession(cli) : undefined;
        // 다른 project의 session이나 GUI 터미널 팀원이라도 이미 이 창(workflow desk 등)에 열려 있으면 그 탭을 고른다.
        const existing = host.windowTabs().find((item) => {
          if (item.fields?.session === session) return true;
          if (item.kind !== "terminal") return false;
          if (liveRef !== undefined) {
            const ref = terminalStore?.refOf(item.key) ?? terminalRefOf(item);
            if (ref === liveRef) return true;
          }
          if (cli !== null) {
            if (terminalStore?.codingOf(item.key)?.cli_session === cli) {
              return true;
            }
            if (terminalStore?.agentOf(item.key)?.session === cli) return true;
            if (item.fields?.agentSession === cli) return true;
          }
          return false;
        });
        if (existing !== undefined) {
          host.openTab(existing);
          return;
        }
        // 살아 있는 GUI 터미널 팀원이지만 이 창에 탭이 닫혀 있으면 workflow instance desk에 바로 붙인다.
        if (liveRef !== undefined) {
          openTerminal(host, {
            terminal: liveRef,
            open: {
              options: {
                desk,
                deskWorkflow: workflow,
                ...(group === undefined ? {} : { group }),
              },
            },
          });
          return;
        }
        // 아직 안 열린 다른 workspace의 session은 toast [Open]과 같은 길로 그 workspace에서 연다.
        runToastAction({
          kind: "session",
          session,
          ...(host.machine === null ? {} : { machine: host.machine }),
        });
      }}
    />
  );
}
