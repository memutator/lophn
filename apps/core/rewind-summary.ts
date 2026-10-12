import { err, ok, type Result } from "../../packages/base/mod.ts";
import {
  finishRewindSummary,
  readRewindSummary,
  requestRewindSummary,
  type RewindSummaryState,
  takeRewindSummaryRequest,
} from "../../packages/protocol/lophn-agent/mod.ts";
import type { MemoryHandler } from "../../packages/core/server/mod.ts";
import { assertCheckpointVisible } from "../../packages/core/lophn-agent/session/rewind/mod.ts";
import type { RewindFilesDeps } from "./rewind-files.ts";

// "Summarize from here"의 요약 요청 대기열(lophn-agent/revert R15). Compact와 같은 모양이다: 사람이 요청하면
// runtime이 요약 call(Model for summaries)을 하고 끝낸 call을 돌려주며, 사람이 그 call로 Rewind(summarize)를
// 확인한다. 대기열은 core의 작업 메모리다. 요약 call 자체는 model call 기록에 남고, session이 바뀌는 것은 Rewind가
// 확정할 때뿐이라 요청이 사라져도(core 재시작, 기한) 잃는 것은 없다. 사람이 다시 요청하면 된다.

// 끝난 요청을 사람이 읽을 수 있는 시간이자 기다리는 요청이 사라지는 기한이다. 요약 call 하나가 이보다 오래
// 걸리면 사람은 이미 기다리기를 멈춘다.
export const REWIND_SUMMARY_TTL_MS = 15 * 60_000;
// 한꺼번에 쥐는 요청 수. 사람 한 명이 누르는 요약이라 넘치면 가장 오래된 것부터 버린다.
const KEPT = 32;

type Target = { assignment: string; from_seq: string };

// 요약할 곳을 정한다: session의 담당과, 고른 사람 메시지(checkpoint)의 생성 seq. 닫힌 session은 되돌릴 수 없고
// (forbidden), 끝나지 않은 run이 있으면 먼저 멈춰야 하며(conflict), 숨긴 구간 안 메시지와 checkpoint가 아닌
// 메시지(진행 중 수정, Fork 복사본)는 시작점이 아니다(invalid_input).
export function rewindSummaryTarget(
  snapshot: RewindFilesDeps["snapshot"],
): (input: { session: string; checkpoint: string }) => Result<Target> {
  return (input) => {
    const read = snapshot((lookup): Result<Target> => {
      const session = lookup.sql.get(
        "select assignment, state from sessions where id = ?",
        [input.session],
      );
      if (session === undefined) {
        return err({ code: "not_found", message: "session not found" });
      }
      if (String(session["state"]) !== "open") {
        return err({
          code: "forbidden",
          message: "a closed session cannot be rewound",
        });
      }
      const message = lookup.sql.get(
        `select cast(m.created_seq as text) as seq from messages m
          join checkpoints c on c.message = m.id
         where m.id = ? and m.session = ?`,
        [input.checkpoint, input.session],
      );
      if (message === undefined) {
        const known = lookup.sql.get(
          "select 1 as found from messages where id = ? and session = ?",
          [input.checkpoint, input.session],
        );
        return known === undefined
          ? err({ code: "not_found", message: "message not found" })
          : err({
            code: "invalid_input",
            message: "this message is not a point to rewind to",
          });
      }
      const running = lookup.sql.get(
        "select 1 as found from runs where session = ? and state != 'finished' limit 1",
        [input.session],
      );
      if (running !== undefined) {
        return err({
          code: "conflict",
          message: "stop the work in progress first",
        });
      }
      const visible = assertCheckpointVisible(
        lookup,
        input.session,
        input.checkpoint,
      );
      if (!visible.ok) return visible;
      return ok({
        assignment: String(session["assignment"]),
        from_seq: String(message["seq"]),
      });
    });
    if (!read.ok) return read;
    return read.value;
  };
}

type Entry = {
  id: string;
  session: string;
  checkpoint: string;
  target: Target;
  taken: boolean;
  state: RewindSummaryState;
  at: number;
};

const key = (route: { resource: string; method: string }) =>
  `${route.resource}/${route.method}`;

function invalid(): Result<never> {
  return err({ code: "invalid_input", message: "the input is not valid" });
}

export function createRewindSummaries(options: {
  resolve(
    input: { session: string; checkpoint: string },
  ): Result<Target>;
  newId(): string;
  now(): number;
  ttlMs?: number;
}): { handlers: ReadonlyMap<string, MemoryHandler> } {
  const ttl = options.ttlMs ?? REWIND_SUMMARY_TTL_MS;
  const entries = new Map<string, Entry>();

  function live(): Entry[] {
    const now = options.now();
    for (const [id, entry] of entries) {
      if (now - entry.at > ttl) entries.delete(id);
    }
    return [...entries.values()];
  }

  const request: MemoryHandler = (_ctx, value) => {
    const parsed = requestRewindSummary.input.safeParse(value);
    if (!parsed.success) return invalid();
    const input = parsed.data;
    // 같은 곳의 요약을 두 번 누르면 기다리는 요청 하나를 그대로 돌려준다.
    const waiting = live().find((entry) =>
      entry.session === input.session &&
      entry.checkpoint === input.checkpoint &&
      entry.state.state === "waiting"
    );
    if (waiting !== undefined) return ok({ request: waiting.id });
    const target = options.resolve(input);
    if (!target.ok) return target;
    const entry: Entry = {
      id: options.newId(),
      session: input.session,
      checkpoint: input.checkpoint,
      target: target.value,
      taken: false,
      state: { state: "waiting" },
      at: options.now(),
    };
    entries.set(entry.id, entry);
    while (entries.size > KEPT) {
      entries.delete(entries.keys().next().value as string);
    }
    return ok({ request: entry.id });
  };

  const state: MemoryHandler = (_ctx, value) => {
    const parsed = readRewindSummary.input.safeParse(value);
    if (!parsed.success) return invalid();
    const entry = live().find((item) => item.id === parsed.data.request);
    return entry === undefined
      ? err({ code: "not_found", message: "the summary request is gone" })
      : ok(entry.state);
  };

  const take: MemoryHandler = (_ctx, value) => {
    if (!takeRewindSummaryRequest.input.safeParse(value).success) {
      return invalid();
    }
    const next = live().find((entry) =>
      !entry.taken && entry.state.state === "waiting"
    );
    if (next === undefined) return ok({ request: null });
    next.taken = true;
    return ok({
      request: {
        id: next.id,
        session: next.session,
        assignment: next.target.assignment,
        from_seq: next.target.from_seq,
      },
    });
  };

  const done: MemoryHandler = (_ctx, value) => {
    const parsed = finishRewindSummary.input.safeParse(value);
    if (!parsed.success) return invalid();
    const entry = live().find((item) => item.id === parsed.data.id);
    if (entry === undefined || entry.state.state !== "waiting") {
      return ok({ accepted: false });
    }
    entry.state = parsed.data.result.kind === "summarized"
      ? { state: "summarized", summary_call: parsed.data.result.summary_call }
      : { state: "failed", reason: parsed.data.result.reason };
    return ok({ accepted: true });
  };

  return {
    handlers: new Map<string, MemoryHandler>([
      [key(requestRewindSummary), request],
      [key(readRewindSummary), state],
      [key(takeRewindSummaryRequest), take],
      [key(finishRewindSummary), done],
    ]),
  };
}
