// core가 supervisor 제어 pipe의 op로 보낸 호출, 뒤집은 changeset 적용, 폰 변경 적용, snapshot을 앱 process의
// control socket으로 중계한다. supervisor는 내용을 보지 않고 길만 이어 준다. 앱에 닿기 전에 실패했는지(`sent: false`)와
// 보낸 뒤 답을 받지 못했는지(`response: null`, 결과 모름)를 구별하는 것이 이 module의 일이다.
// socket I/O는 주입받는다.
import {
  type AppToolTarget,
  CALL_RESULT_MAX_BYTES,
  PROCESS_PATHS,
  type ProcessApplyRequest,
  type ProcessApplyResponse,
  processApplyResponseSchema,
  type ProcessCallRequest,
  type ProcessCallResponse,
  processCallResponseSchema,
  type ProcessSnapshotRequest,
  type ProcessSnapshotResponse,
  processSnapshotResponseSchema,
  type ProcessSyncApplyRequest,
  type ProcessSyncApplyResponse,
  processSyncApplyResponseSchema,
} from "../../../../protocol/apps/calls/mod.ts";
import { CALL_RESPONSE_MAX_BYTES } from "../../../../protocol/base/mod.ts";
import type { LophnError } from "../../../../base/mod.ts";
import type { ControlTarget } from "./supervisor.ts";
import type { z } from "zod";

// 호출 하나가 handler를 돌리는 시간의 상한이다. 넘으면 결과 모름이다.
export const CALL_TIMEOUT_MS = 120_000;
// 뒤집은 changeset 적용, 폰 변경 적용, snapshot 뜨기는 한 transaction(또는 VACUUM INTO 한 번)이다.
export const APPLY_TIMEOUT_MS = 60_000;

export type ControlRequest = {
  socket: string;
  path: string;
  body: string;
  timeoutMs: number;
  // 응답 본문의 상한(byte).
  maxBytes: number;
};

export type ControlReply =
  // 앱이 HTTP로 답했다.
  | { kind: "reply"; status: number; body: string }
  // 연결하지 못했다. 앱에는 아무것도 가지 않았다.
  | { kind: "not_sent" }
  // 보낸 뒤 연결이 끊기거나 시간이 넘었거나 응답이 상한을 넘었다.
  | { kind: "lost" };

export type ControlTransport = (
  request: ControlRequest,
) => Promise<ControlReply>;

type CallOutput =
  | { sent: false; error: LophnError }
  | { sent: true; response: ProcessCallResponse | null };

type Answer<T> = { ok: true; value: T } | { ok: false; error: LophnError };

type Relay = {
  call(target: AppToolTarget, request: ProcessCallRequest): Promise<CallOutput>;
  // 아래 셋은 live process에 간다. 닿지 못하면 `unavailable`이고 앱이 거절하면 그 오류다.
  apply(
    app: string,
    request: ProcessApplyRequest,
  ): Promise<Answer<ProcessApplyResponse>>;
  syncApply(
    app: string,
    request: ProcessSyncApplyRequest,
  ): Promise<Answer<ProcessSyncApplyResponse>>;
  snapshot(
    app: string,
    request: ProcessSnapshotRequest,
  ): Promise<Answer<ProcessSnapshotResponse>>;
};

function unavailable(message: string): { sent: false; error: LophnError } {
  return { sent: false, error: { code: "unavailable", message } };
}

// 앱이 handler에 닿기 전에 거절한 본문(`{error: {code, message}}`)을 오류로 읽는다.
function rejectionOf(status: number, body: string): LophnError {
  try {
    const error = (
      JSON.parse(body) as {
        error?: { code?: unknown; message?: unknown };
      }
    ).error;
    const codes = [
      "invalid_input",
      "unauthorized",
      "forbidden",
      "not_found",
      "conflict",
      "unavailable",
    ] as const;
    const code = codes.find((entry) => entry === error?.code);
    if (code !== undefined) {
      return {
        code,
        message:
          typeof error?.message === "string"
            ? error.message
            : "the app process refused the request",
      };
    }
  } catch {
    /* 본문이 JSON이 아니다 */
  }
  return {
    code: status === 400 ? "invalid_input" : "unavailable",
    message: "the app process refused the request",
  };
}

