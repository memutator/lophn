// `problems.closing` 반응기의 core 쪽 연결(problems#T20). 반응기 자체는 제품 core가 감독하는 상시 worker
// kind `problems/test-runner` 안에서 problems.work 반응기와 같이 돈다. worker가 core에 내는 자격은
// `problems.work`의 machine credential이다(operations는 problems-work.ts의 목록, closing command도
// 들어 있다). 이 파일은 closing event를 `problems.closing` 반응 쪽에게 여는 공개 정책, cursor 전진 자격,
// 그리고 worker를 깨우는 core 안 구독자(machine:problems-closing-feed)다. event는 깨우는 신호이고
// payload로 상태를 만들지 않는다: worker가 cursor 뒤 event와 정본을 다시 읽는다.
import { err, ok, type Result } from "../../packages/base/mod.ts";
import {
  type EventDefinition,
  eventsList,
  type EventVisibilityDefinition,
  type RequestContext,
} from "../../packages/protocol/server/mod.ts";
import {
  openConnection,
  type SubscriberBinding,
} from "../../packages/core/storage/ledger/mod.ts";
import {
  CLOSING_EVENT_TYPES,
  CLOSING_SUBSCRIBER,
} from "../../packages/core/problems/closing/mod.ts";
import {
  type InternalSubscription,
  openInternalSubscription,
} from "./internal-subscription.ts";
import type { CoreRuntime } from "./runtime.ts";

// worker 깨움 요청 op. apps/worker/problems/test-runner.ts와 같은 값이다.
export const PROBLEMS_CLOSING_FEED_PRINCIPAL = "machine:problems-closing-feed";
export const PROBLEMS_CLOSING_OP = "problems.closing";

export function isProblemsClosing(ctx: RequestContext): boolean {
  // feed는 cursor 없이 숨김 event를 여는 자격이고, worker는 발급된 credential(ref는 발급마다 다르다)로
  // event를 읽고 cursor를 올린다.
  return ctx.actor === "machine" &&
    (ctx.principal === PROBLEMS_CLOSING_FEED_PRINCIPAL ||
      ctx.principal === "machine:problems-work");
}

// 정책이 없던 closing event를 `problems.closing` 쪽에게만 연다. 사람·agent·app·다른 machine은
// 정책이 없을 때와 똑같이 못 본다.
export function problemsClosingVisibility<D extends EventDefinition>(
  event: D,
): EventVisibilityDefinition<D> {
  return { event, handle: (_snapshot, ctx) => ok(isProblemsClosing(ctx)) };
}

// owner가 이미 공개하는 event는 그 정책 뒤에 이 반응 쪽을 더한다.
export function visibleToProblemsClosing<D extends EventDefinition>(
  owner: EventVisibilityDefinition<D>,
): EventVisibilityDefinition<D> {
  return {
    event: owner.event,
    handle: (snapshot, ctx, event) =>
      isProblemsClosing(ctx) ? ok(true) : owner.handle(snapshot, ctx, event),
  };
}

// 이름 있는 구독자만 자기 cursor를 올린다. `problems.closing`은 worker만 올린다.
export function problemsClosingSubscribers(): SubscriberBinding[] {
  return [{
    name: CLOSING_SUBSCRIBER,
    authorize: (ctx) =>
      ok(
        ctx.actor === "machine" && ctx.principal === "machine:problems-work",
      ),
  }];
}

// `problems.closing` 구독자의 현재 cursor. 기록이 없으면 처음부터다(0).
export function problemsClosingCursor(ledgerPath: string): Result<string> {
  const opened = openConnection(ledgerPath);
  if (!opened.ok) return opened;
  try {
    const row = opened.value.sql.get(
      "select cast(processed_through_seq as text) as seq from subscriber_cursors where subscriber = ?",
      [CLOSING_SUBSCRIBER],
    );
    return ok(row === undefined ? "0" : String(row["seq"]));
  } catch {
    return err({ code: "unavailable", message: "cursor를 읽지 못했다" });
  } finally {
    opened.value.close();
  }
}

const WAKE_TYPES: ReadonlySet<string> = new Set(CLOSING_EVENT_TYPES);

export type ProblemsClosingFeedDeps = {
  runtime: Pick<CoreRuntime, "events" | "track">;
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

export function startProblemsClosingFeed(
  deps: ProblemsClosingFeedDeps,
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
    const cursor = problemsClosingCursor(deps.ledgerPath);
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
    context: {
      principal: PROBLEMS_CLOSING_FEED_PRINCIPAL,
      actor: "machine",
      scope: { operations: [eventsList.name], targets: {} },
      conditions: {},
      credential_ref: PROBLEMS_CLOSING_FEED_PRINCIPAL,
    },
    backend: deps.runtime.events,
    track: (session) => deps.runtime.track(session),
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
