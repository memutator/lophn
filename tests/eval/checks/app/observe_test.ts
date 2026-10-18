import { assertEquals } from "@std/assert";
import { decideNoRecurrence } from "./diagnose.ts";
import { decideFailure, namesMissing } from "./observe.ts";

const p = (id: string, name: string, count: number, recurred = null) => ({
  id,
  name,
  occurrence_count: count,
  recurred,
});

Deno.test("실패는 새 problem이 열린 것만 통과한다: 이름이 같아 묶인 것과 조용히 넘어간 것은 떨어진다", () => {
  const before = [p("prb_1", "event_input_invalid", 1)];
  const table: [string, ReturnType<typeof p>[], boolean][] = [
    ["새 problem", [...before, p("prb_2", "notify_call_failed", 1)], true],
    [
      "이름이 같아 묶여 발생만 늘어남",
      [p("prb_1", "event_input_invalid", 2)],
      false,
    ],
    ["아무것도 안 바뀜", before, false],
  ];
  for (const [name, after, pass] of table) {
    assertEquals(decideFailure(before, after, "failed").pass, pass, name);
  }
});

Deno.test("고친 뒤 같은 호출이 발생 수를 늘리거나 새 problem을 열거나 recurred를 채우면 떨어진다", () => {
  const before = [p("prb_1", "x", 2)];
  const table: [string, ReturnType<typeof p>[], boolean][] = [
    ["그대로", [p("prb_1", "x", 2)], true],
    ["발생 수가 늘어남", [p("prb_1", "x", 3)], false],
    ["새 problem", [p("prb_1", "x", 2), p("prb_2", "y", 1)], false],
    ["다시 열림", [p("prb_1", "x", 2, { at: "t" } as never)], false],
  ];
  for (const [name, after, pass] of table) {
    assertEquals(decideNoRecurrence(before, after).pass, pass, name);
  }
});

Deno.test("ticket 글에 없는 problem 이름만 골라낸다", () => {
  assertEquals(
    namesMissing(["a_failed", "b_failed", "a_failed"], "goal: fix a_failed"),
    ["b_failed"],
  );
});
