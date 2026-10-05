// report collector worker. core 감독이 띄우고 이 모듈이 보고 접수 통로를
// 조립한다(problems/reporting#R1, R2, R8, R16; plan problems T3). credential에서
// 출처를 정하고 본문 주장은 따르지 않는다. redaction은 이 worker가 ledger에 닿기
// 전에 거친다(R1).
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
  ReportProblemIngress,
} from "../../../packages/contracts/problems/mod.ts";
import {
  type ChildSession,
  type ChildStreams,
  startChild,
} from "../../../packages/platform/responsiveness/mod.ts";
import {
  createKnownSecretRegistry,
  createRedactionEngine,
  type RedactionEngine,
} from "../../../packages/platform/redaction/mod.ts";
import {
  COLLECTOR_CAPS,
  contentHashOf,
  createCollectorQueue,
  deliverReport,
  freezeDeep,
  invalidReportDiagnostic,
} from "../../../packages/problems/reporting/mod.ts";
import {
  type CoreClientOptions,
  postRecordReport,
} from "../../../packages/problems/reporting/adapters/core-client.ts";
import { assembleException } from "../../../packages/problems/snapshots/mod.ts";
import {
  exceptionObservationInputSchema,
  REPORTING_LIMITS,
  snapshotInputSchema,
} from "../../../packages/contracts/problems/mod.ts";
import type { ReportBlobInput } from "../../../packages/contracts/problems/mod.ts";

// registerBlobs의 원주체 검사는 report.principal과 source.blob.principal이
// 같은지 본다. 준비는 항상 principal "collector"로 등록된다.
type BlobPurpose = ReportBlobInput["purpose"];

// hello의 kind는 이 worker 경계가 다시 본다. 다른 kind면 protocol 위반이다.
// hello message는 startChild가 helloSchema로 검사한 뒤 넘긴다.
export const COLLECTOR_KIND = "problems/report-collector";

export function acceptCollectorHello(kind: string): boolean {
  return kind === COLLECTOR_KIND;
}

// 인증 경계가 hello로 넘긴 collector 위치. app·release·process·mode·bundle_hash·
// diagnostic_scope 주장은 hello scope targets에서 온다(T3: credential에서만 정한다.
// contracts/platform의 app credential 주장 대상이고 발급 때 credential에 고정된다).
export type CollectorPosition = {
  credential: string;
  api_port: number;
  // hello scope targets의 app credential 주장. 없는 주장은 조립에서 null로 둔다.
  claims: {
    app?: string;
    release?: string;
    process?: string;
    mode?: string;
    bundle_hash?: string;
    diagnostic_scope?: string;
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
          ...(typeof targets["bundle_hash"] === "string"
            ? { bundle_hash: targets["bundle_hash"] }
            : {}),
          ...(typeof targets["diagnostic_scope"] === "string"
            ? { diagnostic_scope: targets["diagnostic_scope"] }
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
): Result<ReportProblemIngress, { code: "invalid_input"; message: string }> {
  const parsed = reportProblemInputSchema.safeParse(payload);
  if (!parsed.success) {
    return err({ code: "invalid_input", message: "invalid report body" });
  }
  return ok(parsed.data as unknown as ReportProblemIngress);
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
          redaction,
          queue,
          session,
          position,
        );
      }
      if (request.op === "ObserveException") {
        return await observeExceptionPayload(
          request.payload,
          client,
          redaction,
          queue,
          session,
          position,
        );
      }
      throw new Error(`unknown report worker op: ${request.op}`);
    },
  });
  await session.run();
}

