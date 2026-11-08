import assert from "node:assert/strict";
import { test } from "node:test";
import { ok } from "../../../../base/mod.ts";
import type { TurnMode } from "../../../../protocol/lophn-agent/turn-values.ts";
import type { AuthenticatedContext } from "../../../../protocol/server/mod.ts";
import { askWaitHandler, toolGateHandler } from "./approvals.ts";

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
      Promise.resolve(
        ok({
          agent: "lophn_home",
          workspace: null,
          spawnedBy: null,
          skip: false,
        }),
      ),
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

const QUESTIONS = [
  {
    question: "Which one?",
    header: "Pick",
    options: [
      { label: "a", description: "first" },
      { label: "b", description: "second" },
    ],
    multiSelect: false,
  },
];

function askWith(
  session: { spawnedBy: string | null; skip: boolean },
  mode: TurnMode,
) {
  const asked: boolean[] = [];
  const handler = askWaitHandler({
    ask: (_call, _questions, toParent) => {
      asked.push(toParent);
      return Promise.resolve({ outcome: "parent_reply", message: "a" });
    },
    sessionOf: () =>
      Promise.resolve(ok({ agent: "lophn_home", workspace: null, ...session })),
    modeOf: () => Promise.resolve(ok(mode)),
  });
  const run = () =>
    handler(credential(SES, TRN), {
      session: SES,
      turn: TRN,
      tool_call: "tcl_0000000000000000000000000a",
      questions: QUESTIONS,
    });
  return { asked, run };
}

test("팀 밖 session의 ask는 그대로다: unattended turn은 묻지 않고, 아니면 사람에게 기다린다", async () => {
  const unattended = askWith({ spawnedBy: null, skip: false }, "unattended");
  assert.deepStrictEqual(await unattended.run(), ok({ outcome: "unattended" }));
  assert.deepStrictEqual(unattended.asked, []);
  for (const mode of ["attended", "skip"] as const) {
    const person = askWith({ spawnedBy: null, skip: false }, mode);
    await person.run();
    assert.deepStrictEqual(person.asked, [false], mode);
  }
});

test("팀 자식의 ask는 mode와 skip에 상관없이 부모에게 간다", async () => {
  for (const mode of ["attended", "unattended", "skip"] as const) {
    for (const skip of [false, true]) {
      const child = askWith({ spawnedBy: "ses_parent", skip }, mode);
      await child.run();
      assert.deepStrictEqual(child.asked, [true], `${mode} skip=${skip}`);
    }
  }
});

test("shell ask를 부모에게 보내는 것은 팀 자식이고 skip을 켜지 않은 session뿐이다", async () => {
  const seen: boolean[] = [];
  for (const [spawnedBy, skip] of [
    [null, false],
    ["ses_parent", false],
    ["ses_parent", true],
  ] as const) {
    const handler = toolGateHandler({
      approvals: {
        judge: (_call, who) => {
          seen.push(who.toParent);
          return Promise.resolve(ok({ kind: "run" as const }));
        },
        openTurnRequest: () => {
          throw new Error("not reached");
        },
        waitTurnDecision: () => {
          throw new Error("not reached");
        },
      },
      sessionOf: () =>
        Promise.resolve(
          ok({ agent: "lophn_home", workspace: null, spawnedBy, skip }),
        ),
      modeOf: () => Promise.resolve(ok("unattended" as const)),
    });
    await handler(credential(SES, TRN), {
      session: SES,
      turn: TRN,
      tool_call: "tcl_0000000000000000000000000a",
      tool: "shell.run",
      call: { kind: "shell", command: "rm -r x" },
    });
  }
  assert.deepStrictEqual(seen, [false, true, false]);
});
