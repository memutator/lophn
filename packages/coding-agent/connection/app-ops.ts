// 앱 개발 op의 공통 실행이다(T21, mcp#R19·R20·R21·R29·R32·R33, cli#R24–R28·R31·R32).
// MCP `lophn_app`과 CLI `app …`이 이 한 흐름을 지나므로 같은 credential·입력의 결과와 거절이
// 같다(connection#R6, cli#R1). op마다 소유 route로만 보내고 임의 core API는 부르지 않는다.
// 오래 걸리는 일(test·preview 시작·release 준비)은 접수와 다음 read로 나눠 돌려주고, 기다릴 때는
// 알림을 보낸다: 기다림은 OpenCode 기본 tool timeout 30초 안에서 끝난다(조사 T1).
import { err, type LophnError, ok, type Result } from "../../base/mod.ts";
import {
  appBlueprint,
  appConnect,
  appConnectSource,
  appCreate,
  appGet,
  appIdSchema,
  appList,
  appLogs,
  appRuntime,
  invocationsGet,
  invocationsList,
  previewsGet,
  previewsStart,
  previewsStop,
  releasePreparation,
  releasePrepareBundle,
} from "../../protocol/apps/mod.ts";
import {
  getTestRequest,
  getVerification,
  listVerifications,
  requestTest,
  TEST_EXECUTION_LIMITS,
} from "../../protocol/problems/mod.ts";
import { decisionLink } from "../../protocol/coding-agent/mod.ts";
import type { CommandRoute } from "../../protocol/platform/mod.ts";
import type { SyncToolsOutcome } from "../guides/mod.ts";
import {
  APP_ENVIRONMENTS,
  type AppDirect,
  type AppEnvironment,
  type AppInvokeOutcome,
} from "./app-direct.ts";
import { UNREADABLE_MESSAGE } from "./unreadable.ts";
import type { FlowClient } from "./document-save.ts";

// op마다 첫 소유 route다. sync_tools는 재배포가 core route 밖 파일 설치라 contract가 입력을
// 빌린 appRuntime을 가리키고, 실행은 guides의 syncTools가 한다(아래). command의 첫 core 요청은
// 앱 통로를 여는 apps/connect이고 그 뒤는 core를 지나지 않는다(mcp#R29).
export const APP_OP_ROUTES = {
  list: appList,
  show: appGet,
  register: appCreate,
  source: appConnectSource,
  validate: releasePrepareBundle,
  preparation: releasePreparation,
  test: requestTest,
  preview_start: previewsStart,
  preview_stop: previewsStop,
  release_prepare: releasePrepareBundle,
  status: appRuntime,
  blueprint: appBlueprint,
  invocations: invocationsList,
  invocation: invocationsGet,
  logs: appLogs,
  sync_tools: appRuntime,
  command: appConnect,
} as const;

export type AppOp = keyof typeof APP_OP_ROUTES;

export function isAppOp(op: unknown): op is AppOp {
  return typeof op === "string" && Object.hasOwn(APP_OP_ROUTES, op);
}

// CLI command 이름이다. 두 통로의 안내가 같은 동작을 같은 이름으로 가리킨다.
export const APP_OP_CLI_NAMES: Record<AppOp, string> = {
  list: "app list",
  show: "app show",
  register: "app register",
  source: "app source",
  validate: "app validate",
  preparation: "app release prepare",
  test: "app test",
  preview_start: "app preview start",
  preview_stop: "app preview stop",
  release_prepare: "app release prepare",
  status: "app status",
  blueprint: "app blueprint",
  invocations: "app invocations",
  invocation: "app invocation",
  logs: "app logs",
  sync_tools: "app sync-tools",
  command: "app command",
};

// 한 번에 읽는 invocation 수와 log 줄 수의 상한이다(mcp#R32, apps/runtime#R27).
export const INVOCATION_PAGE_MAX = 20;
export const LOG_LINES_MAX = 200;

// app test 기본 timeout이다. 요청이 timeout_ms를 주지 않으면 이 값을 요청에 명시해 runner에
// 넘긴다. runner는 동결 test method의 timeout_ms와 짧은 쪽을 쓴다(mcp#R33).
export const APP_TEST_TIMEOUT_MS = TEST_EXECUTION_LIMITS.timeout_ms;

// 접수 뒤 결과를 기다리는 한도다. OpenCode 기본 tool timeout 30초보다 짧게 끝낸다.
export const DEFAULT_WAIT = { budget_ms: 20_000, interval_ms: 1_000 } as const;

export type AppOpOutput = {
  summary: string;
  data: unknown;
  next: string[];
  // 실패·거절·검사 실패는 true다. 성공 결과는 생략한다(R7).
  isError?: true;
};

export type AppOpDeps = {
  client: FlowClient;
  idempotencyKey: () => string;
  // 앱 통로다. 없으면 command op는 `unavailable`이다.
  direct?: AppDirect;
  // 도구 재배포다(guides#R17). 검사한 입력(op·target·names)을 받아 guides의 syncTools를
  // 돌린다. 파일 설치라 core route 밖이고 host(entry)가 끼운다. 없으면 sync_tools는
  // `unavailable`이다.
  sync?: (input: Obj) => Promise<
    Result<SyncToolsOutcome, LophnError>
  >;
  // 호출 이름 표면이다. 다음 조회 안내의 이름이 달라진다.
  surface?: "mcp" | "cli";
  // 기다리는 동안의 알림이다. 알림 실패는 호출을 막지 않는다.
  progress?: (message: string) => void | Promise<void>;
  wait?: { budget_ms: number; interval_ms: number };
  sleep?: (ms: number) => Promise<void>;
  requestKey?: () => string;
};

