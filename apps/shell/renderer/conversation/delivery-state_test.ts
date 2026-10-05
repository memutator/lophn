import { assert, assertEquals } from "@std/assert";

import {
  afterCheck,
  afterReply,
  composerLocked,
  deliveryAction,
  type Outgoing,
  resend,
  startSend,
  textBody,
} from "./delivery-state.ts";
import { DraftStore, EMPTY_DRAFT } from "./drafts.ts";

const BODY = "a".repeat(64);

function sending(): Outgoing {
  return startSend({
    id: "msg_01h455vb4pex5v6nkc6gd5fdw1",
    key: "messages-receive-msg_01h455vb4pex5v6nkc6gd5fdw1",
    text: "Make the weekly summary shorter",
    body: BODY,
    mode: "request",
    run: null,
  });
}

Deno.test("shell/desktop#R8: 보내는 중·접수됨·못 보냄·접수 확인 안 됨을 구별한다", () => {
  const outgoing = sending();
  assertEquals(outgoing.phase, "sending");
  assertEquals(deliveryAction(outgoing), "wait");
  assertEquals(afterReply(outgoing, { ok: true }).phase, "accepted");
  for (
    const code of [
      "invalid_input",
      "unauthorized",
      "forbidden",
      "not_found",
      "conflict",
    ]
  ) {
    assertEquals(
      afterReply(outgoing, { ok: false, code }).phase,
      "not_sent",
      code,
    );
  }
  // core가 처리했는지 모르는 답은 못 보냄이 아니라 접수 확인 안 됨이다.
  for (const code of ["unavailable", "internal", "transport_failed"]) {
    assertEquals(
      afterReply(outgoing, { ok: false, code }).phase,
      "unconfirmed",
      code,
    );
  }
});

Deno.test("shell/desktop#R8: 결과를 모르면 다시 보내기보다 접수 조회를 먼저 내놓는다", () => {
  const unknown = afterReply(sending(), { ok: false, code: "unavailable" });
  assertEquals(deliveryAction(unknown), "check");
  // 조회 전에는 다시 보내지 않는다.
  assertEquals(resend(unknown), unknown);
  // 기록에서 찾으면 접수됨이다.
  assertEquals(afterCheck(unknown, true).phase, "accepted");
  // 찾지 못한 뒤에야 같은 id·key로 다시 보낸다.
  const missing = afterCheck(unknown, false);
  assertEquals(missing.phase, "unconfirmed");
  assertEquals(deliveryAction(missing), "resend");
  const again = resend(missing);
  assertEquals(again.phase, "sending");
  assertEquals(again.id, unknown.id);
  assertEquals(again.key, unknown.key);
  assertEquals(again.body, unknown.body);
});

Deno.test("shell/desktop#R8: 못 보낸 말은 입력칸에서 고쳐 보내고, 결과를 모르는 동안은 잠근다", () => {
  const notSent = afterReply(sending(), { ok: false, code: "conflict" });
  assertEquals(deliveryAction(notSent), "edit");
  assert(!composerLocked(notSent));
  assert(composerLocked(sending()));
  assert(
    composerLocked(afterReply(sending(), { ok: false, code: "unavailable" })),
  );
  assert(!composerLocked(null));
  assert(!composerLocked(afterReply(sending(), { ok: true })));
});

Deno.test("shell/desktop#R8: 작성 중 말·선택 답·커서는 세션별 메모리에 남고 접수되면 비운다", () => {
  const drafts = new DraftStore();
  const one = "ses_01h455vb4pex5v6nkc6gd5fdw1";
  const two = "ses_01h455vb4pex5v6nkc6gd5fdw2";
  drafts.save(one, { text: "Rename the file", selection: [3, 7] });
  drafts.save(one, { choice: "Keep both" });
  drafts.save(two, { text: "Something else", mode: "correction" });
  assertEquals(drafts.draft(one).text, "Rename the file");
  assertEquals(drafts.draft(one).selection, [3, 7]);
  assertEquals(drafts.draft(one).choice, "Keep both");
  assertEquals(drafts.draft(two).mode, "correction");
  // 실패한 전달은 글을 지우지 않는다.
  const failed = afterReply(sending(), { ok: false, code: "unavailable" });
  drafts.save(one, { outgoing: failed });
  assertEquals(drafts.draft(one).text, "Rename the file");
  // 접수되면 그 세션만 비우고 보낸 글은 본문 hash로 기억한다.
  drafts.sent(one, afterCheck(failed, true));
  assertEquals(drafts.draft(one), { ...EMPTY_DRAFT, mode: "request" });
  assertEquals(drafts.draft(two).text, "Something else");
  assertEquals(drafts.textOf(BODY), "Make the weekly summary shorter");
});

Deno.test("shell/desktop#R8: 다시 보낸 말이 한 번만 접수되도록 본문 hash는 같은 글에 같고 key 순서를 고정한 MessageContent의 SHA-256이다", async () => {
  const body = await textBody("hello");
  assertEquals(body, await textBody("hello"));
  assert(/^[0-9a-f]{64}$/.test(body));
  const expected = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(
        '{"parts":[{"kind":"text","text":"hello"}],"schema_version":1}',
      ),
    ),
  );
  assertEquals(
    body,
    [...expected].map((byte) => byte.toString(16).padStart(2, "0")).join(""),
  );
  assert(body !== await textBody("hello "));
});
