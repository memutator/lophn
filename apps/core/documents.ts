import { err, ok, type Result } from "../../packages/base/mod.ts";
import type { DocumentRef } from "../../packages/contracts/documents/mod.ts";
import {
  formatGet,
  formatGetInputSchema,
  formatList,
} from "../../packages/contracts/documents/mod.ts";
import type { ApiReadDefinition } from "../../packages/contracts/platform/mod.ts";
import type { ReaderRegistration } from "../../packages/platform/ledger/mod.ts";
import type { KindLaunchSpec } from "../../packages/contracts/platform/mod.ts";
import { addressingSchemaSteps } from "../../packages/documents/addressing/mod.ts";
import {
  createAddressingReads,
  createDocumentChangeCommands,
} from "../../packages/documents/addressing/mod.ts";
import { contextsSchemaSteps } from "../../packages/documents/contexts/mod.ts";
import {
  createContextCommands,
} from "../../packages/documents/contexts/mod.ts";
import { createContextReads } from "../../packages/documents/contexts/mod.ts";
import { runnerWasmPath } from "../../packages/documents/formats/guest/contract.ts";
import { BUILTIN_MODULE_HASH } from "../../packages/documents/formats/guest/module-hash.ts";
import {
  formatDeclaration,
  formatDeclarations,
} from "../../packages/documents/formats/model.ts";
import { createProjectCommands } from "../../packages/documents/projects/commands.ts";
import { createVersionCommands } from "../../packages/documents/versions/mod.ts";
import { createVersionReads } from "../../packages/documents/versions/mod.ts";
import { versionsSchemaSteps } from "../../packages/documents/versions/mod.ts";
import {
  versionFileField,
  versionFilesField,
} from "../../packages/documents/versions/mod.ts";
import { createSeriesCommands } from "../../packages/documents/series/mod.ts";
import { seriesSchemaSteps } from "../../packages/documents/series/mod.ts";
import {
  createProjectReads,
  type ProjectReadDeps,
} from "../../packages/documents/projects/reads.ts";
import { projectsSchemaSteps } from "../../packages/documents/projects/schema.ts";

type LedgerRegistration = {
  schemaSteps?: readonly { id: string; sql: string }[];
  commands?: readonly unknown[];
  reads?: readonly unknown[];
  apiReads?: readonly unknown[];
  workers?: readonly KindLaunchSpec[];
  blobFields?: readonly unknown[];
};

// 문서 목록은 versions concern의 read다. seam이 없어 빈 목록만 준다.
function emptyDocuments(): Result<readonly DocumentRef[]> {
  return ok([]);
}

// format read는 ledger snapshot을 쓰지 않는다. core가 reader pool 밖에서 바로 열고,
// dispatcher가 기다리므로 async get도 그대로 연다.
// 게스트 실행 코드(runs the format modules)는 문서 worker·runner의 몫이다(platform.md 6장,
// responsiveness#R1). core가 여는 것은 내장 declaration 읽기뿐이다.
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
// allow_read·write는 root 추가·해제 때 core가 새 목록으로 교체한다. network·env·ffi는 없다.
// 등록 때 data root는 core와 같은 근원(LOPHN_HOME ?? ~/.lophn)에서 env로만 결정한다.
// 활성 root가 바뀌면 이 spec을 다시 만들고 platform이 documents worker만 다시 띄운다.
export function workerSpecs(
  dataRoot: string,
  activeRoots: readonly string[] = [],
): KindLaunchSpec[] {
  const reads = [dataRoot, ...activeRoots.filter((root) => root !== dataRoot)];
  const writes = activeRoots.filter((root) => root !== dataRoot);
  return [
    {
      kind: "documents/worker",
      entry: new URL(
        "../../worker/documents/coordinator.ts",
        import.meta.url,
      ).pathname,
      allow_read: reads,
      allow_write: [`${dataRoot}/documents`, `${dataRoot}/derived`, ...writes],
      allow_net: [],
      allow_run: [],
      allow_sys: [],
      allow_env: ["LOPHN_HOME", "LOPHN_WORKER_KIND"],
      policy: "always",
      memory_limit_bytes: 256 * 1024 * 1024,
    },
    {
      kind: "documents/preparation",
      entry: new URL(
        "../../worker/documents/preparation.ts",
        import.meta.url,
      ).pathname,
      allow_read: reads,
      allow_write: [`${dataRoot}/documents/staging`, ...writes],
      allow_net: [],
      allow_run: [],
      allow_sys: [],
      allow_env: ["LOPHN_HOME", "LOPHN_WORKER_KIND"],
      policy: "always",
      memory_limit_bytes: 256 * 1024 * 1024,
    },
  ];
}

// format runner는 호출마다 시작하고 한 결과를 낸 뒤 종료한다(architecture/documents 2.1).
// 읽기는 runner entry와 내장 QuickJS wasm 파일뿐이다. env·network·ffi·run·쓰기는 없다.
// 호출 입력과 module 바이트를 IPC로 받으므로 나머지 권한은 주지 않는다.
function formatRunnerSpec(): KindLaunchSpec | undefined {
  const entry = new URL(
    "../../packages/documents/formats/runner/main.ts",
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

export function createLedgerRegistration(
  _environment?: unknown,
): LedgerRegistration {
  // owner target은 ledger가 주입한 TargetAuthorization port가 판정한다.
  const commands = createProjectCommands();
  const versions = createVersionCommands();
  const addressing = createDocumentChangeCommands();
  // 앱 command 효과 검사는 apps blueprint read가 들어올 때 교체한다(documents T22).
  const contexts = createContextCommands();
  const series = createSeriesCommands();
  const versionReads = createVersionReads();
  const addressReads = createAddressingReads();
  const contextReads = createContextReads();
  const deps: ProjectReadDeps = {
    documents: emptyDocuments,
  };
  const reads = createProjectReads(deps);
  return {
    schemaSteps: [
      ...addressingSchemaSteps,
      ...projectsSchemaSteps,
      ...versionsSchemaSteps,
      ...contextsSchemaSteps,
      ...seriesSchemaSteps,
    ],
    commands: [
      commands.create,
      commands.update,
      commands.setTracking,
      commands.archive,
      commands.unarchive,
      versions.save,
      versions.update,
      versions.archive,
      versions.unarchive,
      addressing.move,
      addressing.rename,
      contexts.create,
      contexts.update,
      contexts.setItem,
      contexts.removeItem,
      contexts.archive,
      contexts.unarchive,
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
      contextReads.list,
      contextReads.get,
      contextReads.related,
    ],
    // 판 원문과 정규화 목록 blob. 일반 읽기는 원문 파일만 연다.
    blobFields: [versionFileField, versionFilesField],
    // format read는 snapshot 없이 바로 연다. 경로는 같은 조립에서 registry로 모은다.
    apiReads: formatReads(),
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

// reader Worker가 HTTP read를 연다. command 등록과 같은 read 목록이다.
export function createReaderRegistration(): ReaderRegistration {
  const reads = createVersionReads();
  const addressReads = createAddressingReads();
  const contextReads = createContextReads();
  return {
    reads: [
      reads.list,
      reads.get,
      reads.history,
      addressReads.resolve,
      contextReads.list,
      contextReads.get,
      contextReads.related,
    ],
    ports: new Map(),
  };
}

// public harness는 이 이름을 부른다. 제품 등록과 같은 함수다.
export function createLedgerTestRegistration(
  environment?: unknown,
): LedgerRegistration {
  return createLedgerRegistration(environment);
}
