import type { CallReply } from "../../../packages/protocol/lophn-agent/mod.ts";
import type { Participant, ProgramCheck, SentCall } from "../types.ts";
import {
  callFailed,
  type CallWhere,
  effectiveToolCalls,
  matchTarget,
  sentCalls,
} from "./records.ts";

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

// 새 앱을 만든 뒤에 그 앱이 묶인 project의 Project Manager에게 보낸 call이 있나(L4-new). app.create의 project는 이름이나 id다.
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
        const project = (c.input as { project?: unknown } | null)?.project;
        return typeof project === "string"
          ? [{ tool_call: c.call.id, project }]
          : [];
      });
      if (created.length === 0) {
        return { pass: false, reason: "새로 만든 앱 없음" };
      }
      const calls = sentCalls(trial);
      const hit = created.some((app) =>
        calls.some((c) =>
          c.tool_call > app.tool_call && c.reply === opts.reply &&
          c.receiver?.role === "project_manager" &&
          (c.receiver.project === app.project ||
            c.receiver_place?.name === app.project)
        )
      );
      return {
        pass: hit,
        reason: hit
          ? "새 앱 project의 Project Manager에게 보냄"
          : "새 앱 project의 Project Manager에게 보낸 call 없음",
      };
    },
  };
}

export function hasFailedCall(
  id: string,
  opts?: { target?: Participant },
): ProgramCheck {
  return {
    kind: "program",
    id,
    run({ trial }) {
      const n = failedCalls(sentCalls(trial), opts?.target).length;
      return { pass: n > 0, reason: `실패한 call ${n}개` };
    },
  };
}

function failedCalls(calls: SentCall[], target?: Participant): SentCall[] {
  return calls.filter((c) =>
    callFailed(c) && (target === undefined || matchTarget(c, target))
  );
}

// 같은 대상인지 가르는 키. 보낸 쪽이 쓴 이름 꼴이면 그 이름으로 만들어, 막힌 call(receiver 없음)과
// 풀린 call이 같은 키가 되게 한다. `{ session }` 꼴만 receiver나 session id로 만든다.
function targetKey(c: SentCall): string {
  const to = c.to as {
    role?: string;
    place?: { app?: string; project?: string };
    name?: string;
    session?: string;
  };
  if (typeof to.role === "string") {
    return `${to.role}|${JSON.stringify(to.place ?? null)}|${to.name ?? ""}`;
  }
  if (c.receiver !== null) {
    const r = c.receiver;
    const id = r.role === "lophn"
      ? ""
      : r.role === "operator"
      ? r.agent
      : r.role === "project_manager"
      ? r.project
      : ""; // Role 합집합에 남은 앱 갈래
    return `${r.role}#${id}`;
  }
  return `session#${to.session ?? ""}`;
}

export function noOtherCallAfterFailedCall(
  id: string,
  opts?: { target?: Participant },
): ProgramCheck {
  return {
    kind: "program",
    id,
    run({ trial }) {
      const calls = sentCalls(trial);
      const failed = failedCalls(calls, opts?.target)[0];
      if (failed === undefined) {
        return { pass: true, reason: "실패한 call 없음" };
      }
      const key = targetKey(failed);
      const others = calls.slice(calls.indexOf(failed) + 1).filter((c) =>
        targetKey(c) !== key
      );
      return {
        pass: others.length === 0,
        reason: `실패한 call 뒤에 다른 대상으로 간 call ${others.length}개`,
      };
    },
  };
}
