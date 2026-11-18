import { existsSync, realpathSync } from "node:fs";
import * as fsPromises from "node:fs/promises";

import {
  createIdSource,
  err,
  homeOf,
  ok,
  type Result,
} from "../../../../base/mod.ts";
import {
  projectAdd,
  projectBrowse,
} from "../../../../protocol/projects/add-api.ts";
import {
  projectApi,
  projectIdentityApi,
} from "../../../../protocol/projects/mod.ts";
import type { Sql } from "../../../../protocol/server/mod.ts";
import { openConnection } from "../../../storage/ledger/mod.ts";
import { addProject, type ProjectAddInput } from "../../../projects/add.ts";
import { browseFolders } from "../../../projects/browse.ts";
import {
  createGitReader,
  createIdentityFs,
  createIdentityService,
  type IdentityService,
} from "../../../projects/identity/mod.ts";
import {
  assignBornIdentities,
  loadProjects,
  type Project,
  PROJECT_IDENTITY_CONTEXT,
} from "../../../projects/registry/mod.ts";
import type { DataStep, DataStepDeps } from "../../../storage/migration/mod.ts";
import type { WiringFactory } from "./context.ts";

type ReadSql = Pick<Sql, "get" | "all">;

// 읽을 때마다 짧은 연결을 연다.
function snapshot<T>(
  ledgerPath: string,
  read: (sql: ReadSql, seq: string) => Result<T>,
): Result<T> {
  const opened = openConnection(ledgerPath);
  if (!opened.ok) return opened;
  try {
    const head = opened.value.sql.get(
      "select coalesce(max(seq), 0) as seq from events",
      [],
    );
    return read(opened.value.sql, String(head?.["seq"] ?? 0));
  } finally {
    opened.value.close();
  }
}

// 이 command가 commit되면 폴더가 바뀌었거나 다시 쓰이므로 id file을 다시 읽는다.
const FOLDER_CHANGES = new Set<string>([
  projectApi.register.name,
  projectApi.relinkFolder.name,
  projectApi.unarchive.name,
]);

const STARTUP_PARALLEL = 4;

// 폴더 목록이 읽는 범위의 뿌리. 없거나 풀지 못하면 목록은 unavailable이다.
function realHome(): string | null {
  const home = homeOf(process.env, process.platform);
  if (home === undefined) return null;
  try {
    return realpathSync(home);
  } catch {
    return null;
  }
}

// 이 판 전에 등록한 git이 아닌 project와 폴더가 없는 project에 ledger에서 난 id를 준다. id가 IdSource에서 나야 해서
// SQL schema step이 아니라 data step이다. runtime이 열리기 전에 돌아 writer와 겹치지 않는다.
export const projectsBornIdentityStep = {
  id: "projects.born-identity",
  async run(root: string, { ids }: DataStepDeps): Promise<Result<void>> {
    const opened = openConnection(`${root}/lophn.db`);
    if (!opened.ok) return opened;
    try {
      assignBornIdentities(opened.value.sql, ids);
      return ok(undefined);
    } catch {
      return err({
        code: "unavailable",
        message: "projects outside git could not be given an identity",
      });
    } finally {
      opened.value.close();
    }
  },
} satisfies DataStep;

