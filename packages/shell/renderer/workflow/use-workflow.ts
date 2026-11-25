// workflow 탭이 source에서 읽고 쓰는 곳. 정의는 열릴 때와 [Refresh]에서, instance 목록과 고른 instance는 처음과
// `workflow_instances` 변경이 올 때와 시작·멈춤이 끝난 뒤에 다시 읽는다. 읽는 동안 앞 값을 두고, 읽기 실패는 앞 값을 지우지 않고 알린다.

import { t } from "@lophn/i18n";
import { useCallback, useEffect, useRef, useState } from "react";

import { isHarnessRuntime } from "../../../protocol/lophn-agent/agent-values.ts";
import {
  DEFAULT_PERMISSION_MODE,
  type PermissionMode,
} from "../../../protocol/lophn-agent/turn-values.ts";
import { useFollowedRead } from "../desktop/connection/core-read.ts";
import type {
  CallableAgentOptionView,
  WorkflowEntryView,
  WorkflowInstanceDetailView,
  WorkflowInstanceSummaryView,
  WorkspaceSource,
} from "../workspace/source.ts";

export interface ParticipantModeSpec {
  readonly key: string;
  readonly label: string;
  readonly mode: PermissionMode;
}

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
  /** lophn·custom 참가자의 초기 권한 단계(기억된 workflow 설정 → agent 기본 → 전역 기본). harness·사람은 제외한다. */
  readonly participantModes: readonly ParticipantModeSpec[];
  closeNotice(): void;
  refresh(): void;
  /** 성공하면 true. 실패하면 알림을 띄우고 false다. */
  start(
    text: string,
    step?: string,
    inputs?: Record<string, unknown>,
    options?: {
      readonly title?: string;
      readonly open?: "tab" | "background";
      readonly stepOpen?: Record<string, "tab" | "background">;
      readonly participantModes?: Record<string, PermissionMode>;
    },
  ): Promise<boolean>;
  stop(): void;
  retry(step?: string): void;
  resume(useLatestCode?: boolean): void;
  rename(title: string): void;
  /** 참가자별 권한 단계를 `approvals.workflow_modes`에 기억한다(`workflow.yaml`은 건드리지 않는다). */
  rememberParticipantModes?: (
    modes: Readonly<Record<string, PermissionMode>>,
  ) => Promise<boolean>;
  saveDefaults?: (patch: {
    readonly default_step?: string | null;
    readonly open?: "tab" | "background" | null;
    readonly step_open?: Readonly<Record<string, "tab" | "background" | null>>;
    readonly inputs?: Readonly<Record<string, unknown>>;
  }) => Promise<boolean>;
}

