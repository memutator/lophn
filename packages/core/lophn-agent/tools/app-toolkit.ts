import { ok, type Result } from "../../../base/mod.ts";
import { appTools } from "../../../protocol/apps/blueprint/read.ts";
import type { AgentGrantEntry } from "../../../protocol/approvals/mod.ts";
import type { AgentRef } from "../../../protocol/lophn-agent/places.ts";
import type { Grants } from "../../approvals/ports.ts";
import { type CoreCall, readOf } from "../run-loop/core-call.ts";
import {
  type AppToolEntry,
  type AppToolSource,
  type AppToolView,
  buildAppTools,
} from "./app-tools.ts";

// agent runtime의 앱 tool 연결. session을 시작할 때 agent grant에서 할당된 앱을 읽고, 그 앱의 활성 release
// 선언을 읽어 tool 정의를 만든다. 판정은 만들지 않는다: Gate는 호출이 지나는 core의 호출 경로가 건다.

type AppToolLoad = Pick<AppToolSource, "views" | "entries">;

export type AppToolkit = {
  // 지금의 선언과 grant.
  load(agent: AgentRef): Promise<Result<AppToolLoad>>;
  define(agent: AgentRef): Promise<Result<readonly AppToolEntry[]>>;
};

export function createAppToolkit(options: {
  // machine 자격의 loopback. 앱의 활성 release 선언을 읽는다.
  machine: CoreCall;
  grants: Pick<Grants, "agentGrant">;
}): AppToolkit {
  async function load(agent: AgentRef): Promise<Result<AppToolLoad>> {
    const grant = await options.grants.agentGrant(agent);
    if (!grant.ok) return grant;
    const entries: AgentGrantEntry[] = grant.value.entries;
    const views: AppToolView[] = [];
    for (const entry of entries) {
      if (entry.kind !== "app") continue;
      const read = await readOf(options.machine, appTools, {
        app: entry.app,
      });
      // active release가 없거나 읽지 못한 앱은 선언이 없는 앱과 같다.
      if (!read.ok) continue;
      views.push({
        app: read.value.app,
        name: read.value.name,
        release: read.value.release,
        tools: read.value.tools,
      });
    }
    return ok({ views, entries });
  }

  return {
    load,
    async define(agent) {
      const loaded = await load(agent);
      if (!loaded.ok) return loaded;
      return ok(await buildAppTools(loaded.value));
    },
  };
}
