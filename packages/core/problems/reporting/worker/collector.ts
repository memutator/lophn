// report collector worker. core 감독이 띄우고 이 모듈이 보고 접수 통로를
// 조립한다. credential에서
// 출처를 정하고 본문 주장은 따르지 않는다. redaction은 이 worker가 ledger에 닿기
// 전에 거친다.
import {
  err,
  type ErrorCode,
  ok,
  type Result,
  sha256Hex,
} from "../../../../base/mod.ts";
import type { WorkerRequest } from "../../../../protocol/supervision/mod.ts";
import {
  exceptionObservationInputSchema,
  observeException,
  observeViewError,
  observeViewErrorInputSchema,
  problemFeedbackInputSchema,
  type ProblemGroupKey,
  problemReport,
  problemReportInputSchema,
  type ProblemReportRecordInput,
  type ProblemSnapshotInput,
  problemSubmitFeedback,
  type RecordProblemReportInput,
  recordProblemReportInputSchema,
  REPORT_RETRY_DELAYS_MS,
  type ReportAcceptance,
  REPORTING_LIMITS,
} from "../../../../protocol/problems/mod.ts";
import {
  type ChildSession,
  type ChildStreams,
  startChild,
} from "../../../supervision/responsiveness/mod.ts";
import {
  createKnownSecretRegistry,
  createRedactionEngine,
  type RedactionEngine,
} from "../../../../base/redaction/mod.ts";
import {
  COLLECTOR_CAPS,
  contentHashOf,
  createCollectorQueue,
  deliverReport,
  freezeDeep,
} from "../mod.ts";
import {
  type CoreClientOptions,
  postRecordReport,
} from "../adapters/core-client.ts";
import {
  assembleFeedback,
  coreProblemLookup,
  type FeedbackCaller,
} from "../../feedback/mod.ts";
import {
  type AppLogSource,
  assembleException,
  collectLogEvidence,
  coreLogSource,
  type PreparedSnapshotBlob,
  problemNameOf,
  readDetailCollection,
} from "../../snapshots/mod.ts";

// hello의 kind는 이 worker 경계가 다시 본다. 다른 kind면 protocol 위반이다.
// hello message는 startChild가 helloSchema로 검사한 뒤 넘긴다.
export const COLLECTOR_KIND = "problems/report-collector";

// 인증 경계가 hello로 넘긴 collector 위치. app·release·process·mode·bundle_hash·
// diagnostic_scope 주장은 hello scope targets에서 온다(credential에서만 정한다.
// contracts/platform의 app credential 주장 대상이고 발급 때 credential에 고정된다).
type CollectorPosition = {
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

type CollectorWorkerOptions = {
  streams: ChildStreams;
  // op별 접수. 출처 확인·redaction·조립·제출은 이 함수 몫이다.
  accept(request: WorkerRequest, position: CollectorPosition): Promise<unknown>;
  cancelled?: () => boolean;
};

// 접수를 거절한 사유. 코드는 호출자에게 그대로 가고 그 밖의 실패는 unavailable이다.
class CollectorRejection extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

// 등록 시점 kind 검사(runnerReady와 같은 모양).
export function collectorReady(kind: string): Result<true> {
  if (kind !== COLLECTOR_KIND) {
    return err({ code: "invalid_input", message: "unknown worker kind" });
  }
  return ok(true);
}

function createCollectorWorker(
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
      } catch (thrown) {
        if (thrown instanceof CollectorRejection) {
          await session.send({
            type: "worker_response",
            request_id: message.request_id,
            ok: false,
            error: { code: thrown.code, message: thrown.message },
          });
          return;
        }
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

// 보고 접수. 본문은 contract가 다시 본다.
function acceptReportPayload(
  payload: unknown,
): Result<
  ReturnType<typeof problemReportInputSchema.parse>,
  { code: "invalid_input"; message: string }
> {
  const parsed = problemReportInputSchema.safeParse(payload);
  if (!parsed.success) {
    return err({ code: "invalid_input", message: "invalid report body" });
  }
  return ok(parsed.data);
}

export async function runCollectorWorker(): Promise<void> {
  // Only the entry owns console routing. Helper modules never change global console.
  console.log = console.info = console.debug = (...args: unknown[]) =>
    console.error(...args);
  let stopped = false;
  const known = createKnownSecretRegistry();
  const redaction = createRedactionEngine({ registry: known });
  const replays = createOccurrenceReplays();
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
    async accept(request, hello) {
      // core가 요청마다 credential의 위치 주장(request_claims)과 본문(body)을 싣는다. 제품
      // collector 하나가 여러 앱을 받으므로 위치는 hello가 아니라 요청에서 온다. 싣지 않은
      // 요청(단일 위치 기동)은 hello의 위치를 쓴다.
      const carried = requestClaims(request.payload);
      const position: CollectorPosition = carried === undefined
        ? hello
        : { ...hello, claims: carried.claims };
      if (carried !== undefined) {
        request = { ...request, payload: carried.body };
      }
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
      const logs = coreLogs(client);
      if (request.op === problemReport.name) {
        return await acceptProblemReport(
          request.payload,
          client,
          redaction,
          queue,
          session,
          position,
          logs,
          replays,
        );
      }
      if (request.op === observeException.name) {
        return await observeExceptionPayload(
          request.payload,
          client,
          redaction,
          queue,
          session,
          position,
          logs,
        );
      }
      if (request.op === observeViewError.name) {
        return await observeViewErrorPayload(
          request.payload,
          client,
          redaction,
          queue,
          session,
          position,
          logs,
        );
      }
      if (request.op === problemSubmitFeedback.name) {
        return await acceptSubmitFeedback(
          request.payload,
          carried?.caller ?? { actor: "unknown", surface: "unknown" },
          client,
          redaction,
          queue,
          session,
          logs,
        );
      }
      throw new Error(`unknown report worker op: ${request.op}`);
    },
  });
  await session.run();
}

