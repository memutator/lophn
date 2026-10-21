// 세 질문
// - contract: eval roadmap "특정 시나리오에 맞추지 않기" 3. 더해진 줄에 시나리오 고유의 이름·사람 말 구절이 들면 경고한다.
// - 현실적 회귀: 옛 글에 이미 있던 이름을 새 경고로 내거나, `tax`가 `taxonomy`에 걸리거나.
// - 왜 지금 test로 못 잡나: 이 경고는 ex-cli만 부르고, 틀려도 채택이 막히지 않아 어디서도 터지지 않는다.
import { assertEquals } from "@std/assert";
import type { Scenario } from "../../types.ts";
import { findOverfit } from "./mod.ts";

const scenario = {
  id: "L4-app",
  n: 1,
  real: [
    { role: "operator", place: { app: "가계부" }, name: "Mina" },
  ],
  human: { card: "월별 지출 합계를 보고 싶다", approve: {} },
  steps: [
    {
      kind: "say",
      to: { role: "project_agent", place: { project: "tax" } },
      text: "hello",
    },
  ],
} as unknown as Scenario;

const change = {
  from: { kind: "instruction", name: "lophn", n: 3 },
  to: { kind: "instruction", name: "lophn", n: 4 },
} as const;
const run = (before: string, after: string) =>
  findOverfit({ change, before: { "": before }, after: { "": after } }, [
    scenario,
  ]);
const terms = (before: string, after: string) =>
  run(before, after).map((w) => `${w.kind}:${w.term}`);

Deno.test("더해진 줄의 앱 이름과 요구 카드 구절은 경고하고, 옛 글에 있던 것과 단어 일부는 아니다", () => {
  assertEquals(terms("a", "a\n가계부 앱을 만들 때는"), ["name:가계부"]);
  assertEquals(terms("a", "a\n월별 지출 합계를 표로 보여 준다"), [
    "phrase:월별 지출 합계를",
  ]);
  // 옛 글에 이미 한 번 있었고 이번에 더 늘지 않았다
  assertEquals(terms("가계부 앱\nb", "가계부 앱\nb\nc"), []);
  assertEquals(terms("가계부 앱", "가계부 앱 설명\n"), []);
  // 단어 경계
  assertEquals(terms("a", "a\ntaxonomy를 쓴다"), []);
  assertEquals(terms("a", "a\nuse tax rules"), ["name:tax"]);
});
