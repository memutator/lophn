// AppsSource를 main의 core 통로로 만든다. 응답은 main의 contract client가 route output
// schema로 이미 검사했다. 아래 모양은 그 schema에서 이 화면이 읽는 field만 옮긴 것이다.
import { appArchive, appUnarchive } from "../../../protocol/apps/apps.ts";
import type { CoreCall } from "../../ipc/core.ts";
import { commandBody } from "../command-call.ts";
import type { CoreSource } from "../desktop/connection/connection.ts";
import type { AppRow, AppsSource, RunState, SourceResult } from "./source.ts";

interface AppValue {
  id: string;
  name: string;
  project: string;
  status: "active" | "archived";
  active_release: string | null;
  revision: string;
}

/** 목록을 끝까지 모을 때 page 상한. 넘으면 모은 것까지만 보인다. */
const PAGE_LIMIT = 20;

async function call<T>(
  core: CoreSource,
  kind: CoreCall["kind"],
  method: string,
  body: unknown,
): Promise<SourceResult<T>> {
  const reply = await core.call({ kind, resource: "apps", method, body });
  if (!reply.ok) return { ok: false, code: reply.error?.code ?? "internal" };
  return { ok: true, value: reply.value as T };
}

function rowOf(value: AppValue): AppRow {
  return {
    id: value.id,
    name: value.name,
    project: value.project,
    archived: value.status === "archived",
    release: value.active_release,
    revision: value.revision,
  };
}

export function coreAppsSource(core: CoreSource): AppsSource {
  return {
    watch: (listener) => core.subscribe(listener),

    async list() {
      const rows: AppRow[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < PAGE_LIMIT; page += 1) {
        const result: SourceResult<
          { apps: AppValue[]; next_cursor: string | null }
        > = await call(core, "read", "list", cursor ? { cursor } : {});
        if (!result.ok) return result;
        rows.push(...result.value.apps.map(rowOf));
        if (result.value.next_cursor === null) break;
        cursor = result.value.next_cursor;
      }
      return { ok: true, value: rows };
    },

    async get(app) {
      const result = await call<{ app: AppValue }>(core, "read", "get", {
        app,
      });
      if (!result.ok) {
        return result.code === "not_found" ? { ok: true, value: null } : result;
      }
      return { ok: true, value: rowOf(result.value.app) };
    },

    async runtime(app) {
      const result = await call<{ state: { state: RunState } }>(
        core,
        "read",
        "runtime",
        { app },
      );
      return result.ok ? { ok: true, value: result.value.state.state } : result;
    },

    async setArchived(app, archived) {
      // 성공 응답은 route output(App) 그대로다.
      const route = archived ? appArchive : appUnarchive;
      const result = await call<AppValue>(
        core,
        "command",
        route.method,
        commandBody(route, {
          input: { app: app.id },
          compare: { base_revision: app.revision },
          key: `apps-${route.method}-${crypto.randomUUID()}`,
        }),
      );
      return result.ok ? { ok: true, value: rowOf(result.value) } : result;
    },

    // 앱 공간 본문에 여는 화면은 blueprint read(`/apps/tools`)가 준다. 그 release의
    // blueprint가 `full` 크기를 선언한 첫 화면이다(main의 앱 전용 창 `createEntryScreen`과 같은 규칙).
    async entryScreen(app, release) {
      const result = await call<{
        release: string;
        screens: { key: string; sizes: string[] }[];
      }>(core, "read", "tools", { app, release });
      if (!result.ok) return result;
      const full = result.value.release === release
        ? result.value.screens.find((screen) => screen.sizes.includes("full"))
        : undefined;
      return full === undefined
        ? { ok: false, code: "unavailable" }
        : { ok: true, value: full.key };
    },
  };
}
