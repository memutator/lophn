import assert from "node:assert/strict";
import { test } from "node:test";
import { ok } from "../../../../base/mod.ts";
import type { AuthenticatedContext } from "../../../../protocol/server/mod.ts";
import { toolGateHandler } from "./approvals.ts";

const SES = "ses_0000000000000000000000000a";
const OTHER = "ses_0000000000000000000000000b";
const TRN = "trn_0000000000000000000000000a";
const OTHER_TRN = "trn_0000000000000000000000000b";

function credential(session: string, turn: string): AuthenticatedContext {
  return {
    principal: `agent:${session}`,
    actor: `agent:${session}`,
    scope: { operations: [], targets: {} },
    conditions: { session, turn },
    credential_ref: "ref",
  } as AuthenticatedContext;
}

test("다른 session·turn의 자격으로는 Gate route를 부르지 못한다", async () => {
  const touched: string[] = [];
  const handler = toolGateHandler({
    approvals: {
      judge: () => {
        touched.push("judge");
        return Promise.resolve(ok({ kind: "run" as const }));
      },
      openTurnRequest: () => {
        touched.push("open");
        return ok({ id: "apr_0000000000000000000000000a" } as never);
      },
      waitTurnDecision: () => {
        touched.push("wait");
        return Promise.resolve({ outcome: "allow", scope: "once" } as never);
      },
    },
    sessionOf: () =>
      Promise.resolve(ok({ agent: { role: "lophn" as const }, place: null })),
    modeOf: () => Promise.resolve(ok("attended" as const)),
  });
  const body = {
    session: SES,
    turn: TRN,
    tool_call: "tcl_0000000000000000000000000a",
    tool: "web.fetch",
    call: { kind: "mcp_tool", server: "s", tool: "t", effect: "write" },
  };
  for (const who of [credential(OTHER, TRN), credential(SES, OTHER_TRN)]) {
    const refused = await handler(who, body);
    assert.deepStrictEqual(refused.ok ? null : refused.error.code, "forbidden");
  }
  assert.deepStrictEqual(touched, []);
  // 같은 session·turn의 자격이면 Gate까지 닿는다.
  assert.deepStrictEqual(
    await handler(credential(SES, TRN), body),
    ok({ kind: "run" }),
  );
  assert.deepStrictEqual(touched, ["judge"]);
});
