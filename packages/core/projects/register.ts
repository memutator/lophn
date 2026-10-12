import { err, ok, type Result } from "../../base/mod.ts";
import type { DocumentRef } from "../../protocol/projects/mod.ts";
import {
  DOCUMENT_DISPATCHABLE_COMMANDS,
  documentPrepare,
  filesDelete,
  filesRead,
  filesRename,
  filesWatch,
  filesWrite,
  formatValidate,
  outlineRoot,
  projectPreviewTracking,
  READ_ROUTES,
  UPLOAD_ROUTES,
} from "../../protocol/projects/mod.ts";
import type {
  ApiReadDefinition,
  CommandDefinition,
  CommandRoute,
  FileRoute,
  ReadDefinition,
  UploadRoute,
  WorkerRoute,
} from "../../protocol/server/mod.ts";
import type {
  EventRegistration,
  ReaderRegistration,
} from "../storage/ledger/mod.ts";
import { createDocumentsEventRegistration } from "./file-tracking/coordinator/events.ts";
import type { KindLaunchSpec } from "../../protocol/server/mod.ts";
import { addressingSchemaSteps } from "./addressing/mod.ts";
import {
  createAddressingReads,
  createDocumentChangeCommands,
} from "./addressing/mod.ts";
import {
  createContextsRegistration,
  loadContextsRuntime,
} from "./contexts/register.ts";
import { fileStatusRead, type StatusMemory } from "./file-tracking/status.ts";
import { createFileCommands, createFileReads } from "./file-tracking/mod.ts";
import { runnerWasmPath } from "./formats/guest/contract.ts";
import { BUILTIN_MODULE_HASH } from "./formats/guest/module-hash.ts";
import { formatDeclaration, formatDeclarations } from "./formats/model.ts";
import {
  formatGet,
  formatGetInputSchema,
  formatList,
} from "../../protocol/projects/mod.ts";
import { SERVED_ROUTES } from "./outline-and-search/served.ts";
import { createProjectCommands } from "./registry/commands.ts";
import { createSourceCommands, createVersionCommands } from "./versions/mod.ts";
import { createVersionReads } from "./versions/mod.ts";
import { versionsSchemaSteps } from "./versions/mod.ts";
import { versionFileField, versionFilesField } from "./versions/mod.ts";
import { createSeriesCommands, joinSeriesOnSave } from "./series/mod.ts";
import { seriesSchemaSteps } from "./series/mod.ts";
import { createSeriesReads } from "./series/mod.ts";
import {
  createSeriesOutlineRead,
} from "./outline-and-search/series-outline.ts";
import { createProjectReads, type ProjectReadDeps } from "./registry/reads.ts";
import { projectsSchemaSteps } from "./registry/schema.ts";
import { listDocuments } from "./versions/mod.ts";
import type { ReadSnapshot } from "../../protocol/server/mod.ts";

// context API의 의존. command를 실행하는 writer Worker와 read를 실행하는 reader Worker 안에서만
// 실제 구현이 올라온다(contexts-api.ts). core 본체는 route 등록만 쓴다.
const contextsRuntime = await loadContextsRuntime();

type LedgerRegistration = {
  schemaSteps?: readonly { id: string; sql: string }[];
  commands?: readonly unknown[];
  reads?: readonly unknown[];
  apiReads?: readonly unknown[];
  files?: readonly FileRoute[];
  workers?: readonly KindLaunchSpec[];
  workerRoutes?: readonly WorkerRoute[];
  uploadRoutes?: readonly UploadRoute[];
  blobFields?: readonly unknown[];
};

// 프로젝트 문서 목록. 활성 문서의 최신 버전을 반환한다(보관 제외).
function projectDocuments(
  snapshot: ReadSnapshot,
  project: string,
): Result<readonly DocumentRef[]> {
  // snapshot.sql은 읽기 전용(get, all)이고 listDocuments는 모든 sql 메서드를 요구한다.
  // 목록만 사용하므로 일부 메서드는 구현하지 않는다.
  // deno-lint-ignore no-explicit-any
  const readOnlySql: any = {
    get: snapshot.sql.get.bind(snapshot.sql),
    all: snapshot.sql.all.bind(snapshot.sql),
  };
  const docs = listDocuments(readOnlySql, {
    place: { kind: "project", id: project },
    status: "active",
    limit: 10000,
    offset: 0,
  });
  if (!docs.ok) return docs;
  return ok(
    docs.value.map((doc) => ({
      document: doc.id,
      version: doc.latest_version,
      section: null,
    })),
  );
}

