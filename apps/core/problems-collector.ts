// report collector의 core 쪽 연결(problems#T3). 제품 core가 감독하는 상시 worker kind
// `problems/report-collector`로 문제 보고 worker route를 넘기는 target과, collector가 core에
// 제출할 때 쓰는 machine credential의 operation 목록이다.
import { ok } from "../../packages/base/mod.ts";
import { appLogs, invocationsGet } from "../../packages/protocol/apps/mod.ts";
import {
  getProblem,
  observeException,
  observeViewError,
  recordReport,
  REPORTING_LIMITS,
  reportProblem,
  submitFeedback,
} from "../../packages/protocol/problems/mod.ts";
import { settingsGet } from "../../packages/protocol/platform/mod.ts";
import type {
  HealthObservation,
  WorkerRequest,
} from "../../packages/protocol/platform/mod.ts";
import type { OperationPolicy } from "../../packages/core/server/identity/mod.ts";
import type { WorkerRouteTarget } from "../../packages/core/supervision/responsiveness/mod.ts";
import type { DocumentsChannel } from "./documents-serving.ts";

// collector가 core loopback에 낼 수 있는 operation. 보고 제출, 자기 credential의 앱 log 읽기,
// 접수 때 읽는 invocation 도착·상세 수집 설정·feedback이 고른 기존 문제다.
export const COLLECTOR_CREDENTIAL_OPERATIONS = [
  recordReport.name,
  appLogs.name,
  invocationsGet.name,
  settingsGet.name,
  getProblem.name,
];

// registry 상한. appLogs와 앱 보고 operation 정책은 apps 쪽이 이미 둔다. machine은 command
// kind만 받으므로 collector가 읽는 read operation도 command kind로 올린다.
export function collectorOperationPolicies(): OperationPolicy[] {
  return [
    recordReport.name,
    invocationsGet.name,
    settingsGet.name,
    getProblem.name,
  ].map((name): OperationPolicy => ({
    name,
    actors: ["machine"],
    kind: "command",
  }));
}

// collector로 가는 worker route. key는 `<resource>/<method>`다.
export const COLLECTOR_ROUTES = [
  reportProblem,
  observeException,
  observeViewError,
  submitFeedback,
];

// 앱 credential에 발급 때 고정된 보고 위치 주장. 요청 본문이 아니라 credential에서만 온다.
const CLAIM_KEYS = [
  "app",
  "release",
  "process",
  "mode",
  "bundle_hash",
  "diagnostic_scope",
] as const;

// collector 접수 한 건의 기한. snapshot 조립 2초와 blob 준비를 넉넉히 덮는다.
const COLLECTOR_TIMEOUT_MS = 15_000;

// shell main이 받는 user credential의 process 조건(core/parent.ts greet).
const SHELL_PROCESS = "electron-main";
// 바이트 body를 감독 pipe의 byte frame으로 나누는 크기.
const BYTE_FRAME_BYTES = 256 * 1024;

export type CollectorWorkersDeps = {
  // collector 감독 pipe의 요청 통로. 감독이 child를 띄우면 bind된다.
  channel: DocumentsChannel;
  observation(): HealthObservation;
  // 요청 credential의 현재 actor와 조건. 폐기·만료된 자격은 undefined다.
  callerOf(
    request: WorkerRequest,
  ): { actor: string; conditions: Record<string, unknown> } | undefined;
  // 감독 pipe의 byte chunk frame. 보내지 못하면 false다.
  sendBytes(channel: number, chunk: Uint8Array): Promise<boolean>;
};

// 요청마다 credential의 위치 주장을 payload 옆에 붙여 collector로 넘긴다. collector 하나가
// 여러 앱의 보고를 받으므로 위치는 hello가 아니라 요청이 싣는다. 본문은 그대로 `body`다.
export function collectorWorkers(
  deps: CollectorWorkersDeps,
): ReadonlyMap<string, WorkerRouteTarget> {
  let channelCounter = 0;
  const target: WorkerRouteTarget = {
    handle: {
      observation: deps.observation,
      async forward(request, bytes) {
        const caller = deps.callerOf(request);
        const conditions = caller?.conditions;
        if (caller === undefined || conditions === undefined) {
          return ok({
            type: "worker_response",
            request_id: request.request_id,
            ok: false,
            error: { code: "unauthorized", message: "credential이 없다" },
          });
        }
        const claims: Record<string, string> = {};
        for (const key of CLAIM_KEYS) {
          const value = conditions[key];
          if (typeof value === "string") claims[key] = value;
        }
        // 바이트 body(feedback PNG)는 해석 없이 byte frame으로 먼저 보내고, 요청이 그 channel을
        // 가리킨다. 감독 pipe는 순서대로 읽으므로 요청이 처리될 때는 바이트가 이미 와 있다.
        let streamed: number | undefined;
        if (bytes !== undefined) {
          channelCounter = channelCounter % 0xffffffff + 1;
          streamed = channelCounter;
          for (let at = 0; at < bytes.length; at += BYTE_FRAME_BYTES) {
            if (
              !await deps.sendBytes(
                streamed,
                bytes.subarray(at, at + BYTE_FRAME_BYTES),
              )
            ) {
              return ok({
                type: "worker_response",
                request_id: request.request_id,
                ok: false,
                error: {
                  code: "unavailable",
                  message: "report collector에 바이트를 보내지 못했다",
                },
              });
            }
          }
        }
        const answer = await deps.channel.request(
          request.op,
          {
            request_claims: claims,
            caller: {
              actor: caller.actor,
              surface: conditions["process"] === SHELL_PROCESS
                ? "shell"
                : "other",
            },
            body: request.payload,
            ...(streamed === undefined ? {} : { bytes_channel: streamed }),
          },
          COLLECTOR_TIMEOUT_MS,
        );
        if (!answer.ok) {
          return ok({
            type: "worker_response",
            request_id: request.request_id,
            ok: false,
            error: { code: answer.error.code, message: answer.error.message },
          });
        }
        return ok({
          type: "worker_response",
          request_id: request.request_id,
          ok: true,
          payload: answer.value,
        });
      },
    },
    limits: { timeoutMs: COLLECTOR_TIMEOUT_MS + 1_000 },
  };
  // 선택한 PNG를 바이트 body로 받는 route만 상한을 둔다. 나머지는 JSON body만 받는다.
  const withBytes: WorkerRouteTarget = {
    ...target,
    limits: {
      ...target.limits,
      requestBytesMax: REPORTING_LIMITS.feedback_png_bytes,
    },
  };
  return new Map(
    COLLECTOR_ROUTES.map((route) =>
      [
        `${route.resource}/${route.method}`,
        route === submitFeedback ? withBytes : target,
      ] as const
    ),
  );
}
