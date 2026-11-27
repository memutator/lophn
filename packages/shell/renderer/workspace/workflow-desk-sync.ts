// workflow instance desk의 상태 기반 탭 투영(materialize) 계획.
// layout 소유는 보는 컴퓨터(shell)가 그대로 갖되, 어느 session·GUI 터미널이 어느 workflow instance의 어느 step에
// 속하는지는 core가 아는 사실(`workflow_origin`)이므로 1회성 `tab_open` push에 기대지 않고 여기서 desk에 모은다.
// 사람이 이 창에서 직접 닫은 탭(`dismissedTabs`)과 지운 desk(`dismissedDesks`)는 다시 열지 않는다.
import type { CodingSession } from "../../../protocol/coding-agent/relay.ts";
import type { WorkflowOrigin } from "../../../protocol/workflows/origin.ts";
import type { SessionEntry } from "../desktop/connection/events/sessions-store.ts";
import { allTabs, type WorkspaceLayout } from "../shell/desk-model.ts";
import { instanceTitle } from "../workflow/model.ts";
import { sessionOf } from "./agent/tab-fields.ts";
import type { WorkflowInstanceSummaryView } from "./source.ts";

export type WorkflowDeskSyncItem =
  | {
      readonly kind: "run";
      readonly instance: string;
      readonly workflow: string;
      readonly title: string;
    }
  | {
      readonly kind: "session";
      readonly session: string;
      readonly origin: WorkflowOrigin;
    }
  | {
      readonly kind: "terminal";
      readonly terminal: string;
      readonly origin: WorkflowOrigin;
    };

export const dismissedRunKey = (instance: string): string => `run:${instance}`;
export const dismissedSessionKey = (session: string): string =>
  `session:${session}`;
export const dismissedTerminalKey = (terminal: string): string =>
  `terminal:${terminal}`;

export function planWorkflowDeskSync(input: {
  readonly projectId: string;
  readonly layout: WorkspaceLayout;
  readonly runningWorkflows: readonly WorkflowInstanceSummaryView[];
  readonly sessions: readonly SessionEntry[];
  readonly codingSessions: readonly CodingSession[];
  readonly terminalRefOf?: (key: string) => string | null;
  readonly dismissedTabs: ReadonlySet<string>;
  readonly dismissedDesks: ReadonlySet<string>;
}): WorkflowDeskSyncItem[] {
  const {
    projectId,
    layout,
    runningWorkflows,
    sessions,
    codingSessions,
    terminalRefOf,
    dismissedTabs,
    dismissedDesks,
  } = input;

  // 이미 열린 instance desk와 실행 중인 instance(사람이 지운 desk 제외)를 대상으로 한다.
  const openDesks = new Set<string>();
  const instances = new Map<
    string,
    { readonly workflow: string; readonly title: string }
  >();
  for (const desk of Object.values(layout.desks)) {
    if (desk.workflowInstance !== undefined && desk.workflow !== undefined) {
      openDesks.add(desk.workflowInstance);
      instances.set(desk.workflowInstance, {
        workflow: desk.workflow,
        title: desk.label,
      });
    }
  }
  for (const item of runningWorkflows) {
    if (item.state !== "running" || dismissedDesks.has(item.id)) continue;
    instances.set(item.id, {
      workflow: item.workflow,
      title: instanceTitle(item) || item.workflow,
    });
  }
  if (instances.size === 0) return [];

  const openRunKeys = new Set<string>();
  const openSessions = new Set<string>();
  const openTerminals = new Set<string>();
  for (const tab of allTabs(layout)) {
    if (tab.kind === "workflow") openRunKeys.add(tab.key);
    else if (tab.kind === "agent") {
      const id = sessionOf(tab);
      if (id !== null) openSessions.add(id);
    } else if (tab.kind === "terminal") {
      const ref =
        terminalRefOf?.(tab.key) ??
        (typeof tab.fields?.terminal === "string" ? tab.fields.terminal : null);
      if (ref !== null) openTerminals.add(ref);
    }
  }

  const missingSessions = new Map<
    string,
    { readonly session: string; readonly origin: WorkflowOrigin }[]
  >();
  for (const entry of sessions) {
    const origin = entry.workflowOrigin;
    if (
      origin == null ||
      origin.project !== projectId ||
      !instances.has(origin.instance) ||
      entry.archived ||
      entry.ended !== null ||
      openSessions.has(entry.session) ||
      dismissedTabs.has(dismissedSessionKey(entry.session))
    ) {
      continue;
    }
    const list = missingSessions.get(origin.instance) ?? [];
    list.push({ session: entry.session, origin });
    missingSessions.set(origin.instance, list);
  }

  const missingTerminals = new Map<
    string,
    { readonly terminal: string; readonly origin: WorkflowOrigin }[]
  >();
  for (const coding of codingSessions) {
    const origin = coding.workflow_origin;
    if (
      origin == null ||
      origin.project !== projectId ||
      !instances.has(origin.instance) ||
      openTerminals.has(coding.terminal) ||
      dismissedTabs.has(dismissedTerminalKey(coding.terminal))
    ) {
      continue;
    }
    const list = missingTerminals.get(origin.instance) ?? [];
    list.push({ terminal: coding.terminal, origin });
    missingTerminals.set(origin.instance, list);
  }

  const plan: WorkflowDeskSyncItem[] = [];
  for (const [instance, info] of instances) {
    const ses = missingSessions.get(instance) ?? [];
    const trm = missingTerminals.get(instance) ?? [];
    const hasMembers = ses.length > 0 || trm.length > 0;
    // 아직 열지 않은 실행 중 instance desk는 실제 step 탭이 생겼을 때 run 탭과 함께 배경으로 만든다.
    if (!openDesks.has(instance) && !hasMembers) continue;
    if (
      hasMembers &&
      !openRunKeys.has(`workflow-instance:${instance}`) &&
      !dismissedTabs.has(dismissedRunKey(instance))
    ) {
      plan.push({
        kind: "run",
        instance,
        workflow: info.workflow,
        title: info.title,
      });
    }
    for (const item of ses) {
      plan.push({
        kind: "session",
        session: item.session,
        origin: item.origin,
      });
    }
    for (const item of trm) {
      plan.push({
        kind: "terminal",
        terminal: item.terminal,
        origin: item.origin,
      });
    }
  }
  return plan;
}
