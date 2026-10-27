import assert from "node:assert/strict";
import { test } from "node:test";
import { entitlementAllows } from "../../../protocol/lophn-agent/mod.ts";
import { parseReportedModels, readReportedModels } from "./reported-models.ts";

// 응답이 어떤 모양이든 보이는 model을 숨기지 않는다. 읽지 못한 것은 null(거르지 않음)이다.
test("계정 model 목록 응답이 틀리면 null이고, 맞으면 숨긴 것만 빠진다", async () => {
  const cases: [string, Response, string[] | null][] = [
    [
      "list와 visibility 없음은 남는다",
      Response.json({
        data: [
          { id: "b", visibility: "list" },
          { id: "a" },
          {
            id: "c",
            visibility: "hide",
          },
        ],
      }),
      ["a", "b"],
    ],
    ["200이 아님", new Response("{}", { status: 401 }), null],
    ["JSON 아님", new Response("<html>"), null],
    ["data 없음", Response.json({ models: [{ id: "a" }] }), null],
    ["id 없음", Response.json({ data: [{ name: "a" }] }), null],
    [
      "보이는 항목 0개",
      Response.json({ data: [{ id: "a", visibility: "hide" }] }),
      null,
    ],
  ];
  for (const [name, response, expected] of cases) {
    const got = await readReportedModels(
      () => Promise.resolve(response),
      "https://example.test/models",
      "t",
    );
    assert.deepStrictEqual(got, expected, name);
  }
  assert.deepStrictEqual(
    await readReportedModels(
      () => Promise.reject(new Error("deadline")),
      "https://example.test/models",
      "t",
    ),
    null,
  );
  assert.deepStrictEqual(parseReportedModels('{"data":[]}'), null);
  assert.deepStrictEqual(entitlementAllows("oauth", null, "anything"), true);
  assert.deepStrictEqual(entitlementAllows("oauth", ["a"], "b"), false);
});
