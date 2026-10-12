// /v1/apps/export의 worker route 서빙(apps/data#R13, architecture/apps 5.4). 단독 data
// worker가 준보하는 앱 export다. 준비 본체는 worker/export.ts가 하고, 이 모듈은 거기에
// 필요한 것을 core 조립에서 주입받아 모은다: ledger 읽기(snapshot), 요청 자격 재검사
// (current), 앱 접근 판정(TargetAuthorization port), 데이터 root.
//
// packages/core/apps는 core의 platform 쪽 module을 직접 부르지 않는다(code-map). 그래서 core
// 연결과 앱 접근 판정은 deps로 들어온다(apps-control의 injection과 같다). 앱 DB 열기는
// data worker(worker/export.ts의 openAppDatabase)만 한다(정책 "writer").
//
// secret 원값·credential·앱 외부 자료는 export에 모이지 않는다. 앱 외부 자료(첨부·
// files 영역) 포함 여부는 contract의 includes_external_data로 명시한다(R13): 앱 export는
// 앱 폴더 안의 것만 모으므로 늘 false다.
import {
  err,
  ERROR_CODES,
  type ErrorCode,
  ok,
  type Result,
} from "../../../base/mod.ts";
import { appExport } from "../../../protocol/apps/mod.ts";
import type { BundleManifest, Release } from "../../../protocol/apps/mod.ts";
import type {
  HealthObservation,
  ReadSnapshot,
  RequestContext,
} from "../../../protocol/server/mod.ts";
import type {
  WorkerRequest,
  WorkerResponse,
} from "../../../protocol/supervision/mod.ts";
import { canonicalJson } from "../blueprint/mod.ts";
import { appAccessDenied, authorizeApp, loadApp } from "../registration/mod.ts";
import {
  loadActiveBlueprint,
  loadReleases,
  readBundleCopy,
} from "../releases/mod.ts";
import type { WorkerRouteTarget } from "./target.ts";
import type { z } from "zod";

// 형태는 worker route의 계약이 정한다. Input·Output은 command·read route의 것이므로
// worker route의 입출력은 그 자리에서 z.output으로 푼다.
type ExportInput = z.output<typeof appExport.input>;
type ExportOutput = z.output<typeof appExport.output>;

export type ExportSnapshot = ReadSnapshot & { close?(): void };

// 준비 한 번에 넘기는 입력. blueprint 원문과 release 이력은 ledger에서 읽은 것이고,
// 준비 본체(worker/export.ts)는 앱 DB를 여는 data worker 쪽에서 돈다. 이 모듈은 core
// graph에 있어 그 본체를 import하지 않으므로(node:sqlite는 ledger만) 입력 모양만 둔다.
export type ExportJob = {
  app: string;
  blueprintJson?: string;
  releases: readonly Release[];
  bundles: readonly { bundle_hash: string; manifest: BundleManifest }[];
  sdkRoot: string;
};

export type ExportDeps = {
  // 요청 자격의 현재 context. 폐기·만료·없는 자격은 err다(core 조립이 runtime.current를 쥔다).
  current(credentialRef: string): Result<RequestContext>;
  // ledger 읽기 snapshot. worker는 읽기만 하고 쓰지 않는다. 요청마다 열고 ledger를 읽고
  // 난 바로 close한다(느린 파일 작업 동안 열어 두지 않는다). 요청 자격으로 앱 접근 port를 만든다.
  snapshot(ctx: RequestContext): Result<ExportSnapshot>;
  // 데이터 root(`<dataRoot>/apps/<app>/{data,bundles}`, `<dataRoot>/sdk`).
  dataRoot: string;
  // export 준비. 앱 DB를 여는 일이라 data worker(별도 프로세스)가 하고, 실패는 message로 돌려준다.
  prepare(job: ExportJob): Promise<Result<unknown>>;
  // 지금 시각. observation에 남긴다.
  observedAt(): string;
};

// 대상이 없는 것과 범위 밖은 같은 답이다(forbidden으로 존재를 새지 않는다).
const NOT_FOUND = "app not found";

function credentialRefOf(requestId: string): string | undefined {
  const slash = requestId.lastIndexOf("/");
  return slash > 0 ? requestId.slice(0, slash) : undefined;
}

function errorCode(code: string): ErrorCode {
  return (ERROR_CODES as readonly string[]).includes(code)
    ? code as ErrorCode
    : "internal";
}

function rejected(
  request: WorkerRequest,
  code: ErrorCode,
  message: string,
): Result<WorkerResponse> {
  return ok({
    type: "worker_response",
    request_id: request.request_id,
    ok: false,
    error: { code, message },
  });
}

function answered(
  request: WorkerRequest,
  payload: ExportOutput,
): Result<WorkerResponse> {
  return ok({
    type: "worker_response",
    request_id: request.request_id,
    ok: true,
    payload,
  });
}

