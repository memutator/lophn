// `app.tools`. 앱 하나의 active release에 고정된 blueprint를 tool·화면의 설명으로 읽는다.
// 정본은 release에 고정한 blueprint이고 앱 source의 현재 파일이 아니다. release 읽기는 releases 조립이
// loader로 준다(leaf 사이는 mod.ts로만 부르므로 여기서 releases를 import하지 않는다).
import { err, ok, type Result } from "../../../base/mod.ts";
import type { ReleaseRecord } from "../../../protocol/apps/mod.ts";
import {
  type AppTool,
  appToolIndex,
  type AppToolIndexEntry,
  appTools,
} from "../../../protocol/apps/blueprint/read.ts";
import type { Blueprint } from "./mod.ts";
import type {
  ReadDefinition,
  ReadSnapshot,
} from "../../../protocol/server/mod.ts";
import {
  appAccessDenied,
  authorizeApp,
  loadApp,
  loadApps,
} from "../registration/mod.ts";
import { descriptionGaps } from "./describe.ts";

type ActiveBlueprint = {
  release: ReleaseRecord;
  blueprint: Blueprint;
};

// 앱이 채택한 release와 그 고정 blueprint. active release가 없으면 null이다.
type ActiveBlueprintLoader = (
  sql: ReadSnapshot["sql"],
  app: string,
  release?: string,
) => Result<ActiveBlueprint | null>;

function notFound(): Result<never> {
  return err({ code: "not_found", message: "app blueprint not found" });
}

export function createBlueprintReads(load: ActiveBlueprintLoader): {
  appTool: ReadDefinition<typeof appTools>;
  appToolIndex: ReadDefinition<typeof appToolIndex>;
} {
  return {
    // 앱 범위 판정(authorizeApp)을 하지 않는다. 사람이 정했다: App Engineer도 모든 앱의 목록과
    // tool 목록을 읽는다. 돌려주는 칸이 이것뿐이다.
    appToolIndex: {
      route: appToolIndex,
      handle(snapshot, _ctx, input) {
        const listed = input.app === undefined
          ? loadApps(snapshot.sql, "active")
          : loadApp(snapshot.sql, input.app);
        if (!listed.ok) return listed;
        const apps = Array.isArray(listed.value)
          ? listed.value
          : listed.value?.status === "active"
          ? [listed.value]
          : [];
        const entries: AppToolIndexEntry[] = [];
        for (const app of apps) {
          const active = load(snapshot.sql, app.id);
          if (!active.ok) return active;
          if (active.value === null) continue;
          const { blueprint } = active.value;
          entries.push({
            app: app.id,
            name: blueprint.name,
            description: blueprint.description,
            tools: blueprint.tools.map((tool) => ({
              name: tool.name,
              title: tool.title,
              description: tool.description,
              effect: tool.effect,
              public: tool.public,
              domain: tool.domain,
              // 호출 모양은 앱 하나를 볼 때만 싣는다.
              ...(input.app === undefined ? {} : {
                inputSchema: tool.inputSchema as AppTool["inputSchema"],
                ...(tool.outputSchema === undefined ? {} : {
                  outputSchema: tool.outputSchema as AppTool["outputSchema"],
                }),
              }),
            })),
          });
        }
        if (input.app !== undefined && entries.length === 0) return notFound();
        return ok({
          apps: entries,
          as_of_seq: snapshot.as_of_seq,
          next_cursor: null,
        });
      },
    },
    appTool: {
      route: appTools,
      handle(snapshot, ctx, input) {
        const app = loadApp(snapshot.sql, input.app);
        if (!app.ok) return app;
        // 없는 앱·범위 밖 앱·active release 없는 앱은 같은 답이다.
        if (app.value === null) return notFound();
        const access = authorizeApp(snapshot.port, ctx, appTools.name, {
          kind: "app",
          app: app.value,
        });
        if (appAccessDenied(access)) return notFound();
        if (!access.ok) return access;
        const active = load(snapshot.sql, input.app, input.release);
        if (!active.ok) return active;
        if (active.value === null || active.value.release.app !== input.app) {
          return notFound();
        }
        const { release, blueprint } = active.value;
        const gaps = descriptionGaps(blueprint);
        return ok({
          app: input.app,
          release: release.id,
          blueprint_hash: release.blueprint_hash,
          name: blueprint.name,
          description: blueprint.description,
          tools: blueprint.tools.map((tool): AppTool => ({
            name: tool.name,
            title: tool.title,
            description: tool.description,
            inputSchema: tool.inputSchema as AppTool["inputSchema"],
            ...(tool.outputSchema === undefined
              ? {}
              : { outputSchema: tool.outputSchema as AppTool["outputSchema"] }),
            effect: tool.effect,
            public: tool.public,
            domain: tool.domain,
          })),
          screens: blueprint.screens.map((screen) => ({
            key: screen.key,
            label: screen.label,
            path: screen.path,
            sizes: screen.sizes,
          })),
          // 선언 사실은 고정 blueprint에서 푼다. 실행 범위(선언 ∩ grant)를 읽는 쪽이 쓴다.
          declarations: {
            permissions: blueprint.permissions as never,
            app_connections: blueprint.app_connections.map((use) => ({
              app: use.app,
              tools: [...use.tools],
            })),
            tools: blueprint.tools.map((tool) => tool.name),
          },
          // 설명과 구조는 서로 다른 근거다. 구조는 준비 때 검증기를 통과한 것만 저장된다.
          evidence: {
            description: { complete: gaps.length === 0, gaps },
            structure: { validated: true },
          },
          as_of_seq: snapshot.as_of_seq,
          next_cursor: null,
        });
      },
    },
  };
}
