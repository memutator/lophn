// 화면이 agent를 가리키는 값(key)을 다룬다. agent id는 `lophn`이거나 `agt_…`이고, workspace는 화면을 연 자리일 뿐
// agent를 가리키는 값에 끼지 않는다.
import { isLophn } from "../../../../protocol/lophn-agent/workspaces.ts";

export const AGENT_ID = /^agt_[0-7][0-9a-hjkmnp-tv-z]{25}$/;

/** 자리 id의 접두사가 앱인지 project인지 정한다. 앱 공간의 관리 화면이 같은 source를 쓴다. */
export const isAppWorkspace = (workspace: string) =>
  workspace.startsWith("app_");

/** agent id(`lophn`이거나 `agt_…`)인가. */
export const isAgentId = (value: unknown): value is string =>
  typeof value === "string" && (isLophn(value) || AGENT_ID.test(value));
