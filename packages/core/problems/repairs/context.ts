// repair context의 core 쪽 연결(coding-agent#T43). `/v1/repair_context/summary|bundle|more`는 coding-agent
// worker가 조립한다. core는 요청자 connection의 credential(Bearer token)을 요청마다 worker에 실어 보내고,
// worker가 그 credential로 core loopback에서 정본을 읽게 한다. worker는 자기 machine credential이 없어
// 범위 밖 근거를 대신 읽을 수 없다. 응답은 route output(공통 필드 포함)으로 검증된다.
import { err, ok, type Result } from "../../../base/mod.ts";
import {
  codingAgentSessionSummary,
  REPAIR_CONTEXT_ROUTES,
} from "../../../protocol/coding-agent/mod.ts";
import type { KindLaunchSpec } from "../../../protocol/server/mod.ts";
import { checkLaunchSpec } from "../../supervision/security/mod.ts";
import type { DocumentsChannel } from "../../projects/file-tracking/coordinator/serving.ts";
import type { CoreRuntime } from "../../main/daemon/runtime.ts";

export const REPAIR_WORKER_KIND = "coding-agent/worker";
// worker 요청 op. apps/worker/coding-agent/repair-context.ts의 REPAIR_CONTEXT_OPS와 같은 값이다.
const REPAIR_OP_PREFIX = "repair_context.";
const REPAIR_REQUEST_MS = 30_000;

// worker는 core loopback에만 닿고 읽기·쓰기·실행 권한이 없다. ledger·blob·source를 열지 않는다.
export function repairWorkerSpec(): KindLaunchSpec | undefined {
  const spec: KindLaunchSpec = {
    kind: REPAIR_WORKER_KIND,
    entry: new URL(
      "./worker/context.ts",
      import.meta.url,
    )
      .pathname,
    allow_read: [],
    allow_write: [],
    allow_net: ["127.0.0.1"],
    allow_run: [],
    allow_sys: [],
    allow_env: ["LOPHN_HOME", "LOPHN_WORKER_KIND"],
    policy: "always",
    memory_limit_bytes: 268_435_456,
  };
  const checked = checkLaunchSpec(spec);
  return checked.ok ? checked.value : undefined;
}

// 세 route의 handler를 worker 통로로 붙인다. credential이 없거나 이미 회수됐으면 보내지 않는다.
export function registerRepairReads(
  runtime: CoreRuntime,
  channel: DocumentsChannel,
): void {
  for (const route of REPAIR_CONTEXT_ROUTES) {
    runtime.reads.set(
      `${route.resource}/${route.method}`,
      async (ctx, input, credential): Promise<Result<unknown>> => {
        const unauthorized = () =>
          err({
            code: "unauthorized" as const,
            message: "credential이 현재 유효하지 않다",
          });
        if (!credential || !runtime.current(ctx.credential_ref).ok) {
          return unauthorized();
        }
        const answer = await channel.request(
          `${REPAIR_OP_PREFIX}${route.method}`,
          { credential, principal: ctx.principal, input },
          REPAIR_REQUEST_MS,
        );
        // 읽는 동안 회수됐으면 응답을 내보내지 않는다.
        if (!runtime.current(ctx.credential_ref).ok) return unauthorized();
        return answer.ok ? ok(answer.value) : answer;
      },
    );
  }
}

// worker 요청 op. apps/worker/coding-agent/session-summary.ts의 SESSION_SUMMARY_OP와 같은 값이다.
const SESSION_SUMMARY_OP = "coding_agent_sessions.summary";

// 세션 시작 summary(`/v1/coding_agent_sessions/summary`)의 handler를 같은 worker 통로로 붙인다
// (coding-agent#T35). 요청자 credential을 요청마다 싣고, 이미 회수됐으면 보내지 않는다.
export function registerSessionReads(
  runtime: CoreRuntime,
  channel: DocumentsChannel,
): void {
  const route = codingAgentSessionSummary;
  runtime.reads.set(
    `${route.resource}/${route.method}`,
    async (ctx, input, credential): Promise<Result<unknown>> => {
      const unauthorized = () =>
        err({
          code: "unauthorized" as const,
          message: "credential이 현재 유효하지 않다",
        });
      if (!credential || !runtime.current(ctx.credential_ref).ok) {
        return unauthorized();
      }
      const answer = await channel.request(
        SESSION_SUMMARY_OP,
        { credential, principal: ctx.principal, input },
        REPAIR_REQUEST_MS,
      );
      if (!runtime.current(ctx.credential_ref).ok) return unauthorized();
      return answer.ok ? ok(answer.value) : answer;
    },
  );
}
