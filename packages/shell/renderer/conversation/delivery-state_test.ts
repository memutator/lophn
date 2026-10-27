import assert from "node:assert/strict";
import { test } from "node:test";

import {
  afterCheck,
  afterReply,
  deliveryAction,
  resend,
  startSend,
} from "./delivery-state.ts";

const sending = startSend({
  id: "msg_01h455vb4pex5v6nkc6gd5f001",
  key: "key-1",
  text: "Write the report.",
  delivery: "next_turn",
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
