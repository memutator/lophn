// CodingConnectionsSource를 core route로 만든다. 제품마다 감지 결과와 다시 감지, 전역 hook 상태·놓기·지우기는
// `coding_agents/*`다. 연결 생성·회수·token은 이 통로에 없다.
import type { z } from "zod";

import type { Route } from "../../../../../protocol/base/route.ts";
import {
  codingAgentsHookStatus,
  codingAgentsInstallHooks,
  codingAgentsList,
  codingAgentsRefresh,
  codingAgentsUninstallHooks,
} from "../../../../../protocol/coding-agent/coding-agents.ts";
import { CODING_DEPLOYED_SKILLS_SETTING_KEY } from "../../../../../protocol/lophn-agent/skill-settings.ts";
import { createLink } from "../../../workspace/agents/core-link.ts";
import { readDeployable } from "../../../workspace/agents/core-extensions.ts";
import type { CoreSource } from "../../connection/connection.ts";
import { chooseSetting } from "../declared.ts";
import type { CodingConnectionsSource, SourceResult } from "./source.ts";

async function call<R extends Route>(
  core: CoreSource,
  route: R,
  body: z.input<R["input"]>,
): Promise<SourceResult<z.output<R["output"]>>> {
  try {
    const reply = await core.call({
      kind: route.kind,
      resource: route.resource,
      method: route.method,
      body,
    });
    return reply.ok
      ? { ok: true, value: reply.value as z.output<R["output"]> }
      : { ok: false, code: reply.error?.code ?? "unavailable" };
  } catch {
    return { ok: false, code: "unavailable" };
  }
}

export function coreCodingConnectionsSource(
  core: CoreSource,
): CodingConnectionsSource {
  const link = createLink(core, () => crypto.randomUUID().slice(0, 8));

  return {
    async deployable() {
      const read = await readDeployable(link);
      return read.ok ? read : { ok: false, code: read.message };
    },

    setDeployed: (next) =>
      chooseSetting(core, CODING_DEPLOYED_SKILLS_SETTING_KEY, next),

    async harnesses() {
      const read = await call(core, codingAgentsList, {});
      return read.ok ? { ok: true, value: read.value.harnesses } : read;
    },

    async refresh() {
      const read = await call(core, codingAgentsRefresh, {});
      return read.ok ? { ok: true, value: read.value.harnesses } : read;
    },

    async hookStatus() {
      const read = await call(core, codingAgentsHookStatus, {});
      return read.ok ? { ok: true, value: read.value.hooks } : read;
    },

    async installHooks(harness) {
      const read = await call(core, codingAgentsInstallHooks, { harness });
      return read.ok ? { ok: true, value: read.value.hook } : read;
    },

    async uninstallHooks(harness) {
      const read = await call(core, codingAgentsUninstallHooks, { harness });
      return read.ok ? { ok: true, value: read.value.hook } : read;
    },
  };
}
