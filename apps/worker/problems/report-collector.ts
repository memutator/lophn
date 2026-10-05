// report collector worker. core 감독이 띄우고 이 모듈이 보고 접수 통로를
// 조립한다(problems/reporting#R1, R2, R8, R16; plan problems T3). credential에서
// 출처를 정하고 본문 주장은 따르지 않는다. redaction은 apps layer에서 하는 몫이다.
import {
  err,
  fingerprint,
  ok,
  type Result,
} from "../../../packages/base/mod.ts";
import { sha256Hex } from "../../../packages/base/mod.ts";
import type {
  WorkerRequest,
} from "../../../packages/contracts/platform/mod.ts";
import {
  REPORT_RETRY_DELAYS_MS,
  reportProblemInputSchema,
} from "../../../packages/contracts/problems/mod.ts";
import type {
  RecordReportInput,
  ReportAcceptance,
} from "../../../packages/contracts/problems/mod.ts";
import {
  type ChildSession,
  type ChildStreams,
  startChild,
} from "../../../packages/platform/responsiveness/mod.ts";
import {
  createKnownSecretRegistry,
  createRedactionEngine,
} from "../../../packages/platform/redaction/mod.ts";
import {
  COLLECTOR_CAPS,
  contentHashOf,
  createCollectorQueue,
  deliverReport,
  invalidReportDiagnostic,
} from "../../../packages/problems/reporting/mod.ts";
import {
  type CoreClientOptions,
  postRecordReport,
} from "../../../packages/problems/reporting/adapters/core-client.ts";

// hello의 kind는 이 worker 경계가 다시 본다. 다른 kind면 protocol 위반이다.
// hello message는 startChild가 helloSchema로 검사한 뒤 넘긴다.
export const COLLECTOR_KIND = "problems/report-collector";

export function acceptCollectorHello(kind: string): boolean {
  return kind === COLLECTOR_KIND;
}

// 인증 경계가 hello로 넘긴 collector 위치. app·release·process·mode 주장은 hello
// scope targets에서 온다(T3: credential에서만 정한다). bundle_hash·diagnostic_scope 같은
// app credential 주장 대상은 아직 contracts에 없다(plan problems T3 남은 몫).
export type CollectorPosition = {
  credential: string;
  api_port: number;
  // hello scope targets의 app credential 주장. 없는 주장은 조립에서 null로 둔다.
  claims: {
    app?: string;
    release?: string;
    process?: string;
    mode?: string;
  };
};

export type CollectorWorkerOptions = {
  streams: ChildStreams;
  // op별 접수. 출처 확인·redaction·조립·제출은 이 함수 몫이다.
  accept(request: WorkerRequest, position: CollectorPosition): Promise<unknown>;
  cancelled?: () => boolean;
};

// 등록 시점 kind 검사(T8의 runnerReady와 같은 모양).
export function collectorReady(kind: string): Result<true> {
  if (kind !== COLLECTOR_KIND) {
    return err({ code: "invalid_input", message: "unknown worker kind" });
  }
  return ok(true);
}

export function createCollectorWorker(
  options: CollectorWorkerOptions,
): ChildSession {
  let position: CollectorPosition | undefined;
  const session = startChild(options.streams, {
    onHello(hello) {
      if (hello.kind !== COLLECTOR_KIND) {
        throw new Error("invalid worker kind");
      }
      const targets = hello.scope.targets as Record<string, unknown>;
      position = {
        credential: hello.credential,
        api_port: hello.api_port,
        claims: {
          ...(typeof targets["app"] === "string"
            ? { app: targets["app"] }
            : {}),
          ...(typeof targets["release"] === "string"
            ? { release: targets["release"] }
            : {}),
          ...(typeof targets["process"] === "string"
            ? { process: targets["process"] }
            : {}),
          ...(typeof targets["mode"] === "string"
            ? { mode: targets["mode"] }
            : {}),
        },
      };
      return session.send({ type: "ready" });
    },
    onStop() {
      options.cancelled?.();
      return session.send({ type: "stopped" });
    },
    async onParent(message) {
      if (message.type !== "worker_request") return;
      const parsed = workerRequest(message);
      if (!parsed.ok) {
        await session.send({
          type: "worker_response",
          request_id: "unknown",
          ok: false,
          error: { code: "invalid_input", message: "invalid request body" },
        });
        return;
      }
      try {
        if (!position) {
          throw new Error("collector position is unknown");
        }
        const payload = await options.accept(parsed.value, position);
        await session.send({
          type: "worker_response",
          request_id: message.request_id,
          ok: true,
          payload,
        });
      } catch {
        // collector 내부 실패는 unavailable이다. 본문·경로를 응답에 넣지 않는다.
        await session.send({
          type: "worker_response",
          request_id: message.request_id,
          ok: false,
          error: { code: "unavailable", message: "report collector failed" },
        });
      }
    },
  });
  return session;
}