type Obj = Record<string, unknown>;

function obj(value: unknown): Obj {
  return typeof value === "object" && value !== null ? value as Obj : {};
}

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function failure(error: LophnError, next: string[]): AppOpOutput {
  return {
    summary: error.message,
    data: { code: error.code, details: error.details ?? {} },
    next,
    isError: true,
  };
}

function absent(next: string[]): AppOpOutput {
  return failure({ code: "not_found", message: UNREADABLE_MESSAGE }, next);
}

function refer(deps: AppOpDeps, op: AppOp, note = ""): string {
  const name = deps.surface === "cli"
    ? `lophn ${APP_OP_CLI_NAMES[op]}`
    : `lophn_app ${op}`;
  return note === "" ? name : `${name} ${note}`;
}

function withoutOp(input: unknown): Obj {
  const { op: _op, ...rest } = obj(input);
  return rest;
}

function hash12(value: unknown): string {
  return typeof value === "string" ? value.slice(0, 12) : "없음";
}

function more(value: Obj): string {
  const cursor = str(value.next_cursor);
  const omitted = Array.isArray(value.omitted)
    ? (value.omitted as { count?: number }[]).reduce(
      (sum, item) => sum + (item.count ?? 0),
      0,
    )
    : 0;
  const parts: string[] = [];
  if (omitted > 0) parts.push(`한도로 ${omitted}개 생략`);
  if (cursor !== undefined && cursor !== "") {
    parts.push("이어 읽을 것이 더 있다(next_cursor)");
  }
  return parts.join(", ");
}

