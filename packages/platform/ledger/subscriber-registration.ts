import { err, ok, type Result } from "../../base/mod.ts";
import {
  advanceSubscriberCursor,
  type CommandDefinition,
  type RequestContext,
} from "../../contracts/platform/mod.ts";
import { defineSyncCommand } from "./handler.ts";
import { exactResult } from "./event-visibility.ts";

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
    } catch {
      // owner 원문은 command 오류에 넣지 않는다.
    }
    return err({
      code: "unavailable",
      message: "subscriber 검사를 사용할 수 없다",
    });
  });
}

export function createAdvanceSubscriberCursorCommand(
  gate: SubscriberGate,
): CommandDefinition<typeof advanceSubscriberCursor> {
  return defineSyncCommand(advanceSubscriberCursor, (tx, ctx, input) => {
    const allowed = gate(input.subscriber, ctx);
    if (!allowed.ok) return allowed;
    const advanced = tx.advanceSubscriberCursor(
      input.subscriber,
      input.scanned_through_seq,
    );
    if (!advanced.ok) return advanced;
    return ok({ processed_through_seq: input.scanned_through_seq });
  });
}
