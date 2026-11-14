// AppsSource를 main의 core 통로로 만든다. 응답은 main의 contract client가 route output
// schema로 이미 검사했다. 아래 모양은 그 schema에서 이 화면이 읽는 field만 옮긴 것이다.
import {
  appArchive,
  appCreate,
  appDelete,
  appUnarchive,
} from "../../../protocol/apps/apps.ts";
import { appSlugOf } from "../../../protocol/apps/app-slug.ts";
import type { CoreCall } from "../../ipc/core.ts";
import { commandBody } from "../command-call.ts";
import type { CoreSource } from "../desktop/connection/connection.ts";
import type { AppRow, AppsSource, RunState, SourceResult } from "./source.ts";

interface AppValue {
  id: string;
  name: string;
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

export function rowOf(
  value: AppValue,
  releaseNumber: number | null = null,
): AppRow {
  return {
    id: value.id,
    name: value.name,
    archived: value.status === "archived",
    release: value.active_release,
    releaseNumber,
    revision: value.revision,
  };
}

export function coreAppsSource(core: CoreSource): AppsSource {
  // release 번호는 바뀌지 않아 id마다 한 번만 읽는다. 못 읽으면 null이고 다음에 다시 읽는다.
  const numbers = new Map<string, number>();
  const numberOf = async (release: string | null): Promise<number | null> => {
    if (release === null) return null;
    const known = numbers.get(release);
    if (known !== undefined) return known;
    const reply = await core.call({
      kind: "read",
      resource: "releases",
      method: "get_record",
      body: { release },
    });
    const number = reply.ok
      ? (reply.value as { release: { number: number } | null }).release?.number
      : undefined;
    if (number === undefined) return null;
    numbers.set(release, number);
    return number;
  };
  const withNumber = async (value: AppValue) =>
    rowOf(value, await numberOf(value.active_release));
  return {
    watch: (listener) => core.subscribe(listener),

    async list() {
      const rows: AppRow[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < PAGE_LIMIT; page += 1) {
        const result: SourceResult<{
          apps: AppValue[];
          next_cursor: string | null;
        }> = await call(core, "read", "list", cursor ? { cursor } : {});
        if (!result.ok) return result;
        rows.push(...(await Promise.all(result.value.apps.map(withNumber))));
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
      return { ok: true, value: await withNumber(result.value.app) };
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

    async create(draft) {
      // 성공 응답은 route output(App) 그대로다.
      const result = await call<AppValue>(
        core,
        "command",
        appCreate.method,
        commandBody(appCreate, {
          input: {
            slug: appSlugOf(
              draft.name,
              crypto.randomUUID().replaceAll("-", "").slice(0, 8),
            ),
            name: draft.name,
            description: draft.description,
          },
          compare: {},
          key: `apps-create-${crypto.randomUUID()}`,
        }),
      );
      return result.ok
        ? { ok: true, value: await withNumber(result.value) }
        : result;
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
      return result.ok
        ? { ok: true, value: await withNumber(result.value) }
        : result;
    },

    async deleteApp(app) {
      const result = await call<unknown>(
        core,
        "command",
        appDelete.method,
        commandBody(appDelete, {
          input: { app: app.id },
          compare: { base_revision: app.revision },
          key: `apps-${appDelete.method}-${crypto.randomUUID()}`,
        }),
      );
      return result.ok ? { ok: true, value: null } : result;
    },

    async publishedPackages(app) {
      const owned: { name: string; versions: string[] }[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < PAGE_LIMIT; page += 1) {
        const reply = await core.call({
          kind: "read",
          resource: "packages",
          method: "list",
          body: { limit: 200, ...(cursor === undefined ? {} : { cursor }) },
        });
        if (!reply.ok) {
          return { ok: false, code: reply.error?.code ?? "internal" };
        }
        const value = reply.value as {
          packages: {
            name: string;
            owner_app: string | null;
            versions: { version: string }[];
          }[];
          next_cursor?: string | null;
        };
        for (const pkg of value.packages) {
          if (pkg.owner_app !== app.id) continue;
          owned.push({
            name: pkg.name,
            versions: pkg.versions.map((v) => v.version),
          });
        }
        if (!value.next_cursor) break;
        cursor = value.next_cursor;
      }
      const result: { name: string; users: number }[] = [];
      for (const pkg of owned) {
        const users = new Set<string>();
        for (const version of pkg.versions) {
          const reply = await core.call({
            kind: "read",
            resource: "packages",
            method: "usage",
            body: { name: pkg.name, version },
          });
          if (!reply.ok) continue;
          for (const use of (reply.value as { usages: { app: string }[] })
            .usages) {
            if (use.app !== app.id) users.add(use.app);
          }
        }
        result.push({ name: pkg.name, users: users.size });
      }
      return { ok: true, value: result };
    },

    // 앱 공간 본문에 여는 화면은 선언 read(`/apps/tools`)가 준다. 그 release의
    // 선언에 `tab` 자리로 적힌 첫 화면이다(main의 앱 전용 창 `createEntryScreen`과 같은 규칙).
    async entryScreen(app, release) {
      const result = await call<{
        release: string;
        screens: { key: string; places: string[] }[];
      }>(core, "read", "tools", { app, release });
      if (!result.ok) return result;
      const entry =
        result.value.release === release
          ? result.value.screens.find((screen) => screen.places.includes("tab"))
          : undefined;
      return entry === undefined
        ? { ok: false, code: "unavailable" }
        : { ok: true, value: entry.key };
    },
  };
}
