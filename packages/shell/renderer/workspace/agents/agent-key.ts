// 화면이 agent를 가리키는 값(key)과 contract의 AgentRef를 오간다. 내장 role은 role 이름이고 Operator는 `agt_…` ID다.
// 내장 role의 place는 AgentsSource를 부를 때 함께 주는 project나 앱이 정한다.
import type {
  AgentRef,
  Role,
} from "../../../../protocol/lophn-agent/places.ts";

const BUILT_IN: readonly Role[] = ["lophn", "project_manager", "app_engineer"];

export const OPERATOR_ID = /^agt_[0-7][0-9a-hjkmnp-tv-z]{25}$/;

/** 자리 id의 접두사가 앱인지 project인지 정한다. 앱 공간의 관리 화면이 같은 source를 쓴다. */
export const isAppPlace = (place: string) => place.startsWith("app_");

export function keyOf(ref: AgentRef): string {
  return ref.role === "operator" ? ref.agent : ref.role;
}

/** key가 이 자리에서 가리키는 agent. 자리에 맞지 않는 내장 role이거나 모르는 key면 null이다. */
export function refOf(place: string | null, key: string): AgentRef | null {
  if (OPERATOR_ID.test(key)) {
    return { role: "operator", agent: key as `agt_${string}` };
  }
  if (!BUILT_IN.includes(key as Role)) return null;
  if (key === "lophn") return { role: "lophn" };
  if (place === null) return null;
  if (key === "project_manager" && !isAppPlace(place)) {
    return { role: "project_manager", project: place as `prj_${string}` };
  }
  if (key === "app_engineer" && isAppPlace(place)) {
    return { role: "app_engineer", app: place as `app_${string}` };
  }
  return null;
}