const CLAIM_KEYS = [
  "app",
  "release",
  "process",
  "mode",
  "bundle_hash",
  "diagnostic_scope",
] as const;

// core가 worker 요청 payload에 싣는 `{request_claims, caller, body}`를 푼다. 모양이
// 아니면 undefined다.
function requestClaims(payload: unknown): {
  claims: CollectorPosition["claims"];
  caller: FeedbackCaller | undefined;
  body: unknown;
} | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  const record = payload as Record<string, unknown>;
  const carried = record["request_claims"];
  if (
    !("body" in record) || typeof carried !== "object" || carried === null
  ) {
    return undefined;
  }
  const claims: CollectorPosition["claims"] = {};
  for (const key of CLAIM_KEYS) {
    const value = (carried as Record<string, unknown>)[key];
    if (typeof value === "string") claims[key] = value;
  }
  const who = record["caller"] as Record<string, unknown> | null | undefined;
  return {
    claims,
    caller: typeof who?.["actor"] === "string" &&
        typeof who["surface"] === "string"
      ? { actor: who["actor"], surface: who["surface"] }
      : undefined,
    body: record["body"],
  };
}

// 로그 증거의 출처. 기본은 core loopback의 apps.logs와 settings.get이고, 테스트와
// 다른 조립은 port를 바꿔 끼운다. 설정을 읽지 못하면 null이다.
type CollectorLogs = {
  source: AppLogSource | null;
  detailCollection: () => Promise<boolean | null>;
};

function coreLogs(client: CoreClientOptions): CollectorLogs {
  return {
    source: coreLogSource(client),
    detailCollection: () => readDetailCollection(client),
  };
}

type OccurrenceReplay = {
  fingerprint: string;
  acceptance: ReportAcceptance;
};

// 같은 worker 안의 재전송. 조립 시각이 달라도 같은 발생이면 저장한 접수를 돌려준다.
type OccurrenceReplays = {
  lookup(reportId: string): OccurrenceReplay | undefined;
  remember(
    reportId: string,
    fingerprint: string,
    acceptance: ReportAcceptance,
  ): void;
};

function createOccurrenceReplays(): OccurrenceReplays {
  const held = new Map<string, OccurrenceReplay>();
  return {
    lookup(reportId) {
      return held.get(reportId);
    },
    remember(reportId, fingerprint, acceptance) {
      held.set(reportId, { fingerprint, acceptance });
    },
  };
}

function occurrenceFingerprint(parts: {
  name: string;
  observed_at: string;
  app: string;
  mode: string;
  message: string | null;
  details: string | null;
  invocation: string | null;
}): Promise<string> {
  return sha256Hex(JSON.stringify(parts));
}

