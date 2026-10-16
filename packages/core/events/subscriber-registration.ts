import { err, ok, type Result } from "../../base/mod.ts";
import type { RequestContext } from "../../protocol/server/mod.ts";

// cursor를 올리는 구독자는 Reactor 하나다. 그 행의 subscriber 이름과 core 안 machine 자격이다.
export const REACTOR_SUBSCRIBER = "reactor";
export const REACTOR_PRINCIPAL = "machine:reactor";

// Reactor 자격이 아니면 cursor를 올리거나 비교할 수 없다. 자격은 현재 snapshot이다.
export function authorizeReactorCursor(
  subscriber: string,
  request: RequestContext | undefined,
): Result<void> {
  if (request === undefined || request.actor !== "machine") {
    return err({ code: "forbidden", message: "Reactor 자격이 아니다" });
  }
  if (
    subscriber !== REACTOR_SUBSCRIBER || request.principal !== REACTOR_PRINCIPAL
  ) {
    return err({ code: "forbidden", message: "Reactor 자격이 아니다" });
  }
  return ok(undefined);
}
