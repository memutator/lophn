// `useSessions()`의 session을 workspace의 agent 줄이 읽는 값으로 옮긴다. 상태 점은 parts/agent-session/lophn.ts다.
import { LOPHN_AGENT_NAME } from "../../../../protocol/lophn-agent/agent-values.ts";
import {
  codingBuiltinOf,
  isLophn,
} from "../../../../protocol/lophn-agent/workspaces.ts";
import type { SessionEntry } from "../../desktop/connection/events/sessions-store.ts";
import {
  allTabs,
  type TabItem,
  type WorkspaceLayout,
  type WorkspaceRef,
} from "../../shell/desk-model.ts";
import type { SidebarAgent } from "./sidebar-agent.ts";

// renderer session store의 agent를 읽는 한 곳. store는 agent id를 싣는다.
export function sessionAgentKey(entry: SessionEntry): string | null {
  return entry.agent;
}

// Home은 workspace가 없는 session이다.
export function sessionAtWorkspace(
  entry: SessionEntry,
  workspace: WorkspaceRef,
): boolean {
  return workspace.kind === "home"
    ? entry.workspace === null
    : entry.workspace?.kind === workspace.kind &&
        entry.workspace.id === workspace.id;
}

/**
 * 이 workspace의 열린 lophn session 가운데 가장 최근 것. workspace마다 lophn이 하나라 자리로 거른 lophn은 그 workspace의 것이다.
 */
export function openedWorkspaceLophnSession(
  entries: readonly SessionEntry[],
  workspace: WorkspaceRef,
): string | null {
  const found = entries.filter((entry) => {
    const key = sessionAgentKey(entry);
    return (
      entry.ended === null &&
      key !== null &&
      isLophn(key) &&
      sessionAtWorkspace(entry, workspace)
    );
  });
  return found.length === 0 ? null : found[found.length - 1].session;
}

// session을 가진 agent를 sidebar의 agent 줄로 찾는다.
export function agentRow(
  entry: SessionEntry,
  agents: readonly SidebarAgent[],
  workspace: WorkspaceRef,
): SidebarAgent | undefined {
  const key = sessionAgentKey(entry);
  if (key === null || !sessionAtWorkspace(entry, workspace)) return undefined;
  return agents.find((row) => row.assignment === key);
}

/**
 * session 탭을 열 때 쓸 agent와 초기 제목. 원격 workspace로 막 옮겨 agent 목록이 아직 안 왔거나
 * 삭제·내장 agent여도 session store가 agent id를 알고 있으면 바로 탭을 열 수 있게 떨어지는 이름을 고른다.
 */
export function sessionAgentTarget(
  entry: SessionEntry,
  agents: readonly SidebarAgent[],
  workspace: WorkspaceRef,
  knownTitle?: string | null,
): { readonly assignment: string; readonly name: string } | undefined {
  const key = sessionAgentKey(entry);
  if (
    key === null ||
    (!sessionAtWorkspace(entry, workspace) &&
      sessionWorkflowDesk(entry, workspace) === undefined)
  ) {
    return undefined;
  }
  const row = agents.find((one) => one.assignment === key);
  return {
    assignment: key,
    name:
      row?.name ??
      (knownTitle && knownTitle.length > 0 ? knownTitle : undefined) ??
      codingBuiltinOf(key)?.label ??
      LOPHN_AGENT_NAME,
  };
}

/** session의 `workflowOrigin`이 현재 project workspace에 속하면 그 instance desk 옵션을 돌려준다. */
export function sessionWorkflowDesk(
  entry: SessionEntry | undefined,
  workspace: WorkspaceRef,
): { readonly desk: string; readonly deskWorkflow: string } | undefined {
  const origin = entry?.workflowOrigin;
  if (
    origin == null ||
    workspace.kind !== "project" ||
    workspace.id !== origin.project
  ) {
    return undefined;
  }
  return { desk: origin.instance, deskWorkflow: origin.workflow };
}

/** 이 workspace layout에 `terminalRef`가 이미 열린 터미널 탭. store는 기계 전체 공유라 다른 workspace 탭과 섞이지 않게 layout만 본다. */
export function findTerminalTabByRef(
  layout: WorkspaceLayout,
  terminalRef: string,
  refOf?: (key: string) => string | null,
): TabItem | undefined {
  return allTabs(layout).find(
    (tab) =>
      tab.kind === "terminal" &&
      (tab.fields?.terminal === terminalRef ||
        refOf?.(tab.key) === terminalRef),
  );
}
