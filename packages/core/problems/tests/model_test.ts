import { assertEquals } from "@std/assert";
import { ok } from "../../../base/mod.ts";
import type { RequestContext } from "../../../protocol/server/mod.ts";
import {
  canListVerifications,
  canReadVerification,
  scopeCovers,
} from "./model.ts";

const APP = "app_01hzzzzzzzzzzzzzzzzzzzzzza";
const OTHER = "app_01hzzzzzzzzzzzzzzzzzzzzzzb";
const OPERATIONS = ["GetVerification", "ListVerifications"];

function context(actor: string, targets: Record<string, string>) {
  return {
    actor,
    principal: actor,
    scope: { operations: OPERATIONS, targets },
    conditions: {},
  } as unknown as RequestContext;
}

// user token에는 app target이 없다. 검사 결과는 어느 앱의 것이든 읽고, 앱에 묶인 coding token은 자기 앱만이다.
Deno.test("검사 결과 읽기는 user는 앱 target 없이, coding token은 자기 앱만 허락한다", () => {
  const allow = () => ok(undefined);
  const cases: [string, RequestContext, boolean][] = [
    ["user", context("user", {}), true],
    ["coding own app", context("coding_agent:s", { app: APP }), true],
    ["coding other app", context("coding_agent:s", { app: OTHER }), false],
  ];
  for (const [name, ctx, expected] of cases) {
    assertEquals(
      canReadVerification(ctx, { app: APP }, allow).ok,
      expected,
      `read ${name}`,
    );
    assertEquals(canListVerifications(ctx, APP).ok, expected, `list ${name}`);
    assertEquals(scopeCovers(ctx, { app: APP }), expected, `row ${name}`);
  }
});