export const projectsWiring: WiringFactory = () => {
  let startup: Promise<void> = Promise.resolve();
  let reconcileActive = (): Promise<void> => Promise.resolve();
  let stopping = false;
  return {
    name: "projects",
    dataSteps: [projectsBornIdentityStep],
    // project 키워드 검색이 project 폴더를 찾는 ledger snapshot.
    environment: (ctx) => ({
      projectSearch: {
        snapshot: <T>(read: (sql: ReadSql, seq: string) => Result<T>) =>
          snapshot(ctx.ledgerPath, read),
      },
    }),
    operations: () => [
      // 폴더에서 읽은 id를 적는 core 안 machine 자격(projects/identity).
      {
        name: projectIdentityApi.recordIdentity.name,
        actors: ["machine"],
        kind: "command",
      },
    ],
    records: () => [PROJECT_IDENTITY_CONTEXT],
    build(ctx) {
      const logger = ctx.telemetry.logger;
      const ids = createIdSource({ clock: ctx.clock, random: ctx.random });
      const identity: IdentityService = createIdentityService({
        git: createGitReader({ logger }),
        fs: createIdentityFs(ids),
        ids,
        writer: () => ctx.writer,
        snapshot: (read) => snapshot(ctx.ledgerPath, (sql) => read(sql)),
        folders: { exists: (path) => existsSync(path) },
        logger,
      });
      const home = realHome();
      const reconcile = async (project: Pick<Project, "id" | "folders">) => {
        const done = await identity.reconcile(project);
        if (!done.ok) {
          logger.warn({
            component: "projects-identity",
            event: "reconcile_failed",
            message: `project ${project.id}: ${done.error.message}`,
          });
        }
      };
      // pull로 바뀐 file을 따라가려고 기동 때 active project를 몇 개씩 다시 읽는다.
      reconcileActive = async () => {
        const projects = snapshot(ctx.ledgerPath, (sql) => loadProjects(sql));
        if (!projects.ok) {
          logger.warn({
            component: "projects-identity",
            event: "startup_read_failed",
            message: projects.error.message,
          });
          return;
        }
        const queue = projects.value.filter(
          (project) => project.status === "active",
        );
        const worker = async () => {
          for (let next = queue.shift(); next; next = queue.shift()) {
            if (stopping) return;
            await reconcile(next);
          }
        };
        await Promise.all(
          Array.from({ length: STARTUP_PARALLEL }, () => worker()),
        );
      };
      return ok({
        // tx 안에서는 file과 git을 만질 수 없어 commit 뒤에 읽는다. 읽기가 실패해도 원래 결과는 그대로다.
        writer: (inner) => ({
          ...inner,
          async command(context, envelope) {
            const done = await inner.command(context, envelope);
            if (!done.ok || done.value.replayed) return done;
            const folders =
              FOLDER_CHANGES.has(envelope.command) ||
              (envelope.command === projectApi.edit.name &&
                (envelope.input as { folders?: unknown }).folders !==
                  undefined);
            if (folders) await reconcile(done.value.result as Project);
            return done;
          },
        }),
        memory: [
          [
            `${projectIdentityApi.identity.resource}/${projectIdentityApi.identity.method}`,
            (_who, body) =>
              identity.status((body as { project: string }).project),
          ],
          [
            `${projectIdentityApi.createIdentity.resource}/${projectIdentityApi.createIdentity.method}`,
            (_who, body) =>
              identity.create((body as { project: string }).project),
          ],
          [
            `${projectIdentityApi.renewIdentity.resource}/${projectIdentityApi.renewIdentity.method}`,
            (_who, body) =>
              identity.renew((body as { project: string }).project),
          ],
          [
            `${projectIdentityApi.match.resource}/${projectIdentityApi.match.method}`,
            (_who, body) => identity.match((body as { path: string }).path),
          ],
          [
            `${projectAdd.resource}/${projectAdd.method}`,
            // project.create는 부른 사람의 자격으로 간다. writer는 모든 층이 쌓인 뒤에 채워지므로 부를 때 읽는다.
            (who, body) =>
              addProject(who, body as ProjectAddInput, {
                writer: {
                  command: (auth, envelope) =>
                    ctx.writer.command(auth, envelope),
                },
                ids,
              }),
          ],
          [
            `${projectBrowse.resource}/${projectBrowse.method}`,
            (_who, body) =>
              browseFolders(body as { path?: string }, {
                home,
                fs: fsPromises,
              }),
          ],
        ],
      });
    },
    // 기동을 막지 않는다(afterReady를 기다리면 control의 ready가 늦는다). 종료가 끝을 기다린다.
    afterReady() {
      startup = reconcileActive();
      return Promise.resolve();
    },
    async closeWork() {
      stopping = true;
      await startup;
    },
  };
};