// app 출처 보고 접수. 본문은 redaction을 거친 뒤 ledger에 닿는다(R1, T3).
// text·details 원문은 bounded memory에서만 있고 permanent content는 hash뿐이다.
// app·release·process·mode·bundle_hash·diagnostic_scope 주장은 hello scope
// targets(credential)에서 온다.
export async function acceptReportProblem(
  payload: unknown,
  client: CoreClientOptions,
  redaction: RedactionEngine,
  queue: ReturnType<typeof createCollectorQueue>,
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
  // app·mode 주장은 credential 위치에서만 온다. 없으면 추측값을 만들지 않고
  // 잘못된 보고 진단으로 거절한다(T3).
  if (position.claims.app === undefined || position.claims.mode === undefined) {
    await invalidReportDiagnostic({
      reportId: parsed.value.report_id,
      component: COLLECTOR_KIND,
      observedAt: atNow(),
    });
    throw new Error("report credential has no app or mode claim");
  }
  // 조립값은 접수 본문이 검증한 필드만 이름으로 둔다(R1).
  const { report_id, code, observed_at, text, details } = parsed.value;
  const textContent = await redactText(redaction, text);
  const detailsContent = await redactDetails(redaction, details);
  // redaction이 비운 값을 내면 hash 없이 ledger에 닿는다(R1).
  // snapshot ID는 제출 rpt ID에서 결정적으로 정한다(snapshots#R ID 자리).
  // 접수 본문의 report_id가 곧 제출 rpt ID다(R1).
  const snapshotId = await pendingSnapshotId(report_id);
  // redaction을 통과한 text·details를 blob 준비해 Report.text·details에 싣는다
  // (T4: T3에서 넘어온 것). 준비는 core blob prepare 경계로 간다. 넘치는 본문은
  // 항목 상한(automatic_body_bytes)에서 제외하고 이유를 남긴다(R5, R20).
  const preparedText = await prepareContent(
    session,
    "report_text",
    textContent,
    REPORTING_LIMITS.automatic_body_bytes,
  );
  const preparedDetails = await prepareContent(
    session,
    "report_details",
    detailsContent,
    REPORTING_LIMITS.automatic_body_bytes,
  );
  const claims = position.claims;
  const report: RecordReportInput["report"] = {
    id: report_id,
    source: "app",
    code,
    text: preparedText === null ? null : preparedText.prepared.hash,
    details: preparedDetails === null ? null : preparedDetails.prepared.hash,
    snapshot: snapshotId,
    observed_at,
    principal: "collector",
    app: claims.app,
    mode: claims.mode,
    diagnostic_scope: claims.diagnostic_scope ?? null,
    release: claims.release ?? null,
    release_missing_reason: claims.release === undefined ? "collector" : null,
    bundle_hash: claims.bundle_hash ?? null,
    content_hash: "",
  } as RecordReportInput["report"];
  return await submit(
    client,
    report,
    [
      ...(preparedText !== null ? [preparedText] : []),
      ...(preparedDetails !== null ? [preparedDetails] : []),
    ],
    queue,
    session,
  );
}

// redaction을 통과한 inline content를 core blob prepare로 준비한다(T4).
// 내용이 없거나 항목 상한을 넘거나 준비가 실패하면 null이다: 항목의 이유는
// 다음 보고에 남기고 접수 자체는 계속한다(R5). 원문은 bounded memory에서만 있다.
async function prepareContent(
  session: Pick<ChildSession, "prepareBlob">,
  purpose: string,
  content: string | null,
  limitBytes: number,
): Promise<
  {
    prepared: {
      preparation: string;
      principal: string;
      purpose: string;
      hash: string;
      size_bytes: number;
    };
  } | null
> {
  if (content === null) return null;
  const bytes = new TextEncoder().encode(content);
  if (bytes.length > limitBytes) return null;
  const prepared = await prepareBlobBytes(session, purpose, bytes);
  return prepared === null ? null : { prepared };
}

// core blob prepare 경계. collector는 별도 process라 감독 pipe의 blob 준비 통로
// (session.prepareBlob)로 core에 청한다. hash와 준비 참조는 core가 I/O worker에서 받은
// 값이고 collector가 정하지 않는다. 준비가 실패하면 null이다: 이유를 남기고 접수한다(R5).
async function prepareBlobBytes(
  session: Pick<ChildSession, "prepareBlob">,
  purpose: string,
  bytes: Uint8Array,
): Promise<
  {
    preparation: string;
    principal: string;
    purpose: string;
    hash: string;
    size_bytes: number;
  } | null
