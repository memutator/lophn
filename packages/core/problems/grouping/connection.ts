// `problems.work` 반응기의 core 쪽 연결. 반응기 자체는 제품 core가 감독하는 상시 worker
// kind `problems/test-runner` 안에서 돈다. 이 파일은 그 worker가 core에 낼 수 있는 machine credential의
// operation, ticket event를 worker 자격에게 여는 공개 정책, `problems.work` cursor 전진 자격, 그리고
// worker를 깨우는 core 안 구독자(machine:problems-work-feed)다. event는 깨우는 신호이고 payload로
// 상태를 만들지 않는다: worker가 cursor 뒤 event와 정본을 다시 읽는다.
import { err, ok, type Result } from "../../../base/mod.ts";
import type {
  EventVisibilityDefinition,
  RequestContext,
} from "../../../protocol/server/mod.ts";
import {
  advanceSubscriberCursor,
  eventsList,
} from "../../../protocol/events/mod.ts";
import { type EventDefinition } from "../../../protocol/base/mod.ts";
import {
  closeProblemVerified,
  getProblem,
  reconcileProblemWork,
} from "../../../protocol/problems/mod.ts";
import {
  openConnection,
  type SubscriberBinding,
} from "../../storage/ledger/mod.ts";
import type { OperationPolicy } from "../../server/identity/mod.ts";
import { WORK_EVENT_TYPES, WORK_SUBSCRIBER } from "./mod.ts";
import {
  type InternalSubscription,
  openInternalSubscription,
} from "../../events/internal-subscription.ts";
import {
  PROBLEMS_WORK_FEED_PRINCIPAL,
  PROBLEMS_WORK_PRINCIPAL,
} from "./work-ids.ts";

export { PROBLEMS_WORK_FEED_PRINCIPAL, PROBLEMS_WORK_PRINCIPAL };
// worker 깨움 요청 op. packages/core/main/worker/test-runner.ts와 같은 값이다.
export const PROBLEMS_WORK_OP = "problems.work";

// worker가 core loopback에 낼 수 있는 operation: event 읽기, 문제 기준 읽기, 반응 command, cursor 전진.
// 같은 worker kind의 `problems.closing` 반응기도 이 자격으로 CloseProblemVerified를 낸다.
// machine의 실제 reproduction 판정만 닫는다.
export const PROBLEMS_WORK_OPERATIONS = [
  eventsList.name,
  getProblem.name,
  reconcileProblemWork.name,
  closeProblemVerified.name,
  advanceSubscriberCursor.name,
];

// machine은 command kind만 받으므로 worker가 읽는 read operation도 command kind로 올린다.
// GetProblem 정책은 report collector 쪽이 이미 올려 두어 겹치지 않게 뺀다. CloseProblemVerified는
// 같은 worker kind의 `problems.closing` 반응기가 내는 반응 command다.
export function problemsWorkPolicies(): OperationPolicy[] {
  return [
    eventsList.name,
    reconcileProblemWork.name,
    closeProblemVerified.name,
    advanceSubscriberCursor.name,
  ]
    .map((name): OperationPolicy => ({
      name,
      actors: ["machine"],
      kind: "command",
    }));
}

// 구독자의 자격. core가 ledger credential 기록으로 심고 token이 없다. HTTP로는 이 principal이 될 수
// 없다.
export const PROBLEMS_WORK_FEED_CONTEXT: RequestContext = {
  principal: PROBLEMS_WORK_FEED_PRINCIPAL,
  actor: "machine",
  scope: { operations: [eventsList.name], targets: {} },
  conditions: {},
  credential_ref: PROBLEMS_WORK_FEED_PRINCIPAL,
};

export function isProblemsWorkFeed(ctx: RequestContext): boolean {
  return ctx.actor === "machine" &&
    ctx.principal === PROBLEMS_WORK_FEED_PRINCIPAL &&
    ctx.credential_ref === PROBLEMS_WORK_FEED_PRINCIPAL;
}

// worker는 발급된 credential(ref는 발급마다 다르다)로 event를 읽고 cursor를 올린다.
export function isProblemsWorker(ctx: RequestContext): boolean {
  return ctx.actor === "machine" && ctx.principal === PROBLEMS_WORK_PRINCIPAL;
}