// 접수 위치. credential 위치 주장에서 온 값만 쓴다. 본문 주장은 따르지 않는다.
type ReportScope = Pick<
  ProblemReportRecordInput,
  | "app"
  | "mode"
  | "diagnostic_scope"
  | "release"
  | "release_missing_reason"
  | "bundle_hash"
>;

function scopeOf(claims: CollectorPosition["claims"]): ReportScope {
  return {
    app: claims.app as ReportScope["app"],
    mode: claims.mode as ReportScope["mode"],
    diagnostic_scope: claims.diagnostic_scope ?? null,
    release: (claims.release ?? null) as ReportScope["release"],
    release_missing_reason: claims.release === undefined ? "collector" : null,
    bundle_hash: claims.bundle_hash ?? null,
  };
}

// 실제 연결한 invocation만 담는다. 기록이 아직 도착하지 않았으면 그 이유를 남긴다.
async function invocationEvidence(
  client: CoreClientOptions,
  linked: { id: string } | null | undefined,
): Promise<ProblemSnapshotInput["invocation"]> {
  if (linked === null || linked === undefined) return null;
  const arrived = await confirmInvocation(client, linked.id);
  return {
    id: linked.id as NonNullable<ProblemSnapshotInput["invocation"]>["id"],
    record_missing_reason: arrived
      ? null
      : { reason: "기록이 아직 도착하지 않았다" },
  };
}

// app 출처 보고 접수. 본문은 redaction을 거친 뒤 ledger에 닿는다.
// message·details 원문은 bounded memory에서만 있고 permanent content는 hash뿐이다.
// app·release·process·mode·bundle_hash·diagnostic_scope 주장은 credential에서 온다.
async function acceptProblemReport(
  payload: unknown,
  client: CoreClientOptions,
  redaction: RedactionEngine,
  queue: ReturnType<typeof createCollectorQueue>,
  session: ChildSession,
  position: CollectorPosition,
  logs: CollectorLogs = coreLogs(client),
  replays: OccurrenceReplays = createOccurrenceReplays(),
): Promise<unknown> {
  const startedMs = Date.now();
  const parsed = acceptReportPayload(payload);
  if (!parsed.ok) {
    throw new CollectorRejection("invalid_input", parsed.error.message);
  }
  // app·mode 주장은 credential 위치에서만 온다. 없으면 추측값을 만들지 않고 거절한다.
  if (position.claims.app === undefined || position.claims.mode === undefined) {
    throw new CollectorRejection(
      "unauthorized",
      "report credential has no app or mode claim",
    );
  }
  const { report_id, observed_at, message, details } = parsed.value;
  const name = problemNameOf(
    await redactText(redaction, parsed.value.name),
    "[redacted]",
  );
  const messageContent = await redactOutcome(redaction, message, "text/plain");
  const detailsContent = await redactOutcome(
    redaction,
    details === undefined ? undefined : JSON.stringify(details),
    "application/json",
  );
  const fingerprint = await occurrenceFingerprint({
    name,
    observed_at,
    app: position.claims.app,
    mode: position.claims.mode,
    message: messageContent.value,
    details: detailsContent.value,
    invocation: parsed.value.invocation?.id ?? null,
  });
  const prior = replays.lookup(report_id);
  if (prior !== undefined) {
    if (prior.fingerprint === fingerprint) return prior.acceptance;
    throw new CollectorRejection(
      "conflict",
      "같은 Report ID의 원주체나 내용이 다르다",
    );
  }
  // snapshot ID는 제출 rpt ID에서 결정적으로 정한다.
  const snapshotId = await pendingSnapshotId(report_id);
  // redaction을 통과한 message·details를 blob 준비해 Report.message·details에 싣는다.
  // 넘치는 본문은 항목 상한(automatic_body_bytes)에서 제외한다.
  const preparedMessage = await prepareContent(
    session,
    "report_text",
    messageContent.value,
    REPORTING_LIMITS.automatic_body_bytes,
  );
  const preparedDetails = await prepareContent(
    session,
    "report_details",
    detailsContent.value,
    REPORTING_LIMITS.automatic_body_bytes,
  );
  // SDK가 실제로 연결한 invocation만 담고 근접 추정은 없다.
  const linked = parsed.value.invocation ?? null;
  const invocation = await invocationEvidence(client, linked);
  const logEvidence = await collectLogEvidence(
    { app: position.claims.app, invocation: linked?.id ?? null },
    {
      detailCollection: await logs.detailCollection(),
      source: logs.source,
      redact: (text) => redactText(redaction, text),
      blobPrepare: {
        prepare: (input, bytes) => prepareViaStream(session, input, bytes),
      },
      principal: "collector",
      nowAt: atNow(),
      remainingMs: REPORTING_LIMITS.snapshot_assembly_ms -
        (Date.now() - startedMs),
      remainingLargeBytes: REPORTING_LIMITS.snapshot_large_bytes -
        (preparedMessage?.size_bytes ?? 0) -
        (preparedDetails?.size_bytes ?? 0),
    },
  );
  const acceptance = await submit(client, queue, {
    report: {
      id: report_id as ProblemReportRecordInput["id"],
      ...scopeOf(position.claims),
      source: "app",
      name,
      message: preparedMessage?.hash ?? null,
      details: preparedDetails?.hash ?? null,
      snapshot: snapshotId as ProblemReportRecordInput["snapshot"],
      observed_at,
    },
    snapshot: {
      id: snapshotId as ProblemSnapshotInput["id"],
      captured_at: atNow(),
      invocation,
      error: null,
      logs: logEvidence.logs,
    },
    group_key: { kind: "named", name },
    existing_problem: null,
    prepared: [preparedMessage, preparedDetails, logEvidence.prepared],
    origin: "app",
    actor: `app:${position.claims.app}`,
  });
  replays.remember(report_id, fingerprint, acceptance);
  return acceptance;
}