// active release의 고정 blueprint 원문(canonical JSON)이다. release에 고정한
// blueprint_hash의 정규 byte와 같다(준비 worker가 같은 규칙으로 고정했다).
function blueprintCanonicalText(stored: { blueprint: unknown }): string {
  return canonicalJson(stored.blueprint as never);
}

// ledger에서 앱 접근 판정과 export에 쓸 release 이력·고정 blueprint를 읽는다.
function readLedger(
  input: ExportInput,
  ctx: RequestContext,
  snapshot: ReadSnapshot,
): Result<{
  history: readonly Release[];
  active: { blueprint: unknown } | null;
}> {
  const found = loadApp(snapshot.sql, input.app);
  if (!found.ok) return err(found.error);
  if (found.value === null) {
    return err({ code: "not_found", message: NOT_FOUND });
  }
  const access = authorizeApp(
    snapshot.port,
    ctx,
    appExport.name,
    { kind: "app", app: found.value },
  );
  if (!access.ok) {
    // 범위 밖 앱은 없는 앱과 같은 답이다(same-owner 거절, registration/model).
    if (appAccessDenied(access)) {
      return err({ code: "not_found", message: NOT_FOUND });
    }
    return access;
  }
  const history = loadReleases(snapshot.sql, { app: input.app });
  if (!history.ok) return err(history.error);
  const active = loadActiveBlueprint(snapshot.sql, input.app);
  if (!active.ok) return err(active.error);
  return ok({ history: history.value, active: active.value });
}

// export 준비. 실패는 worker 오류 envelope가 아니라 contract의 state: "failed"다
// (준비 중·완성·실패는 route output으로 구별한다).
async function prepareExport(
  input: ExportInput,
  ctx: RequestContext,
  deps: ExportDeps,
): Promise<Result<ExportOutput>> {
  const snapshot = deps.snapshot(ctx);
  if (!snapshot.ok) return err(snapshot.error);
  // ledger 읽기는 동기다. 끝나면 snapshot을 닫고 파일 작업으로 간다.
  let source: Result<
    { history: readonly Release[]; active: { blueprint: unknown } | null }
  >;
  try {
    source = readLedger(input, ctx, snapshot.value);
  } finally {
    snapshot.value.close?.();
  }
  if (!source.ok) return err(source.error);
  const app = input.app;
  const { history, active } = source.value;
  const manifestOf = async (
    release: Release,
  ): Promise<Result<{ bundle_hash: string; manifest: BundleManifest }>> => {
    const copy = await readBundleCopy(deps.dataRoot, app, release.bundle_hash);
    if (!copy.ok) return copy;
    if (copy.value === undefined) {
      return err({
        code: "not_found",
        message: "bundle copy is not sealed",
      });
    }
    return ok({
      bundle_hash: release.bundle_hash,
      manifest: copy.value.manifest,
    });
  };
  const bundles: { bundle_hash: string; manifest: BundleManifest }[] = [];
  for (const release of history) {
    const manifest = await manifestOf(release);
    if (!manifest.ok) return err(manifest.error);
    bundles.push(manifest.value);
  }
  const prepared = await deps.prepare({
    app,
    ...(active === null
      ? {}
      : { blueprintJson: blueprintCanonicalText(active) }),
    releases: history,
    bundles,
    sdkRoot: `${deps.dataRoot}/sdk`,
  });
  if (!prepared.ok) {
    return ok({
      app,
      state: "failed",
      reason: { code: "export_failed", summary: prepared.error.message },
      includes_external_data: false,
    });
  }
  return ok({ app, state: "ready", includes_external_data: false });
}

export function createExportTarget(deps: ExportDeps): WorkerRouteTarget {
  return {
    handle: {
      observation(): HealthObservation {
        return {
          component: `apps/export (${deps.dataRoot})`,
          available: true,
          observed_at: deps.observedAt(),
        };
      },
      async forward(
        request: WorkerRequest,
      ): Promise<Result<WorkerResponse>> {
        const parsed = appExport.input.safeParse(request.payload);
        if (!parsed.success) {
          return rejected(
            request,
            "invalid_input",
            "export 입력이 계약과 다르다",
          );
        }
        const ref = credentialRefOf(request.request_id);
        if (ref === undefined) {
          return rejected(request, "unauthorized", "credential이 없다");
        }
        const ctx = deps.current(ref);
        if (!ctx.ok) {
          return rejected(request, "unauthorized", "credential이 없다");
        }
        const result = await prepareExport(parsed.data, ctx.value, deps);
        if (!result.ok) {
          return rejected(
            request,
            errorCode(result.error.code),
            result.error.message,
          );
        }
        return answered(request, result.value);
      },
    },
  };
}
