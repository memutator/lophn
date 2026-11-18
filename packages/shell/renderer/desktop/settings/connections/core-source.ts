// CodingConnectionsSource를 core route로 만든다. 제품마다 감지 결과와 다시 감지, 전역 hook 상태·놓기·지우기는
// `coding_agents/*`다. 연결 생성·회수·token은 이 통로에 없다.
import type { z } from "zod";

import {
  SHARED_APPS_SETTING_KEY,
  sharedAppsSettingSchema,
} from "../../../../../protocol/approvals/share-request.ts";
import type { Route } from "../../../../../protocol/base/route.ts";
import {
  codingAgentsHookStatus,
  codingAgentsInstallHooks,
  codingAgentsList,
  codingAgentsRefresh,
  codingAgentsUninstallHooks,
} from "../../../../../protocol/coding-agent/coding-agents.ts";
import type { CoreSource } from "../../connection/connection.ts";
import { chooseSetting, readEffective } from "../declared.ts";
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
  // 공유 요청 승인이 같은 값에 slug를 더하므로 빼기 직전에 다시 읽어 한 slug만 빼고 값 전체를 쓴다.
  async function readShared(): Promise<SourceResult<string[]>> {
    const read = await readEffective(core, [SHARED_APPS_SETTING_KEY]);
    if (!read.ok) return read;
    const parsed = sharedAppsSettingSchema.safeParse(
      read.value.get(SHARED_APPS_SETTING_KEY),
    );
    return parsed.success
      ? { ok: true, value: parsed.data }
      : { ok: false, code: "internal" };
  }

  return {
    async unshareApp(slug) {
      const current = await readShared();
      if (!current.ok) return current;
      return chooseSetting(
        core,
        SHARED_APPS_SETTING_KEY,
        current.value.filter((one) => one !== slug),
      );
    },

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
