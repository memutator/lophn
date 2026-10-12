// core 안의 assignments 반응 구독자(machine:lophn-agent-assignments). 독립 비동기 루프가
// `lophn-agent-assignments` cursor 뒤 event를 읽고, AppCreated면 거두지 않은 App Engineer
// assignment를 만들고 자리(project·app)가 보관되면 그 자리의 켜진 assignment를 멈추고 보관이
// 풀리면 멈춘 assignment를 다시 켜며, 나머지는 cursor만 올린다.
// 본문 조립·model 호출은 하지 않는다.
//
// event는 깨우는 신호다. 구독이 (다시) 열릴 때와 event가 올 때 cursor부터 따라잡고, 실패하면
// 그 위치에서 멈춘 채 대기 뒤 같은 cursor부터 다시 읽는다. 전달 실패로 버리지 않는다.
import { err, ok, type Result } from "../../../base/mod.ts";
import {
  ASSIGNMENT_SUBSCRIBER,
  assignmentList,
} from "../../../protocol/lophn-agent/mod.ts";
import type { AuthenticatedContext } from "../../../protocol/server/mod.ts";
import { assignmentEngine } from "./reaction.ts";
import { openConnection } from "../../storage/ledger/mod.ts";
import {
  type InternalSubscription,
  openInternalSubscription,
} from "../../events/internal-subscription.ts";
import { ASSIGNMENT_REACTIONS_CONTEXT } from "../../main/daemon/platform-register.ts";
import type { CoreRuntime } from "../../main/daemon/runtime.ts";

export type AssignmentReactionsDeps = {
  runtime: Pick<CoreRuntime, "events" | "track" | "writer" | "readers">;
  ledgerPath: string;
  // 한 번 실패한 뒤 다시 시도하는 대기. 기본 1초다.
  retryMs?: number;
};

export type AssignmentReactions = {
  // 지금 cursor부터 head까지 따라잡는다. 이미 도는 중이면 그 끝까지 기다린 뒤 한 번 더 본다.
  drain(): Promise<void>;
  // 구독과 retry를 멈추고 진행 중인 한 번을 기다린다.
  stop(): Promise<void>;
  readonly subscription: InternalSubscription;
};

// 구독자의 현재 cursor. 기록이 없으면 처음부터다(0).
export function assignmentReactionsCursor(ledgerPath: string): Result<string> {
  const opened = openConnection(ledgerPath);
  if (!opened.ok) return opened;
  try {
    const row = opened.value.sql.get(
      "select cast(processed_through_seq as text) as seq from subscriber_cursors where subscriber = ?",
      [ASSIGNMENT_SUBSCRIBER],
    );
    return ok(row === undefined ? "0" : String(row["seq"]));
  } catch {
    return err({ code: "unavailable", message: "cursor를 읽지 못했다" });
  } finally {
    opened.value.close();
  }
}

type Listed = {
  assignments?: {
    id: string;
    revision: number;
    state: string;
    scope: { kind: string; id: string | null };
  }[];
  next_cursor?: string | null;
};

export function startAssignmentReactions(
  deps: AssignmentReactionsDeps,
): AssignmentReactions {
  const retryMs = deps.retryMs ?? 1_000;
  let stopped = false;
  let running: Promise<void> | undefined;
  let again = false;
  let retry: ReturnType<typeof setTimeout> | undefined;
  const machine = ASSIGNMENT_REACTIONS_CONTEXT as AuthenticatedContext;
  const engine = assignmentEngine({
    backend: deps.runtime.events,
    machine,
    command: (ctx, envelope) =>
      deps.runtime.writer.command(ctx as never, envelope as never),
    cursor: () => {
      const cursor = assignmentReactionsCursor(deps.ledgerPath);
      return cursor.ok
        ? Promise.resolve(cursor.value)
        : Promise.reject(new Error(cursor.error.message));
    },
    // 자리에 놓인 거두지 않은 assignment. 목록을 훑어 scope로 고른다.
    async findAtPlace(place) {
      const found: { id: string; revision: number; state: string }[] = [];
      let cursor: string | undefined;
      for (;;) {
        const listed = await deps.runtime.readers.read(
          assignmentList,
          machine as never,
          cursor === undefined ? {} : { cursor },
        );
        if (!listed.ok) return listed;
        const page = listed.value as Listed;
        for (const entry of page.assignments ?? []) {
          if (entry.scope.id === place && entry.state !== "withdrawn") {
            found.push({
              id: entry.id,
              revision: entry.revision,
              state: entry.state,
            });
          }
        }
        if (page.next_cursor === undefined || page.next_cursor === null) {
          return ok(found);
        }
        cursor = page.next_cursor;
      }
    },
  });

  // cursor가 head에 닿을 때까지 한 batch씩 읽는다. 움직임이 없으면 따라잡은 것이다.
  async function catchUp(): Promise<void> {
    for (;;) {
      if (stopped) return;
      const before = assignmentReactionsCursor(deps.ledgerPath);
      if (!before.ok) return schedule();
      const stepped = await engine.step().catch(() => undefined);
      if (stepped === undefined || !stepped.ok) return schedule();
      // 저장된 cursor가 움직이지 않았으면 따라잡은 것이다(step 결과가 아니라 기록으로 본다).
      const after = assignmentReactionsCursor(deps.ledgerPath);
      if (!after.ok) return schedule();
      if (after.value === before.value) return;
    }
  }

  function schedule(): void {
    if (stopped || retry !== undefined) return;
    retry = setTimeout(() => {
      retry = undefined;
      void drain();
    }, retryMs);
  }

  function drain(): Promise<void> {
    if (stopped) return Promise.resolve();
    // 도는 중에 온 신호는 끝난 뒤 한 번 더 본다. 동시에 두 step이 같은 cursor를 쓰지 않는다.
    if (running !== undefined) {
      again = true;
      return running;
    }
    running = (async () => {
      try {
        do {
          again = false;
          await catchUp();
        } while (again && !stopped);
      } finally {
        running = undefined;
      }
    })();
    return running;
  }

  const subscription = openInternalSubscription({
    context: ASSIGNMENT_REACTIONS_CONTEXT,
    backend: deps.runtime.events,
    track: (session) => deps.runtime.track(session),
    retryMs: deps.retryMs,
    onSubscribed: drain,
    onEvents: () => void drain(),
  });
  void drain();
  return {
    drain,
    subscription,
    async stop() {
      stopped = true;
      clearTimeout(retry);
      retry = undefined;
      subscription.stop();
      engine.close();
      await running;
    },
  };
}
