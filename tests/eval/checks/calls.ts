import type { CallReply } from "../../../packages/protocol/lophn-agent/mod.ts";
import type { ProgramCheck } from "../types.ts";
import { type CallWhere, effectiveToolCalls, sentCalls } from "./records.ts";

export type Count = number | { min?: number; max?: number };

export function countOk(n: number, count: Count): boolean {
  if (typeof count === "number") return n === count;
  return (count.min === undefined || n >= count.min) &&
    (count.max === undefined || n <= count.max);
}

export function countText(count: Count): string {
  if (typeof count === "number") return `${count}`;
  return `${count.min ?? 0}..${count.max ?? "∞"}`;
}

export function callCount(
  id: string,
  opts: { count: Count; where?: CallWhere },
): ProgramCheck {
  return {
    kind: "program",
    id,
    run({ trial }) {
      const n = sentCalls(trial, opts.where).length;
      return {
        pass: countOk(n, opts.count),
        reason: `call ${n}개 (기대 ${countText(opts.count)})`,
      };
    },
  };
}

// 새 앱을 만든 뒤에 그 앱의 App Engineer에게 보낸 call이 있나(L4-new). 만든 앱은 app.create 결과의 content.id다.
export function callAfterAppCreate(
  id: string,
  opts: { reply: CallReply },
): ProgramCheck {
  return {
    kind: "program",
    id,
    run({ trial }) {
      const created = effectiveToolCalls(trial).filter((c) =>
        c.call.tool === "app.create" && c.call.outcome?.kind === "success"
      ).flatMap((c) => {
        const app = (c.output as { content?: { id?: unknown } } | null)?.content
          ?.id;
        return typeof app === "string" ? [{ tool_call: c.call.id, app }] : [];
      });
      if (created.length === 0) {
        return { pass: false, reason: "새로 만든 앱 없음" };
      }
      const calls = sentCalls(trial);
      const hit = created.some((made) =>
        calls.some((c) =>
          c.tool_call > made.tool_call && c.reply === opts.reply &&
          c.receiver?.role === "app_engineer" && c.receiver.app === made.app
        )
      );
      return {
        pass: hit,
        reason: hit
          ? "새 앱의 App Engineer에게 보냄"
          : "새 앱의 App Engineer에게 보낸 call 없음",
      };
    },
  };
}
