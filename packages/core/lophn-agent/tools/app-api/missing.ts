import type { AgentGrantEntry } from "../../../../protocol/approvals/mod.ts";
import type { MissingToolCode } from "../wire.ts";

// 목록에 없는 app-api tool을 불렀을 때 이유를 구별한다. 이 session이 앞서 보인 tool(offered)과 지금의
// 선언·grant를 비교한다. 앞서 보인 적 없는 이름은 `unknown_tool`이다.

export type AppApiMissingState = {
  // 앞서 보인 tool. name은 정본 이름이다(app-api 이름은 wire 이름과 같다).
  offered: readonly { name: string; app: string; api: string }[];
  // 지금 활성 release의 선언. 앱이 없으면 그 앱의 release가 없다.
  declared: ReadonlyMap<string, ReadonlySet<string>>;
  // 지금의 agent grant.
  entries: readonly AgentGrantEntry[];
  // 사람이나 Gate가 거절해 이 session에서 막힌 tool 이름.
  denied?: ReadonlySet<string>;
};

// agent grant가 이 app-api를 부르게 두는가. 앱을 할당하지 않았거나 api를 뺐으면 아니다.
export function grantAllows(
  entries: readonly AgentGrantEntry[],
  app: string,
  api: string,
): boolean {
  for (const entry of entries) {
    if (entry.kind !== "app" || entry.app !== app) continue;
    return !entry.apis.some((one) =>
      one.api === api && one.setting === "excluded"
    );
  }
  return false;
}

export function appApiMissingReason(
  name: string,
  state: AppApiMissingState,
): MissingToolCode {
  const found = state.offered.find((tool) => tool.name === name);
  if (found === undefined) return "unknown_tool";
  if (state.denied?.has(name)) return "denied";
  if (state.declared.get(found.app)?.has(found.api) !== true) {
    return "removed_from_release";
  }
  if (!grantAllows(state.entries, found.app, found.api)) {
    return "removed_from_grant";
  }
  return "unknown_tool";
}
