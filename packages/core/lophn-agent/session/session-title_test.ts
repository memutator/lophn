import { assert, assertEquals } from "@std/assert";
import type { Result } from "../../../base/mod.ts";
import {
  SESSION_AUTO_TITLE_MAX,
  SESSION_RENAME_TITLE_MAX,
  sessionTitleLength,
} from "../../../protocol/lophn-agent/mod.ts";
import {
  autoSessionTitle,
  renameSessionTitle,
  titleOnReceive,
} from "./session-title.ts";

// session 제목: 자동 제목(첫 사람 request 본문의 앞 60자)과 사람의 rename(120자 이하).
// 순수 함수라서 시각·ID·저장소 없이 고정 입력과 기대 출력만 본다.

const FAMILY = "👨‍👩‍👧"; // 코드 포인트 5개, 글자 1개.
const E_ACUTE = "é"; // 코드 포인트 2개, 글자 1개.

function code(result: Result<unknown>): string {
  return result.ok ? "ok" : result.error.code;
}

Deno.test("lophn-agent/conversation#R18 [agent-I8]: 제한은 자동 60자와 rename 120자다", () => {
  assertEquals(SESSION_AUTO_TITLE_MAX, 60);
  assertEquals(SESSION_RENAME_TITLE_MAX, 120);
});

Deno.test("lophn-agent/conversation#R18 [agent-I8]: 60자 이하 본문은 그대로 제목이 된다", () => {
  assertEquals(autoSessionTitle("Plan the cart"), "Plan the cart");
  assertEquals(autoSessionTitle("장바구니 만들기"), "장바구니 만들기");
  const exact = "a".repeat(60);
  assertEquals(autoSessionTitle(exact), exact);
});

Deno.test("lophn-agent/conversation#R18 [agent-I8]: 61자부터는 앞 60자만 제목이 된다", () => {
  assertEquals(autoSessionTitle("a".repeat(61)), "a".repeat(60));
  assertEquals(autoSessionTitle("가".repeat(100)), "가".repeat(60));
  const text = "0123456789".repeat(7);
  assertEquals(autoSessionTitle(text), "0123456789".repeat(6));
});

Deno.test("lophn-agent/conversation#R18 [agent-I8]: 글자 경계에서 자르며 결합 문자·이모지 묶음·surrogate pair를 쪼개지 않는다", () => {
  // 코드 포인트로 세면 30자에서 잘릴 글인데 글자로는 60자라 그대로 남는다.
  assertEquals(autoSessionTitle(E_ACUTE.repeat(60)), E_ACUTE.repeat(60));
  assertEquals(autoSessionTitle(E_ACUTE.repeat(61)), E_ACUTE.repeat(60));
  assertEquals(autoSessionTitle(FAMILY.repeat(61)), FAMILY.repeat(60));
  assertEquals(autoSessionTitle("😀".repeat(61)), "😀".repeat(60));
  // 59자 뒤에 오는 묶음 이모지는 통째로 들어가거나 통째로 빠진다.
  assertEquals(
    autoSessionTitle("a".repeat(59) + FAMILY + "b"),
    "a".repeat(59) + FAMILY,
  );
  assertEquals(
    autoSessionTitle("a".repeat(60) + FAMILY),
    "a".repeat(60),
  );
  for (
    const text of [
      E_ACUTE.repeat(99),
      FAMILY.repeat(99),
      "한글 mixed 😀 text ".repeat(20),
    ]
  ) {
    const title = autoSessionTitle(text);
    assert(title !== null);
    assert(sessionTitleLength(title) <= SESSION_AUTO_TITLE_MAX);
  }
});

Deno.test("lophn-agent/conversation#R18 [agent-I8]: 줄바꿈은 공백이 되고 줄바꿈을 낀 연속 공백은 공백 하나다", () => {
  assertEquals(
    autoSessionTitle("first line\nsecond line"),
    "first line second line",
  );
  assertEquals(autoSessionTitle("a\r\nb"), "a b");
  assertEquals(autoSessionTitle("a\rb"), "a b");
  assertEquals(autoSessionTitle("a\u2028b\u2029c"), "a b c");
  // 빈 줄과 줄머리 들여쓰기는 공백 하나로 모인다.
  assertEquals(autoSessionTitle("a\n\n   b"), "a b");
  assertEquals(autoSessionTitle("a \n b"), "a b");
  // 줄바꿈이 없는 공백은 건드리지 않는다.
  assertEquals(autoSessionTitle("a  b"), "a  b");
  assertEquals(autoSessionTitle("a\tb"), "a\tb");
  // 줄바꿈을 공백으로 바꾼 글에서 60자를 센다.
  assertEquals(
    autoSessionTitle("a".repeat(30) + "\n" + "b".repeat(40)),
    "a".repeat(30) + " " + "b".repeat(29),
  );
});