// 앱이 handler(또는 적용)에 닿기 전에 거절한 응답이다. 효과가 없었다.
function refused(status: number): boolean {
  return (status >= 400 && status < 500) || status === 503;
}

export function createRelay(deps: {
  transport: ControlTransport;
  live: (app: string) => ControlTarget | undefined;
  preview: (app: string, nonce: string) => string | undefined;
}): Relay {
  async function toLive<T>(
    app: string,
    path: string,
    request: unknown,
    schema: z.ZodType<T>,
  ): Promise<Answer<T>> {
    const live = deps.live(app);
    if (live === undefined) {
      return {
        ok: false,
        error: { code: "unavailable", message: "the app is not ready" },
      };
    }
    const reply = await deps.transport({
      socket: live.socket,
      path,
      body: JSON.stringify(request),
      timeoutMs: APPLY_TIMEOUT_MS,
      maxBytes: 4096,
    });
    if (reply.kind !== "reply") {
      return {
        ok: false,
        error: {
          code: "unavailable",
          message:
            reply.kind === "lost"
              ? "the app process did not answer"
              : "the app process did not accept the connection",
        },
      };
    }
    if (reply.status === 200) {
      try {
        const parsed = schema.safeParse(JSON.parse(reply.body));
        if (parsed.success) return { ok: true, value: parsed.data };
      } catch {
        /* 아래에서 unavailable이 된다 */
      }
    }
    return {
      ok: false,
      error: refused(reply.status)
        ? rejectionOf(reply.status, reply.body)
        : { code: "unavailable", message: "the app process answered badly" },
    };
  }
  return {
    async call(target, request) {
      const context = request.context;
      if (context.app !== target.app || context.mode !== target.mode) {
        return {
          sent: false,
          error: {
            code: "invalid_input",
            message: "the call context does not match its target",
          },
        };
      }
      let socket: string | undefined;
      if (target.mode === "live") {
        const live = deps.live(target.app);
        if (live === undefined) return unavailable("the app is not ready");
        if (target.release !== null && target.release !== live.release) {
          return unavailable("the target release is not running");
        }
        socket = live.socket;
      } else {
        socket = deps.preview(target.app, target.process_nonce);
        if (socket === undefined) {
          return unavailable("the preview process is not ready");
        }
      }
      const reply = await deps.transport({
        socket,
        path: PROCESS_PATHS.call,
        body: JSON.stringify(request),
        timeoutMs: CALL_TIMEOUT_MS,
        // 화면 operation의 응답만 control frame을 넘는다. 바깥 명령의 결과는 frame 하나에 든다.
        maxBytes:
          request.kind === "operation"
            ? CALL_RESULT_MAX_BYTES
            : CALL_RESPONSE_MAX_BYTES,
      });
      if (reply.kind === "not_sent") {
        return unavailable("the app process did not accept the connection");
      }
      if (reply.kind === "lost") return { sent: true, response: null };
      if (reply.status === 200) {
        try {
          const parsed = processCallResponseSchema.safeParse(
            JSON.parse(reply.body),
          );
          if (parsed.success) return { sent: true, response: parsed.data };
        } catch {
          /* 아래에서 결과 모름이 된다 */
        }
        return { sent: true, response: null };
      }
      if (refused(reply.status)) {
        return { sent: false, error: rejectionOf(reply.status, reply.body) };
      }
      return { sent: true, response: null };
    },
    apply: (app, request) =>
      toLive(app, PROCESS_PATHS.apply, request, processApplyResponseSchema),
    syncApply: (app, request) =>
      toLive(
        app,
        PROCESS_PATHS.sync_apply,
        request,
        processSyncApplyResponseSchema,
      ),
    snapshot: (app, request) =>
      toLive(
        app,
        PROCESS_PATHS.snapshot,
        request,
        processSnapshotResponseSchema,
      ),
  };
}