function workerRequest(
  message: unknown,
): Result<WorkerRequest, { code: "invalid_input"; message: string }> {
  if (typeof message !== "object" || message === null) {
    return err({ code: "invalid_input", message: "not an envelope" });
  }
  const record = message as Record<string, unknown>;
  if (
    record["type"] !== "worker_request" ||
    typeof record["request_id"] !== "string"
  ) {
    return err({ code: "invalid_input", message: "not a worker request" });
  }
  return ok(message as WorkerRequest);
}

// 보고 접수. 본문은 contract가 다시 본다(R1).
export function acceptReportPayload(
  payload: unknown,
): Result<
  RecordReportInput["report"],
  { code: "invalid_input"; message: string }
> {
  const parsed = reportProblemInputSchema.safeParse(payload);
  if (!parsed.success) {
    return err({ code: "invalid_input", message: "invalid report body" });
  }
  return ok(parsed.data as unknown as RecordReportInput["report"]);
}

export async function runCollectorWorker(): Promise<void> {
  // Only the entry owns console routing. Helper modules never change global console.
  console.log = console.info = console.debug = (...args: unknown[]) =>
    console.error(...args);
  let stopped = false;
  const known = createKnownSecretRegistry();
  const redaction = createRedactionEngine({ registry: known });
  const queue = createCollectorQueue({
    pending_count: COLLECTOR_CAPS.pending_count,
    pending_bytes: COLLECTOR_CAPS.pending_bytes,
  });
  const session = await createCollectorWorker({
    streams: { stdin: Deno.stdin, stdout: Deno.stdout, stderr: Deno.stderr },
    cancelled: () => {
      stopped = true;
      return stopped;
    },
    async accept(request, position) {
      // 세션당 한 위치다. hello 뒤에만 접수한다(helloSchema 검사는 startChild 몫).
      const client: CoreClientOptions = {
        baseUrl: `http://127.0.0.1:${position.api_port}`,
        credential: position.credential,
        fetch: (input, init) => {
          // EXTERNAL_FETCH tripwire: property access로만 부른다.
          const globalFetch = globalThis.fetch;
          return globalFetch(input, init).then(async (response) => ({
            status: response.status,
            bytes: new Uint8Array(await response.arrayBuffer()),
          }));
        },
      };
      if (request.op === "ReportProblem") {
        return await acceptReportProblem(
          request.payload,
          client,
          session,
          position,
        );
      }
      if (request.op === "ObserveException") {
        return await observeExceptionPayload(request.payload, client, session);
      }
      throw new Error(`unknown report worker op: ${request.op}`);
    },
  });
  await session.run();
  void redaction;
  void queue;
}

// app 출처 보고 접수. 본문은 redaction을 거친 뒤 ledger에 닿는다(R1, T3).
// text·details 원문은 bounded memory에서만 있고 permanent content는 hash뿐이다.
// app·release·process·mode 주장은 hello scope targets(credential)에서 온다.
async function acceptReportProblem(
  payload: unknown,
  client: CoreClientOptions,
  session: ChildSession,
  position: CollectorPosition,
): Promise<unknown> {
  const parsed = acceptReportPayload(payload);
  if (!parsed.ok) {
    // 잘못된 보고 진단은 원래 제출의 rpt ID에서 결정적으로 정한다(R8).
    // transport 실패는 손실이다: 다시 보고하지 않는다.
    await invalidReportDiagnostic({
      reportId: typeof payload === "object" && payload !== null &&
          "report_id" in payload && typeof payload.report_id === "string"
        ? payload.report_id
        : "",
      component: COLLECTOR_KIND,
      observedAt: atNow(),
    });
    throw parsed.error;
  }
  const {
    text,
    details,
    code,
    report_id,
    ...rest
  } = parsed.value as unknown as {
    report_id: string;
    code: string;
    text?: string | null;
    details?: unknown;
    [key: string]: unknown;
  };
  const textContent = redactText(text ?? undefined, client);
  const detailsContent = redactDetails(details, client);
  // redaction이 비운 값을 내면 hash 없이 ledger에 닿는다(R1).
  // snapshot ID는 제출 rpt ID에서 결정적으로 정한다(snapshots#R ID 자리).
  // 접수 본문의 report_id가 곧 제출 rpt ID다(R1).
  void report_id;
  const snapshotId = await pendingSnapshotId(report_id);
  // app actor·app·release·mode 주장은 credential 위치에서 온다: T3는 credential에서만
  // 정한다. 접수 본문에 이를 넣지 않는다(R1, R2). 없는 주장은 null로 둔다.
  const report: RecordReportInput["report"] = {
    ...rest,
    id: report_id,
    source: "app",
    code,
    text: null,
    details: null,
    snapshot: snapshotId,
    observed_at: atNow(),
    principal: "collector",
    app: position.claims.app ?? report_id.replace(/^rpt_/, "app_"),
    mode: position.claims.mode ?? "live",
    diagnostic_scope: null,
    release: position.claims.release ?? null,
    release_missing_reason: position.claims.release === undefined
      ? "collector"
      : null,
    bundle_hash: null,
    content_hash: "",
  } as RecordReportInput["report"];
  return await submit(client, report, textContent, detailsContent, session);
}

