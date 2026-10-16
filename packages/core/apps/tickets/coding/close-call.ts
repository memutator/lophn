// 맡긴 coding call을 닫고 맡긴 App Engineer("열린 session, 없으면 새 session")에게 그 사실을 새 입력으로
// 넣는다. 같은 tx 안에서 call을 닫으므로 Router의 실패 알림이 같은 사실을 한 번 더 보내지 않는다.
import { ok, type Result } from "../../../../base/mod.ts";
import type { CallRef } from "../../../../protocol/lophn-agent/calls.ts";
import type { Tx } from "../../../../protocol/server/mod.ts";
import { createCallStore, routerFor } from "../../../router/mod.ts";

// 입력 본문은 고정 문구다. 본문 blob을 미리 준비해 둘 수 있어야 하므로 session마다 다른 값을 넣지 않는다.
export const CODING_REACTION_TEXTS = {
  TicketCompletionReported: "The coding agent reported the ticket complete.",
  TicketClaimExpired:
    "The coding agent's claim on the ticket expired before it reported.",
  CodingSessionEndedUnreported:
    "The coding session ended without reporting completion.",
} as const;
type CloseEvent = keyof typeof CODING_REACTION_TEXTS;

export function closeCall(tx: Tx, input: {
  call: string;
  event: CloseEvent;
  // 근거 domain event의 seq. event 없이 직접 닫을 때는 "0"이다.
  seq: string;
  // 띄우지 못한 줄의 call은 session이 없다.
  session: string | null;
  ticket: string;
  app: string;
}): Result<void> {
  const store = createCallStore();
  const record = store.read(tx, input.call as never);
  // 이미 끝난 call(취소, Router가 먼저 닫음)은 그대로 두고 알리지 않는다.
  if (record === null || record.state !== "accepted") return ok(undefined);
  const router = routerFor(tx);
  if (!router.ok) return router;
  const done = input.event === "TicketCompletionReported";
  const closed = router.value.close(
    tx,
    input.call as never,
    done ? "done" : "failed",
    done ? null : "receiver_ended",
  );
  if (!closed.ok) return closed;
  if (record.from.kind !== "agent") return ok(undefined);
  const refs = [
    { kind: "ticket", ticket: input.ticket },
    ...(input.session === null
      ? []
      : [{ kind: "session", session: input.session }]),
  ] as CallRef[];
  const routed = router.value.route(tx, {
    from: { kind: "program", event_seq: input.seq },
    to: {
      kind: "open_session_or_new",
      session: record.from.session,
      agent: { role: "app_engineer", app: input.app },
    } as never,
    reply: "none",
    body: CODING_REACTION_TEXTS[input.event],
    refs,
    reply_to: null,
    dedup: null,
    options: null,
    kind: "reaction",
    delivery: "next_turn",
    event: input.event,
  });
  return routed.ok ? ok(undefined) : routed;
}