// format read는 ledger snapshot을 쓰지 않는다. core가 reader pool 밖에서 바로 열고,
// dispatcher가 기다리므로 async get도 그대로 연다.
// 게스트 실행 코드(runs the format modules)는 문서 worker·runner의 몫이다(platform.md 6장,
// responsiveness#R1). core가 여는 것은 내장 declaration 읽기뿐이다.
// FileStatus 조회가 묻는 메모리. 근원은 documents coordinator 메모리고, core가 기동 때
// 감독 pipe로 묻는 구현을 environment에 넣는다. 넣지 않은 등록(harness)은 coordinator가
// 없는 것이다: 추적 안 함으로 꾸미지 않고 unavailable이다.
export type DocumentsEnvironment = {
  status?: StatusMemory;
};

const UNATTACHED_STATUS: StatusMemory = {
  lookup: () =>
    err({ code: "unavailable", message: "documents worker가 붙어 있지 않다" }),
};

function formatReads(): ApiReadDefinition[] {
  return [
    {
      route: formatList,
      handle(_ctx, _input) {
        return ok({
          formats: formatDeclarations(),
          as_of_seq: "0",
          next_cursor: null,
        });
      },
    },
    {
      route: formatGet,
      handle(_ctx, input) {
        // 이름으로 내장 declaration을 찾고, module_hash는 같은 declaration만 읽는다.
        // hash로 최신 module을 대체하지 않는다(누락·실행 실패·미지원은 runner 몫).
        const parsed = formatGetInputSchema.safeParse(input);
        if (!parsed.success) {
          return err({
            code: "invalid_input",
            message: "format get input is invalid",
          });
        }
        // 내장 declaration의 hash와 보존된 module의 hash를 찾는다. 없는 hash는
        // not_found다. blob 보존 읽기는 문서 worker의 몫이므로, core가 여는 것은
        // 내장 declaration뿐이다(Q10). 없는 hash는 최신 module로 대체하지 않는다.
        if (parsed.data.module_hash !== BUILTIN_MODULE_HASH) {
          return err({
            code: "not_found",
            message: "format module is missing",
          });
        }
        const declaration = formatDeclaration(parsed.data.name);
        if (declaration.module_hash !== parsed.data.module_hash) {
          return err({
            code: "not_found",
            message: "format module is missing",
          });
        }
        return ok({
          ...declaration,
          as_of_seq: "0",
          next_cursor: null,
        });
      },
    },
  ];
}

