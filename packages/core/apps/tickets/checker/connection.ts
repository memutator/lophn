// ticket checker의 core 쪽 연결(coding-agent#T26). 제품 core가 감독하는 상시 worker kind
// `coding-agent/checker`의 launch spec, 그 worker가 core에 낼 수 있는 machine credential의
// operation, 그리고 worker를 깨우는 core 안 구독자(machine:ticket-check-feed)다.
// event는 깨우는 신호이고 payload로 상태를 만들지 않는다: worker가 정본을 다시 읽는다.
import { ok } from "../../../../base/mod.ts";
import { ticketCheckWork } from "./work.ts";
import {
  ticketCompletionReported,
  ticketRecordChecks,
} from "../../../../protocol/coding-agent/mod.ts";
import {
  releaseActivated,
  releaseSuperseded,
} from "../../../../protocol/apps/mod.ts";
import {
  problemClosed,
  problemConfirmationRecorded,
  problemReopened,
  verificationRecorded,
} from "../../../../protocol/problems/mod.ts";
import type {
  EventVisibilityDefinition,
  RequestContext,
} from "../../../../protocol/server/mod.ts";
import type { EventDefinition } from "../../../../protocol/events/mod.ts";
import type { KindLaunchSpec } from "../../../../protocol/supervision/mod.ts";
import type { OperationPolicy } from "../../../server/identity/mod.ts";
import { checkLaunchSpec } from "../../../supervision/security/mod.ts";
import {
  type InternalSubscription,
  openInternalSubscription,
} from "../../../events/internal-subscription.ts";
import type { CoreRuntime } from "../../../main/daemon/runtime.ts";
import {
  TICKET_CHECK_FEED_PRINCIPAL,
  TICKET_CHECKER_PRINCIPAL,
} from "./ids.ts";

export const TICKET_CHECKER_KIND = "coding-agent/checker";
// worker 깨움 요청 op. packages/core/apps/tickets/worker/checker.ts와 같은 값이다.
export const TICKET_CHECK_OP = "tickets.check";
export { TICKET_CHECK_FEED_PRINCIPAL, TICKET_CHECKER_PRINCIPAL };

// worker가 core loopback에 낼 수 있는 operation: 판정 사실 read와 결과 기록 command.
export const TICKET_CHECKER_OPERATIONS = [
  ticketCheckWork.name,
  ticketRecordChecks.name,
];

// machine은 command kind만 받으므로 worker가 읽는 read operation도 command kind로 올린다.
export function ticketCheckerPolicies(): OperationPolicy[] {
  return TICKET_CHECKER_OPERATIONS.map((name): OperationPolicy => ({
    name,
    actors: ["machine"],
    kind: "command",
  }));
}

// checker worker는 core loopback에만 닿고 읽기·쓰기·실행 권한이 없다. ledger·blob·source를
// 열지 않는다(architecture/coding-agent 2.2: worker는 core loopback net과 작업 credential만).
export function ticketCheckerSpec(input: {
  dataRoot: string;
}): KindLaunchSpec | undefined {
  if (!input.dataRoot.startsWith("/")) return undefined;
  const entry = new URL(
    "../worker/checker.ts",
    import.meta.url,
  )
    .pathname;
  const spec: KindLaunchSpec = {
    kind: TICKET_CHECKER_KIND,
    entry,
    allow_read: [],
    allow_write: [],
    allow_net: ["127.0.0.1"],
    allow_run: [],
    allow_sys: [],
    allow_env: ["LOPHN_HOME", "LOPHN_WORKER_KIND"],
    policy: "always",
    memory_limit_bytes: 134_217_728,
  };
  const checked = checkLaunchSpec(spec);
  return checked.ok ? checked.value : undefined;
}

// 구독자의 자격. core가 ledger credential 기록으로 심고 token이 없다. HTTP로는 이 principal이
// 될 수 없다.
export const TICKET_CHECK_FEED_CONTEXT: RequestContext = {
  principal: TICKET_CHECK_FEED_PRINCIPAL,
  actor: "machine",
  scope: { operations: ["ListEvents"], targets: {} },
  conditions: {},
  credential_ref: TICKET_CHECK_FEED_PRINCIPAL,
};

export function isTicketCheckFeed(ctx: RequestContext): boolean {
  return ctx.actor === "machine" &&
    ctx.principal === TICKET_CHECK_FEED_PRINCIPAL &&
    ctx.credential_ref === TICKET_CHECK_FEED_PRINCIPAL;
}

// 보고된 ticket의 조건을 다시 비교하게 하는 event다(R20). 이 밖의 event는 feed에도 닫혀 있다.
const WAKE_EVENTS: readonly EventDefinition[] = [
  ticketCompletionReported,
  verificationRecorded,
  problemClosed,
  problemReopened,
  // 열린 문제에 사람이 "아직입니다"(not_fixed)라고 한 결정은 human_confirmation의 실패다.
  problemConfirmationRecorded,
  releaseActivated,
  releaseSuperseded,
];
const WAKE_TYPES: ReadonlySet<string> = new Set(
  WAKE_EVENTS.map((event) => event.type),
);

export function isTicketCheckWake(type: string): boolean {
  return WAKE_TYPES.has(type);
}

// 정책이 없던 event를 feed에게만 연다. 사람·agent·app·다른 machine은 정책이 없을 때와
// 똑같이 못 본다.
export function ticketCheckFeedVisibility<D extends EventDefinition>(
  event: D,
): EventVisibilityDefinition<D> {
  return { event, handle: (_snapshot, ctx) => ok(isTicketCheckFeed(ctx)) };
}

export type TicketCheckFeedDeps = {
  runtime: Pick<CoreRuntime, "events" | "track">;
  // worker에게 비교를 청한다. worker가 없거나 답하지 못하면 실패는 다음 깨움이 잇는다.
  wake(): Promise<unknown>;
  // 한 묶음의 event가 몰릴 때 한 번만 깨우는 대기.
  debounceMs?: number;
  retryMs?: number;
};

export function startTicketCheckFeed(
  deps: TicketCheckFeedDeps,
): InternalSubscription {
  const debounceMs = deps.debounceMs ?? 100;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const wake = () => {
    if (stopped) return;
    void deps.wake().catch(() => undefined);
  };
  const subscription = openInternalSubscription({
    context: TICKET_CHECK_FEED_CONTEXT,
    backend: deps.runtime.events,
    track: (session) => deps.runtime.track(session),
    retryMs: deps.retryMs,
    // 구독이 닫혀 있던 동안의 변화는 worker가 정본을 다시 읽어 따라잡는다.
    onSubscribed: wake,
    onEvents(events) {
      if (!events.some((event) => isTicketCheckWake(event.type))) return;
      clearTimeout(timer);
      timer = setTimeout(wake, debounceMs);
    },
  });
  return {
    listen: subscription.listen,
    get open() {
      return subscription.open;
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
      subscription.stop();
    },
  };
}
