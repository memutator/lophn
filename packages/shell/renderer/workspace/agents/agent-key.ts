// 화면이 agent를 가리키는 값(key)을 다룬다. agent id는 workspace마다의 lophn(`lophn_home`, `lophn_<prj|app id>`)이거나
// `agt_…`이다. lophn의 id에는 그 workspace가 들어 있고, 사람이 만든 agent의 id에는 workspace가 끼지 않는다.
import {
  isLophn,
  lophnIdOf,
} from "../../../../protocol/lophn-agent/workspaces.ts";
import type { WorkspaceKind } from "../../../../protocol/lophn-agent/workspaces.ts";
import type { WorkspaceRef } from "../../shell/desk-model.ts";

export const AGENT_ID = /^agt_[0-7][0-9a-hjkmnp-tv-z]{25}$/;

/** 자리 id의 접두사가 앱인지 정한다. 앱 공간의 관리 화면이 같은 source를 쓴다. */
export const isAppWorkspace = (workspace: string) =>
  workspace.startsWith("app_");

/** 화면이 workspace를 가리키는 열쇠("home", project id, 앱 id)가 어느 종류인가. */
export const kindOfWorkspace = (workspace: string): WorkspaceKind =>
  workspace === "home" ? "home" : isAppWorkspace(workspace) ? "app" : "project";

/** 그 자리의 lophn id. */
export const lophnIdAt = (ref: WorkspaceRef) =>
  lophnIdOf(ref.kind === "home" ? null : ref);

/** agent id(workspace의 lophn이거나 `agt_…`)인가. */
export const isAgentId = (value: unknown): value is string =>
  typeof value === "string" && (isLophn(value) || AGENT_ID.test(value));