// coordinator는 등록한 활성 root와 문서 위치의 필요한 권한만 받는다(architecture/documents 2.2).
// allow_read·write는 root 추가·해제 때 core가 새 목록으로 교체한다. ffi는 없다.
// 등록 때 data root는 core와 같은 근원(LOPHN_HOME ?? ~/.lophn)에서 env로만 결정한다.
// 활성 root가 바뀌면 이 spec을 다시 만들고 platform이 documents worker만 다시 띄운다.
// network는 core loopback뿐이다: 관측 제출이 같은 process의 API에 Bearer credential로
// 닿는다(T11). 코드(repo)와 deno 캐시 읽기는 child가 자기 entry를 올리는 데 필요하다
// (platform/io spec과 같다). 준비 worker는 이 coordinator가 띄우는 자식이라 core가 따로
// 선언하지 않는다(spec은 apps/worker/documents/launch.ts).
export function workerSpecs(
  dataRoot: string,
  activeRoots: readonly string[] = [],
): KindLaunchSpec[] {
  const reads = [dataRoot, ...activeRoots.filter((root) => root !== dataRoot)];
  const code = codeReads();
  const writes = activeRoots.filter((root) => root !== dataRoot);
  return [
    {
      kind: "documents/worker",
      entry: new URL(
        "../../../apps/worker/documents/entry.ts",
        import.meta.url,
      ).pathname,
      allow_read: [...reads, ...code],
      allow_write: [`${dataRoot}/documents`, `${dataRoot}/derived`, ...writes],
      allow_net: ["127.0.0.1"],
      // 고정 실행 파일은 이 deno 하나다. format runner는 호출마다, 준비 worker 두 slot은 첫
      // 요청에서 이 coordinator가 띄운다(architecture/documents 2.1). runner·준비 worker의
      // 읽기·env·network·run 권한은 띄우는 쪽(launch spec)이 좁힌다. process group 종료를
      // 확인하는 kill 도구 하나(platform 감독의 adapter)가 더 필요하다.
      allow_run: [Deno.execPath(), "/usr/bin/kill"],
      allow_sys: [],
      // NODE_V8_COVERAGE는 platform 감독이 자식을 띄울 때(node:child_process) deno가 읽는
      // 이름 하나다. 값을 쓰지도 자식에게 넘기지도 않는다.
      allow_env: [
        "LOPHN_HOME",
        "LOPHN_WORKER_KIND",
        "HOME",
        "PATH",
        "NODE_V8_COVERAGE",
      ],
      policy: "always",
      memory_limit_bytes: 256 * 1024 * 1024,
    },
  ];
}

// child가 코드와 deno 캐시를 올리는 읽기. 사용자 root가 아니다.
function codeReads(): string[] {
  const repo = new URL("../../../", import.meta.url).pathname.replace(
    /\/$/,
    "",
  );
  // 설치 묶음은 DENO_DIR로 ~/.cache/lophn/deno를 준다(install-and-update#R8).
  const home = Deno.env.get("HOME");
  let configured: string | undefined;
  try {
    configured = Deno.env.get("DENO_DIR");
  } catch { /* env 권한이 없는 worker는 spec을 쓰지 않는다 */ }
  const cache = configured ?? (home ? `${home}/.cache/deno` : "/tmp");
  return [repo, cache];
}

// format runner는 호출마다 시작하고 한 결과를 낸 뒤 종료한다(architecture/documents 2.1).
// 읽기는 runner entry와 내장 QuickJS wasm 파일뿐이다. env·network·ffi·run·쓰기는 없다.
// 호출 입력과 module 바이트를 IPC로 받으므로 나머지 권한은 주지 않는다.
function formatRunnerSpec(): KindLaunchSpec | undefined {
  const entry = new URL(
    "./formats/runner/main.ts",
    import.meta.url,
  ).pathname;
  let wasm: string | undefined;
  try {
    wasm = runnerWasmPath();
  } catch {
    // quickjs-emscripten cache 위치를 인식하지 못하면 runner도 시작할 수 없다.
    return undefined;
  }
  return {
    kind: "documents/format-runner",
    entry,
    allow_read: [entry, wasm],
    allow_write: [],
    allow_net: [],
    allow_run: [],
    allow_sys: [],
    allow_env: [],
    policy: "on_request",
    memory_limit_bytes: 256 * 1024 * 1024,
  };
}

// root outline read. ledger snapshot과 derived store를 같이 읽는 서빙은 reader Worker의
// 등록(documents-reader.ts)이 한다. 여기 handler는 route를 registry에 올리는 자리이고,
// core는 이 key를 reader pool로 보낸다(실행되지 않는다).
function outlineRootRoute(): ReadDefinition<typeof outlineRoot> {
  return {
    route: outlineRoot,
    handle() {
      return err({
        code: "unavailable",
        message: "root outline은 reader Worker가 서빙한다",
      });
    },
  };
}

export type DocumentsRelaunch =
  | { kind: "unchanged" }
  | { kind: "relaunch"; specs: KindLaunchSpec[] }
  | { kind: "unavailable" };

