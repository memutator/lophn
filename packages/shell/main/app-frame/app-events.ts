// 앱 view가 받는 앱 event. core가 낸 `AppEventPublished`를, 지금 열려 있는 live view 가운데 그 view의 release가 구독을
// 선언한 것에만 보낸다(앱 process의 구독과 같은 선언이다). 화면이 떠 있는 동안만 받고 놓친 것은 다시 오지 않는다.
// 선언은 release마다 고정이라 한 번 읽어 둔다.
import { APP_EVENT_CHANNEL } from "../../ipc/app-events.ts";
import type { CoreCaller } from "./app-connection.ts";

type Subscription = { source: string; event: string };

interface AppEventsDeps {
  call: CoreCaller;
  /** 지금 page가 붙어 있는 live view. */
  views(): { view_session: string; app: string; release: string }[];
  /** view의 page로 보낸다. 그 view가 이미 없으면 false다. */
  send(view_session: string, channel: string, payload: unknown): boolean;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function createAppEvents(deps: AppEventsDeps) {
  const declared = new Map<string, Promise<Subscription[]>>();

  function subscriptionsOf(
    app: string,
    release: string,
  ): Promise<Subscription[]> {
    const key = `${app}\u0000${release}`;
    let found = declared.get(key);
    if (found === undefined) {
      found = deps
        .call("read", "apps", "tools", { app, release })
        .then((result) => {
          const items = result.ok
            ? record(result.value)?.subscriptions
            : undefined;
          if (!Array.isArray(items)) {
            // 못 읽은 것은 기억하지 않는다. 다음 event에 다시 읽는다.
            if (!result.ok) declared.delete(key);
            return [];
          }
          return items.flatMap((item) => {
            const row = record(item);
            return typeof row?.source === "string" &&
              typeof row.event === "string"
              ? [{ source: row.source, event: row.event }]
              : [];
          });
        });
      declared.set(key, found);
    }
    return found;
  }

  return {
    /** core의 `AppEventPublished`. */
    async published(payload: {
      source: string;
      event: string;
      payload: unknown;
      /** 이 앱들의 화면만 받는다. null이면 구독을 선언한 모든 화면이다(core의 session event는 앱이 볼 수 있는 것만 싣는다). */
      audience: readonly string[] | null;
    }): Promise<void> {
      await Promise.all(
        deps.views().map(async (view) => {
          if (
            payload.audience !== null &&
            !payload.audience.includes(view.app)
          ) {
            return;
          }
          const subscriptions = await subscriptionsOf(view.app, view.release);
          if (
            !subscriptions.some(
              (one) =>
                one.source === payload.source && one.event === payload.event,
            )
          ) {
            return;
          }
          deps.send(view.view_session, APP_EVENT_CHANNEL, {
            source: payload.source,
            event: payload.event,
            payload: payload.payload,
          });
        }),
      );
    },
  };
}
