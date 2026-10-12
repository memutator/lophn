// `/v1/apps/blueprint`. 앱 하나의 active release에 고정된 blueprint를 command·화면·automation의
// 설명으로 읽는다. 정본은 release에 고정한 blueprint이고 앱 source의 현재 파일이
// 아니다. release 읽기는 releases 조립이 loader로 준다(leaf 사이는 mod.ts로만 부르므로 여기서
// releases를 import하지 않는다).
import { err, ok, type Result } from "../../../base/mod.ts";
import {
  appBlueprint,
  type AppBlueprintCommand,
  type Release,
} from "../../../protocol/apps/mod.ts";
import type { Blueprint } from "./mod.ts";
import type {
  ReadDefinition,
  ReadSnapshot,
} from "../../../protocol/server/mod.ts";
import { appAccessDenied, authorizeApp, loadApp } from "../registration/mod.ts";
import { descriptionGaps } from "./describe.ts";

export type ActiveBlueprint = {
  release: Release;
  blueprint: Blueprint;
  // release 준비 때 blueprint에서 만들어 둔 선언 사실.
  declarations: {
    permissions: readonly unknown[];
    app_connections: readonly { app: string; commands: readonly string[] }[];
    commands: readonly string[];
    automations: readonly {
      key: string;
      command: string;
      external: boolean;
      input_hash: string;
      when: unknown;
    }[];
    problem_codes?: readonly string[];
    documents?: readonly unknown[];
  };
};

// 앱이 채택한 release와 그 고정 blueprint. active release가 없으면 null이다.
export type ActiveBlueprintLoader = (
  sql: ReadSnapshot["sql"],
  app: string,
  release?: string,
) => Result<ActiveBlueprint | null>;

function notFound(): Result<never> {
  return err({ code: "not_found", message: "app blueprint not found" });
}

export function createBlueprintReads(load: ActiveBlueprintLoader): {
  blueprint: ReadDefinition<typeof appBlueprint>;
} {
  return {
    blueprint: {
      route: appBlueprint,
      handle(snapshot, ctx, input) {
        const app = loadApp(snapshot.sql, input.app);
        if (!app.ok) return app;
        // 없는 앱·범위 밖 앱·active release 없는 앱은 같은 답이다.
        if (app.value === null) return notFound();
        const access = authorizeApp(snapshot.port, ctx, appBlueprint.name, {
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
        const { release, blueprint, declarations } = active.value;
        const gaps = descriptionGaps(blueprint);
        const commands: AppBlueprintCommand[] = blueprint.commands.map((
          command,
        ) => ({
          key: command.key,
          label: command.label,
          description: command.description,
          effect: command.effect,
          confirm: command.confirm,
          input: command.input as AppBlueprintCommand["input"],
          revert: command.revert,
        }));
        return ok({
          app: input.app,
          release: release.id,
          blueprint_hash: release.blueprint_hash,
          name: blueprint.name,
          description: blueprint.description,
          commands,
          screens: blueprint.screens.map((screen) => ({
            key: screen.key,
            label: screen.label,
            path: screen.path,
            sizes: screen.sizes,
          })),
          automations: blueprint.automatic_tasks.map((task) => ({
            key: task.key,
            label: task.label,
            command: task.command,
            when: task.when,
          })),
          agent_context: blueprint.agent_context.map((entry) => ({
            screen: entry.screen,
            read_command: entry.read_command,
            annotation_targets: entry.annotation_targets.map((target) => ({
              key: target.key,
              label: target.label,
              write_command: target.write_command,
            })),
          })),
          // 설명·구조·test는 서로 다른 근거다. 구조는 준비 때 검증기를 통과한 것만 저장되고
          // test 통과는 release에 고정한 같은 hash의 app test 참조다.
          declarations: {
            permissions: declarations.permissions as never,
            app_connections: declarations.app_connections.map((entry) => ({
              app: entry.app,
              commands: [...entry.commands],
            })),
            commands: [...declarations.commands],
            automations: declarations.automations.map((entry) => ({
              ...entry,
            })) as never,
            problem_codes: [...(declarations.problem_codes ?? [])],
            documents: [...(declarations.documents ?? [])] as never,
          },
          evidence: {
            description: { complete: gaps.length === 0, gaps },
            structure: { validated: true },
            test: {
              passed: release.tests.length > 0,
              verifications: release.tests,
            },
          },
          as_of_seq: snapshot.as_of_seq,
          next_cursor: null,
        });
      },
    },
  };
}
