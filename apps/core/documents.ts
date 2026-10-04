import { ok, type Result } from "../../packages/base/mod.ts";
import type { DocumentRef } from "../../packages/contracts/documents/mod.ts";
import type { KindLaunchSpec } from "../../packages/contracts/platform/mod.ts";
import { addressingSchemaSteps } from "../../packages/documents/addressing/mod.ts";
import { createProjectCommands } from "../../packages/documents/projects/commands.ts";
import {
  createProjectReads,
  type ProjectReadDeps,
} from "../../packages/documents/projects/reads.ts";
import { projectsSchemaSteps } from "../../packages/documents/projects/schema.ts";

type LedgerRegistration = {
  schemaSteps?: readonly { id: string; sql: string }[];
  commands?: readonly unknown[];
  reads?: readonly unknown[];
  workers?: readonly KindLaunchSpec[];
};

// 문서 목록은 versions concern의 read다. seam이 없어 빈 목록만 준다.
function emptyDocuments(): Result<readonly DocumentRef[]> {
  return ok([]);
}

// coordinator는 등록한 활성 root와 문서 위치의 필요한 권한만 받는다(architecture/documents 2.2).
// allow_read·write는 root 추가·해제 때 core가 새 목록으로 교체한다. network·env·ffi는 없다.
// 등록 때 data root는 core와 같은 근원(LOPHN_HOME ?? ~/.lophn)에서 env로만 결정한다.
export function workerSpecs(dataRoot: string): KindLaunchSpec[] {
  return [
    {
      kind: "documents/worker",
      entry: new URL(
        "../../worker/documents/coordinator.ts",
        import.meta.url,
      ).pathname,
      allow_read: [dataRoot],
      allow_write: [`${dataRoot}/documents`, `${dataRoot}/derived`],
      allow_net: [],
      allow_run: [],
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
      allow_read: [dataRoot],
      allow_write: [`${dataRoot}/documents/staging`],
      allow_net: [],
      allow_run: [],
      allow_env: ["LOPHN_HOME", "LOPHN_WORKER_KIND"],
      policy: "always",
      memory_limit_bytes: 256 * 1024 * 1024,
    },
  ];
}

export function createLedgerRegistration(
  _environment?: unknown,
): LedgerRegistration {
  // owner target은 ledger가 주입한 TargetAuthorization port가 판정한다.
  const commands = createProjectCommands();
  const deps: ProjectReadDeps = {
    documents: emptyDocuments,
  };
  const reads = createProjectReads(deps);
  return {
    schemaSteps: [...addressingSchemaSteps, ...projectsSchemaSteps],
    commands: [
      commands.create,
      commands.update,
      commands.setTracking,
      commands.archive,
      commands.unarchive,
    ],
    reads: [
      reads.list,
      reads.get,
      reads.resolve,
      reads.resolveCwd,
      reads.trackingRoots,
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
  return workerSpecs(root);
}

// public harness는 이 이름을 부른다. 제품 등록과 같은 함수다.
export function createLedgerTestRegistration(
  environment?: unknown,
): LedgerRegistration {
  return createLedgerRegistration(environment);
}