Deno.test("lophn-agent/conversation#R18 [agent-I8]: 앞뒤 공백을 빼고 자른 자리의 끝 공백도 뺀다", () => {
  assertEquals(autoSessionTitle("  \n hello \n"), "hello");
  assertEquals(autoSessionTitle("\t\tx\t"), "x");
  // 60번째 자리가 공백이면 그 공백은 제목에 남지 않는다.
  assertEquals(
    autoSessionTitle("a".repeat(59) + " b"),
    "a".repeat(59),
  );
  const title = autoSessionTitle("word ".repeat(30));
  assert(title !== null);
  assertEquals(title, title.trim());
});

Deno.test("lophn-agent/conversation#R18 [agent-I8]: 남는 글이 없으면 제목을 만들지 않고 번호 이름을 쓰지 않는다", () => {
  for (const text of ["", " ", "\n", " \r\n\t \u2028 "]) {
    assertEquals(autoSessionTitle(text), null);
  }
  for (const text of ["hi", "a".repeat(80), "\n\nx"]) {
    const title = autoSessionTitle(text);
    assert(title !== null);
    assert(!/^Conversation \d+$/.test(title));
  }
});

Deno.test("lophn-agent/conversation#R18 [agent-I8]: 같은 입력은 같은 제목이다", () => {
  const text = "  Plan\nthe " + "cart ".repeat(30);
  assertEquals(autoSessionTitle(text), autoSessionTitle(text));
});

Deno.test("lophn-agent/conversation#R18 [agent-I8]: rename은 앞뒤 공백을 뺀 글을 돌려준다", () => {
  const renamed = renameSessionTitle("  Cart plan \n");
  assert(renamed.ok);
  assertEquals(renamed.value, "Cart plan");
  const inner = renameSessionTitle("keep  inner   spaces");
  assert(inner.ok);
  assertEquals(inner.value, "keep  inner   spaces");
  // 자동 제목의 60자 제한은 rename에 없다.
  const long = renameSessionTitle("a".repeat(100));
  assert(long.ok);
  assertEquals(long.value, "a".repeat(100));
});

Deno.test("lophn-agent/conversation#R18 [agent-I8]: rename은 120자를 넘으면 invalid_input이다", () => {
  assertEquals(code(renameSessionTitle("가".repeat(120))), "ok");
  assertEquals(code(renameSessionTitle("가".repeat(121))), "invalid_input");
  // 길이는 앞뒤 공백을 뺀 글로 센다.
  assertEquals(code(renameSessionTitle(` ${"가".repeat(120)} `)), "ok");
  // 글자로 센다: 묶음 이모지 120개는 되고 121개는 안 된다.
  assertEquals(code(renameSessionTitle(FAMILY.repeat(120))), "ok");
  assertEquals(code(renameSessionTitle(FAMILY.repeat(121))), "invalid_input");
  assertEquals(code(renameSessionTitle(E_ACUTE.repeat(120))), "ok");
  assertEquals(code(renameSessionTitle(E_ACUTE.repeat(121))), "invalid_input");
});

Deno.test("lophn-agent/conversation#R18 [agent-I8]: rename은 비었거나 공백뿐인 제목을 거절한다", () => {
  for (const text of ["", " ", "\n", " \t\r\n ", "\u2028"]) {
    assertEquals(code(renameSessionTitle(text)), "invalid_input");
  }
});

Deno.test("lophn-agent/conversation#R18 [agent-I8]: 제목은 첫 사람 request에서 한 번 정하고 이후엔 바꾸지 않는다", () => {
  const first = {
    title: null,
    first_request: true,
    mode: "request",
    text: "Plan the cart\nwith coupons",
  } as const;
  assertEquals(titleOnReceive(first), "Plan the cart with coupons");
  // 메시지가 없는 session은 제목이 null이다: 번호 이름이 붙지 않는다.
  assertEquals(
    titleOnReceive({ ...first, first_request: false, text: "second" }),
    null,
  );
  // rename한 제목은 새 메시지가 와도 그대로다.
  assertEquals(
    titleOnReceive({ ...first, title: "My name", first_request: false }),
    "My name",
  );
  // 첫 메시지 전에 rename했어도 자동 제목이 덮어쓰지 않는다.
  assertEquals(
    titleOnReceive({ ...first, title: "Named early" }),
    "Named early",
  );
  // 자동 제목도 다시 정하지 않는다.
  assertEquals(
    titleOnReceive({ ...first, title: "Plan the cart", text: "other" }),
    "Plan the cart",
  );
});

Deno.test("lophn-agent/conversation#R18 [agent-I8]: correction은 제목을 정하지 않고 본문에서 제목이 안 나오면 null을 유지한다", () => {
  assertEquals(
    titleOnReceive({
      title: null,
      first_request: true,
      mode: "correction",
      text: "change it",
    }),
    null,
  );
  assertEquals(
    titleOnReceive({
      title: null,
      first_request: true,
      mode: "request",
      text: " \n ",
    }),
    null,
  );
  // 긴 첫 request는 앞 60자다.
  assertEquals(
    titleOnReceive({
      title: null,
      first_request: true,
      mode: "request",
      text: "x".repeat(200),
    }),
    "x".repeat(60),
  );
});
