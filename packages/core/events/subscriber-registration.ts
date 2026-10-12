import { err, ok, type Result } from "../../base/mod.ts";
import type { RequestContext } from "../../protocol/platform/mod.ts";
import { exactResult } from "./visibility.ts";

export type SubscriberBinding = {
  name: string;
  authorize(ctx: RequestContext): Result<boolean>;
};
export type SubscriberGate = (
  subscriber: string,
  ctx: RequestContext,
) => Result<void>;

export function createSubscriberGate(
  bindings: readonly SubscriberBinding[],
): Result<SubscriberGate> {
  const owners = new Map<string, SubscriberBinding>();
  for (const binding of bindings) {
    if (!binding.name || owners.has(binding.name)) {
      return err({
        code: "unavailable",
        message: "subscriber 등록이 올바르지 않다",
      });
    }
    owners.set(binding.name, binding);
  }
  return ok((name, ctx) => {
    const binding = owners.get(name);
    if (!binding) {
      return err({ code: "forbidden", message: "등록 subscriber가 아니다" });
    }
    try {
      const allowed = exactResult(binding.authorize(ctx));
      if (!allowed.ok) {
        return err({
          code: "unavailable",
          message: "subscriber 검사를 사용할 수 없다",
        });
      }
      if (allowed.value === true) return ok(undefined);
      if (allowed.value === false) {
        return err({ code: "forbidden", message: "subscriber 주체가 아니다" });
      }
    } catch (thrown) {
      // thrown Promise도 관측하되 owner 원문은 command 오류에 넣지 않는다.
      exactResult(thrown);
    }
    return err({
      code: "unavailable",
      message: "subscriber 검사를 사용할 수 없다",
    });
  });
}

// current snapshot을 매 호출 복사해 handler·이전 gate의 mutation이 권한을 넓히지 못한다.
export function authorizeSubscriberCursor(
  gate: SubscriberGate | undefined,
  subscriber: string,
  request: RequestContext | undefined,
): Result<void> {
  if (gate !== undefined && request !== undefined) {
    try {
      const allowed = exactResult(gate(subscriber, structuredClone(request)));
      if (allowed.ok && allowed.value === undefined) return ok(undefined);
      if (!allowed.ok && allowed.error.code === "forbidden") {
        return err({ code: "forbidden", message: "subscriber 주체가 아니다" });
      }
      if (!allowed.ok && allowed.error.code === "unauthorized") {
        return err({ code: "unauthorized", message: "subscriber 자격이 없다" });
      }
    } catch (thrown) {
      exactResult(thrown);
    }
  }
  return err({
    code: "unavailable",
    message: "subscriber 검사를 사용할 수 없다",
  });
}
