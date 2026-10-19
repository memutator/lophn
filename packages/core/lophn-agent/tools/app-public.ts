import { ok } from "../../../base/mod.ts";
import { agentDefinitionRead } from "../../../protocol/lophn-agent/agent-definitions.ts";
import {
  type AgentRef,
  type Place,
  placeOfAgentRef,
} from "../../../protocol/lophn-agent/places.ts";
import { type CoreCall, readOf } from "../run-loop/core-call.ts";
import type { AppApiToolkit } from "./app-toolkit.ts";
import { buildAppApiTools } from "./app-tools.ts";

// 다른 project 앱의 비공개 tool을 뺀다. 같은 project의 agent는 그 앱의 tool을 다 보고, 다른 project의
// agent(place가 없는 lophn 포함)는 `public` tool만 본다. 읽지 못하면 뺀다(막는 쪽으로 실패한다).
// prepare가 부르는 건 `load`라서 거르기는 load의 views에 건다. `define`은 그 위에 만든다.
export function withPublicOnly(
  toolkit: AppApiToolkit,
  deps: {
    machine: CoreCall;
    // 앱의 project. 읽지 못하면 null.
    appProject(app: string): Promise<string | null>;
  },
): AppApiToolkit {
  const { appProject } = deps;

  // 부른 agent의 project. Operator는 정의의 place가 정한다.
  async function callerProject(agent: AgentRef): Promise<string | null> {
    let place: Place | null | undefined = placeOfAgentRef(agent);
    if (place === undefined) {
      const read = await readOf(deps.machine, agentDefinitionRead, { agent });
      place = read.ok ? read.value.place : null;
    }
    if (place === null) return null;
    return place.kind === "project" ? place.id : await appProject(place.id);
  }

  const load: AppApiToolkit["load"] = async (agent) => {
    const loaded = await toolkit.load(agent);
    if (!loaded.ok) return loaded;
    const home = await callerProject(agent);
    const views = [];
    for (const view of loaded.value.views) {
      const same = home !== null && home === await appProject(view.app);
      views.push(
        same
          ? view
          : { ...view, tools: view.tools.filter((tool) => tool.public) },
      );
    }
    return ok({ ...loaded.value, views });
  };

  return {
    load,
    async define(agent) {
      const loaded = await load(agent);
      if (!loaded.ok) return loaded;
      return ok(await buildAppApiTools(loaded.value));
    },
  };
}
