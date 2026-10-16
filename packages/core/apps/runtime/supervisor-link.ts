// core 쪽 supervisor 제어 통로. platform 감독 pipe의 worker_request·worker_response 위에서
// control-protocol의 op를 보내고 답을 요청 id로 맞춘다. 연결(pipe)은 core 조립이 `bind`로
// 넣고, supervisor가 없거나 답하지 않으면 모든 요청이 unavailable이다. core는 supervisor의
// 메모리를 직접 읽지 않고 이 질의로만 현재 관측을 얻는다.
import { err, type LophnError, ok, type Result } from "../../../base/mod.ts";
import type { AppProcessLink } from "../ports.ts";
import type {
  RuntimeObservation,
  RuntimeReason,
} from "../../../protocol/apps/mod.ts";
import {
  activationOpenOutputSchema,
  activationPauseOutputSchema,
  activationPrepareOutputSchema,
  activationResumeOutputSchema,
  applyOutputSchema,
  blockOutputSchema,
  callOutputSchema,
  dataJobOutputSchema,
  logsOutputSchema,
  type LogsWire,
  type ObservationWire,
  observeOutputSchema,
  type PreviewLaunch,
  previewStartOutputSchema,
  previewStopOutputSchema,
  reconcileOutputSchema,
  releaseCancelOutputSchema,
  releasePreparationOutputSchema,
  type ReleasePreparationWire,
  restartOutputSchema,
  SUPERVISOR_OPS,
} from "./control-protocol.ts";
import type { DesiredApp } from "./supervisor/supervisor.ts";
import { APPLY_TIMEOUT_MS, CALL_TIMEOUT_MS } from "./supervisor/relay.ts";

const REQUEST_TIMEOUT_MS = 5_000;
// 재시작은 이전 자식의 정지 유예(10초)와 종료 확인까지 기다린다.
const RESTART_TIMEOUT_MS = 30_000;
// preview 종료도 정지 유예와 종료 확인까지 기다린다.
const PREVIEW_STOP_TIMEOUT_MS = 30_000;
// 준비 취소는 자식 종료 확인까지 기다린다.
const RELEASE_CANCEL_TIMEOUT_MS = 30_000;
// activation의 자식 종료 확인·후보 준비 확인(ready 기한 30초와 정지 유예)을 기다린다.
const ACTIVATION_TIMEOUT_MS = 90_000;
// data worker 작업은 backup·migration·restore가 끝날 때까지 기다린다.
const DATA_JOB_TIMEOUT_MS = 300_000;
// 호출·적용은 supervisor가 앱 process를 기다리는 시간에 pipe 왕복 여유를 더한다.
const CALL_REQUEST_TIMEOUT_MS = CALL_TIMEOUT_MS + 5_000;
const APPLY_REQUEST_TIMEOUT_MS = APPLY_TIMEOUT_MS + 5_000;

type WorkerResponse =
  | { type: "worker_response"; request_id: string; ok: true; payload: unknown }
  | {
    type: "worker_response";
    request_id: string;
    ok: false;
    error: { code: string; message: string };
  };

export type SupervisorChannel = {
  request(
    op: string,
    payload: unknown,
    timeoutMs?: number,
  ): Promise<Result<unknown>>;
  // 요청이 아닌 message(app_credential_response 같은 답)를 supervisor에 보낸다.
  notify(payload: unknown): Promise<boolean>;
  // 감독 callback이 자식 message를 넘긴다. worker_response를 소비했으면 true다.
  onMessage(message: { type: string }): boolean;
  // pipe로 frame을 쓰는 함수. false면 보내지 못한 것이다.
  bind(send: (payload: unknown) => Promise<boolean>): void;
  // supervisor가 멈췄다. 기다리던 요청은 unavailable로 끝난다.
  unbind(): void;
  // supervisor child가 끝났다(crash·재기동). 보낸 요청은 답이 오지 않으므로 기한(5초·재시작 30초)까지
  // 기다리지 않고 바로 unavailable로 끝낸다. 연결(bind)은 그대로다: 감독이 새 child를 띄운다.
  failPending(message: string): void;
  readonly bound: boolean;
};

