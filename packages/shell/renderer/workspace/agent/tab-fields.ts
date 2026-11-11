// Agent 탭이 TabItem.fields에 두는 값(agent·workspace·session)의 읽기와 쓰기.
import type { TabItem } from "../model.ts";

export const SESSION_ID = /^ses_[0-7][0-9a-hjkmnp-tv-z]{25}$/;
export const TAB_KEY = /^[A-Za-z0-9._:-]+$/;

/** 탭이 보는 agent의 id(sidebar의 agent 줄이 주는 값). 맞지 않으면 null이다. */
export function agentOf(tab: TabItem): string | null {
  const agent = tab.fields?.agent;
  return typeof agent === "string" && agent.length > 0 && agent.length <= 128
    ? agent
    : null;
}

/** 탭을 연 자리(project id, app id, Home이면 "home"). 탭을 연 뒤 바꾸지 않는다. */
export function workspaceOf(tab: TabItem): string | null {
  const workspace = tab.fields?.workspace;
  return typeof workspace === "string" &&
    workspace.length > 0 &&
    workspace.length <= 128
    ? workspace
    : null;
}

/** 탭이 보는 session. 없으면 아직 만들지 않은 새 session이다. */
export function sessionOf(tab: TabItem): string | null {
  const session = tab.fields?.session;
  return typeof session === "string" && SESSION_ID.test(session)
    ? session
    : null;
}

const APP_WORKSPACE = /^app_/;

/** 탭을 연 자리 key를 agent source의 workspace로 옮긴다. app id는 `app_`로 시작해 project id와 갈린다. */
export function sourceWorkspaceOf(
  workspace: string | null,
):
  | { readonly kind: "global"; readonly id: "" }
  | { readonly kind: "project" | "app"; readonly id: string } {
  if (workspace === null || workspace === "home")
    return { kind: "global", id: "" };
  return {
    kind: APP_WORKSPACE.test(workspace) ? "app" : "project",
    id: workspace,
  };
}
