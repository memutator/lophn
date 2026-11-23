// workflow 탭이 source에서 읽고 쓰는 곳. 정의는 열릴 때와 [Refresh]에서, instance 목록과 고른 instance는 처음과
// `workflow_instances` 변경이 올 때와 시작·멈춤이 끝난 뒤에 다시 읽는다. 읽는 동안 앞 값을 두고, 읽기 실패는 앞 값을 지우지 않고 알린다.
import { useCallback, useEffect, useRef, useState } from "react";
import { t } from "@lophn/i18n";

import { useFollowedRead } from "../desktop/connection/core-read.ts";
import type {
  CallableAgentOptionView,
  WorkflowEntryView,
  WorkflowInstanceDetailView,
  WorkflowInstanceSummaryView,
  WorkspaceSource,
} from "../workspace/source.ts";

export interface WorkflowNotice {
  readonly title: string;
  readonly body: string;
}

export type Definitions =
  | { readonly state: "loading" }
  | { readonly state: "failed" }
  /** entry가 null이면 이 이름의 workflow가 목록에 없다(지워졌다). */
  | {
      readonly state: "ready";
      readonly entry: WorkflowEntryView | null;
      readonly callableAgents: readonly CallableAgentOptionView[];
    };

export interface UseWorkflow {
  readonly definitions: Definitions;
  readonly instances: readonly WorkflowInstanceSummaryView[] | null;
  readonly detail: WorkflowInstanceDetailView | null;
  readonly notice: WorkflowNotice | null;
  closeNotice(): void;
  refresh(): void;
  /** 성공하면 true. 실패하면 알림을 띄우고 false다. */
  start(
    text: string,
    step?: string,
    inputs?: Record<string, unknown>,
  ): Promise<boolean>;
  stop(): void;
  retry(step?: string): void;
}

export function useWorkflow({
  source,
  project,
  workflow,
  instance,
  onInstance,
}: {
  source: WorkspaceSource;
  /** prj id. */
  project: string;
  /** workflow 이름(slug). */
  workflow: string;
  instance: string | null;
  onInstance: (instance: string | null) => void;
}): UseWorkflow {
  const [definitions, setDefinitions] = useState<Definitions>({
    state: "loading",
  });
  const [notice, setNotice] = useState<WorkflowNotice | null>(null);
  const [definitionReads, setDefinitionReads] = useState(0);
  const haveDefinitions = useRef(false);

  const unreadable = useCallback(
    (body: string) =>
      setNotice({
        title: t("workflow.title.read-failed", { workflow }),
        body,
      }),
    [workflow],
  );

  useEffect(() => {
    let live = true;
    void source.workflows(project).then((result) => {
      if (!live) return;
      if (result.ok) {
        haveDefinitions.current = true;
        setDefinitions({
          state: "ready",
          entry: result.value.find((item) => item.name === workflow) ?? null,
          callableAgents: result.callableAgents ?? [],
        });
      } else if (haveDefinitions.current) {
        unreadable(t("workflow.error.load-failed"));
      } else {
        setDefinitions({ state: "failed" });
      }
    });
    return () => {
      live = false;
    };
  }, [source, project, workflow, definitionReads, unreadable]);

  // instance 이름은 project·workflow를 싣지 않아 어느 instance가 바뀌어도 목록을 다시 읽는다.
  const instancesRead = useFollowedRead(
    () => source.workflowInstances({ project, workflow }),
    ["workflow_instances"],
    `${project}\0${workflow}`,
  );
  const detailRead = useFollowedRead(
    () =>
      instance === null
        ? Promise.resolve({ ok: true as const, value: null })
        : source.workflowInstance(instance),
    [{ name: "workflow_instances", id: instance }],
    instance ?? "",
  );
  const failed =
    instancesRead.loaded.state === "failed" ||
    detailRead.loaded.state === "failed";
  useEffect(() => {
    if (failed) unreadable(t("workflow.error.instances-failed"));
  }, [failed, unreadable]);
  const instances =
    instancesRead.loaded.state === "ready" ? instancesRead.loaded.value : null;
  const detail =
    detailRead.loaded.state === "ready" ? detailRead.loaded.value : null;
  const reload = () => {
    instancesRead.reload();
    detailRead.reload();
  };

  const entry = definitions.state === "ready" ? definitions.entry : null;
  return {
    definitions,
    instances,
    // 고른 instance를 바꾼 직후 앞 instance의 값이 남아 보이지 않게 한다.
    detail:
      instance !== null && detail?.instance.id === instance ? detail : null,
    notice,
    closeNotice: () => setNotice(null),
    refresh() {
      setDefinitionReads((count) => count + 1);
      reload();
    },
    async start(text, step, inputs) {
      if (entry === null) return false;
      const result = await source.startWorkflow({
        workflow: entry.key,
        text,
        step,
        ...(inputs === undefined ? {} : { inputs }),
      });
      if (!result.ok) {
        setNotice({
          title: t("workflow.title.start-failed", { workflow }),
          body:
            result.message === "invalid_input"
              ? t("workflow.error.start-invalid-inputs")
              : t("workflow.error.start-failed"),
        });
        return false;
      }
      setNotice(null);
      instancesRead.reload();
      onInstance(result.value.instance);
      return true;
    },
    stop() {
      if (instance === null) return;
      void source.stopWorkflow(instance).then((result) => {
        if (!result.ok) {
          setNotice({
            title: t("workflow.title.stop-failed", { workflow }),
            body: t("workflow.error.stop-failed"),
          });
        }
        reload();
      });
    },
    retry(step) {
      if (instance === null) return;
      void source.retryWorkflowStep(instance, step).then((result) => {
        if (!result.ok) {
          setNotice({
            title: t("workflow.title.retry-failed", { workflow }),
            body: t("workflow.error.retry-failed"),
          });
        }
        reload();
      });
    },
  };
}
