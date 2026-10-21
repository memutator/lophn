import { assertEquals } from "@std/assert";
import { OPERATOR_TOOLS } from "./operator.ts";

// skip 기본값은 사람만 쓴다. PM과 App Engineer가 정의를 만들거나 고쳐 허락 확인을 끌 수 없어야 한다.
Deno.test("Operator 정의의 skip 기본값 칸은 PM과 App Engineer의 tool로 쓸 수 없다", () => {
  const cases: [string, Record<string, unknown>][] = [
    ["operator.create", { place: { project: "prj" }, name: "ops", body: "b" }],
    ["operator.update", { operator: "ops", body: "b" }],
  ];
  for (const [name, minimal] of cases) {
    const tool = OPERATOR_TOOLS.find((entry) => entry.name === name)!;
    assertEquals(tool.input.safeParse(minimal).success, true, name);
    assertEquals(
      tool.input.safeParse({ ...minimal, skip: true }).success,
      false,
      name,
    );
  }
});
