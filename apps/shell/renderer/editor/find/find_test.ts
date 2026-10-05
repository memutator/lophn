import { assertEquals } from "@std/assert";

import {
  findLabel,
  findMatches,
  nearestMatch,
  replaceAll,
  stepMatch,
} from "./find.ts";

Deno.test("shell/editor#R11: 찾기는 글자 그대로 겹치지 않게 찾고 대소문자 구별을 고른다", () => {
  assertEquals(findMatches("Aa aa AA", "aa"), [
    { from: 0, to: 2 },
    { from: 3, to: 5 },
    { from: 6, to: 8 },
  ]);
  assertEquals(findMatches("Aa aa AA", "aa", { caseSensitive: true }), [
    { from: 3, to: 5 },
  ]);
  assertEquals(findMatches("a.b", "."), [{ from: 1, to: 2 }]);
  assertEquals(findMatches("text", ""), []);
});

Deno.test("shell/editor#R11: 다음·이전은 끝에서 돌고 커서 뒤 첫 일치에서 시작한다", () => {
  const matches = findMatches("x x x", "x");
  assertEquals(nearestMatch(matches, 1), 1);
  assertEquals(nearestMatch(matches, 9), 0);
  assertEquals(stepMatch(2, 3, 1), 0);
  assertEquals(stepMatch(0, 3, -1), 2);
  assertEquals(stepMatch(-1, 0, 1), -1);
});

Deno.test("shell/editor#R11: 개수 표시는 위치/전체이고 상한이면 +를 붙인다", () => {
  assertEquals(findLabel(-1, 0), "No matches");
  assertEquals(findLabel(2, 12), "3/12");
  assertEquals(findLabel(0, 1000), "1/1,000+");
});

Deno.test("shell/editor#R11: 모두 바꾸기는 일치마다 바꾸고 개수를 돌려준다", () => {
  const text = "cat cat dog";
  assertEquals(replaceAll(text, findMatches(text, "cat"), "fox"), {
    text: "fox fox dog",
    count: 2,
  });
});
