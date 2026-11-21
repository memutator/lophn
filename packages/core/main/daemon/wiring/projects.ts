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
  artifactsFile,
  artifactsList,
  projectApi,
  projectFilesCreate,
  projectFilesRemove,
  projectFilesRename,
  projectFilesWrite,
  projectIdentityApi,
} from "../../../../protocol/projects/mod.ts";
import type { Sql } from "../../../../protocol/server/mod.ts";
import { openConnection } from "../../../storage/ledger/mod.ts";
import { artifactHandlers } from "../../../projects/artifacts/mod.ts";
import { addProject, type ProjectAddInput } from "../../../projects/add.ts";
import { browseFolders } from "../../../projects/browse.ts";
import { projectFilesMutationHandlers } from "../../../projects/files/mod.ts";
import {
  createGitReader,
  createIdentityService,
  type IdentityService,
  matchActions,
  nodeFolderProbe,
  sharedProjects,
} from "../../../projects/identity/mod.ts";
import {
  assignMissingIdentities,
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

// 이 command가 commit되면 폴더가 바뀌었으므로 git 여부와 remote를 다시 읽는다.
const FOLDER_CHANGES = new Set<string>([
  projectApi.register.name,
  projectApi.relinkFolder.name,
  projectApi.unarchive.name,
]);

// 이 command가 commit되면 이 기계의 git project 목록이 바뀌었을 수 있다: 기계 기록을 다시 쓰고 자동 match를 다시 돌린다.
const LIST_CHANGES = new Set<string>([
  projectApi.register.name,
  projectApi.edit.name,
  projectApi.relinkFolder.name,
  projectApi.archive.name,
  projectApi.unarchive.name,
  projectIdentityApi.recordIdentity.name,
  projectIdentityApi.renewIdentity.name,
  projectIdentityApi.linkIdentity.name,
  projectIdentityApi.matchIdentity.name,
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

// id가 없는 project에 ledger에서 난 id를 준다. id가 IdSource에서 나야 해서 SQL schema step이 아니라 data step이다.
// runtime이 열리기 전에 돌아 writer와 겹치지 않는다.
function identityStep(id: string, what: string): DataStep {
  return {
    id,
    async run(root: string, { ids }: DataStepDeps): Promise<Result<void>> {
      const opened = openConnection(`${root}/lophn.db`);
      if (!opened.ok) return opened;
      try {
        assignMissingIdentities(opened.value.sql, ids);
        return ok(undefined);
      } catch (thrown) {
        return err({
          code: "unavailable",
          message: `${what} could not be given an identity: ${thrown instanceof Error ? thrown.message : String(thrown)}`,
        });
      } finally {
        opened.value.close();
      }
    },
  };
}

// 앞 판이 git이 아닌 project와 폴더가 없는 project에 id를 주던 step. 이미 돈 data root가 있어 id를 지우지 못한다.
export const projectsBornIdentityStep = identityStep(
  "projects.born-identity",
  "projects outside git",
);
// git project도 id를 ledger에서 얻는다(저장소 file을 읽지 않는다). id file이 없던 git project와 같은 file을 읽은 두 번째
// copy가 여기서 id를 얻는다. 이미 가진 id(file에서 왔던 것 포함)는 그대로다.
export const projectsIdentityForAllStep = identityStep(
  "projects.identity-for-all",
  "projects",
);

export const projectsWiring: WiringFactory = () => {
  let startup: Promise<void> = Promise.resolve();
  let reconcileActive = (): Promise<void> => Promise.resolve();
  let listChanged = (): void => {};
  // 도는 자동 match. 종료가 끝을 기다린다.
  let matchRun: Promise<void> = Promise.resolve();
  let stopping = false;
  return {
    name: "projects",
    dataSteps: [projectsBornIdentityStep, projectsIdentityForAllStep],
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
      // 내 다른 컴퓨터의 같은 저장소와 id를 맞추는 core 안 machine 자격.
      {
        name: projectIdentityApi.matchIdentity.name,
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
        fs: nodeFolderProbe,
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
      const readProjects = () => {
        const projects = snapshot(ctx.ledgerPath, (sql) => loadProjects(sql));
        if (!projects.ok) {
          logger.warn({
            component: "projects-identity",
            event: "projects_read_failed",
            message: projects.error.message,
          });
        }
        return projects.ok ? projects.value : null;
      };
      // 명단의 다른 컴퓨터가 기계 기록에 실은 목록으로 같은 저장소를 맞춘다. 한 번에 하나만 돌고, 도는 사이 다시 부르면 끝난 뒤
      // 한 번 더 돈다. 명단이 없으면(remote가 꺼졌다) 맞추지 않는다.
      let matching = false;
      let matchAgain = false;
      const matchOnce = async () => {
        const links = ctx.peek.machineLinks;
        const records = ctx.peek.machineRecords;
        if (links === undefined || records === undefined) return;
        const roster = new Set<string>(
          links
            .computers()
            .filter((computer) => !computer.self)
            .map((computer) => computer.machine),
        );
        if (roster.size === 0) return;
        const projects = readProjects();
        if (projects === null) return;
        for (const action of matchActions(
          projects,
          records.projects(),
          roster,
        )) {
          if (stopping) return;
          const done = await ctx.writer.command(PROJECT_IDENTITY_CONTEXT, {
            command: projectIdentityApi.matchIdentity.name,
            input: action,
            idempotency_key: ids.newId("idk"),
            compare: {},
            prepared: [],
          });
          // conflict는 계산한 뒤 project가 바뀐 것이다. 다음 계기가 다시 본다.
          if (!done.ok && done.error.code !== "conflict") {
            logger.warn({
              component: "projects-identity",
              event: "match_failed",
              message: `project ${action.project}: ${done.error.message}`,
            });
          }
        }
      };
      const runMatching = (): Promise<void> => {
        if (matching) {
          matchAgain = true;
          return matchRun;
        }
        matching = true;
        matchRun = loopMatching();
        return matchRun;
      };
      const loopMatching = async () => {
        try {
          do {
            matchAgain = false;
            await matchOnce();
          } while (matchAgain && !stopping);
        } catch (thrown) {
          logger.warn({
            component: "projects-identity",
            event: "match_threw",
            message: thrown instanceof Error ? thrown.message : String(thrown),
          });
        } finally {
          matching = false;
        }
      };
      listChanged = () => {
        ctx.peek.machineRecords?.publish();
        void runMatching();
      };
      ctx.provide("projectMatching", {
        shared: () => sharedProjects(readProjects() ?? []),
        peersChanged: () => void runMatching(),
      });
      // 바뀐 remote를 따라가려고 기동 때 active project를 몇 개씩 다시 읽는다.
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
      const artifacts = artifactHandlers(ctx.root.path);
      const projectFiles = projectFilesMutationHandlers({
        snapshot: <T>(read: (sql: ReadSql, seq: string) => Result<T>) =>
          snapshot(ctx.ledgerPath, read),
      });
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
            if (LIST_CHANGES.has(envelope.command)) listChanged();
            return done;
          },
        }),
        fileStreams: [
          [`${artifactsFile.resource}/${artifactsFile.method}`, artifacts.file],
        ],
        memory: [
          [`${artifactsList.resource}/${artifactsList.method}`, artifacts.list],
          [
            `${projectIdentityApi.identity.resource}/${projectIdentityApi.identity.method}`,
            (_who, body) =>
              identity.status((body as { project: string }).project),
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
          [
            `${projectFilesWrite.resource}/${projectFilesWrite.method}`,
            projectFiles.write,
          ],
          [
            `${projectFilesCreate.resource}/${projectFilesCreate.method}`,
            projectFiles.create,
          ],
          [
            `${projectFilesRename.resource}/${projectFilesRename.method}`,
            projectFiles.rename,
          ],
          [
            `${projectFilesRemove.resource}/${projectFilesRemove.method}`,
            projectFiles.remove,
          ],
        ],
      });
    },
    // 기동을 막지 않는다(afterReady를 기다리면 control의 ready가 늦는다). 종료가 끝을 기다린다.
    afterReady() {
      startup = reconcileActive().then(() => {
        if (!stopping) listChanged();
      });
      return Promise.resolve();
    },
    async closeWork() {
      stopping = true;
      await startup;
      await matchRun;
    },
  };
};