// redaction을 통과한 inline content를 core blob prepare로 준비한다.
// 내용이 없거나 항목 상한을 넘거나 준비가 실패하면 null이다: 접수 자체는 계속한다.
// 원문은 bounded memory에서만 있다.
async function prepareContent(
  session: Pick<ChildSession, "prepareBlob">,
  purpose: string,
  content: string | null,
  limitBytes: number,
): Promise<PreparedSnapshotBlob | null> {
  if (content === null) return null;
  const bytes = new TextEncoder().encode(content);
  if (bytes.length > limitBytes) return null;
  const prepared = await session.prepareBlob({
    purpose,
    sizeBytes: bytes.length,
    bytes,
  });
  return prepared.ok ? prepared.value : null;
}

// 제출 rpt ID에서 결정적으로 정한 접수 snapshot ID: 원문에서만 온다.
async function pendingSnapshotId(reportId: string): Promise<string> {
  if (!/^rpt_[0-7][0-9a-hjkmnp-tv-z]{25}$/.test(reportId)) {
    throw new CollectorRejection("invalid_input", "invalid report id");
  }
  const digest = await sha256Hex(`pending-snapshot:${reportId}`);
  const first = String(digest.charCodeAt(0) & 7);
  return `snp_${first}${digest.slice(1, 26)}`;
}

// redaction 엔진을 거친 text. 통과하지 못하면 null이다: 부분 지워진 값도
// permanent content로 남기지 않는다.
async function redactText(
  redaction: RedactionEngine,
  text: string | undefined,
): Promise<string | null> {
  if (text === undefined) return null;
  return (await redactOutcome(redaction, text, "text/plain")).value;
}

type RedactedBody = { value: string | null; reason: string | null };

// 본문이 없으면 뺄 원문이 없다. passed가 아니면 원문 없이 생략 이유만 남긴다.
async function redactOutcome(
  redaction: RedactionEngine,
  body: string | undefined,
  mediaType: string,
): Promise<RedactedBody> {
  if (body === undefined) return { value: null, reason: null };
  try {
    const result = await redaction.redact({
      source: {
        concern: "problems/reporting",
        revision: "collector-intake",
        scope: "report_intake",
      },
      media_type: mediaType,
      audience: "storage",
      safe_fields: [],
      private_fields: [],
    }, body);
    if (
      result.status === "passed" && result.content !== null &&
      result.content.kind === "inline"
    ) {
      return { value: result.content.value, reason: null };
    }
    return {
      value: null,
      reason: result.omissions[0]?.reason ?? "redaction",
    };
  } catch {
    return { value: null, reason: "redaction" };
  }
}

