import { ok } from "../../../base/mod.ts";
import type { AgentAtPlace } from "../../../protocol/lophn-agent/places.ts";
import type { AppToolkit } from "./app-toolkit.ts";

// 다른 domain 앱 command의 비공개 command를 뺀다. agent는 자기 domain 집합 안 domain의 command를 다 보고, 그 밖
// domain(같은 앱의 다른 domain 포함)과 집합이 없는 lophn은 `public` command만 본다. 읽지 못하면 뺀다
// (막는 쪽으로 실패한다). `lophn <domain> <command>`가 부를 때마다 거른다.
export function withPublicOnly(
  toolkit: AppToolkit,
  deps: {
    // agent가 일하는 domain id 전부. 읽지 못하면 null.
    callerDomains(who: AgentAtPlace): Promise<readonly string[] | null>;
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

  return { load };
}
