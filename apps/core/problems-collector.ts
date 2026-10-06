// report collector의 core 쪽 연결(problems#T3). 제품 core가 감독하는 상시 worker kind
// `problems/report-collector`로 문제 보고 worker route를 넘기는 target과, collector가 core에
// 제출할 때 쓰는 machine credential의 operation 목록이다.
import { ok } from "../../packages/base/mod.ts";
import { appLogs } from "../../packages/contracts/apps/mod.ts";
import {
  observeException,
  recordReport,
  reportProblem,
} from "../../packages/contracts/problems/mod.ts";
import type {
  HealthObservation,
  WorkerRequest,
} from "../../packages/contracts/platform/mod.ts";
import type { OperationPolicy } from "../../packages/platform/identity/mod.ts";
import type { WorkerRouteTarget } from "../../packages/platform/responsiveness/mod.ts";
import type { DocumentsChannel } from "./documents-serving.ts";

// collector가 core loopback에 낼 수 있는 operation. 보고 제출과 자기 credential의 앱 log 읽기다.
export const COLLECTOR_CREDENTIAL_OPERATIONS = [
  recordReport.name,
  appLogs.name,
];

// registry 상한. appLogs와 앱 보고 operation 정책은 apps 쪽이 이미 둔다.
export function collectorOperationPolicies(): OperationPolicy[] {
  return [{ name: recordReport.name, actors: ["machine"], kind: "command" }];
}

// collector로 가는 worker route. key는 `<resource>/<method>`다.
export const COLLECTOR_ROUTES = [reportProblem, observeException];

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

export type CollectorWorkersDeps = {
  // collector 감독 pipe의 요청 통로. 감독이 child를 띄우면 bind된다.
  channel: DocumentsChannel;
  observation(): HealthObservation;
  // 요청 credential의 현재 조건. 폐기·만료된 자격은 undefined다.
  conditionsOf(request: WorkerRequest): Record<string, unknown> | undefined;
};

// 요청마다 credential의 위치 주장을 payload 옆에 붙여 collector로 넘긴다. collector 하나가
// 여러 앱의 보고를 받으므로 위치는 hello가 아니라 요청이 싣는다. 본문은 그대로 `body`다.
export function collectorWorkers(
  deps: CollectorWorkersDeps,
): ReadonlyMap<string, WorkerRouteTarget> {
  const target: WorkerRouteTarget = {
    handle: {
      observation: deps.observation,
      async forward(request) {
        const conditions = deps.conditionsOf(request);
        if (conditions === undefined) {
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
        const answer = await deps.channel.request(
          request.op,
          { request_claims: claims, body: request.payload },
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
  return new Map(
    COLLECTOR_ROUTES.map((route) =>
      [`${route.resource}/${route.method}`, target] as const
    ),
  );
}
