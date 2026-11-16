import { createIdSource, ok } from "../../../../base/mod.ts";
import {
  PROJECT_CLONE_ROUTES,
  projectApi,
  projectClone,
} from "../../../../protocol/projects/mod.ts";
import type { Sql } from "../../../../protocol/server/mod.ts";
import {
  type CloneInput,
  cloneProject,
  gitCloneRunner,
  nodeCloneFs,
  projectsFolderSetting,
} from "../../../projects/clone/mod.ts";
import { PROJECT_CLONE_CONTEXT } from "../../../projects/registry/mod.ts";
import { openConnection } from "../../../storage/ledger/mod.ts";
import type { WiringFactory } from "./context.ts";

// handler는 아래 wiring이 붙인다.
export function createCoreRegistration() {
  return { memoryRoutes: PROJECT_CLONE_ROUTES };
}

// 이 기계에 없는 project를 받아 등록한다. 등록은 core 안 machine 자격(machine:projects-clone)으로 낸다.
export const projectCloneWiring: WiringFactory = () => ({
  name: "project-clone",
  operations: () => [
    { name: projectApi.register.name, actors: ["machine"], kind: "command" },
  ],
  records: () => [PROJECT_CLONE_CONTEXT],
  build(ctx) {
    const ids = createIdSource({ clock: ctx.clock, random: ctx.random });
    const logger = ctx.telemetry.logger;
    return ok({
      memory: [
        [
          `${projectClone.resource}/${projectClone.method}`,
          (_who, body) =>
            cloneProject(body as CloneInput, {
              git: gitCloneRunner,
              fs: nodeCloneFs,
              ids,
              random: ctx.random,
              logger,
              // writer는 모든 층이 쌓인 뒤에 채워지므로 부를 때 읽는다.
              writer: {
                command: (auth, envelope) => ctx.writer.command(auth, envelope),
              },
              snapshot<T>(read: (sql: Pick<Sql, "get" | "all">) => T): T {
                const opened = openConnection(ctx.ledgerPath);
                if (!opened.ok) throw new Error(opened.error.message);
                try {
                  return read(opened.value.sql);
                } finally {
                  opened.value.close();
                }
              },
              settings: {
                folder: () => ctx.settings.get(projectsFolderSetting) ?? "",
                async remember(path) {
                  const written = ctx.settingsUpdate([
                    {
                      key: projectsFolderSetting.key,
                      action: "set",
                      value: path,
                    },
                  ]);
                  if (!written.ok || written.value.rejected.length > 0) {
                    logger.error({
                      component: "projects-clone",
                      event: "folder_not_remembered",
                      message: "the projects folder could not be saved",
                    });
                  }
                },
              },
            }),
        ],
      ],
    });
  },
});
