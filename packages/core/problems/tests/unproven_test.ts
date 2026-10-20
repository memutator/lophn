import { assertEquals } from "@std/assert";
import {
  unprovenAfterExamples,
  unprovenNote,
  unprovenOfReason,
} from "./unproven.ts";

// 사용자 data를 되돌리는 규칙의 알림이 빠지거나 넘치는 것을 막는다.
Deno.test("examples run 뒤 알릴 tool은 app test의 unproven에서 examples가 증명한 tool을 뺀 것이다", () => {
  const rows: [
    string,
    string[] | undefined,
    "pass" | "fail" | "inconclusive",
    string[],
    string[],
  ][] = [
    ["examples가 일부를 증명했다", ["a", "b"], "pass", ["a"], ["b"]],
    ["모두 증명했다", ["a"], "pass", ["a"], []],
    [
      "fail이면 알리지 않는다(맡은 session이 이미 그 실패를 받는다)",
      ["a", "b"],
      "fail",
      ["a"],
      [],
    ],
    ["inconclusive면 알리지 않는다", ["a"], "inconclusive", [], []],
    ["app test가 없으면 알리지 않는다", undefined, "fail", [], []],
    ["unproven이 없으면 알리지 않는다", [], "pass", ["a"], []],
  ];
  for (const [name, unproven, result, proven, expected] of rows) {
    assertEquals(
      unprovenAfterExamples({
        appTestUnproven: unproven,
        examples: { result, proven },
      }),
      expected,
      name,
    );
  }
});

Deno.test("pass 이유에 붙인 한 줄에서 같은 tool 이름이 돌아오고 한 줄이 없으면 비어 있다", () => {
  const tools = ["a.add", "a.remove"];
  assertEquals(
    unprovenOfReason("모든 필수 검사가 실제로 통과했다" + unprovenNote(tools)),
    tools,
  );
  assertEquals(unprovenOfReason("모든 필수 검사가 실제로 통과했다"), []);
});