export function useWorkflow({
  source,
  project,
  workflow,
  instance,
  onInstance,
  onStarted,
}: {
  source: WorkspaceSource;
  /** prj id. */
  project: string;
  /** workflow 이름(slug). */
  workflow: string;
  instance: string | null;
  onInstance: (instance: string | null) => void;
  onStarted?: (started: {
    readonly instance: string;
    readonly title: string | null;
  }) => void;
}): UseWorkflow {
  const [definitions, setDefinitions] = useState<Definitions>({
    state: "loading",
  });
  const [notice, setNotice] = useState<WorkflowNotice | null>(null);
  const [definitionReads, setDefinitionReads] = useState(0);
  const [participantModes, setParticipantModes] = useState<
    readonly ParticipantModeSpec[]
  >([]);
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
  const callableAgents =
    definitions.state === "ready" ? definitions.callableAgents : [];

  // lophn·custom 참가자만 뽑아 기억된 workflow 설정 → agent 기본 → 전역 기본 순으로 초기 권한 단계를 채운다.
  useEffect(() => {
    if (entry === null || entry.participants === null) {
      setParticipantModes([]);
      return;
    }
    const participants = entry.participants;
    let live = true;
    void (async () => {
      const [rememberedRead, defaultRead, agentsRead] = await Promise.all([
        source.readWorkflowModes?.(entry.project, entry.name) ??
          Promise.resolve({ ok: true as const, value: {} }),
        source.readDefaultMode?.() ??
          Promise.resolve({
            ok: true as const,
            value: DEFAULT_PERMISSION_MODE,
          }),
        source.agentsSource?.list(entry.project) ??
          Promise.resolve({ ok: true as const, value: [] }),
      ]);
      if (!live) return;
      const remembered: Readonly<Record<string, PermissionMode>> =
        rememberedRead.ok ? rememberedRead.value : {};
      const globalDefault = defaultRead.ok
        ? defaultRead.value
        : DEFAULT_PERMISSION_MODE;
      const agentRows = agentsRead.ok ? agentsRead.value : [];
      const agentModeById = new Map<string, PermissionMode>();
      const nonHarnessEntries = Object.entries(participants).filter(
        ([, participant]) => {
          if ("kind" in participant) return false;
          const row = agentRows.find(
            (item) =>
              item.handle === participant.agent ||
              item.name === participant.agent ||
              item.assignment === participant.agent,
          );
          if (row?.runtime !== undefined && isHarnessRuntime(row.runtime)) {
            return false;
          }
          const callable = callableAgents.find(
            (item) =>
              item.name === participant.agent ||
              item.label === participant.agent,
          );
          if (
            callable?.kind === "coding" ||
            participant.agent.startsWith("coding_")
          ) {
            return false;
          }
          return true;
        },
      );
      if (source.agentsSource !== undefined) {
        await Promise.all(
          nonHarnessEntries.map(async ([, participant]) => {
            if ("kind" in participant) return;
            const row = agentRows.find(
              (item) =>
                item.handle === participant.agent ||
                item.name === participant.agent ||
                item.assignment === participant.agent,
            );
            if (row === undefined) return;
            if (row.glance?.permissionMode !== undefined) {
              agentModeById.set(row.assignment, row.glance.permissionMode);
              return;
            }
            const detail = await source.agentsSource?.readAgent(
              entry.project,
              row.assignment,
            );
            if (
              detail !== undefined &&
              detail.ok &&
              detail.value.definition.permission_mode !== undefined
            ) {
              agentModeById.set(
                row.assignment,
                detail.value.definition.permission_mode,
              );
            }
          }),
        );
      }
      if (!live) return;
      const resolved: ParticipantModeSpec[] = nonHarnessEntries.map(
        ([key, participant]) => {
          const agentRef = "agent" in participant ? participant.agent : key;
          const row = agentRows.find(
            (item) =>
              item.handle === agentRef ||
              item.name === agentRef ||
              item.assignment === agentRef,
          );
          const agentMode =
            row === undefined ? undefined : agentModeById.get(row.assignment);
          return {
            key,
            label: row?.name ?? agentRef,
            mode: remembered[key] ?? agentMode ?? globalDefault,
          };
        },
      );
      setParticipantModes(resolved);
    })();
    return () => {
      live = false;
    };
  }, [source, entry, callableAgents, definitionReads]);

  return {
    definitions,
    instances,
    // 고른 instance를 바꾼 직후 앞 instance의 값이 남아 보이지 않게 한다.
    detail:
      instance !== null && detail?.instance.id === instance ? detail : null,
    notice,
    participantModes,
    closeNotice: () => setNotice(null),
    refresh() {
      setDefinitionReads((count) => count + 1);
      reload();
    },
    async start(text, step, inputs, options) {
      if (entry === null) return false;
      const result = await source.startWorkflow({
        workflow: entry.key,
        ...(options?.title === undefined ? {} : { title: options.title }),
        text,
        step,
        ...(inputs === undefined ? {} : { inputs }),
        ...(options?.open === undefined ? {} : { open: options.open }),
        ...(options?.stepOpen === undefined
          ? {}
          : { step_open: options.stepOpen }),
        ...(options?.participantModes === undefined
          ? {}
          : { participant_modes: options.participantModes }),
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
      if (onStarted !== undefined) {
        onStarted({
          instance: result.value.instance,
          title: result.value.title ?? null,
        });
      } else {
        onInstance(result.value.instance);
      }
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
    resume(useLatestCode = false) {
      if (instance === null) return;
      void source.resumeWorkflow(instance, { useLatestCode }).then((result) => {
        if (!result.ok) {
          setNotice({
            title: t("workflow.title.resume-failed", { workflow }),
            body: t("workflow.error.resume-failed"),
          });
        }
        reload();
      });
    },
    rename(title) {
      if (instance === null || source.renameWorkflowInstance === undefined) {
        return;
      }
      const trimmed = title.trim();
      if (trimmed === "") return;
      void source.renameWorkflowInstance(instance, trimmed).then((result) => {
        if (result.ok) reload();
      });
    },
    ...(source.saveWorkflowModes === undefined
      ? {}
      : {
          async rememberParticipantModes(modes) {
            if (entry === null || source.saveWorkflowModes === undefined) {
              return false;
            }
            const saved = await source.saveWorkflowModes(
              entry.project,
              entry.name,
              modes,
            );
            if (!saved.ok) {
              setNotice({
                title: t("workflow.title.save-default-failed", { workflow }),
                body: t("workflow.error.remember-modes-failed"),
              });
              return false;
            }
            setNotice(null);
            setParticipantModes((prev) =>
              prev.map((item) => ({
                ...item,
                mode: modes[item.key] ?? item.mode,
              })),
            );
            return true;
          },
        }),
    ...(source.setWorkflowDefaults === undefined
      ? {}
      : {
          async saveDefaults(patch) {
            if (entry === null || source.setWorkflowDefaults === undefined) {
              return false;
            }
            const result = await source.setWorkflowDefaults({
              project: entry.project,
              workflow: entry.name,
              ...patch,
            });
            if (!result.ok) {
              setNotice({
                title: t("workflow.title.save-default-failed", { workflow }),
                body: t("workflow.error.save-default-failed"),
              });
              return false;
            }
            setNotice(null);
            setDefinitions((prev) =>
              prev.state === "ready"
                ? { ...prev, entry: result.value.entry }
                : prev,
            );
            return true;
          },
        }),
  };
}
