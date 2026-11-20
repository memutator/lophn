import { PROJECT_ADD_ROUTES } from "../../protocol/projects/add-api.ts";
import {
  ARTIFACT_FILE_ROUTES,
  ARTIFACT_MEMORY_ROUTES,
  PROJECT_FILES_MUTATION_ROUTES,
  PROJECT_IDENTITY_MEMORY_ROUTES,
} from "../../protocol/projects/mod.ts";
import type {
  ReaderRegistration,
  TxPortRegistration,
} from "../storage/ledger/mod.ts";
import { createProjectCommands } from "./registry/commands.ts";
import { createFolderResolver } from "./registry/folder-resolver.ts";
import { folderResolverPort } from "./registry/ports.ts";
import { createProjectReads } from "./registry/reads.ts";
import { projectsSchemaSteps } from "./registry/schema.ts";
import { projectFilesListRead, projectFilesReadRead } from "./files/mod.ts";
import { projectSearchRead } from "./search/mod.ts";

type LedgerRegistration = {
  schemaSteps?: readonly { id: string; sql: string }[];
  commands?: readonly unknown[];
  reads?: readonly unknown[];
  ports?: readonly TxPortRegistration[];
  apiReads?: readonly unknown[];
  memoryRoutes?: readonly unknown[];
  files?: readonly unknown[];
};

// project.search가 ledger를 짧게 읽는 통로. 없으면 검색은 unavailable이다.
type ProjectSearchEnvironment = {
  snapshot: Parameters<typeof projectSearchRead>[0]["snapshot"];
};

const UNATTACHED_SEARCH: ProjectSearchEnvironment = {
  snapshot: () => ({
    ok: false,
    error: { code: "unavailable", message: "project search is not attached" },
  }),
};

export function createLedgerRegistration(
  environment: { projectSearch?: ProjectSearchEnvironment } = {},
): LedgerRegistration {
  // owner target은 ledger가 주입한 TargetAuthorization port가 판정한다.
  const commands = createProjectCommands();
  const folders = createFolderResolver();
  const reads = createProjectReads({ folders });
  return {
    schemaSteps: projectsSchemaSteps,
    commands: [
      commands.register,
      commands.edit,
      commands.relinkFolder,
      commands.archive,
      commands.unarchive,
      commands.setIcon,
      commands.recordIdentity,
      commands.linkIdentity,
    ],
    reads: [reads.list, reads.get, reads.resolve, reads.icon],
    apiReads: [
      projectFilesListRead(environment.projectSearch ?? UNATTACHED_SEARCH),
      projectFilesReadRead(environment.projectSearch ?? UNATTACHED_SEARCH),
      projectSearchRead({
        ...(environment.projectSearch ?? UNATTACHED_SEARCH),
        exists: (path) => folders.exists(path),
      }),
    ],
    // 폴더의 id file을 읽고 쓰는 route, project 더하기·폴더 목록, 등록 폴더 안 file 쓰기·만들기·옮기기·지우기. handler는 wiring/projects.ts가 단다.
    memoryRoutes: [
      ...PROJECT_IDENTITY_MEMORY_ROUTES,
      ...PROJECT_ADD_ROUTES,
      ...ARTIFACT_MEMORY_ROUTES,
      ...PROJECT_FILES_MUTATION_ROUTES,
    ],
    // 다른 컴퓨터가 읽는 artifact byte. handler는 wiring/projects.ts가 단다.
    files: ARTIFACT_FILE_ROUTES,
    // 폴더 존재 확인.
    ports: [{ key: folderResolverPort, create: () => folders }],
  };
}

// reader Worker가 HTTP read를 연다. command 등록과 같은 read 목록이다.
export function createReaderRegistration(): ReaderRegistration {
  const projectReads = createProjectReads({ folders: createFolderResolver() });
  return {
    reads: [
      projectReads.list,
      projectReads.get,
      projectReads.resolve,
      projectReads.icon,
    ],
    ports: new Map(),
  };
}