// 활성 root가 바뀌면 documents worker의 spec을 다시 만든다. 재시작 자체는
// platform 감독(updateSpec)이 한다. root 집합이 같으면 띄우지 않는다.
export function documentsWorkerRelaunch(
  dataRoot: string,
  previous: readonly string[],
  next: readonly string[],
): DocumentsRelaunch {
  const before = [...previous].sort();
  const after = [...next].sort();
  if (
    before.length === after.length &&
    before.every((root, index) => root === after[index])
  ) {
    return { kind: "unchanged" };
  }
  return { kind: "relaunch", specs: workerSpecs(dataRoot, next) };
}

// 감독의 재시작 입구. platform#T7의 updateSpec이 이 자리다.
export type DocumentsSupervisor = {
  updateSpec(spec: KindLaunchSpec): Promise<{ ok: boolean }>;
};

// root가 바뀌었을 때만 documents worker를 새 권한으로 다시 띄운다.
// coordinator는 시작 때 전체 root를 다시 scan한다.
export async function connectDocumentsRelaunch(
  supervisor: DocumentsSupervisor,
  dataRoot: string,
  previous: readonly string[],
  next: readonly string[],
): Promise<DocumentsRelaunch> {
  const decision = documentsWorkerRelaunch(dataRoot, previous, next);
  if (decision.kind !== "relaunch") return decision;
  for (const spec of decision.specs) {
    if (spec.kind !== "documents/worker") continue;
    const restarted = await supervisor.updateSpec(spec);
    if (!restarted.ok) return { kind: "unavailable" };
  }
  return decision;
}

// contract가 dispatchable로 선언한 command만 dispatchable로 표시한다. handler는 그대로다.
function dispatchableByContract<R extends CommandRoute>(
  definition: CommandDefinition<R>,
): CommandDefinition<R> {
  const declared = [...DOCUMENT_DISPATCHABLE_COMMANDS].some((item) =>
    item.route === (definition.route as CommandRoute)
  );
  return declared ? { ...definition, dispatchable: true } : definition;
}

export function createLedgerRegistration(
  environment?: DocumentsEnvironment,
): LedgerRegistration {
  // owner target은 ledger가 주입한 TargetAuthorization port가 판정한다.
  const commands = createProjectCommands();
  const versions = createVersionCommands({ joinSeries: joinSeriesOnSave });
  const sourceCommands = createSourceCommands();
  const fileCommands = createFileCommands();
  const fileReads = createFileReads();
  const addressing = createDocumentChangeCommands();
  const contexts = createContextsRegistration(contextsRuntime);
  const series = createSeriesCommands();
  const versionReads = createVersionReads();
  const addressReads = createAddressingReads();
  const seriesReads = createSeriesReads();
  const seriesOutline = createSeriesOutlineRead();
  const deps: ProjectReadDeps = {
    documents: projectDocuments,
  };
  const reads = createProjectReads(deps);
  return {
    schemaSteps: [
      ...addressingSchemaSteps,
      ...projectsSchemaSteps,
      ...versionsSchemaSteps,
      ...contexts.schemaSteps,
      ...seriesSchemaSteps,
    ],
    commands: [
      commands.create,
      commands.update,
      commands.setTracking,
      commands.archive,
      commands.unarchive,
      versions.save,
      dispatchableByContract(versions.restore),
      versions.update,
      dispatchableByContract(versions.archive),
      versions.unarchive,
      sourceCommands.setSource,
      fileCommands.recordResult,
      // 사람이 허락한 approval 적용(apply_approved_action)이 같은 transaction에서 부를 수 있다.
      // 어느 command가 그런지는 contract가 정한다(DOCUMENT_DISPATCHABLE_COMMANDS).
      dispatchableByContract(addressing.move),
      dispatchableByContract(addressing.rename),
      ...contexts.commands,
      series.create,
      series.update,
      series.setDraft,
      series.clearDraft,
      series.addInstance,
      series.updateInstance,
      series.removeInstance,
      series.archive,
      series.unarchive,
    ],
    reads: [
      reads.list,
      reads.get,
      reads.resolve,
      reads.resolveCwd,
      reads.trackingRoots,
      versionReads.list,
      versionReads.get,
      versionReads.history,
      addressReads.resolve,
      ...contexts.reads,
      seriesReads.list,
      seriesReads.get,
      seriesReads.next,
      seriesOutline,
      fileReads.list,
      outlineRootRoute(),
    ],
    // 판 원문과 정규화 목록 blob. 일반 읽기는 원문 파일만 연다. context 내용 blob은 context 읽기가 연다.
    blobFields: [versionFileField, versionFilesField, ...contexts.blobFields],
    // format read는 snapshot 없이 바로 연다. 경로는 같은 조립에서 registry로 모은다.
    apiReads: [
      ...formatReads(),
      fileStatusRead(environment?.status ?? UNATTACHED_STATUS),
    ],
    // worker route. 준비(documentPrepare)는 core의 준비 조립이, 나머지(outline·읽기·
    // search·view open·export)는 reader Worker 등록(documents-reader.ts)이 서빙한다.
    // core는 요청마다 현재 credential로 그 읽기를 실행한다(documents-serving.ts).
    // 사람 파일 작업과 폴더 미리보기도 worker route다(core는 파일을 열지 않는다).
    workerRoutes: [
      documentPrepare,
      formatValidate,
      filesWrite,
      filesRename,
      filesDelete,
      filesWatch,
      projectPreviewTracking,
      ...SERVED_ROUTES,
    ],
    // 제출 파일 바이트 route. 준비 중계로 흘려 보내는 handler는 core.ts가 붙인다.
    uploadRoutes: UPLOAD_ROUTES,
    // 단계적 읽기(T14). 선택 판 본문 통로는 stored bytes다(redaction은 host 책임).
    files: [
      ...[...READ_ROUTES].filter((route) => route.kind === "file"),
      filesRead,
    ],
    // 문서 worker 뼈대(T2). 등록 시점 env에서 data root를 결정해 절대 경로로 좁힌다.
    // core가 root를 좁히는 T11 교체는 core 쪽 감독 seam이 넣는다.
    workers: registerWorkers(),
  };
}

