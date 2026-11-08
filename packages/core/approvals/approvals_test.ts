import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createIdSource,
  manualClock,
  ok,
  seededRandom,
} from "../../base/mod.ts";
import { createApprovals } from "./mod.ts";

const SES = "ses_0000000000000000000000000a";

test("사람이 아닌 자격은 turn request를 결정하지 못한다", async () => {
  const clock = manualClock(Date.UTC(2026, 0, 1));
  const approvals = createApprovals({
    assignmentOf: (agent) => Promise.resolve(ok({ agent, entries: [] })),
    shellRules: () => ({ floor: [], layers: [] }),
    bus: { publish: () => {} },
    clock,
    ids: createIdSource({ clock, random: seededRandom(1) }),
  });
  const opened = approvals.openTurnRequest(
    {
      session: SES,
      turn: "trn_0000000000000000000000000a",
      tool_call: "tcl_0000000000000000000000000a",
      workspace: null,
      toParent: false,
    },
    { kind: "shell", command: "rm -r x" },
  );
  assert.ok(opened.ok);

  for (const actor of [`agent:${SES}`, "machine"]) {
    const refused = await approvals.decide(
      { actor },
      {
        session: SES,
        request: opened.value.id,
        choice: { kind: "once" },
      },
    );
    assert.ok(!refused.ok && refused.error.code === "forbidden");
  }
  // 요청은 그대로 기다린다.
  assert.deepStrictEqual(
    approvals.turnRequests(SES).map((one) => one.id),
    [opened.value.id],
  );
});

function teamSetup() {
  const clock = manualClock(Date.UTC(2026, 0, 1));
  const approvals = createApprovals({
    assignmentOf: (agent) => Promise.resolve(ok({ agent, entries: [] })),
    shellRules: () => ({ floor: [], layers: [] }),
    bus: { publish: () => {} },
    clock,
    ids: createIdSource({ clock, random: seededRandom(1) }),
  });
  const always: string[] = [];
  approvals.remember("shell", () => {
    always.push("saved");
    return Promise.resolve(ok(undefined));
  });
  const open = (toParent: boolean) => {
    const opened = approvals.openTurnRequest(
      {
        session: SES,
        turn: "trn_0000000000000000000000000a",
        tool_call: "tcl_0000000000000000000000000a",
        workspace: null,
        toParent,
      },
      { kind: "shell", command: "rm -r x" },
    );
    assert.ok(opened.ok);
    return opened.value;
  };
  return { approvals, always, open };
}

test("부모가 푼 request는 once이고 always 규칙을 더하지 않으며 사람은 결정하지 못한다", async () => {
  const { approvals, always, open } = teamSetup();
  const request = open(true);
  assert.strictEqual(request.to_parent, true);
  assert.deepStrictEqual(request.always_patterns, []);
  // 카드가 없는 request를 사람이 결정하는 길은 없다.
  for (const choice of [{ kind: "once" }, { kind: "always" }] as const) {
    const refused = await approvals.decide(
      { actor: "user" },
      { session: SES, request: request.id, choice },
    );
    assert.ok(!refused.ok && refused.error.code === "not_found");
  }
  approvals.answerFromParent(request.id, "allow", null);
  assert.deepStrictEqual(await approvals.waitTurnDecision(request.id), {
    outcome: "allow",
    scope: "once",
  });
  assert.deepStrictEqual(always, []);
});

test("부모가 끝나 거절로 풀린 request는 이유를 싣고 다시 풀리지 않는다", async () => {
  const { approvals, open } = teamSetup();
  const request = open(true);
  approvals.answerFromParent(
    request.id,
    "reject",
    "the parent session ended without answering",
  );
  approvals.answerFromParent(request.id, "allow", null);
  assert.deepStrictEqual(await approvals.waitTurnDecision(request.id), {
    outcome: "reject",
    reason: "the parent session ended without answering",
  });
});

test("팀 밖 request는 사람이 결정하고 to_parent가 아니다", async () => {
  const { approvals, open } = teamSetup();
  const request = open(false);
  assert.strictEqual(request.to_parent, false);
  const decided = await approvals.decide(
    { actor: "user" },
    { session: SES, request: request.id, choice: { kind: "once" } },
  );
  assert.ok(decided.ok);
});
