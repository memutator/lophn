import { assert, assertEquals } from "@std/assert";

import {
  afterCheck,
  afterReply,
  composerLocked,
  contentBytes,
  deliveryAction,
  fitsMessage,
  MESSAGE_TEXT_MAX_BYTES,
  type Outgoing,
  resend,
  startSend,
  textContent,
} from "./delivery-state.ts";
import { DraftStore, EMPTY_DRAFT } from "./drafts.ts";
import { messageContract } from "./testdata/message-contract.ts";

const ID = "msg_01h455vb4pex5v6nkc6gd5fdw1";

function sending(): Outgoing {
  return startSend({
    id: ID,
    key: `messages-receive-${ID}`,
    text: "Make the weekly summary shorter",
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
  assertEquals(again.text, unknown.text);
  assertEquals(textContent(again.text), textContent(unknown.text));
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
  // 접수되면 그 세션만 비우고 보낸 글은 메시지 id로 기억한다.
  drafts.sent(one, afterCheck(failed, true));
  assertEquals(drafts.draft(one), { ...EMPTY_DRAFT, mode: "request" });
  assertEquals(drafts.draft(two).text, "Something else");
  assertEquals(drafts.textOf(ID), "Make the weekly summary shorter");
});

Deno.test("lophn-agent/conversation#R2: 보내는 본문은 글 part 하나의 MessageContent 값이고 contract schema를 통과한다", async () => {
  const { userMessageContentInputSchema } = await messageContract();
  const content = textContent("hello");
  assertEquals(content, {
    schema_version: 1,
    parts: [{ kind: "text", text: "hello" }],
  });
  assert(userMessageContentInputSchema.safeParse(content).success);
  // 같은 글은 같은 값이다. 다시 보내도 core가 같은 본문으로 본다.
  assertEquals(textContent("hello"), content);
});

Deno.test("shell/desktop#R8: 본문 상한은 contract와 같고 정규 직렬화 바이트로 센다", async () => {
  const {
    MESSAGE_TEXT_CONTENT_MAX_BYTES,
    serializeMessageContent,
    userMessageContentInputSchema,
  } = await messageContract();
  assertEquals(MESSAGE_TEXT_MAX_BYTES, MESSAGE_TEXT_CONTENT_MAX_BYTES);
  for (
    const text of ["hello", 'quote " and \\ back', "줄\n바꿈 😀", "\u0001 "]
  ) {
    assertEquals(
      contentBytes(text),
      serializeMessageContent(textContent(text)).length,
      text,
    );
  }
  const overhead = contentBytes("");
  const largest = "a".repeat(MESSAGE_TEXT_MAX_BYTES - overhead);
  assert(fitsMessage(largest));
  assert(userMessageContentInputSchema.safeParse(textContent(largest)).success);
  const over = `${largest}a`;
  assert(!fitsMessage(over));
  assert(!userMessageContentInputSchema.safeParse(textContent(over)).success);
  // 여러 바이트 글자도 글자 수가 아니라 바이트로 센다.
  assert(!fitsMessage("가".repeat(Math.ceil(MESSAGE_TEXT_MAX_BYTES / 3))));
  // 짝 없는 surrogate는 정규화할 수 없어 보내지 않는다.
  assert(!fitsMessage("broken \uD800 text"));
});