function joined(summary: string, note: string): string {
  return note === "" ? summary : `${summary}. ${note}`;
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

async function notify(deps: AppOpDeps, message: string): Promise<void> {
  try {
    await deps.progress?.(message);
  } catch {
    // 알림 실패는 일을 막지 않는다.
  }
}

// 접수 뒤 한도 안에서만 다시 읽는다. 한도를 넘기면 settled=false로 접수 상태를 돌려준다.
async function settle<T>(
  deps: AppOpDeps,
  label: string,
  read: () => Promise<Result<T, LophnError>>,
  done: (value: T) => boolean,
): Promise<Result<{ value: T; settled: boolean }, LophnError>> {
  const wait = deps.wait ?? DEFAULT_WAIT;
  let waited = 0;
  let current = await read();
  while (current.ok && !done(current.value) && waited < wait.budget_ms) {
    await notify(deps, `${label}: ${Math.round(waited / 1000)}초 기다리는 중`);
    await (deps.sleep ?? defaultSleep)(wait.interval_ms);
    waited += wait.interval_ms;
    current = await read();
  }
  if (!current.ok) return current;
  return ok({ value: current.value, settled: done(current.value) });
}

// 입력은 소유 route 입력만이다. command route는 envelope로 보낸다.
function send(
  deps: AppOpDeps,
  route: CommandRoute,
  input: unknown,
  compare?: unknown,
  key?: string,
) {
  return deps.client.command(route, {
    input,
    idempotency_key: key ?? deps.idempotencyKey(),
    ...(compare === undefined ? {} : { compare }),
  });
}

export async function runAppOp(
  rawInput: unknown,
  deps: AppOpDeps,
): Promise<AppOpOutput> {
  const op = obj(rawInput).op;
  if (!isAppOp(op)) {
    return failure({
      code: "invalid_input",
      message: "app tool 표에 없는 op다",
      details: { op: typeof op === "string" ? op : null },
    }, [refer(deps, "list")]);
  }
  const input = withoutOp(rawInput);
  switch (op) {
    case "list":
      return await listApps(input, deps);
    case "show":
      return await showApp(input, deps);
    case "register":
      return await registerApp(input, deps);
    case "source":
      return await connectSource(input, deps);
    case "validate":
    case "release_prepare":
      return await prepareBundle(op, input, deps);
    case "preparation":
      return await readPreparation(input, deps);
    case "test":
      return await requestAppTest(input, deps);
    case "preview_start":
      return await startPreview(input, deps);
    case "preview_stop":
      return await stopPreview(input, deps);
    case "status":
      return await appStatus(input, deps);
    case "blueprint":
      return await readBlueprint(input, deps);
    case "sync_tools":
      return await syncAppTools(input, deps);
    case "invocations":
      return await listInvocations(input, deps);
    case "invocation":
      return await showInvocation(input, deps);
    case "logs":
      return await readLogs(input, deps);
    case "command":
      return await callCommand(input, deps);
  }
}

// 도구 재배포다(guides#R17, mcp#R19, cli#R29). 사람이 고른 target 하나의 앱 범위에
// MCP 설정·skill·관리 구간 안내·ignore 안내를 다시 맞춘다. 파일 설치라 core route 밖이다:
// 실행은 host가 끼운 sync port가 guides의 syncTools로 하고 이 흐름은 결과를 항목별로
// 풀어 낸다. user target은 syncTools가 거절한다.
async function syncAppTools(input: Obj, deps: AppOpDeps): Promise<AppOpOutput> {
  if (deps.sync === undefined) {
    return failure({
      code: "unavailable",
      message: "도구 재배포가 이 process에 연결되지 않았다",
    }, [refer(deps, "sync_tools")]);
  }
  const synced = await deps.sync(input);
  if (!synced.ok) return failure(synced.error, [refer(deps, "sync_tools")]);
  const outcome = synced.value;
  const files = outcome.files.map((file) => ({
    target: file.target,
    name: file.name,
    outcome: file.outcome,
    reason: file.reason,
  }));
  const changed = files.filter((file) => file.outcome === "changed").length;
  const summary = outcome.status === "failed"
    ? "도구 재배포를 하지 못했다"
    : outcome.status === "partial"
    ? `도구 재배포가 일부만 됐다(${changed}개 파일을 새로 썼다)`
    : `도구 재배포를 마쳤다(${changed}개 파일을 새로 썼다)`;
  return {
    summary,
    data: { status: outcome.status, files, notices: outcome.notices },
    next: outcome.status === "complete"
      ? ["`lophn doctor`로 앱 안내 loading을 확인한다"]
      : ["파일별 결과의 충돌·실패를 사람이 확인한다"],
    ...(outcome.status === "failed" ? { isError: true as const } : {}),
  };
}

async function listApps(input: Obj, deps: AppOpDeps): Promise<AppOpOutput> {
  const read = await deps.client.read(appList, input);
  if (!read.ok) return failure(read.error, [refer(deps, "list")]);
  const value = obj(read.value);
  const apps = Array.isArray(value.apps) ? value.apps : [];
  return {
    summary: joined(`앱 ${apps.length}개`, more(value)),
    data: value,
    next: [refer(deps, "show", "로 앱 하나의 source·release 상태를 읽는다")],
  };
}

// source 미연결·active release 없음은 없는 이유로 구별해 낸다(cli#R24).
function describeApp(app: Obj): string {
  const source = str(app.source_path) === undefined
    ? "source 미연결"
    : "source 연결됨";
  const release = str(app.active_release) === undefined
    ? "active release 없음"
    : `active release ${app.active_release}`;
  return `${app.slug ?? "앱"}: ${source}, ${release}, 운영 실행 ${
    app.run_enabled === true ? "켜짐" : "꺼짐"
  }`;
}

async function showApp(input: Obj, deps: AppOpDeps): Promise<AppOpOutput> {
  const read = await deps.client.read(appGet, input);
  if (!read.ok) return failure(read.error, [refer(deps, "list")]);
  const value = obj(read.value);
  const app = obj(value.app);
  return {
    summary: describeApp(app),
    data: value,
    next: str(app.source_path) === undefined
      ? [refer(deps, "source", "로 구현 시작 source를 연결한다")]
      : [refer(deps, "status", "로 개발·release 현재 상태를 읽는다")],
  };
}

// 가벼운 등록이다: 이름·한 줄 목적만 받고 source·release·기획 판 없이 성공한다. 구현 시작
// source 연결은 따로다(cli#R25). 전체 범위 연결만 등록한다: 판정은 core가 하고 앱 범위
// 연결의 요청은 거절이다(connection#R4).
async function registerApp(
  input: Obj,
  deps: AppOpDeps,
): Promise<AppOpOutput> {
  const sent = await send(deps, appCreate, input, {});
  if (!sent.ok) {
    return failure(sent.error, [
      sent.error.code === "forbidden"
        ? "앱 등록은 전체 범위 연결만 할 수 있다. 사람이 전체 범위 연결을 만든다"
        : refer(deps, "list", "로 같은 slug의 앱이 있는지 읽는다"),
    ]);
  }
  const app = obj(sent.value);
  return {
    summary: `앱 ${app.slug ?? ""} 등록(source·release 없음)`,
    data: app,
    next: [refer(deps, "source", "로 구현 시작 source를 연결한다")],
  };
}

// source 연결은 현재 앱 revision에 CAS한다. tool 입력에는 revision이 없어 먼저 읽는다.
async function connectSource(
  input: Obj,
  deps: AppOpDeps,
): Promise<AppOpOutput> {
  const current = await deps.client.read(appGet, { app: input.app });
  if (!current.ok) return failure(current.error, [refer(deps, "list")]);
  const revision = obj(obj(current.value).app).revision;
  const sent = await send(deps, appConnectSource, input, {
    base_revision: revision,
  });
  if (!sent.ok) {
    return failure(sent.error, [
      refer(deps, "show", "로 현재 source를 읽는다"),
    ]);
  }
  const app = obj(sent.value);
  return {
    summary: `앱 ${app.slug ?? ""}의 source를 연결했다`,
    data: app,
    next: [
      refer(deps, "validate", "로 blueprint를 검사한다"),
      refer(deps, "preview_start", "로 preview를 연다"),
    ],
  };
}

type Preparation = {
  request_key?: string;
  status?: string;
  bundle_hash?: string | null;
  blueprint_hash?: string | null;
  manifest?: { files?: unknown[] } | null;
};

function preparationView(value: Preparation): Obj {
  return {
    request_key: value.request_key,
    status: value.status,
    bundle_hash: value.bundle_hash ?? null,
    blueprint_hash: value.blueprint_hash ?? null,
    files: value.manifest?.files?.length ?? null,
  };
}

// validate는 blueprint 구조 검사다. 실제 Verification(test result)과 구별해 표시한다(mcp#R20).
// release_prepare는 ticket·claim_seq가 필수이고(ticket 없는 작업·문제 직접 준비는 거절), 같은
// 묶음 hash의 app test 통과 근거가 있어야 준비로 이어진다(mcp#R21).
async function prepareBundle(
  op: "validate" | "release_prepare",
  input: Obj,
  deps: AppOpDeps,
): Promise<AppOpOutput> {
  if (op === "release_prepare" && input.ticket_source === undefined) {
    return failure({
      code: "invalid_input",
      message:
        "release 준비는 ticket·claim_seq가 필요하다. ticket 없는 작업과 문제 직접 준비는 거절한다",
      details: { op },
    }, [
      refer(
        deps,
        "release_prepare",
        "에 ticket_source {ticket, claim_seq}를 넣는다",
      ),
    ]);
  }
  const accepted = await send(deps, releasePrepareBundle, input);
  if (!accepted.ok) return failure(accepted.error, [refer(deps, op)]);
  const first = accepted.value as Preparation;
  const request = { app: input.app, request_key: input.request_key };
  const settled = first.status === "preparing"
    ? await settle(
      deps,
      "bundle 준비",
      async () =>
        (await send(deps, releasePreparation, request)) as Result<
          Preparation,
          LophnError
        >,
      (value) => value.status !== "preparing",
    )
    : ok({ value: first, settled: true });
  if (!settled.ok) return failure(settled.error, [refer(deps, "preparation")]);
  const prepared = settled.value.value;
  const view = preparationView({
    ...prepared,
    request_key: input.request_key as string,
  });
  if (!settled.value.settled) {
    return {
      summary: "준비를 접수했다. 아직 끝나지 않았다",
      data: { ...view, accepted: true },
      next: [
        refer(deps, "preparation", "으로 같은 request_key의 진행을 읽는다"),
      ],
    };
  }
  if (prepared.status !== "completed") {
    return {
      summary: prepared.status === "unknown"
        ? "준비 진행을 모른다(작업 메모리 유실). 같은 request_key로 다시 접수한다"
        : `준비가 ${prepared.status === "cancelled" ? "취소됐다" : "실패했다"}`,
      data: view,
      next: [refer(deps, op, "를 새 request_key로 다시 접수한다")],
      isError: true,
    };
  }
  if (op === "validate") {
    return {
      summary: `blueprint 구조 검사를 마쳤다(bundle ${
        hash12(prepared.bundle_hash)
      }). 이 결과는 test result가 아니다`,
      data: { ...view, check: "blueprint_structure", real_test: false },
      next: [
        refer(
          deps,
          "test",
          "로 같은 bundle_hash의 실제 app test를 요청한다",
        ),
      ],
    };
  }
  return await releaseEvidence(view, input, prepared, deps);
}

type Verified = {
  id?: string;
  kind?: string;
  result?: string;
  reason?: string;
  target?: { bundle_hash?: string };
};

// 같은 묶음 hash의 app test만 근거다. 다른 hash의 통과·실패한 테스트는 쓰지 않는다.
async function releaseEvidence(
  view: Obj,
  input: Obj,
  prepared: Preparation,
  deps: AppOpDeps,
): Promise<AppOpOutput> {
  const hash = prepared.bundle_hash ?? "";
  const evidence: Verified[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 5; page += 1) {
    const read = await deps.client.read(listVerifications, {
      app: input.app,
      kind: "app_test",
      ...(cursor === undefined ? {} : { cursor }),
    });
    if (!read.ok) return failure(read.error, [refer(deps, "preparation")]);
    const body = obj(read.value);
    for (const row of (body.verifications as Verified[] | undefined) ?? []) {
      if (row.target?.bundle_hash === hash) evidence.push(row);
    }
    cursor = str(body.next_cursor);
    if (cursor === undefined || cursor === "") break;
  }
  const passed = evidence.find((row) => row.result === "pass");
  const tests = evidence.map((row) => ({
    id: row.id,
    result: row.result,
    reason: row.reason,
  }));
  if (passed === undefined) {
    return {
      summary: evidence.length === 0
        ? "같은 묶음 hash의 app test가 아직 없다. test 없이 release를 준비하지 않는다"
        : `같은 묶음 hash의 app test가 통과하지 않았다(${
          evidence[evidence.length - 1].result
        }). release를 준비하지 않는다`,
      data: { ...view, tests, prepared_release: false },
      next: [
        refer(deps, "test", "로 같은 bundle_hash의 app test를 요청한다"),
      ],
      isError: true,
    };
  }
  return {
    summary: `release 준비를 접수했다(bundle ${
      hash12(hash)
    }, app test ${passed.id} 통과). activation은 사람이 한 번 눌러 고른다`,
    data: { ...view, tests, prepared_release: true, activated: false },
    next: [
      refer(deps, "preparation", "으로 준비 release를 읽는다"),
      "activation은 사람이 shell에서 고른다. 준비는 activation이 아니다",
    ],
  };
}

async function readPreparation(
  input: Obj,
  deps: AppOpDeps,
): Promise<AppOpOutput> {
  const read = await send(deps, releasePreparation, input);
  if (!read.ok) return failure(read.error, [refer(deps, "validate")]);
  const value = read.value as Preparation;
  return {
    summary: `준비 ${value.status ?? "상태 모름"}`,
    data: preparationView({
      ...value,
      request_key: input.request_key as string,
    }),
    next: value.status === "completed"
      ? [refer(deps, "test", "로 같은 bundle_hash의 app test를 요청한다")]
      : [refer(deps, "preparation", "으로 다시 읽는다")],
  };
}

type TestRequestView = {
  request_key?: string;
  accepted?: boolean;
  preparation_failed?: boolean;
  start_attempted_at?: string | null;
  started_at?: string | null;
  start_unknown?: boolean;
  result_ref?: string | null;
  reason?: string;
};

// 실제 app test는 runner에 요청한다. 접수·준비 실패·시작 불명·실행 중·통과·실패·timeout·
// 판정 불가를 구별하고, 결과는 problems의 Verification만 낸다(mcp#R20·R33, cli#R26).
async function requestAppTest(
  input: Obj,
  deps: AppOpDeps,
): Promise<AppOpOutput> {
  // 기본 timeout도 생략하지 않고 요청에 명시한다(mcp#R33).
  const timeoutMs = typeof input.timeout_ms === "number"
    ? input.timeout_ms
    : APP_TEST_TIMEOUT_MS;
  const sent = await send(
    deps,
    requestTest,
    { ...input, timeout_ms: timeoutMs },
    undefined,
    input.request_key as string,
  );
  if (!sent.ok) return failure(sent.error, [refer(deps, "test")]);
  const accepted = obj(sent.value);
  const requestKey = input.request_key as string;
  const timeoutNote = `runner timeout ${timeoutMs}ms`;
  if (accepted.accepted !== true) {
    return {
      summary: "test 요청을 접수하지 못했다",
      data: { request_key: requestKey, accepted: false },
      next: [refer(deps, "test", "를 새 request_key로 다시 요청한다")],
      isError: true,
    };
  }
  const tracked = await settle(
    deps,
    "app test",
    async () => {
      if (accepted.result_ref !== null && accepted.result_ref !== undefined) {
        return ok({
          request: { request_key: requestKey, result_ref: accepted.result_ref },
        } as Obj);
      }
      const read = await deps.client.read(getTestRequest, {
        request_key: requestKey,
      });
      return read.ok ? ok(obj(read.value)) : read;
    },
    (value) => {
      const request = obj(value.request) as TestRequestView;
      return (request.result_ref ?? null) !== null ||
        request.preparation_failed === true || request.start_unknown === true;
    },
  );
  if (!tracked.ok) return failure(tracked.error, [refer(deps, "test")]);
  const request = obj(tracked.value.value.request) as TestRequestView;
  if (request.preparation_failed === true) {
    return {
      summary: `test 준비에 실패해 실행하지 않았다: ${
        request.reason ?? "이유 없음"
      }`,
      data: { request_key: requestKey, state: "preparation_failed", request },
      next: [refer(deps, "test", "를 새 request_key로 다시 요청한다")],
      isError: true,
    };
  }
  if (request.start_unknown === true) {
    return {
      summary: "test 시작 여부를 모른다. 성공이나 실패로 추측하지 않는다",
      data: { request_key: requestKey, state: "start_unknown", request },
      next: [
        refer(deps, "test", "를 같은 request_key로 다시 보내 결과를 읽는다"),
      ],
      isError: true,
    };
  }
  if ((request.result_ref ?? null) === null) {
    return {
      summary: `test를 접수했고 아직 결과가 없다(${timeoutNote})`,
      data: {
        request_key: requestKey,
        state: request.started_at ? "running" : "accepted",
        runner_timeout_ms: timeoutMs,
        request,
      },
      next: [
        refer(deps, "test", "를 같은 request_key로 다시 보내 결과를 읽는다"),
      ],
    };
  }
  const verified = await deps.client.read(getVerification, {
    verification: request.result_ref,
    detail: false,
  });
  if (!verified.ok) return failure(verified.error, [refer(deps, "test")]);
  return describeVerification(
    obj(obj(verified.value).verification) as Verified & Obj,
    timeoutMs,
    deps,
  );
}

function describeVerification(
  verification: Verified & Obj,
  timeoutMs: number,
  deps: AppOpDeps,
): AppOpOutput {
  const result = verification.result;
  const reason = verification.reason ?? "";
  const timedOut = result === "inconclusive" && /timeout/i.test(reason);
  const state = result === "pass"
    ? "pass"
    : result === "fail"
    ? "fail"
    : timedOut
    ? "timeout"
    : "inconclusive";
  const text = {
    pass: "test 통과",
    fail: "test 실패",
    timeout: "test timeout",
    inconclusive: "test 판정 불가",
  }[state];
  return {
    summary: `${text}(${verification.kind}, bundle ${
      hash12(verification.target?.bundle_hash)
    }) ${verification.id}: ${reason}. runner timeout ${timeoutMs}ms`,
    data: {
      state,
      real_test: true,
      verification,
      runner_timeout_ms: timeoutMs,
    },
    next: state === "pass"
      ? [
        refer(
          deps,
          "release_prepare",
          "로 ticket·claim_seq와 함께 release를 준비한다",
        ),
      ]
      : [
        "고친 source로 bundle을 다시 준비한 뒤 새 request_key로 test한다",
        "실패한 test의 stderr excerpt를 test result로 쓰지 않는다",
      ],
    ...(state === "pass" ? {} : { isError: true as const }),
  };
}

type PreviewView = {
  process_nonce?: string;
  ready?: boolean;
};

type PreviewObservation = {
  ready?: boolean;
  release?: string | null;
  accepting?: boolean;
  reason?: { code?: string; summary?: string };
  process_nonce?: string;
  bundle_hash?: string;
};

// preview는 fixture 격리 세션이다. 운영 active release와 운영 data를 건드리지 않고 accepting이
// 항상 false인 개발 통로다(mcp#R20).
async function startPreview(
  input: Obj,
  deps: AppOpDeps,
): Promise<AppOpOutput> {
  const started = await deps.client.read(previewsStart, input);
  if (!started.ok) return failure(started.error, [refer(deps, "status")]);
  const start = started.value as PreviewView;
  const body = obj(input.input);
  const app = body.app;
  const tracked = await settle(
    deps,
    "preview 시작",
    async () => {
      const read = await deps.client.read(previewsGet, {
        app,
        process_nonce: start.process_nonce,
      });
      return read.ok ? ok(obj(read.value)) : read;
    },
    (value) => {
      const observation = obj(value.observation) as PreviewObservation;
      return observation.ready === true || observation.reason !== undefined;
    },
  );
  if (!tracked.ok) return failure(tracked.error, [refer(deps, "status")]);
  const observation = obj(
    tracked.value.value.observation,
  ) as PreviewObservation;
  const common = {
    process_nonce: start.process_nonce,
    fixture_hash: body.fixture_hash ?? null,
    isolated: true,
    live_release_untouched: true,
  };
  if (observation.reason !== undefined) {
    return {
      summary: `preview를 시작하지 못했다: ${observation.reason.summary}`,
      data: { ...common, state: "failed", reason: observation.reason },
      next: [refer(deps, "logs", "로 앱 log를 읽는다")],
      isError: true,
    };
  }
  if (observation.ready !== true) {
    return {
      summary: "preview 시작을 접수했다. 아직 준비 중이다",
      data: { ...common, state: "starting" },
      next: [refer(deps, "status", "로 preview 상태를 읽는다")],
    };
  }
  return {
    summary:
      "preview가 준비됐다(fixture 격리 사본, 운영 active release·data는 그대로)",
    data: { ...common, state: "ready", observation },
    next: [
      refer(deps, "command", "로 environment=preview의 read command를 부른다"),
      refer(deps, "preview_stop", "으로 끝나면 중지한다"),
    ],
  };
}

async function stopPreview(
  input: Obj,
  deps: AppOpDeps,
): Promise<AppOpOutput> {
  const stopped = await deps.client.read(previewsStop, input);
  if (!stopped.ok) return failure(stopped.error, [refer(deps, "status")]);
  const after = await deps.client.read(previewsGet, {
    app: input.app,
    process_nonce: input.process_nonce,
  });
  const remains = after.ok
    ? obj(obj(after.value).observation).ready !== undefined
    : null;
  return {
    summary: "preview를 중지했다. 운영 앱은 멈추지 않았다",
    data: { ...obj(stopped.value), still_observed: remains },
    next: [refer(deps, "status", "로 운영 상태가 그대로인지 읽는다")],
  };
}

// 개발 상태다: 운영 active release와 현재 preview를 따로 낸다(cli#R24).
// active release에 고정된 blueprint다. 설명·구조 검증·실제 test 통과는 다른 근거로 표시한다
// (apps/blueprint#R3). 범위 밖·없는 앱·active release 없는 앱은 같은 not_found라 합쳐 낸다.
async function readBlueprint(
  input: Obj,
  deps: AppOpDeps,
): Promise<AppOpOutput> {
  const read = await deps.client.read(appBlueprint, { app: input.app });
  if (!read.ok) return failure(read.error, [refer(deps, "list")]);
  const value = obj(read.value);
  const commands = Array.isArray(value.commands) ? value.commands : [];
  const evidence = obj(value.evidence);
  const test = obj(evidence.test);
  const description = obj(evidence.description);
  return {
    summary: `release ${
      hash12(value.release)
    }의 blueprint: command ${commands.length}개, 설명 ${
      description.complete === true ? "완성" : "빈자리 있음"
    }, 실제 test ${test.passed === true ? "통과" : "근거 없음"}`,
    data: value,
    next: [
      refer(deps, "command", "로 선언된 command를 호출한다"),
      refer(deps, "invocations", "로 최근 호출 이력을 읽는다"),
    ],
  };
}

async function appStatus(input: Obj, deps: AppOpDeps): Promise<AppOpOutput> {
  const app = await deps.client.read(appGet, { app: input.app });
  if (!app.ok) return failure(app.error, [refer(deps, "list")]);
  const runtime = await deps.client.read(appRuntime, { app: input.app });
  const preview = await deps.client.read(previewsGet, { app: input.app });
  const record = obj(obj(app.value).app);
  const state = runtime.ok ? obj(obj(runtime.value).state).state : null;
  const observation = preview.ok
    ? obj(preview.value).observation ?? null
    : null;
  return {
    summary: `${describeApp(record)}. 운영 상태 ${
      state ?? "알 수 없음"
    }, preview ${observation === null ? "없음" : "있음"}`,
    data: {
      app: record,
      runtime: runtime.ok ? runtime.value : { error: runtime.error.code },
      preview: preview.ok ? preview.value : { error: preview.error.code },
    },
    next: [
      refer(deps, "invocations", "로 최근 호출 이력을 읽는다"),
      refer(deps, "logs", "로 redaction된 log를 읽는다"),
    ],
  };
}

type Invocation = {
  id?: string;
  app?: string;
  release?: string;
  operation?: { kind?: string; command?: string };
  mode?: string;
  approval?: string | null;
  input_hash?: string | null;
  status?: string;
};

const INVOCATION_TEXT: Record<string, string> = {
  accepted: "접수했다. 사람의 확인을 기다린다",
  running: "실행 중이다",
  succeeded: "성공했다",
  failed: "실패했다",
  denied: "거절됐다",
  unknown: "효과를 모른다. 성공이나 실패로 추측하지 않는다",
};

async function listInvocations(
  input: Obj,
  deps: AppOpDeps,
): Promise<AppOpOutput> {
  const limit = Math.min(
    typeof input.limit === "number" ? input.limit : INVOCATION_PAGE_MAX,
    INVOCATION_PAGE_MAX,
  );
  const read = await deps.client.read(invocationsList, { ...input, limit });
  if (!read.ok) return failure(read.error, [refer(deps, "status")]);
  const value = obj(read.value);
  const rows = Array.isArray(value.invocations)
    ? (value.invocations as Invocation[]).slice(0, INVOCATION_PAGE_MAX)
    : [];
  return {
    summary: joined(`invocation ${rows.length}개`, more(value)),
    data: { ...value, invocations: rows },
    next: [
      refer(deps, "invocation", "으로 하나의 결과와 실제 상태를 읽는다"),
      ...(more(value) === "" ? [] : ["next_cursor로 이어 읽는다"]),
    ],
  };
}

// invocation은 같은 환경(기본 preview)의 것만 읽는다. 다른 환경의 기록은 없는 것과 같은 답이고
// 대상 환경을 바꾸어 다시 조회하지 않는다(mcp#R29).
async function showInvocation(
  input: Obj,
  deps: AppOpDeps,
): Promise<AppOpOutput> {
  const environment = environmentOf(input.environment);
  const read = await deps.client.read(invocationsGet, {
    invocation: input.invocation,
  });
  if (!read.ok) return failure(read.error, [refer(deps, "invocations")]);
  const found = obj(read.value).invocation as Invocation | null | undefined;
  if (
    found === null || found === undefined || found.mode !== environment ||
    (typeof input.app === "string" && found.app !== input.app)
  ) {
    return absent([refer(deps, "invocations", "로 읽을 수 있는 이력을 본다")]);
  }
  const waiting = found.status === "accepted" && found.approval
    ? {
      approval: found.approval,
      release: found.release,
      command: found.operation?.command ?? null,
      input_hash: found.input_hash ?? null,
      decision_link: decisionLink(found.approval),
    }
    : null;
  return {
    summary: `invocation ${found.id}(${found.mode}): ${
      INVOCATION_TEXT[found.status ?? ""] ?? found.status
    }`,
    data: { invocation: found, environment, waiting_decision: waiting },
    next: waiting
      ? [`사람이 ${waiting.decision_link}에서 결정한다`]
      : [refer(deps, "logs", "로 이 invocation의 log를 읽는다")],
  };
}

function environmentOf(value: unknown): AppEnvironment {
  return (APP_ENVIRONMENTS as readonly unknown[]).includes(value)
    ? value as AppEnvironment
    : "preview";
}

async function readLogs(input: Obj, deps: AppOpDeps): Promise<AppOpOutput> {
  const requested = typeof input.limit === "number"
    ? Math.min(input.limit, LOG_LINES_MAX)
    : undefined;
  const read = await deps.client.read(appLogs, {
    ...input,
    ...(requested === undefined ? {} : { limit: requested }),
  });
  if (!read.ok) return failure(read.error, [refer(deps, "status")]);
  const value = obj(read.value);
  const lines = Array.isArray(value.lines) ? value.lines : [];
  const state = str(value.state) ?? "none";
  const text: Record<string, string> = {
    none: "log source가 없다",
    off: "log 수집이 꺼져 있다",
    timeout: "log 수집이 예산을 넘겼다",
    ok: `log ${lines.length}줄(redaction 뒤)`,
  };
  return {
    summary: joined(
      text[state] ?? state,
      value.truncated === true
        ? str(value.next_cursor) === undefined
          ? "잘렸다. limit·max_bytes나 invocation으로 좁혀 읽는다"
          : "더 오래된 줄이 남았다(next_cursor)"
        : "",
    ),
    data: value,
    next: [
      ...(str(value.next_cursor) === undefined ? [] : [
        refer(deps, "logs", "에 cursor=next_cursor를 넣어 이어 읽는다"),
      ]),
      refer(deps, "invocations", "로 호출 이력을 함께 읽는다"),
    ],
  };
}

// 앱 통로로 read 효과·confirm 없는 command를 부른다. 환경은 preview가 기본이고 preview가 없으면
// 운영 앱으로 대신 부르지 않는다. coding credential의 판정은 host가 하고 여기서는 결과 불명과
// 실제 실패를 구별해 낸다(mcp#R29, cli#R31, R32).
async function callCommand(
  input: Obj,
  deps: AppOpDeps,
): Promise<AppOpOutput> {
  const environment = environmentOf(input.environment);
  const timeout = input.timeout_ms;
  if (
    timeout !== undefined &&
    !(typeof timeout === "number" && Number.isInteger(timeout) && timeout > 0)
  ) {
    return failure({
      code: "invalid_input",
      message: "timeout_ms는 양의 정수여야 한다",
    }, []);
  }
  if (deps.direct === undefined) {
    return failure({
      code: "unavailable",
      message: "앱 통로가 이 process에 연결되지 않았다",
    }, ["lophn doctor로 연결을 확인한다"]);
  }
  let nonce: string | undefined;
  if (environment === "preview") {
    const preview = await deps.client.read(previewsGet, { app: input.app });
    if (!preview.ok) return failure(preview.error, [refer(deps, "status")]);
    const observation = obj(
      obj(preview.value).observation,
    ) as PreviewObservation;
    if (observation.ready !== true || observation.process_nonce === undefined) {
      return failure({
        code: "unavailable",
        message:
          "열린 preview가 없다. 운영 앱으로 대신 부르지 않는다. preview를 먼저 시작한다",
      }, [refer(deps, "preview_start")]);
    }
    nonce = observation.process_nonce;
  }
  const requestKey = (deps.requestKey ?? (() => crypto.randomUUID()))();
  const call = deps.direct.invoke({
    app: input.app as string,
    environment,
    command: input.command as string,
    ...(input.input === undefined ? {} : { input: input.input }),
    request_key: requestKey,
    ...(nonce === undefined ? {} : { preview_nonce: nonce }),
  });
  const outcome = timeout === undefined
    ? await call
    : await withDeadline(call, timeout as number, requestKey);
  if (!outcome.ok) {
    return failure(outcome.error, [refer(deps, "status")]);
  }
  return describeInvoke(outcome.value, environment, input, deps);
}

// 기한 안에 응답이 없으면 결과 불명이다. 요청은 이미 나갔을 수 있어 실패로 쓰지 않는다.
async function withDeadline(
  call: Promise<Result<AppInvokeOutcome, LophnError>>,
  ms: number,
  requestKey: string,
): Promise<Result<AppInvokeOutcome, LophnError>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<Result<AppInvokeOutcome, LophnError>>(
    (resolve) => {
      timer = setTimeout(
        () => resolve(ok({ kind: "unknown", request_key: requestKey })),
        ms,
      );
    },
  );
  try {
    return await Promise.race([call, expired]);
  } finally {
    clearTimeout(timer);
  }
}