type SubmitParts = {
  report: Omit<ProblemReportRecordInput, "principal" | "content_hash">;
  snapshot: ProblemSnapshotInput;
  group_key: ProblemGroupKey;
  existing_problem: string | null;
  // 준비한 blob. 없는 항목은 null이다.
  prepared: readonly (PreparedSnapshotBlob | null)[];
  origin: "app" | "process_observer" | "view_observer";
  actor: string;
};

// 준비 입력을 problem.record_report로 제출한다. 대기 큐는 같은 고정 input만
// 쥐고 개수·바이트 한도를 넘는 새 입력은 손실 이유다. acceptance는 ok payload다.
async function submit(
  client: CoreClientOptions,
  queue: ReturnType<typeof createCollectorQueue>,
  parts: SubmitParts,
): Promise<ReportAcceptance> {
  const prepared = parts.prepared.filter((entry) => entry !== null);
  // blob 준비 항목은 principal "collector"로 등록한다: registerBlobs 원주체
  // 검사는 report.principal과 source.blob.principal이 같은지 본다.
  const blobs: RecordProblemReportInput["blobs"] = prepared.map((entry) => ({
    hash: entry.hash,
    size_bytes: entry.size_bytes,
    purpose: entry.purpose as RecordProblemReportInput["blobs"][number][
      "purpose"
    ],
    source: { kind: "prepared", blob: { ...entry } },
  }));
  const report = { ...parts.report, principal: "collector" };
  // content hash는 접수 내용(원문 제외 조립값)에서 결정적으로 정한다.
  const contentHash = await contentHashOf({
    report: { ...report, content_hash: "" },
    snapshot: parts.snapshot,
    group_key: parts.group_key,
    existing_problem: parts.existing_problem,
    blobs,
  });
  const candidate = {
    report: { ...report, content_hash: contentHash },
    snapshot: parts.snapshot,
    group_key: parts.group_key,
    existing_problem: parts.existing_problem,
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
        origin: parts.origin,
        authentication: {
          principal: report.principal,
          actor: parts.actor,
          scope: { operations: [problemReport.name], targets: {} },
          conditions: {},
          credential_ref: "collector-position",
        },
      },
    },
  };
  const checked = recordProblemReportInputSchema.safeParse(candidate);
  if (!checked.success) {
    throw new CollectorRejection("invalid_input", "invalid report content");
  }
  return await deliver(
    client,
    queue,
    checked.data,
    prepared.map((entry) => entry.preparation),
  );
}

