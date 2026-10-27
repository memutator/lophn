import assert from "node:assert/strict";
import { test } from "node:test";

import { z } from "zod";

import { commandRequestSchema } from "../../protocol/base/envelope.ts";
import { defineCommand } from "../../protocol/base/route.ts";
import { commandBody } from "./command-call.ts";

// 칸 하나가 빠져 설정의 provider 연결이 모두 core 앞에서 거절된 bug를 막는다. 지키는 것은 봉투 칸이라
// 입력이 비어 있는 작은 route로 본다.
const base = {
  resource: "probe",
  input: z.strictObject({}),
  output: z.object({}),
  actors: ["user"],
  errors: ["invalid_input"],
} as const;
const plain = defineCommand({ ...base, method: "plain", name: "Plain" });
const compared = defineCommand({
  ...base,
  method: "compared",
  name: "Compared",
  compare: z.strictObject({ revision: z.number() }),
});
const confirmed = defineCommand({
  ...base,
  method: "confirmed",
  name: "Confirmed",
  input: z.strictObject({ item: z.string() }),
  confirmation: "required",
  binding: ["item"],
});
const REF = "a".repeat(43);

test("helper가 만든 봉투는 route의 봉투 schema를 통과한다", () => {
  const cases = [
    [plain, { input: {}, compare: {}, key: "probe-key" }],
    [compared, { input: {}, compare: { revision: 2 }, key: "probe-key" }],
    [
      confirmed,
      {
        input: { item: "x" },
        compare: {},
        key: "probe-key",
        confirmation: REF,
      },
    ],
  ] as const;
  for (const [route, body] of cases) {
    const parsed = commandRequestSchema(route as never).safeParse(
      commandBody(route as never, body as never),
    );
    assert.ok(parsed.success, `${route.method}: ${parsed.error?.message}`);
  }
});