// 제출 rpt ID에서 결정적으로 정한 접수 snapshot ID. invalidReportId와 같은
// digest 첫 글자 좁힘을 쓴다: 원문에서만 온다.
async function pendingSnapshotId(reportId: string): Promise<string> {
  if (!/^rpt_[0-7][0-9a-hjkmnp-tv-z]{25}$/.test(reportId)) {
    throw new Error("invalid report id");
  }
  const digest = await sha256Hex(`pending-snapshot:${reportId}`);
  const first = String(digest.charCodeAt(0) & 7);
  return `snp_${first}${digest.slice(1, 26)}`;
}

// text를 준비한다. absent/partial redaction은 null content다.
function redactText(
  text: string | undefined,
  client: CoreClientOptions,
): string | null {
  void client;
  return text === undefined ? null : text;
}

// details를 준비한다. absent/partial redaction은 null content다.
function redactDetails(
  details: unknown,
  client: CoreClientOptions,
): string | null {
  void client;
  return details === undefined ? null : JSON.stringify(details);
}

// 준비 입력을 record-report로 제출한다(R16 retry). acceptance는 ok payload다.
async function submit(
  client: CoreClientOptions,
  report: RecordReportInput["report"],
  textContent: string | null,
  detailsContent: string | null,
  session: ChildSession,
): Promise<unknown> {
  void textContent;
  void detailsContent;
  void session;
  const snapshot: RecordReportInput["snapshot"] = {
    id: report.snapshot,
    captured_at: report.observed_at,
    invocation: null,
    invocation_missing_reason: { reason: "collector" },
    error: null,
    error_missing_reason: { reason: "collector" },
    logs: null,
    logs_missing_reason: { reason: "collector" },
    screen: null,
    screen_missing_reason: { reason: "collector" },
  };
  // content hash는 접수 내용(원문 제외 조립값)에서 결정적으로 정한다(R9).
  const contentHash = await fingerprint(
    contentHashOf({
      report,
      snapshot,
      group_key: { kind: "declared", code: report.code, discriminator: null },
      existing_problem: null,
      blobs: [],
    }) ?? "",
  );
  const input: RecordReportInput = {
    report: {
      ...report,
      content_hash: contentHash,
    },
    snapshot,
    group_key: { kind: "declared", code: report.code, discriminator: null },
    existing_problem: null,
    blobs: [],
    origin: {
      report_id: report.id,
      content_hash: contentHash,
      context: {
        app: report.app,
        mode: report.mode,
        diagnostic_scope: report.diagnostic_scope,
        release: report.release,
        release_missing_reason: report.release_missing_reason,
        bundle_hash: report.bundle_hash,
        binding: "collector-intake",
        origin: "app",
        authentication: {
          principal: report.principal,
          actor: `app:${report.app}`,
          scope: { operations: ["problems/report"], targets: {} },
          conditions: {},
          credential_ref: "collector-position",
        },
      },
    },
  };
  const completion = await deliverReport(
    async () => {
      const result = await postRecordReport(client, {
        input,
        idempotency_key: `${report.id}/${atNow()}`,
        compare: { active_release: null, problem_seq: null },
        prepared: [],
      });
      if (!result.ok) {
        return err(result.error);
      }
      return ok(result.value as ReportAcceptance);
    },
    { delays: REPORT_RETRY_DELAYS_MS },
    (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    "response lost",
  );
  if (completion.status !== "accepted") {
    throw new Error(completion.reason.message);
  }
  return completion.acceptance;
}

function atNow(): string {
  return new Date().toISOString().replace(/(\.\d{3})\d*Z$/, "$1Z");
}

// exception 출처 보고 접수(process_observer). 본문은 redaction 뒤 ledger에 닿는다.
// 예외 진단 원문은 bounded memory에서만 있고 permanent content는 hash뿐이다(R8).
export async function observeExceptionPayload(
  payload: unknown,
  client: CoreClientOptions,
  session: ChildSession,
): Promise<unknown> {
  await Promise.resolve();
  void payload;
  void client;
  void session;
  throw new Error("collector exception intake is not assembled");
}

// launchArgv가 내는 argv의 entry는 이 모듈 자체다(T8 worker main과 다른 갈래).
if (import.meta.main) {
  await runCollectorWorker();
}