function describeInvoke(
  outcome: AppInvokeOutcome,
  environment: AppEnvironment,
  input: Obj,
  deps: AppOpDeps,
): AppOpOutput {
  if (outcome.kind === "unknown") {
    return {
      summary:
        "결과를 모른다. 앱이 처리했는지 알 수 없어 성공이나 실패로 쓰지 않고 자동으로 다시 부르지 않는다",
      data: {
        diagnosis: "result_unknown",
        request_key: outcome.request_key,
        app: input.app,
        command: input.command,
        environment,
      },
      next: [
        refer(deps, "invocations", "로 이 호출의 invocation을 읽어 확인한다"),
      ],
      isError: true,
    };
  }
  const output = outcome.output;
  // 요청한 환경과 다른 환경의 응답은 쓰지 않는다. 환경을 바꾸어 다시 조회하지도 않는다.
  if (output.mode !== environment) {
    return failure({
      code: "conflict",
      message: "요청한 환경과 다른 환경의 응답이다",
      details: { requested: environment, answered: output.mode },
    }, [refer(deps, "status")]);
  }
  const source = output.result.source;
  const note = source === undefined
    ? ""
    : source.coverage === "complete" && source.freshness === "fresh"
    ? ""
    : `읽기 원천 상태: ${source.coverage}·${source.freshness}. 빈 결과가 정상 0행이라는 뜻이 아닐 수 있다`;
  return {
    summary: joined(
      `command ${input.command} 결과(${environment})${
        output.invocation === undefined
          ? ""
          : ` invocation ${output.invocation}`
      }`,
      note,
    ),
    data: {
      environment,
      result: output.result.result,
      source: source ?? null,
      invocation: output.invocation ?? null,
    },
    next: output.invocation === undefined
      ? []
      : [refer(deps, "invocation", "으로 기록된 결과를 읽는다")],
  };
}