export function createSupervisorChannel(): SupervisorChannel {
  let send: ((payload: unknown) => Promise<boolean>) | null = null;
  let counter = 0;
  const pending = new Map<string, (answer: Result<unknown>) => void>();
  // 보낸 요청이 답 없이 끝났다. 앱 process까지 갔을 수 있다(`details.sent`).
  const SENT = { sent: true };
  function failPending(message: string) {
    for (const [id, settle] of [...pending]) {
      pending.delete(id);
      settle(err({ code: "unavailable", message, details: SENT }));
    }
  }
  return {
    request(op, payload, timeoutMs = REQUEST_TIMEOUT_MS) {
      const sender = send;
      if (sender === null) {
        return Promise.resolve(err({
          code: "unavailable",
          message: "app supervisor is not ready",
        }));
      }
      counter += 1;
      const id = `apps-request-${counter}`;
      return new Promise<Result<unknown>>((resolve) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          resolve(err({
            code: "unavailable",
            message: "app supervisor did not answer in time",
            details: SENT,
          }));
        }, timeoutMs);
        pending.set(id, (answer) => {
          clearTimeout(timer);
          resolve(answer);
        });
        sender({ type: "worker_request", request_id: id, op, payload }).then(
          (sent) => {
            if (sent) return;
            const settle = pending.get(id);
            pending.delete(id);
            settle?.(err({
              code: "unavailable",
              message: "request could not be sent to the app supervisor",
            }));
          },
          () => {
            const settle = pending.get(id);
            pending.delete(id);
            settle?.(err({
              code: "unavailable",
              message: "request could not be sent to the app supervisor",
            }));
          },
        );
      });
    },
    notify(payload) {
      return send === null ? Promise.resolve(false) : send(payload);
    },
    onMessage(message) {
      if (message.type !== "worker_response") return false;
      const response = message as WorkerResponse;
      const settle = pending.get(response.request_id);
      if (!settle) return false;
      pending.delete(response.request_id);
      settle(
        response.ok ? ok(response.payload) : err({
          code: response.error.code as "unavailable",
          message: "app supervisor rejected the request",
        }),
      );
      return true;
    },
    bind(next) {
      send = next;
    },
    failPending,
    unbind() {
      send = null;
      failPending("app supervisor stopped");
    },
    get bound() {
      return send !== null;
    },
  };
}

function shaped<T>(
  schema: {
    safeParse(
      value: unknown,
    ): { success: true; data: T } | { success: false };
  },
  answer: Result<unknown>,
): Result<T> {
  if (!answer.ok) return answer;
  const parsed = schema.safeParse(answer.value);
  return parsed.success
    ? ok(parsed.data)
    : err({ code: "unavailable", message: "app supervisor answered badly" });
}

export type SupervisorClient = {
  reconcile(desired: DesiredApp): Promise<Result<void>>;
  observe(app: string): Promise<Result<ObservationWire | null>>;
  logs(
    app: string,
    query: {
      invocation?: string;
      limit: number;
      max_bytes?: number;
      cursor?: string;
    },
  ): Promise<Result<LogsWire>>;
  restart(app: string, processNonce: string): Promise<Result<boolean>>;
  // 그 앱의 broker 연결을 새 요청부터 막고 막은 연결 수를 돌려준다.
  block(app: string): Promise<Result<number>>;
  // preview 프로세스. 운영 자식과 다른 통로이고 운영 관측을 바꾸지 않는다(apps/preview).
  previewStart(launch: PreviewLaunch): Promise<Result<void>>;
  previewObserve(
    app: string,
    processNonce: string,
  ): Promise<Result<ObservationWire | null>>;
  previewStop(app: string, processNonce: string): Promise<Result<boolean>>;
  // release 준비. 진행은 supervisor 메모리라 supervisor가 없으면 unavailable이다.
  releasePrepare(input: {
    app: string;
    commit: string;
    request_key: string;
    source_path: string;
  }): Promise<Result<ReleasePreparationWire>>;
  releasePreparation(
    app: string,
    requestKey: string,
  ): Promise<Result<ReleasePreparationWire>>;
  releaseCancel(app: string, requestKey: string): Promise<Result<void>>;
  // activation. 앱을 붙들고 자식 종료를 확인한다(true만 확인).
  activationPause(app: string): Promise<Result<boolean>>;
  // 후보를 준비 모드로 시작한다. 검사를 통과하면 확인을, 아니면 이유를 낸다.
  activationPrepare(desired: DesiredApp): Promise<
    Result<
      | {
        ok: true;
        processNonce: string;
        attestation: {
          release: string;
          bundleHash: string;
          commands: string[];
          dataSchema: number;
        };
      }
      | { ok: false; reason: string }
    >
  >;
  activationOpen(app: string): Promise<Result<boolean>>;
  activationResume(app: string): Promise<Result<void>>;
  // 앱 전용 data worker 작업 한 번(backup·migrate·restore). 성공이면 출력 한 줄이다.
  dataJob(app: string, line: string): Promise<Result<string>>;
};