export function isProblemsWork(ctx: RequestContext): boolean {
  return isProblemsWorkFeed(ctx) || isProblemsWorker(ctx);
}

// 정책이 없던 ticket event를 `problems.work` 쪽에게만 연다. 사람·agent·app·다른 machine은 정책이
// 없을 때와 똑같이 못 본다.
export function problemsWorkVisibility<D extends EventDefinition>(
  event: D,
): EventVisibilityDefinition<D> {
  return { event, handle: (_snapshot, ctx) => ok(isProblemsWork(ctx)) };
}

// owner가 이미 공개하는 ticket event는 그 정책 뒤에 이 반응 쪽을 더한다.
export function visibleToProblemsWork<D extends EventDefinition>(
  owner: EventVisibilityDefinition<D>,
): EventVisibilityDefinition<D> {
  return {
    event: owner.event,
    handle: (snapshot, ctx, event) =>
      isProblemsWork(ctx) ? ok(true) : owner.handle(snapshot, ctx, event),
  };
}

// 이름 있는 구독자만 자기 cursor를 올린다. `problems.work`는 worker만 올린다.
export function problemsWorkSubscribers(): SubscriberBinding[] {
  return [{
    name: WORK_SUBSCRIBER,
    authorize: (ctx) => ok(isProblemsWorker(ctx)),
  }];
}

// `problems.work` 구독자의 현재 cursor. 기록이 없으면 처음부터다(0).
export function problemsWorkCursor(ledgerPath: string): Result<string> {
  const opened = openConnection(ledgerPath);
  if (!opened.ok) return opened;
  try {
    const row = opened.value.sql.get(
      "select cast(processed_through_seq as text) as seq from subscriber_cursors where subscriber = ?",
      [WORK_SUBSCRIBER],
    );
    return ok(row === undefined ? "0" : String(row["seq"]));
  } catch {
    return err({ code: "unavailable", message: "cursor를 읽지 못했다" });
  } finally {
    opened.value.close();
  }
}

const WAKE_TYPES: ReadonlySet<string> = new Set(WORK_EVENT_TYPES);

export type ProblemsWorkFeedDeps = {
  ledgerPath: string;
  // worker에게 cursor 뒤를 따라잡게 한다. worker가 없거나 답하지 못하면 실패다.
  wake(cursor: string): Promise<Result<unknown>>;
  // 한 묶음의 event가 몰릴 때 한 번만 깨우는 대기.
  debounceMs?: number;
  // 깨움이 실패했을 때 다시 하는 대기와 연속 횟수. worker가 막 뜨는 동안을 넘긴다.
  retryMs?: number;
  retries?: number;
  // 놓친 깨움(worker 재시작 등)을 따라잡는 주기.
  periodMs?: number;
};

export function startProblemsWorkFeed(
  deps: ProblemsWorkFeedDeps,
): InternalSubscription {
  const debounceMs = deps.debounceMs ?? 100;
  const retryMs = deps.retryMs ?? 1_000;
  const retries = deps.retries ?? 60;
  const periodMs = deps.periodMs ?? 30_000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let failures = 0;
  async function attempt(): Promise<void> {
    if (stopped) return;
    const cursor = problemsWorkCursor(deps.ledgerPath);
    const done = cursor.ok
      ? await deps.wake(cursor.value).catch(() =>
        err({ code: "unavailable" as const, message: "wake failed" })
      )
      : cursor;
    if (stopped) return;
    if (done.ok) {
      failures = 0;
      return;
    }
    if (++failures <= retries) schedule(retryMs);
  }
  function schedule(delay: number) {
    if (stopped) return;
    clearTimeout(timer);
    timer = setTimeout(() => void attempt(), delay);
  }
  const period = setInterval(() => void attempt(), periodMs);
  const subscription = openInternalSubscription({
    context: PROBLEMS_WORK_FEED_CONTEXT,
    // 구독이 닫혀 있던 동안의 변화는 cursor 뒤를 다시 읽어 따라잡는다.
    onSubscribed: () => schedule(0),
    onEvents(events) {
      if (!events.some((event) => WAKE_TYPES.has(event.type))) return;
      schedule(debounceMs);
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
      clearInterval(period);
      subscription.stop();
    },
  };
}