> {
  const prepared = await session.prepareBlob({
    purpose,
    sizeBytes: bytes.length,
    bytes,
  });
  return prepared.ok ? prepared.value : null;
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

// text를 준비한다. redaction 엔진을 거치고 비운 값은 null content다(R1).
// 서브미션은 passed일 때만 진행한다. 엔진이 secret 형태를 지우지 못하면
// (omitted·partial) 원문이 남지 않게 null content로 둔다.
async function redactText(
  redaction: RedactionEngine,
  text: string | undefined,
): Promise<string | null> {
  if (text === undefined) return null;
  const result = await redact({
    redaction,
    body: text,
    mediaType: "text/plain",
  });
  return result;
}

// details를 준비한다. JSON으로 직렬화한 뒤 redaction 엔진을 거친다(R1).
async function redactDetails(
  redaction: RedactionEngine,
  details: unknown,
): Promise<string | null> {
  if (details === undefined) return null;
  const result = await redact({
    redaction,
    body: JSON.stringify(details),
    mediaType: "application/json",
  });
  return result;
}

// redaction 엔진 호출 하나. passed가 아니면 null로 둔다: 부분 지워진 값도
// permanent content로 남기지 않는다(R1).
async function redact(options: {
  redaction: RedactionEngine;
  body: string;
  mediaType: string;
}): Promise<string | null> {
  try {
    const result = await options.redaction.redact({
      source: {
        concern: "problems/reporting",
        revision: "collector-intake",
        scope: "report_intake",
      },
      media_type: options.mediaType,
      audience: "storage",
      safe_fields: [],
      private_fields: [],
    }, options.body);
    if (result.status !== "passed") return null;
    if (result.content === null || result.content.kind !== "inline") {
      return null;
    }
    return result.content.value;
  } catch {
    // redaction 실패는 원문을 통과시키지 않는다(R1).
    return null;
  }
}

// 준비 입���을 record-report로 제출한다(R16 retry). 대기 큐는 같은 고정 input만
// 쥐고 개수·바이트 한도를 넘는 새 입력은 손실 이유다(R16). acceptance는 ok payload다.
async function submit(
  client: CoreClientOptions,
  report: RecordReportInput["report"],
  prepared: {
    prepared: {
      preparation: string;
      principal: string;
      purpose: string;
      hash: string;
      size_bytes: number;
    };
  }[],
  queue: ReturnType<typeof createCollectorQueue>,
  _session: ChildSession,
): Promise<unknown> {
  // captured_at(조립 시각)은 report.observed_at(발생 시각)과 따로 둔다(R1).
  const snapshot: RecordReportInput["snapshot"] = {
    id: report.snapshot,
    captured_at: atNow(),
    invocation: null,
    invocation_missing_reason: { reason: "collector" },
    error: null,
    error_missing_reason: { reason: "collector" },
    logs: null,
    logs_missing_reason: { reason: "collector" },
    screen: null,
    screen_missing_reason: { reason: "collector" },
  };
  // blob 준비 항목은 principal "collector"로 등록한다: registerBlobs 원주체
  // 검사는 report.principal과 source.blob.principal이 같은지 본다.
  const blobs: RecordReportInput["blobs"] = prepared.map((entry) => ({
    hash: entry.prepared.hash,
    size_bytes: entry.prepared.size_bytes,
    purpose: entry.prepared.purpose as BlobPurpose,
    source: {
      kind: "prepared",
      blob: { ...entry.prepared },
    },
  }));
  // content hash는 접수 내용(원문 제외 조립값)에서 결정적으로 정한다(R9).
  const contentHash = await fingerprint(
    contentHashOf({
      report,
      snapshot,
      group_key: { kind: "declared", code: report.code, discriminator: null },
      existing_problem: null,
      blobs,
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
    blobs,
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
  // 대기 큐에 같은 고정 input을 넣는다(R16). 한도를 넘는 새 입력은 손실 이유고
  // 다시 보고하지 않는다.
  const frozen = freezeDeep(input);
  const over = queue.admit(report.id, frozen);
  if (over !== undefined) {
    throw new Error(over.message);
  }
  const completion = await deliverReport(
    async () => {
      const result = await postRecordReport(client, {
        input: queue.held(report.id) ?? frozen,
        idempotency_key: `${report.id}/${atNow()}`,
        compare: { active_release: null, problem_seq: null },
        prepared: prepared.map((entry) => entry.prepared.preparation),
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
  // send가 끝난 뒤에만 큐에서 빠진다(R16).
  queue.release(report.id);
  if (completion.status !== "accepted") {
    throw new Error(completion.reason.message);
  }
  return completion.acceptance;
}

function atNow(): string {
  return new Date().toISOString().replace(/(\.\d{3})\d*Z$/, "$1Z");
}

// exception 출처 보고 접수(process_observer·view_observer). 본문은 redaction 뒤
// ledger에 닿는다. 예외 진단 원문은 bounded memory에서만 있고 permanent content는
// hash뿐이다(R8, R10). stack은 준비 폴더 source로 위치를 찾고, invocation은
// 실제 연결한 ID만 기록 도착을 확인한다(snapshots#R8, R9, R11).
export async function observeExceptionPayload(
  payload: unknown,
  client: CoreClientOptions,
  redaction: RedactionEngine,
  queue: ReturnType<typeof createCollectorQueue>,
  session: ChildSession,
  position: CollectorPosition,
): Promise<unknown> {
  const parsed = exceptionObservationInputSchema.safeParse(payload);
  if (!parsed.success) {
    throw new Error("invalid exception observation body");
  }
  const observation = parsed.data;
  // app 주장은 credential 위치에서만 온다. 없으면 추측값을 만들지 않고 거절한다(T3).
  if (position.claims.app === undefined || position.claims.mode === undefined) {
    throw new Error("exception credential has no app or mode claim");
  }
  // observation kind에서 원본 origin을 정한다. render_error는 view_observer,
  // process_exit·error·unhandledrejection는 process_observer다(reporting#R2).
  const origin = observation.observation === "render_error"
    ? "view_observer"
    : "process_observer";
  // raw 문��는 bounded memory에서 redaction을 거친다(R1). fail-closed:
  // 통과하지 못한 문자는 원문 대신 null + missing reason이다(R4). 이름도
  // 엔진을 거친다: safe 모양이어도 secret pattern 값이 든 이름은 지운다(R10).
  const rawError = observation.error;
  const redactedName = rawError === null
    ? ""
    : await redactText(redaction, rawError.name) ?? "*";
  const redactedMessage = rawError === null ? null : await redactText(
    redaction,
    rawError.message === null ? undefined : rawError.message,
  );
  const messageMissing = rawError === null
    ? null
    : rawError.message === null
    ? rawError.message_missing_reason
    : redactedMessage === null
    ? { reason: "redaction" }
    : null;
  const redactedStack = rawError === null ? null : await redactText(
    redaction,
    rawError.stack === null ? undefined : rawError.stack,
  );
  const stackMissing = rawError === null
    ? null
    : rawError.stack === null
    ? rawError.stack_missing_reason
    : redactedStack === null
    ? { reason: "redaction" }
    : null;
  // 전체 조립은 2,000ms다(snapshots#R18). 단조 시계는 assembleException이 본다.
  const assembled = await assembleException(
    {
      report_id: observation.report_id,
      observed_at: observation.observed_at,
      observation: observation.observation,
      error: rawError === null ? null : {
        name: redactedName,
        message: redactedMessage,
        message_missing_reason: messageMissing,
        stack: redactedStack,
        stack_missing_reason: stackMissing,
      },
      error_missing_reason: observation.error_missing_reason,
      // invocation이 없으면 이유를 남긴다(snapshots#R4, R9).
      invocation: observation.invocation,
    },
    {
      app: position.claims.app,
      bundle_hash: position.claims.bundle_hash ?? null,
    },
    {
      // stack blob 준비는 core blob prepare 경계로 간다. 준비가 실패해도
      // 남은 자료로 접수한다(R5).
      blobPrepare: {
        prepare: (input, bytes) => prepareViaStream(session, input, bytes),
      },
      folder: {
        appsRoot: collectorAppsRoot(),
      },
      nowAt: atNow(),
      principal: "collector",
    },
  );
  if (!assembled.ok) {
    throw new Error("exception snapshot assembly failed");
  }
  const result = assembled.value;
  // 조립값은 snapshot input schema를 그대로 통과한다(R2). 통과하지 못하면
  // 접수하지 않는다: 잘못된 snapshot은 loss 이유다(R5).
  const checked = snapshotInputSchema.safeParse(result.snapshot);
  if (!checked.success) {
    throw new Error("assembled snapshot does not pass snapshot schema");
  }
  if (position.claims.mode === undefined) {
    throw new Error("exception credential has no mode claim");
  }
  const report: RecordReportInput["report"] = {
    id: observation.report_id,
    source: "exception",
    code: "_exception",
    text: null,
    details: null,
    snapshot: result.snapshot.id,
    observed_at: observation.observed_at,
    principal: "collector",
    app: position.claims.app,
    mode: position.claims.mode,
    diagnostic_scope: position.claims.diagnostic_scope ?? null,
    release: position.claims.release ?? null,
    release_missing_reason: position.claims.release === undefined
      ? "collector"
      : null,
    bundle_hash: position.claims.bundle_hash ?? null,
    content_hash: "",
  } as RecordReportInput["report"];
  const invocation = await confirmInvocation(
    client,
    observation.invocation,
  );
  // 기록 도착을 확인한 뒤 invocation 증거를 갱신한다(R8, R9). 근접 추정은 없다:
  // 도착하지 않은 기록은 그 이유만 남긴다(reporting#R14).
  const snapshot: RecordReportInput["snapshot"] = invocation === undefined
    ? {
      ...result.snapshot,
      invocation: result.snapshot.invocation,
      invocation_missing_reason: result.snapshot.invocation_missing_reason,
    }
    : result.snapshot.invocation?.id === invocation.id
    ? {
      ...result.snapshot,
      invocation: {
        id: invocation.id,
        binding: result.snapshot.invocation!.binding,
        record_missing_reason: null,
      },
      invocation_missing_reason: null,
    }
    : result.snapshot;
  return await submitException(
    client,
    report,
    snapshot,
    result.group_key,
    result.stack_prepared,
    queue,
    session,
    origin,
    position,
  );
}

// exception 보고 제출. origin은 observation kind에서 온 process_observer·
// view_observer다(reporting#R2: 출처 위조는 ledger가 refines로 거절한다).
async function submitException(
  client: CoreClientOptions,
  report: RecordReportInput["report"],
  snapshot: RecordReportInput["snapshot"],
  group_key: RecordReportInput["group_key"],
  stackPrepared: {
    preparation: string;
    principal: string;
    purpose: string;
    hash: string;
    size_bytes: number;
  } | null,
  queue: ReturnType<typeof createCollectorQueue>,
  _session: ChildSession,
  origin: "process_observer" | "view_observer",
  _position: CollectorPosition,
): Promise<unknown> {
  const prepared: {
    prepared: {
      preparation: string;
      principal: string;
      purpose: string;
      hash: string;
      size_bytes: number;
    };
  }[] = stackPrepared === null ? [] : [{ prepared: stackPrepared }];
  const blobs: RecordReportInput["blobs"] = prepared.map((entry) => ({
    hash: entry.prepared.hash,
    size_bytes: entry.prepared.size_bytes,
    purpose: entry.prepared.purpose as BlobPurpose,
    source: {
      kind: "prepared",
      blob: { ...entry.prepared },
    },
  }));
  const contentHash = await fingerprint(
    contentHashOf({
      report,
      snapshot,
      group_key,
      existing_problem: null,
      blobs,
    }) ?? "",
  );
  const input: RecordReportInput = {
    report: {
      ...report,
      content_hash: contentHash,
    },
    snapshot,
    group_key,
    existing_problem: null,
    blobs,
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
        origin,
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
  const frozen = freezeDeep(input);
  const over = queue.admit(report.id, frozen);
  if (over !== undefined) {
    throw new Error(over.message);
  }
  const completion = await deliverReport(
    async () => {
      const result = await postRecordReport(client, {
        input: queue.held(report.id) ?? frozen,
        idempotency_key: `${report.id}/${atNow()}`,
        compare: { active_release: null, problem_seq: null },
        prepared: prepared.map((entry) => entry.prepared.preparation),
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
  queue.release(report.id);
  if (completion.status !== "accepted") {
    throw new Error(completion.reason.message);
  }
  return completion.acceptance;
}

// exception observation의 error name을 redaction한다. 이름은 안전한 오류 이름만
// 남긴다(snapshots#R10: 안전한 오류 이름).

// collector의 준비 폴더 출처. LOPHN_HOME env의 apps 부분만 이름 짓는다(등록
// spec allow_read와 같다). env가 없으면 null이다: 준비 폴더 없음 이유로 남는다.
function collectorAppsRoot(): string | null {
  try {
    const home = Deno.env.get("LOPHN_HOME");
    if (home === undefined || !home.startsWith("/")) return null;
    return `${home}/apps`;
  } catch {
    return null;
  }
}

// stack blob 준비를 stream으로 받는 platform blob prepare 모양. 바이트를 모아 크기를
// 정한 뒤 감독 pipe의 blob 준비 통로로 core에 청한다. principal·expectedHash는 core가
// kind에서 정하므로 보내지 않는다. 준비가 실패하면 오류를 돌려주고 남은 자료로 접수한다(R5).
async function prepareViaStream(
  session: Pick<ChildSession, "prepareBlob">,
  input: { principal: string; purpose: string; expectedHash?: string },
  bytes: ReadableStream<Uint8Array>,
): Promise<
  Result<
    {
      preparation: string;
      principal: string;
      purpose: string;
      hash: string;
      size_bytes: number;
    }
  >
> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = bytes.getReader();
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    chunks.push(next.value);
    total += next.value.length;
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.length;
  }
  return await session.prepareBlob({
    purpose: input.purpose,
    sizeBytes: total,
    bytes: body,
  });
}

// 실제 연결한 invocation ID만 기록 도착을 확인한다(snapshots#R8, R9). 근접
// 추정은 없다: ID가 없으면 확인하지 않는다. 기록이 아직 없으면 그 이유만 남기고
// 접수는 계속한다(R9, reporting#R14).
async function confirmInvocation(
  client: CoreClientOptions,
  invocation:
    | { id: string; binding: string; record_missing_reason: unknown }
    | null,
): Promise<{ id: string; binding: string } | undefined> {
  if (invocation === null) return undefined;
  try {
    const base = client.baseUrl.replace(/\/$/, "");
    // 주입한 client.fetch를 건다: 테스트와 EXTERNAL_FETCH tripwire가 같은
    // 통로를 본다. 응답은 loopback 모양({status, bytes})이다.
    const response = await client.fetch(`${base}/v1/invocations/get`, {
      method: "POST",
      headers: {
        "authorization": `Bearer ${client.credential}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ invocation: invocation.id }),
    });
    if (response.status !== 200) return undefined;
    const body = JSON.parse(new TextDecoder().decode(response.bytes)) as {
      invocation?: unknown;
    };
    if (body.invocation === null || body.invocation === undefined) {
      return undefined;
    }
    const row = body.invocation as { id?: unknown };
    if (typeof row.id !== "string" || row.id !== invocation.id) {
      return undefined;
    }
    return { id: invocation.id, binding: invocation.binding };
  } catch {
    return undefined;
  }
}

// launchArgv가 내는 argv의 entry는 이 모듈 자체다(T8 worker main과 다른 갈래).
if (import.meta.main) {
  await runCollectorWorker();
}
