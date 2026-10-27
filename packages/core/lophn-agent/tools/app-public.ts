import { ok } from "../../../base/mod.ts";
import type { AgentRef } from "../../../protocol/lophn-agent/places.ts";
import type { AppToolkit } from "./app-toolkit.ts";
import { buildAppTools } from "./app-tools.ts";

// 다른 domain 앱 tool의 비공개 tool을 뺀다. agent는 자기 domain 집합 안 domain의 tool을 다 보고, 그 밖
// domain(같은 앱의 다른 domain 포함)과 집합이 없는 lophn은 `public` tool만 본다. 읽지 못하면 뺀다
// (막는 쪽으로 실패한다).
// prepare가 부르는 건 `load`라서 거르기는 load의 views에 건다. `define`은 그 위에 만든다.
export function withPublicOnly(
  toolkit: AppToolkit,
  deps: {
    // agent가 일하는 domain id 전부. 읽지 못하면 null.
    callerDomains(agent: AgentRef): Promise<readonly string[] | null>;
    // 앱의 domain 이름 → id. 읽지 못하면 null.
    toolDomain(app: string, name: string): Promise<string | null>;
  },
): AppToolkit {
  const load: AppToolkit["load"] = async (agent) => {
    const loaded = await toolkit.load(agent);
    if (!loaded.ok) return loaded;
    const mine = (await deps.callerDomains(agent)) ?? [];
    // 같은 load 안에서 같은 (앱, domain 이름)을 다시 읽지 않는다.
    const ids = new Map<string, Promise<string | null>>();
    const views = [];
    for (const view of loaded.value.views) {
      const tools = [];
      for (const tool of view.tools) {
        let visible = tool.public;
        if (!visible) {
          const key = `${view.app}\0${tool.domain}`;
          if (!ids.has(key)) {
            ids.set(key, deps.toolDomain(view.app, tool.domain));
          }
          const id = await ids.get(key)!;
          visible = id !== null && mine.includes(id);
        }
        if (visible) tools.push(tool);
      }
      views.push({ ...view, tools });
    }
    return ok({ ...loaded.value, views });
  };

  return {
    load,
    async define(agent) {
      const loaded = await load(agent);
      if (!loaded.ok) return loaded;
      return ok(await buildAppTools(loaded.value));
    },
  };
}
