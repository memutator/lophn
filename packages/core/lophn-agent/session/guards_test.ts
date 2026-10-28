import assert from "node:assert/strict";
import { test } from "node:test";
import type { RequestContext } from "../../../protocol/server/mod.ts";
import { requireUserOrMachine } from "./guards.ts";

// Compact 요청은 사람과 runtime만 연다. agent가 자기 session을 Compact하면 사람이 모르는 사이 이전 대화가 요약된다.
test("Compact 요청은 사람과 runtime만 열고 agent와 앱은 못 연다", () => {
  const as = (actor: string) =>
    requireUserOrMachine({ actor } as RequestContext).ok;
  assert.deepStrictEqual(
    ["user", "machine", "agent:ses_01", "app:app_01"].map(as),
    [true, true, false, false],
  );
});