// 등록 시점에 env로 data root를 좁힌다. core의 resolveDataRoot와 같은 근원이다.
function registerWorkers(): KindLaunchSpec[] {
  const lophnHome = Deno.env.get("LOPHN_HOME");
  const home = Deno.env.get("HOME");
  const root = lophnHome && lophnHome.length > 0
    ? lophnHome
    : home
    ? `${home}/.lophn`
    : undefined;
  if (root === undefined || !root.startsWith("/")) return [];
  const runner = formatRunnerSpec();
  return runner ? [...workerSpecs(root), runner] : workerSpecs(root);
}

// event 정의와 공개 정책. reader Worker가 모든 팀 module의 것을 모아 events/list의 registry를
// 만든다(platform/ledger#R15, documents plan Q17).
export function createEventRegistration(): EventRegistration {
  return createDocumentsEventRegistration();
}

// reader Worker가 HTTP read를 연다. command 등록과 같은 read 목록이다.
// project read도 같은 목록이다. documents 목록 seam은 command 등록과 같은
// emptyDocuments다(shell main의 `read projects list`가 이 Worker를 만난다).
export function createReaderRegistration(): ReaderRegistration {
  const reads = createVersionReads();
  const addressReads = createAddressingReads();
  const contexts = createContextsRegistration(contextsRuntime);
  const seriesReads = createSeriesReads();
  const seriesOutline = createSeriesOutlineRead();
  const fileReads = createFileReads();
  const deps: ProjectReadDeps = {
    documents: projectDocuments,
  };
  const projectReads = createProjectReads(deps);
  return {
    reads: [
      reads.list,
      reads.get,
      reads.history,
      addressReads.resolve,
      ...contexts.reads,
      seriesReads.list,
      seriesReads.get,
      seriesReads.next,
      seriesOutline,
      projectReads.list,
      projectReads.get,
      projectReads.resolve,
      projectReads.resolveCwd,
      projectReads.trackingRoots,
      fileReads.list,
    ],
    ports: new Map(),
  };
}

// public harness는 이 이름을 부른다. 제품 등록과 같은 함수다.
export function createLedgerTestRegistration(
  environment?: DocumentsEnvironment,
): LedgerRegistration {
  return createLedgerRegistration(environment);
}