export function createSupervisorClient(
  channel: SupervisorChannel,
): SupervisorClient {
  return {
    async reconcile(desired) {
      const answer = shaped(
        reconcileOutputSchema,
        await channel.request(SUPERVISOR_OPS.reconcile, desired),
      );
      return answer.ok ? ok(undefined) : answer;
    },
    async observe(app) {
      const answer = shaped(
        observeOutputSchema,
        await channel.request(SUPERVISOR_OPS.observe, { app }),
      );
      return answer.ok ? ok(answer.value.observation) : answer;
    },
    async logs(app, query) {
      return shaped(
        logsOutputSchema,
        await channel.request(SUPERVISOR_OPS.logs, { app, ...query }),
      );
    },
    async restart(app, processNonce) {
      const answer = shaped(
        restartOutputSchema,
        await channel.request(
          SUPERVISOR_OPS.restart,
          { app, process_nonce: processNonce },
          RESTART_TIMEOUT_MS,
        ),
      );
      return answer.ok ? ok(answer.value.restarted) : answer;
    },
    async block(app) {
      const answer = shaped(
        blockOutputSchema,
        await channel.request(SUPERVISOR_OPS.block, { app }),
      );
      return answer.ok ? ok(answer.value.blocked) : answer;
    },
    async previewStart(launch) {
      const answer = shaped(
        previewStartOutputSchema,
        await channel.request(SUPERVISOR_OPS.previewStart, launch),
      );
      return answer.ok ? ok(undefined) : answer;
    },
    async previewObserve(app, processNonce) {
      const answer = shaped(
        observeOutputSchema,
        await channel.request(SUPERVISOR_OPS.previewObserve, {
          app,
          process_nonce: processNonce,
        }),
      );
      return answer.ok ? ok(answer.value.observation) : answer;
    },
    async previewStop(app, processNonce) {
      const answer = shaped(
        previewStopOutputSchema,
        await channel.request(
          SUPERVISOR_OPS.previewStop,
          { app, process_nonce: processNonce },
          PREVIEW_STOP_TIMEOUT_MS,
        ),
      );
      return answer.ok ? ok(answer.value.stopped) : answer;
    },
    async releasePrepare(input) {
      return shaped(
        releasePreparationOutputSchema,
        await channel.request(SUPERVISOR_OPS.releasePrepare, input),
      );
    },
    async releasePreparation(app, requestKey) {
      return shaped(
        releasePreparationOutputSchema,
        await channel.request(SUPERVISOR_OPS.releasePreparation, {
          app,
          request_key: requestKey,
        }),
      );
    },
    async activationPause(app) {
      const answer = shaped(
        activationPauseOutputSchema,
        await channel.request(
          SUPERVISOR_OPS.activationPause,
          { app },
          ACTIVATION_TIMEOUT_MS,
        ),
      );
      return answer.ok ? ok(answer.value.confirmed) : answer;
    },
    async activationPrepare(desired) {
      const answer = shaped(
        activationPrepareOutputSchema,
        await channel.request(
          SUPERVISOR_OPS.activationPrepare,
          desired,
          ACTIVATION_TIMEOUT_MS,
        ),
      );
      if (!answer.ok) return answer;
      return ok(
        answer.value.ok
          ? {
            ok: true as const,
            processNonce: answer.value.process_nonce,
            attestation: {
              release: answer.value.attestation.release,
              bundleHash: answer.value.attestation.bundle_hash,
              commands: answer.value.attestation.commands,
              dataSchema: answer.value.attestation.data_schema,
            },
          }
          : { ok: false as const, reason: answer.value.reason },
      );
    },
    async activationOpen(app) {
      const answer = shaped(
        activationOpenOutputSchema,
        await channel.request(
          SUPERVISOR_OPS.activationOpen,
          { app },
          ACTIVATION_TIMEOUT_MS,
        ),
      );
      return answer.ok ? ok(answer.value.opened) : answer;
    },
    async activationResume(app) {
      const answer = shaped(
        activationResumeOutputSchema,
        await channel.request(
          SUPERVISOR_OPS.activationResume,
          { app },
          ACTIVATION_TIMEOUT_MS,
        ),
      );
      return answer.ok ? ok(undefined) : answer;
    },
    async dataJob(app, line) {
      const answer = shaped(
        dataJobOutputSchema,
        await channel.request(
          SUPERVISOR_OPS.dataJob,
          { app, line },
          DATA_JOB_TIMEOUT_MS,
        ),
      );
      if (!answer.ok) return answer;
      return answer.value.ok && answer.value.line !== null
        ? ok(answer.value.line)
        : err({ code: "unavailable", message: "data job failed" });
    },
    async releaseCancel(app, requestKey) {
      const answer = shaped(
        releaseCancelOutputSchema,
        await channel.request(
          SUPERVISOR_OPS.releaseCancel,
          { app, request_key: requestKey },
          RELEASE_CANCEL_TIMEOUT_MS,
        ),
      );
      return answer.ok ? ok(undefined) : answer;
    },
  };
}

