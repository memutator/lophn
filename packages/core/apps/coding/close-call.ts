// 맡긴 coding call을 닫고 맡긴 App Engineer("열린 session, 없으면 새 session")에게 그 사실을 한 번 알린다.
// 같은 tx 안에서 call을 닫으므로 Router의 실패 알림이 같은 사실을 한 번 더 보내지 않는다.
import { ok, type Result } from "../../../base/mod.ts";
import type { CallRef } from "../../../protocol/lophn-agent/calls.ts";
import type { Tx } from "../../../protocol/server/mod.ts";
import { createCallStore, routerFor } from "../../router/mod.ts";

// 입력 본문은 고정 문구다. 본문 blob을 미리 준비해 둘 수 있어야 하므로 session마다 다른 값을 넣지 않는다.
// "끝났다"는 session이 있었을 때만 말한다. 띄우지 못했는데 끝났다고 하면 일이 된 줄 안다.
export const CODING_REACTION_TEXTS = {
  ended: "The coding session ended. Its last message to you says what it did.",
  not_started: "The coding session could not start.",
} as const;

export function closeCall(tx: Tx, input: {
  call: string;
  // 띄우지 못한 줄의 call은 session이 없다.
  session: string | null;
  app: string;
}): Result<void> {
  const store = createCallStore();
  const record = store.read(tx, input.call as never);
  // 이미 끝난 call(취소, Router가 먼저 닫음)은 그대로 두고 알리지 않는다.
  if (record === null || record.state !== "accepted") return ok(undefined);
  const router = routerFor(tx);
  if (!router.ok) return router;
  const started = input.session !== null;
  const closed = router.value.close(
    tx,
    input.call as never,
    started ? "done" : "failed",
    started ? null : "receiver_ended",
  );
  if (!closed.ok) return closed;
  if (record.from.kind !== "agent") return ok(undefined);
  const refs: CallRef[] = started
    ? [{ kind: "session", session: input.session } as CallRef]
    : [];
  const routed = router.value.route(tx, {
    from: { kind: "program" },
    to: {
      kind: "open_session_or_new",
      session: record.from.session,
      agent: { role: "app_engineer", app: input.app },
    } as never,
    reply: "none",
    body: CODING_REACTION_TEXTS[started ? "ended" : "not_started"],
    refs,
    reply_to: null,
    dedup: null,
    options: null,
    kind: "reaction",
    delivery: "next_turn",
    event: "CodingSessionEnded",
  });
  return routed.ok ? ok(undefined) : routed;
}
