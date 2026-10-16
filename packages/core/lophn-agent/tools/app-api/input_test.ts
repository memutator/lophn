import { assertEquals } from "@std/assert";
import type { InputSchema } from "../../../../protocol/apps/mod.ts";
import { appApiInput } from "./input.ts";

const PROJECT = "prj_01zzzzzzzzzzzzzzzzzzzzzzzz";
const OTHER = "prj_01j00000000000000000000000";
const api = {
  input: {
    type: "object",
    properties: { title: { type: "string" } },
    required: ["title"],
  } satisfies InputSchema,
  project_scope: true,
};

function accepts(
  place: Parameters<typeof appApiInput>[1],
  value: unknown,
): boolean {
  return appApiInput(api, place).validator.safeParse(value).success;
}

Deno.test("project에 놓인 agent는 app-api 입력으로 다른 project를 지정할 수 없다", () => {
  const placed = { kind: "project", id: PROJECT } as const;
  assertEquals(accepts(placed, { title: "a" }), true);
  assertEquals(accepts(placed, { title: "a", project: PROJECT }), false);
  assertEquals(accepts(placed, { title: "a", project: OTHER }), false);
  assertEquals(
    JSON.stringify(appApiInput(api, placed).jsonSchema).includes("project"),
    false,
  );

  // lophn과 앱 place의 agent는 project를 입력으로 정한다. 이 칸은 앱 입력에 섞이지 않는다.
  for (
    const place of [
      null,
      { kind: "app", id: "app_01zzzzzzzzzzzzzzzzzzzzzzzz" } as const,
    ]
  ) {
    assertEquals(accepts(place, { title: "a" }), false);
    assertEquals(accepts(place, { title: "a", project: OTHER }), true);
    assertEquals(
      appApiInput(api, place).split({ title: "a", project: OTHER }),
      { input: { title: "a" }, project: OTHER },
    );
  }
});
