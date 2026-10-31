// workflow 탭 kind. project의 workflow 하나가 탭 하나이고(key `workflow:<name>`), 그 안에서 instance를 고른다.
// 고른 instance는 필드가 가진다. 탭을 닫고 다시 열어도 같은 instance가 선다.
import { commonIcons } from "../../icons/mod.ts";

import type { TabItem } from "../model.ts";
import { PaddedTab } from "../padded-tab.tsx";
import { WorkflowPage } from "../../workflow/workflow-page.tsx";
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
    const instance = tab.fields?.instance;
    return (
      <PaddedTab bare>
        <WorkflowPage
          key={tab.key}
          project={host.projectId}
          workflow={workflow}
          instance={typeof instance === "string" ? instance : null}
          source={host.props.source}
          onInstance={(next) =>
            host.patchTab(tab.key, () => ({
              fields:
                next === null ? { workflow } : { workflow, instance: next },
            }))
          }
          onOpenArtifact={(view, picked) =>
            openWorkflowArtifact(host, {
              project: host.projectId,
              workflow,
              view,
              instance: picked,
            })
          }
          onOpenConversation={
            host.agentView === null
              ? null
              : (session) => host.agentView?.openSession(session)
          }
        />
      </PaddedTab>
    );
  },
};
