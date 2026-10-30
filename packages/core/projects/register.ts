import { kindCheck, kindGet, kindList } from "../../protocol/projects/mod.ts";
import type {
  ReaderRegistration,
  TxPortRegistration,
} from "../storage/ledger/mod.ts";
import { createProjectCommands } from "./registry/commands.ts";
import { createFolderResolver } from "./registry/folder-resolver.ts";
import { folderResolverPort } from "./registry/ports.ts";
import { createProjectReads } from "./registry/reads.ts";
import { projectsSchemaSteps } from "./registry/schema.ts";
import { projectSearchRead } from "./search/mod.ts";

type LedgerRegistration = {
  schemaSteps?: readonly { id: string; sql: string }[];
  commands?: readonly unknown[];
  reads?: readonly unknown[];
  ports?: readonly TxPortRegistration[];
  apiReads?: readonly unknown[];
  // ledger를 쓰지 않는 core 메모리 route. handler는 core 조립(wiring/kinds.ts)이 붙인다.
  memoryRoutes?: readonly unknown[];
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
    ],
    reads: [reads.list, reads.get, reads.resolve],
    apiReads: [
      projectSearchRead({
        ...(environment.projectSearch ?? UNATTACHED_SEARCH),
        exists: (path) => folders.exists(path),
      }),
    ],
    // 폴더 존재 확인.
    ports: [{ key: folderResolverPort, create: () => folders }],
    memoryRoutes: [kindGet, kindList, kindCheck],
  };
}

// reader Worker가 HTTP read를 연다. command 등록과 같은 read 목록이다.
export function createReaderRegistration(): ReaderRegistration {
  const projectReads = createProjectReads({ folders: createFolderResolver() });
  return {
    reads: [projectReads.list, projectReads.get, projectReads.resolve],
    ports: new Map(),
  };
}
