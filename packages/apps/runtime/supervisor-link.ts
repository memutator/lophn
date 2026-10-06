// core 쪽 supervisor 제어 통로. platform 감독 pipe의 worker_request·worker_response 위에서
// control-protocol의 op를 보내고 답을 요청 id로 맞춘다. 연결(pipe)은 core 조립이 `bind`로
// 넣고, supervisor가 없거나 답하지 않으면 모든 요청이 unavailable이다. core는 supervisor의
// 메모리를 직접 읽지 않고 이 질의로만 현재 관측을 얻는다.
import { err, ok, type Result } from "../../base/mod.ts";
import type {
  RuntimeObservation,
  RuntimeReason,
} from "../../contracts/apps/mod.ts";
import type {
  ProcessObservation,
  ProcessQuery,
  ProcessSource,
} from "./connect.ts";
import {
  blockOutputSchema,
  logsOutputSchema,
  type LogsWire,
  type ObservationWire,
  observeOutputSchema,
  type PreviewLaunch,
  previewStartOutputSchema,
  previewStopOutputSchema,
  reconcileOutputSchema,
  restartOutputSchema,
  SUPERVISOR_OPS,
} from "./control-protocol.ts";
import type { DesiredApp } from "./supervisor/supervisor.ts";

const REQUEST_TIMEOUT_MS = 5_000;
// 재시작은 이전 자식의 정지 유예(10초)와 종료 확인까지 기다린다.
const RESTART_TIMEOUT_MS = 30_000;
// preview 종료도 정지 유예와 종료 확인까지 기다린다.
const PREVIEW_STOP_TIMEOUT_MS = 30_000;

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
  readonly bound: boolean;
};

export function createSupervisorChannel(): SupervisorChannel {
  let send: ((payload: unknown) => Promise<boolean>) | null = null;
  let counter = 0;
  const pending = new Map<string, (answer: Result<unknown>) => void>();
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
    unbind() {
      send = null;
      for (const [id, settle] of [...pending]) {
        pending.delete(id);
        settle(err({
          code: "unavailable",
          message: "app supervisor stopped",
        }));
      }
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
  };
}

// connect 어댑터가 읽는 프로세스 출처. 자식이 없거나 다른 nonce인 질의는 값 없음이다.
export function processSourceOf(client: SupervisorClient): ProcessSource {
  return {
    async current(query: ProcessQuery) {
      // preview는 운영 자식과 따로 쥔 프로세스라 그 nonce로 묻는다. 운영 관측으로 대신하지 않는다.
      const found = query.mode === "preview"
        ? await client.previewObserve(query.app, query.nonce)
        : await client.observe(query.app);
      if (!found.ok) return found;
      const wire = found.value;
      if (
        wire === null || wire.process_nonce === "" ||
        wire.bundle_hash === null ||
        wire.endpoint === ""
      ) return ok(undefined);
      if (wire.mode !== query.mode) return ok(undefined);
      if (query.mode === "preview" && wire.process_nonce !== query.nonce) {
        return ok(undefined);
      }
      const process: ProcessObservation = {
        app: wire.app,
        mode: wire.mode,
        release: wire.release,
        bundleHash: wire.bundle_hash,
        processNonce: wire.process_nonce,
        endpoint: wire.endpoint,
        ready: wire.ready,
        accepting: wire.accepting,
        commands: wire.commands,
        screens: wire.screens as ProcessObservation["screens"],
      };
      return ok(process);
    },
    async restart(app, nonce) {
      const restarted = await client.restart(app, nonce);
      return restarted.ok ? ok(undefined) : restarted;
    },
  };
}

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