// 대기 큐에 같은 고정 input을 넣고 보낸다. 한도를 넘는 새 입력은 손실 이유고 다시 보고하지 않는다.
async function deliver(
  client: CoreClientOptions,
  queue: ReturnType<typeof createCollectorQueue>,
  input: RecordProblemReportInput,
  prepared: string[],
): Promise<ReportAcceptance> {
  const id = input.report.id;
  const frozen = freezeDeep(input);
  const over = queue.admit(id, frozen);
  if (over !== undefined) {
    throw new Error(over.message);
  }
  const completion = await deliverReport(
    async () => {
      const result = await postRecordReport(client, {
        input: queue.held(id) ?? frozen,
        idempotency_key: `${id}/${atNow()}`,
        compare: { active_release: null, problem_seq: null },
        prepared,
      });
      return result.ok
        ? ok(result.value as ReportAcceptance)
        : err(result.error);
    },
    { delays: REPORT_RETRY_DELAYS_MS },
    (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    "response lost",
  );
  // send가 끝난 뒤에만 큐에서 빠진다.
  queue.release(id);
  if (completion.status !== "accepted") {
    throw new Error(completion.reason.message);
  }
  return completion.acceptance;
}

function atNow(): string {
  return new Date().toISOString().replace(/(\.\d{3})\d*Z$/, "$1Z");
}

// 처리되지 않은 오류 접수(process_observer·view_observer). 오류 원문은 bounded memory에서만 있고
// permanent content는 hash뿐이다. stack은 준비 폴더 source로 위치를 찾고, invocation은 실제
// 연결한 ID만 기록 도착을 확인한다.
async function acceptObserved(options: {
  observation: ReturnType<typeof exceptionObservationInputSchema.parse>;
  scope: ReportScope;
  origin: "process_observer" | "view_observer";
  // view 오류는 stack을 수집하지 않는다.
  withStack: boolean;
  client: CoreClientOptions;
  redaction: RedactionEngine;
  queue: ReturnType<typeof createCollectorQueue>;
  session: ChildSession;
  logs: CollectorLogs;
}): Promise<unknown> {
  const { observation, scope, redaction, session } = options;
  // raw 문자는 bounded memory에서 redaction을 거친다. fail-closed: 통과하지 못한 문자는 null이다.
  // 이름도 엔진을 거친다: safe 모양이어도 secret pattern 값이 든 이름은 지운다.
  const raw = observation.error;
  const error = raw === null ? null : {
    name: await redactText(redaction, raw.name) ?? "*",
    message: await redactText(redaction, raw.message ?? undefined),
    stack: options.withStack
      ? await redactText(redaction, raw.stack ?? undefined)
      : null,
  };
  const invocation = await invocationEvidence(
    options.client,
    observation.invocation,
  );
  // 전체 조립은 2,000ms다. 단조 시계는 assembleException이 본다.
  const assembled = await assembleException(
    {
      report_id: observation.report_id,
      observed_at: observation.observed_at,
      observation: observation.observation,
      error,
      invocation,
    },
    { app: scope.app, bundle_hash: scope.bundle_hash },
    {
      // stack blob 준비는 core blob prepare 경계로 간다. 준비가 실패해도 남은 자료로 접수한다.
      blobPrepare: {
        prepare: (input, bytes) => prepareViaStream(session, input, bytes),
      },
      folder: { appsRoot: collectorAppsRoot() },
      nowAt: atNow(),
      principal: "collector",
      // 로그는 credential의 앱 것만 묻는다. 수집 설정은 새 수집만 멈춘다.
      logs: {
        detailCollection: await options.logs.detailCollection(),
        source: options.logs.source,
        redact: (text) => redactText(redaction, text),
      },
    },
  );
  if (!assembled.ok) {
    throw new Error("exception snapshot assembly failed");
  }
  const result = assembled.value;
  return await submit(options.client, options.queue, {
    report: {
      id: observation.report_id as ProblemReportRecordInput["id"],
      ...scope,
      source: "exception",
      name: result.name,
      message: null,
      details: null,
      snapshot: result.snapshot.id,
      observed_at: observation.observed_at,
    },
    snapshot: result.snapshot,
    group_key: result.group_key,
    existing_problem: null,
    prepared: [result.stack_prepared, result.logs_prepared],
    origin: options.origin,
    actor: `app:${scope.app}`,
  });
}

// process 출처 오류 접수. observation kind에서 원본 origin을 정한다: render_error는
// view_observer, process_exit·error·unhandledrejection는 process_observer다.
async function observeExceptionPayload(
  payload: unknown,
  client: CoreClientOptions,
  redaction: RedactionEngine,
  queue: ReturnType<typeof createCollectorQueue>,
  session: ChildSession,
  position: CollectorPosition,
  logs: CollectorLogs = coreLogs(client),
): Promise<unknown> {
  const parsed = exceptionObservationInputSchema.safeParse(payload);
  if (!parsed.success) {
    throw new CollectorRejection(
      "invalid_input",
      "invalid exception observation body",
    );
  }
  // app 주장은 credential 위치에서만 온다. 없으면 추측값을 만들지 않고 거절한다.
  if (position.claims.app === undefined || position.claims.mode === undefined) {
    throw new CollectorRejection(
      "unauthorized",
      "exception credential has no app or mode claim",
    );
  }
  return await acceptObserved({
    observation: parsed.data,
    scope: scopeOf(position.claims),
    origin: parsed.data.observation === "render_error"
      ? "view_observer"
      : "process_observer",
    withStack: true,
    client,
    redaction,
    queue,
    session,
    logs,
  });
}

// view 출처 오류 접수. 모든 observation 종류를 view_observer 출처로 받는다. view의
// app·release·mode·bundle_hash는 core가 서명 검증한 binding에서 정해 보낸 값이다
// (packages/core/problems/reporting/view-binding.ts). 페이지 주장은 그 전에 덮여 여기까지 오지 않는다.
async function observeViewErrorPayload(
  payload: unknown,
  client: CoreClientOptions,
  redaction: RedactionEngine,
  queue: ReturnType<typeof createCollectorQueue>,
  session: ChildSession,
  _position: CollectorPosition,
  logs: CollectorLogs = coreLogs(client),
): Promise<unknown> {
  const parsed = observeViewErrorInputSchema.safeParse(payload);
  if (!parsed.success) {
    throw new CollectorRejection("invalid_input", "invalid view error payload");
  }
  const { view, observation } = parsed.data;
  return await acceptObserved({
    observation,
    scope: {
      app: view.app as ReportScope["app"],
      mode: view.mode,
      diagnostic_scope: null,
      release: view.release as ReportScope["release"],
      release_missing_reason: view.release === null ? "collector" : null,
      bundle_hash: view.bundle_hash,
    },
    origin: "view_observer",
    withStack: false,
    client,
    redaction,
    queue,
    session,
    logs,
  });
}

// shell user의 feedback 접수. core는 사람 자격을 인증하고 호출자 출처(caller)를 해석 없이
// 넘긴다. 검증·redaction·blob 준비·조립은 assembleFeedback이 하고 이 함수는 제품 의존
// (redaction, core 읽기, blob 준비)을 꽂아 problem.record_report로 제출한다. 조립이 거절한 사유는
// 코드 그대로 호출자에게 간다.
async function acceptSubmitFeedback(
  payload: unknown,
  caller: FeedbackCaller,
  client: CoreClientOptions,
  redaction: RedactionEngine,
  queue: ReturnType<typeof createCollectorQueue>,
  session: ChildSession,
  logs: CollectorLogs = coreLogs(client),
): Promise<unknown> {
  const parsed = problemFeedbackInputSchema.safeParse(payload);
  if (!parsed.success) {
    throw new CollectorRejection("invalid_input", "invalid feedback body");
  }
  const assembled = await assembleFeedback(parsed.data, {
    caller,
    blobPrepare: {
      prepare: (input, bytes) => prepareViaStream(session, input, bytes),
    },
    principal: "collector",
    nowAt: atNow(),
    redact: async (body, mediaType) =>
      (await redactOutcome(redaction, body, mediaType)).value,
    detailCollection: await logs.detailCollection(),
    lookupProblem: coreProblemLookup(client),
    logSource: logs.source,
  });
  if (!assembled.ok) {
    throw new CollectorRejection(assembled.error.code, assembled.error.message);
  }
  return await deliver(
    client,
    queue,
    assembled.value.input,
    assembled.value.prepared,
  );
}

// collector의 준비 폴더 출처. bundleCopyPath가 `apps/<app>/bundles/<hash>`를 붙이므로
// 여기 값은 LOPHN_HOME이다. env가 없으면 null이다.
function collectorAppsRoot(): string | null {
  try {
    const home = Deno.env.get("LOPHN_HOME");
    if (home === undefined || !home.startsWith("/")) return null;
    return home;
  } catch {
    return null;
  }
}

// blob 준비를 stream으로 받는 platform blob prepare 모양. 바이트를 모아 크기를
// 정한 뒤 감독 pipe의 blob 준비 통로로 core에 청한다. principal·expectedHash는 core가
// kind에서 정하므로 보내지 않는다. 준비가 실패하면 오류를 돌려주고 남은 자료로 접수한다.
async function prepareViaStream(
  session: Pick<ChildSession, "prepareBlob">,
  input: { principal: string; purpose: string; expectedHash?: string },
  bytes: ReadableStream<Uint8Array>,
): Promise<Result<PreparedSnapshotBlob>> {
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

// 실제 연결한 invocation ID만 기록 도착을 확인한다. 근접 추정은 없다. 기록이 아직 없으면
// false이고 접수는 계속한다.
async function confirmInvocation(
  client: CoreClientOptions,
  id: string,
): Promise<boolean> {
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
      body: JSON.stringify({ invocation: id }),
    });
    if (response.status !== 200) return false;
    const body = JSON.parse(new TextDecoder().decode(response.bytes)) as {
      invocation?: unknown;
    };
    const row = body.invocation as { id?: unknown } | null | undefined;
    return row !== null && row !== undefined && row.id === id;
  } catch {
    return false;
  }
}

// launchArgv가 내는 argv의 entry는 이 모듈 자체다(worker main과 다른 갈래).
if (import.meta.main) {
  await runCollectorWorker();
}
