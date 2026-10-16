import type { TxPortRegistration } from "../storage/ledger/mod.ts";
import {
  createContextsRegistration,
  loadContextsRuntime,
} from "./contexts/register.ts";
import { createProjectCommands } from "./registry/commands.ts";
import { createFolderResolver } from "./registry/folder-resolver.ts";
import { folderResolverPort } from "./registry/ports.ts";
import { createProjectReads } from "./registry/reads.ts";
import { projectsSchemaSteps } from "./registry/schema.ts";
import { projectSearchRead } from "./search/mod.ts";

// context API의 의존. command를 실행하는 writer Worker와 read를 실행하는 reader Worker 안에서만
// 실제 구현이 올라온다(contexts-api.ts). core 본체는 route 등록만 쓴다.
const contextsRuntime = await loadContextsRuntime();

type LedgerRegistration = {
  schemaSteps?: readonly { id: string; sql: string }[];
  commands?: readonly unknown[];
  reads?: readonly unknown[];
  blobFields?: readonly unknown[];
  ports?: readonly TxPortRegistration[];
  apiReads?: readonly unknown[];
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
  const contexts = createContextsRegistration(contextsRuntime);
  const folders = createFolderResolver();
  const reads = createProjectReads({ folders });
  return {
    schemaSteps: [...projectsSchemaSteps, ...contexts.schemaSteps],
    commands: [
      commands.register,
      commands.edit,
      commands.relinkFolder,
      commands.archive,
      commands.unarchive,
      ...contexts.commands,
    ],
    reads: [
      reads.list,
      reads.get,
      reads.resolve,
      reads.resolveCwd,
      ...contexts.reads,
    ],
    apiReads: [projectSearchRead({
      ...(environment.projectSearch ?? UNATTACHED_SEARCH),
      exists: (path) => folders.exists(path),
    })],
    // 하위 폴더 검사와 폴더 존재 확인. Project Manager를 만드는 port는 agent-definition이 채운다.
    ports: [{ key: folderResolverPort, create: () => folders }],
    // context 내용 blob은 context 읽기가 연다.
    blobFields: [...contexts.blobFields],
  };
}

// context worker(machine:context-worker)가 보는 context event. 판 제출·적용·되돌림과 보관이
// index 감시 폴더와 검사 일을 바꾼다. 사람 token은 owner 정책으로 읽는다.

// context event(위반을 새로 찾은 ContextViolationFound 포함)의 공개 정책: 사람(user)과 context worker가
// 읽고, 다른 자격에는 숨긴다.

// event 정의와 공개 정책. reader Worker가 모든 팀 module의 것을 모아 events/list의 registry를
// 만든다.

// reader Worker가 HTTP read를 연다. command 등록과 같은 read 목록이다.