// core가 앱 process를 부르는 길이다. supervisor 제어 pipe의 `apps.call`·`apps.apply`를 보낸다.
// supervisor가 없거나 앱에 보내기 전에 거절하면 `sent: false`이고, 보낸 뒤 답이 끊기면 `response: null`이다.
export function createAppProcessLink(
  channel: SupervisorChannel,
): AppProcessLink {
  return {
    async call(target, request) {
      const answer = await channel.request(
        SUPERVISOR_OPS.call,
        { target, request },
        CALL_REQUEST_TIMEOUT_MS,
      );
      if (!answer.ok) {
        // pipe 쪽에서 끊기거나 시간이 넘은 요청은 supervisor가 앱까지 보냈는지 모른다.
        return answer.error.details?.sent === true
          ? { sent: true, response: null }
          : { sent: false, error: answer.error };
      }
      const parsed = callOutputSchema.safeParse(answer.value);
      if (!parsed.success) {
        return {
          sent: false,
          error: {
            code: "unavailable",
            message: "app supervisor answered badly",
          } satisfies LophnError,
        };
      }
      return parsed.data.sent
        ? { sent: true, response: parsed.data.response }
        : { sent: false, error: parsed.data.error };
    },
    async apply(app, request) {
      return shaped(
        applyOutputSchema,
        await channel.request(
          SUPERVISOR_OPS.apply,
          { app, request },
          APPLY_REQUEST_TIMEOUT_MS,
        ),
      );
    },
  };
}

// connect 어댑터가 읽는 프로세스 출처. 자식이 없거나 다른 nonce인 질의는 값 없음이다.

const STARTING: RuntimeReason = {
  code: "starting",
  summary: "the app process has not passed its readiness check",
};
const NOT_RUNNING: RuntimeReason = {
  code: "not_running",
  summary: "no app process is running",
};

// supervisor의 현재 프로세스를 RuntimeObservation 값으로 바꾼다. 그 release가 아직 없는
// 관측은 값이 아니다(live는 release가 필수다). endpoint는 read로 내보내지 않는다:
// 연결 주소는 인증된 connect만 받는다.
export function runtimeObservationOf(
  wire: ObservationWire,
): RuntimeObservation | null {
  if (wire.release === null) return null;
  // 자식이 없고 붙일 근거(crash loop 같은 멈춘 이유)도 없으면 관측이 아니다.
  if (wire.process_nonce === "" && wire.reason === undefined) return null;
  const reason = wire.ready ? wire.reason : (wire.reason ??
    (wire.process_nonce === "" ? NOT_RUNNING : STARTING));
  return {
    app: wire.app,
    release: wire.release,
    mode: wire.mode,
    process_nonce: wire.process_nonce === "" ? "none" : wire.process_nonce,
    endpoint: null,
    ready: wire.ready,
    accepting: wire.accepting,
    ...(reason ? { reason } : {}),
  };
}
