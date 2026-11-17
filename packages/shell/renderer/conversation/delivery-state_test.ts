import assert from "node:assert/strict";
import { test } from "node:test";

import {
  afterCheck,
  afterReply,
  deliveryAction,
  composerLocked,
  resend,
  seenOf,
  startSend,
  waitsInQueue,
} from "./delivery-state.ts";

const sending = startSend({
  id: "msg_01h455vb4pex5v6nkc6gd5f001",
  key: "key-1",
  content: [{ type: "text", text: "Write the report." }],
  delivery: "next_turn",
  queued: false,
});

// 접수 여부를 모르는 채 다시 보내면 같은 말이 두 번 접수될 수 있다.
test("결과를 모르는 전송은 접수 조회가 없다고 답한 뒤에만 같은 id·key로 다시 보낸다", () => {
  const notTaken = [
    "invalid_input",
    "unauthorized",
    "forbidden",
    "not_found",
    "conflict",
  ];
  for (const code of notTaken) {
    const after = afterReply(sending, { ok: false, code });
    assert.deepStrictEqual(deliveryAction(after), "edit", code);
  }

  for (const code of ["unavailable", "internal", "channel_failed"]) {
    const lost = afterReply(sending, { ok: false, code });
    assert.deepStrictEqual(deliveryAction(lost), "check", code);
    // 조회 전에는 다시 보내기가 없다.
    assert.deepStrictEqual(resend(lost), lost, code);

    assert.deepStrictEqual(afterCheck(lost, true).phase, "accepted", code);

    const missing = afterCheck(lost, false);
    assert.deepStrictEqual(deliveryAction(missing), "resend", code);
    const again = resend(missing);
    assert.deepStrictEqual(again.phase, "sending", code);
    assert.deepStrictEqual(
      [again.id, again.key],
      [sending.id, sending.key],
      code,
    );
  }
});

// 줄로 갈 말이 대화에서 빠지는 동안에도, 못 보낸 말의 다시 보내기 단추는 대화 줄에 남아야 한다.
test("대화에서 빠지는 것은 줄에 설 말이 보내는 중이거나 접수된 동안뿐이다", () => {
  const queued = { ...sending, queued: true };
  assert.equal(waitsInQueue(queued), true);
  assert.equal(waitsInQueue(afterReply(queued, { ok: true })), true);
  assert.equal(
    waitsInQueue(afterReply(queued, { ok: false, code: "internal" })),
    false,
  );
  assert.equal(
    waitsInQueue(afterReply(queued, { ok: false, code: "conflict" })),
    false,
  );
  assert.equal(waitsInQueue(sending), false);
});

// 다른 기기가 먼저 보내 거절되면 쓴 글이 사라지면 안 된다. 접수됨만 입력칸을 비운다.
test("changed_elsewhere 뒤 쓴 글과 첨부는 그대로 남아 다시 보낼 수 있다", () => {
  const after = afterReply(sending, { ok: false, code: "changed_elsewhere" });
  assert.deepStrictEqual(after.phase, "changed_elsewhere");
  assert.deepStrictEqual(after.content, sending.content);
  assert.equal(composerLocked(after), false);
  assert.deepStrictEqual(deliveryAction(after), "none");
});

// 화면이 아는 것보다 앞선 seen을 싣거나 줄에 선 메시지를 빼먹으면 core가 멀쩡한 보내기를 거절한다. 대화를 읽기 전에
// null을 실으면 core가 모든 사람 메시지를 다른 기기의 것으로 본다.
test("seen은 대화의 마지막 사람 메시지와 줄에 선 메시지 가운데 뒤의 것이고 아직 안 온 내 말이 있으면 그것이며 대화를 읽기 전에는 싣지 않는다", () => {
  const user = (id: string, at: string) => ({ id, actor: "user", at });
  const messages = [
    user("m1", "2026-10-17T00:00:01.000Z"),
    { id: "a1", actor: "agent", at: "2026-10-17T00:00:02.000Z" },
  ];
  assert.equal(seenOf([], [], null), null);
  assert.equal(seenOf(messages, [], null), "m1");
  assert.equal(
    seenOf(messages, [{ id: "q1", at: "2026-10-17T00:00:03.000Z" }], null),
    "q1",
  );
  assert.equal(seenOf(messages, [], "m9"), "m9");
  assert.equal(seenOf(messages, [], "m1"), "m1");
  assert.equal(seenOf(null, [], "m9"), undefined);
});
