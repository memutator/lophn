// OS 표시 전달 상태의 core 조립(platform/notifications#R9, R10). core 시작마다 ledger 밖
// 관측 보관 하나를 만들고, 그 값으로 notifications get·list·display 응답을 꾸미고, shell main이
// 알리는 표시 실패를 받는다. ledger 표·event·재시도 상태는 만들지 않는다. 재시작하면 관측이
// 없으므로 켜 둔 사람에게는 unconfirmed로 답한다.
import {
  type Clock,
  err,
  type LophnError,
  ok,
  type Result,
} from "../../base/mod.ts";
import {
  type AuthenticatedContext,
  type OsDelivery,
  reportOsDelivery,
} from "../../protocol/server/mod.ts";
import type { MemoryHandler, ReadHandler } from "../server/mod.ts";
import { createOsDeliveryObservations } from "./mod.ts";
import { osNotificationsSetting } from "../config/shell-settings.ts";

type ReadRouteName = { resource: string; method: string };

export type NotificationDelivery = {
  /** get·list 응답에 `delivery`를, display 응답에 켜짐 여부를 반영한다. */
  decorate(key: string, inner: ReadHandler): ReadHandler;
  /** `notifications/delivery`(shell main의 표시 실패 보고)의 handler. */
  memory: ReadonlyMap<string, MemoryHandler>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function gone(): Result<never, LophnError> {
  return err({ code: "not_found", message: "notification이 없다" });
}

export function createNotificationDelivery(options: {
  clock: Clock;
  read(
    route: ReadRouteName,
    ctx: AuthenticatedContext,
    body: unknown,
  ): Promise<Result<unknown, LophnError>>;
}): NotificationDelivery {
  const observations = createOsDeliveryObservations(options.clock);

  // 사람이 켰는지는 지금 settings 값이다. 읽지 못하면 꺼짐이다(기본 꺼짐).
  async function optedIn(ctx: AuthenticatedContext): Promise<boolean> {
    const reply = await options.read(
      { resource: "settings", method: "get" },
      ctx,
      { keys: [osNotificationsSetting.key] },
    );
    if (!reply.ok || !isRecord(reply.value)) return false;
    const settings = reply.value["settings"];
    if (!Array.isArray(settings)) return false;
    const found = settings.find((item) =>
      isRecord(item) && item["key"] === osNotificationsSetting.key
    );
    return isRecord(found) && found["value"] === true;
  }

  function deliveryOf(id: unknown, on: boolean): OsDelivery | undefined {
    return typeof id === "string" ? observations.lookup(id, on) : undefined;
  }

  function withDelivery(entry: unknown, on: boolean): unknown {
    if (!isRecord(entry)) return entry;
    const notification = entry["notification"];
    const id = isRecord(notification) ? notification["id"] : undefined;
    const delivery = deliveryOf(id, on);
    return delivery === undefined ? entry : { ...entry, delivery };
  }

  const decorators: Record<
    string,
    (value: Record<string, unknown>, on: boolean) => unknown
  > = {
    "notifications/get": (value, on) => withDelivery(value, on),
    "notifications/list": (value, on) => {
      const list = value["notifications"];
      return Array.isArray(list)
        ? {
          ...value,
          notifications: list.map((entry) => withDelivery(entry, on)),
        }
        : value;
    },
    // 켜지 않았으면 OS로 줄 것이 없다(R9).
    "notifications/display": (value, on) =>
      on ? value : { ...value, display: null },
  };

  const memory = new Map<string, MemoryHandler>([[
    "notifications/delivery",
    async (ctx, input) => {
      const body = input as { notification: string; reason: unknown };
      // 없는 notification과 이 operation 자격이 없는 호출자는 같은 not_found다.
      if (!ctx.scope.operations.includes(reportOsDelivery.name)) return gone();
      const found = await options.read(
        { resource: "notifications", method: "get" },
        ctx,
        { notification: body.notification },
      );
      if (!found.ok) {
        return found.error.code === "forbidden" ||
            found.error.code === "not_found"
          ? gone()
          : found;
      }
      const recorded = observations.recordFailure(
        body.notification,
        body.reason,
      );
      return recorded.ok ? ok({}) : recorded;
    },
  ]]);

  return {
    decorate(key, inner) {
      const decorator = decorators[key];
      if (decorator === undefined) return inner;
      return async (ctx, input) => {
        const result = await inner(ctx, input);
        if (!result.ok || !isRecord(result.value)) return result;
        return ok(decorator(result.value, await optedIn(ctx)));
      };
    },
    memory,
  };
}