// 사람만 하는 앱 결정이다. CLI에서는 coding credential이 거절되고 결정 화면 링크와 사실만
// 나온다: confirmation window를 열지 않고 yes·옵션으로 승인하지 않는다(cli#R7, R27, R31).
export const APP_HUMAN_ONLY = [
  "app start",
  "app stop",
  "app release activate",
  "app automation run",
] as const;
export type AppHumanOnly = (typeof APP_HUMAN_ONLY)[number];

const HUMAN_ONLY_TEXT: Record<AppHumanOnly, string> = {
  "app start": "운영 앱 시작",
  "app stop": "운영 앱 중지",
  "app release activate": "release activation",
  "app automation run": "automation 수동 수행",
};

export function humanOnlyReport(
  name: AppHumanOnly,
  input: { app?: string },
): Result<AppOpOutput, LophnError> {
  const app = appIdSchema.safeParse(input.app);
  if (!app.success) {
    return err({
      code: "invalid_input",
      message: "대상 앱 ID가 필요하다(--app 또는 LOPHN_APP)",
    });
  }
  const link = decisionLink(app.data);
  return ok({
    summary: `${
      HUMAN_ONLY_TEXT[name]
    }은 사람만 한다. coding credential로는 거절한다`,
    data: {
      code: "forbidden",
      human_only: true,
      app: app.data,
      decision_link: link,
      window_opened: false,
      requested: false,
    },
    next: [
      `사람이 ${link}에서 exact 대상·입력을 보고 결정한다. 이 요청은 아무것도 시작하지 않았다`,
    ],
    isError: true,
  });
}

export type { AppDirect, AppEnvironment };
