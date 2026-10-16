import { ok, type Result } from "../../../base/mod.ts";
import { appAppApi } from "../../../protocol/apps/blueprint/read.ts";
import type { AgentGrantEntry } from "../../../protocol/approvals/mod.ts";
import type { AgentRef, Place } from "../../../protocol/lophn-agent/places.ts";
import type { Grants } from "../../approvals/ports.ts";
import { type CoreCall, readOf } from "../run-loop/core-call.ts";
import { type AppApiMissingState } from "./app-api/missing.ts";
import {
  type AppApiSource,
  type AppApiTool,
  type AppApiView,
  buildAppApiTools,
} from "./app-tools.ts";

// agent runtime의 app-api 연결. session을 시작할 때 agent grant에서 할당된 앱을 읽고, 그 앱의 활성 release
// 선언을 읽어 tool 정의를 만든다. 판정은 만들지 않는다: Gate는 호출이 지나는 core의 호출 경로가 건다.

type AppApiLoad = Pick<AppApiSource, "views" | "entries">;

export type AppApiToolkit = {
  // 지금의 선언과 grant.
  load(agent: AgentRef): Promise<Result<AppApiLoad>>;
  define(
    agent: AgentRef,
    place: Place | null,
  ): Promise<Result<readonly AppApiTool[]>>;
  // 앞서 보인 tool과 지금의 선언·grant로 `appApiMissingReason`의 state를 만든다.
  missingState(
    offered: readonly AppApiTool[],
    loaded: AppApiLoad,
    denied?: ReadonlySet<string>,
  ): AppApiMissingState;
};

export function createAppApiToolkit(options: {
  // machine 자격의 loopback. 앱의 활성 release 선언을 읽는다.
  machine: CoreCall;
  grants: Pick<Grants, "agentGrant">;
}): AppApiToolkit {
  async function load(agent: AgentRef): Promise<Result<AppApiLoad>> {
    const grant = await options.grants.agentGrant(agent);
    if (!grant.ok) return grant;
    const entries: AgentGrantEntry[] = grant.value.entries;
    const views: AppApiView[] = [];
    for (const entry of entries) {
      if (entry.kind !== "app") continue;
      const read = await readOf(options.machine, appAppApi, {
        app: entry.app,
      });
      // active release가 없거나 읽지 못한 앱은 선언이 없는 앱과 같다.
      if (!read.ok) continue;
      views.push({
        app: read.value.app,
        name: read.value.name,
        release: read.value.release,
        app_api: read.value.app_api,
      });
    }
    return ok({ views, entries });
  }

  return {
    load,
    async define(agent, place) {
      const loaded = await load(agent);
      if (!loaded.ok) return loaded;
      return ok(await buildAppApiTools({ place, ...loaded.value }));
    },
    missingState(offered, loaded, denied) {
      return {
        offered: offered.map((tool) => ({
          name: tool.definition.name,
          app: tool.app,
          api: tool.api,
        })),
        declared: new Map(loaded.views.map((view) => [
          view.app,
          new Set(view.app_api.map((api) => api.key)),
        ])),
        entries: loaded.entries,
        ...(denied === undefined ? {} : { denied }),
      };
    },
  };
}
