// `app.tools`. 앱 하나의 active release에 고정된 선언을 command·operation·화면의 설명으로 읽는다.
// 정본은 release에 고정한 선언이고 앱 source의 현재 파일이 아니다. release 읽기는 releases 조립이
// loader로 준다(leaf 사이는 mod.ts로만 부르므로 여기서 releases를 import하지 않는다).
import { err, ok, type Result } from "../../../base/mod.ts";
import { parseActor } from "../../../protocol/base/mod.ts";
import type { ReleaseRecord } from "../../../protocol/apps/mod.ts";
import {
  type AppCommand,
  appToolIndex,
  type AppToolIndexEntry,
  appTools,
} from "../../../protocol/apps/declaration/read.ts";
import { type AppDeclaration, handlerNames } from "./mod.ts";
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
import { usagePorts } from "../usage/mod.ts";
import { descriptionGaps } from "./describe.ts";

type ActiveDeclaration = {
  release: ReleaseRecord;
  declaration: AppDeclaration;
};

// 앱이 채택한 release와 그 고정 declaration. active release가 없으면 null이다.
type ActiveDeclarationLoader = (
  sql: ReadSnapshot["sql"],
  app: string,
  release?: string,
) => Result<ActiveDeclaration | null>;

function notFound(): Result<never> {
  return err({ code: "not_found", message: "app declaration not found" });
}

// `app.tool_index`. 모든 앱의 command 목록이다. 앱 범위 판정(authorizeApp)을 하지 않는다. 사람이 정했다: 앱 workspace의
// session도 모든 앱의 목록과 command 목록을 읽는다. 돌려주는 칸이 이것뿐이다.
// 다른 앱의 비공개 command는 부른 쪽 credential로 거른다: agent는 session이 그 앱 workspace에 있을 때만 비공개를 보고,
// 사람(user)은 모두 본다. 같은 명령을 binary가 user token으로도 부르기 때문에 이 판단은 명령이 아니라 여기서 한다.
// session의 workspace가 usage port에 있어서 이 read는 그 port를 가진 등록(apps-usage)에 붙는다.
export function createToolIndexRead(
  load: ActiveDeclarationLoader,
): ReadDefinition<typeof appToolIndex> {
  return {
    route: appToolIndex,
    handle(snapshot, ctx, input) {
      const actor = parseActor(ctx.actor);
      const ports = snapshot.port(usagePorts);
      // session을 읽지 못한 agent는 workspace가 없는 것으로 본다(public만 보인다).
      const sessionWorkspace =
        actor?.kind === "agent"
          ? (ports.sessionWorkspace(actor.id)?.workspace ?? null)
          : null;
      const listed =
        input.app === undefined
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
        const { declaration } = active.value;
        const visible = declaration.commands.filter((command) => {
          if (command.public || actor?.kind === "user") return true;
          return (
            sessionWorkspace?.kind === "app" && sessionWorkspace.id === app.id
          );
        });
        entries.push({
          app: app.id,
          name: declaration.name,
          description: declaration.description,
          tools: visible.map((command) => ({
            name: command.name,
            description: command.description,
            effect: command.effect,
            public: command.public,
            // 호출 모양은 앱 하나를 볼 때만 싣는다.
            ...(input.app === undefined
              ? {}
              : {
                  inputSchema: command.inputSchema as AppCommand["inputSchema"],
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
  };
}

export function createDeclarationReads(load: ActiveDeclarationLoader): {
  appTool: ReadDefinition<typeof appTools>;
} {
  return {
    appTool: {
      route: appTools,
      handle(snapshot, ctx, input) {
        const app = loadApp(snapshot.sql, input.app);
        if (!app.ok) return app;
        // 없는 앱·범위 밖 앱·active release 없는 앱은 같은 답이다.
        if (app.value === null) return notFound();
        const access = authorizeApp(snapshot, ctx, appTools.name, {
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
        const { release, declaration } = active.value;
        const gaps = descriptionGaps(declaration);
        return ok({
          app: input.app,
          slug: app.value.slug,
          release: release.id,
          declaration_hash: release.declaration_hash,
          name: declaration.name,
          description: declaration.description,
          tools: declaration.commands.map(
            (command): AppCommand => ({
              name: command.name,
              description: command.description,
              inputSchema: command.inputSchema as AppCommand["inputSchema"],
              effect: command.effect,
              public: command.public,
            }),
          ),
          // operation은 화면과 그 앱 자신이 쓰는 층이라 agent에게는 보이지 않는다. 예외는 그 앱 workspace의 session이다
          // (preview에서 부를 수 있으니까). 화면을 허용하는 supervisor(machine)와 사람은 모두 본다.
          operations:
            parseActor(ctx.actor)?.kind === "agent" &&
            ctx.conditions.app !== input.app
              ? []
              : declaration.operations.map((operation) => ({
                  name: operation.name,
                  title: operation.title,
                  effect: operation.effect,
                })),
          screens: declaration.screens.map((screen) => ({
            key: screen.key,
            label: screen.label,
            path: screen.path,
            places: screen.places,
            ...(screen.params ? { params: screen.params } : {}),
            ...(screen.tray ? { tray: screen.tray } : {}),
          })),
          ...(declaration.keys ? { keys: declaration.keys } : {}),
          ...(declaration.events ? { events: declaration.events } : {}),
          ...(declaration.subscriptions
            ? { subscriptions: declaration.subscriptions }
            : {}),
          ...(declaration.widgets ? { widgets: declaration.widgets } : {}),
          // 선언 사실은 고정 선언에서 푼다. 실행 범위(선언 ∩ grant)를 읽는 쪽이 쓴다.
          facts: {
            permissions: declaration.permissions as never,
            app_connections: declaration.app_connections.map((use) => ({
              app: use.app,
              tools: [...use.commands],
            })),
            tools: handlerNames(declaration),
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
