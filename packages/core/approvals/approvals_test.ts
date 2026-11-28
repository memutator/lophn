import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createIdSource,
  manualClock,
  ok,
  seededRandom,
} from "../../base/mod.ts";
import {
  type PermissionDenial,
  PRODUCT_FLOOR_RULES,
} from "../../protocol/approvals/mod.ts";
import type { AgentEvent } from "../../protocol/events/agent.ts";
import { createApprovals } from "./mod.ts";

const SES = "ses_0000000000000000000000000a";
const TRN = "trn_0000000000000000000000000a";
const TCL = "tcl_0000000000000000000000000a";

function makeApprovals() {
  const clock = manualClock(Date.UTC(2026, 0, 1));
  const published: AgentEvent[] = [];
  const approvals = createApprovals({
    appAccessOf: () =>
      Promise.resolve(ok({ reached: false, slug: "ledger", skills: [] })),
    permissionRules: () => ({
      floor: PRODUCT_FLOOR_RULES,
      global: [],
      project: [],
    }),
    bus: {
      publish(event) {
        published.push(event as AgentEvent);
      },
    },
    clock,
    ids: createIdSource({ clock, random: seededRandom(1) }),
  });
  return { approvals, published };
}

test("사람이 아닌 자격은 turn request를 결정하거나 session grant를 해제하지 못한다", async () => {
  const { approvals } = makeApprovals();
  const opened = approvals.openTurnRequest(
    {
      session: SES,
      turn: TRN,
      tool_call: TCL,
      workspace: null,
      toParent: false,
    },
    { kind: "shell", command: "npm test" },
    { allowedChoices: ["once", "session", "always", "reject"] },
  );
  assert.ok(opened.ok);

  for (const actor of [`agent:${SES}`, "machine"]) {
    const refused = await approvals.decide(
      { actor },
      { session: SES, request: opened.value.id, choice: { kind: "once" } },
    );
    assert.ok(!refused.ok && refused.error.code === "forbidden");

    const revokeRefused = approvals.revokeGrant(
      { actor },
      { session: SES, grant: "grt_0000000000000000000000000a" },
    );
    assert.ok(!revokeRefused.ok && revokeRefused.error.code === "forbidden");
  }
  assert.deepStrictEqual(
    approvals.turnRequests(SES).map((one) => one.id),
    [opened.value.id],
  );
});

test("allowed_choices에 없는 선택지는 invalid_input으로 거절된다", async () => {
  const { approvals } = makeApprovals();
  // rm -rf ./dist는 금지 접두사라 always_patterns가 비고 always가 빠진다.
  const opened = approvals.openTurnRequest(
    {
      session: SES,
      turn: TRN,
      tool_call: TCL,
      workspace: null,
      toParent: false,
    },
    { kind: "shell", command: "rm -rf ./dist" },
    {
      allowedChoices: ["once", "session", "always", "reject"],
      reason: "destructive",
      outsideRewind: true,
    },
  );
  assert.ok(opened.ok);
  assert.deepStrictEqual(opened.value.always_patterns, []);
  assert.deepStrictEqual(opened.value.allowed_choices, [
    "once",
    "session",
    "reject",
  ]);

  const badAlways = await approvals.decide(
    { actor: "user" },
    { session: SES, request: opened.value.id, choice: { kind: "always" } },
  );
  assert.ok(!badAlways.ok && badAlways.error.code === "invalid_input");

  // 사람 전용 setting 요청은 once·reject만 받는다.
  const settingReq = approvals.openTurnRequest(
    {
      session: SES,
      turn: TRN,
      tool_call: TCL,
      workspace: null,
      toParent: false,
    },
    { kind: "setting", key: "folder.destinations", lines: ["Add sync folder"] },
    { allowedChoices: ["once", "reject"] },
  );
  assert.ok(settingReq.ok);
  const badSession = await approvals.decide(
    { actor: "user" },
    { session: SES, request: settingReq.value.id, choice: { kind: "session" } },
  );
  assert.ok(!badSession.ok && badSession.error.code === "invalid_input");
});

test("session 선택지는 이 대화 동안 허락을 기록하고 개별 해제와 session 종료 시 사라진다", async () => {
  const { approvals } = makeApprovals();
  const opened = approvals.openTurnRequest(
    {
      session: SES,
      turn: TRN,
      tool_call: TCL,
      workspace: null,
      toParent: false,
    },
    {
      kind: "file_read",
      path: "/outside/notes.md",
      folder: "/outside",
      outside_workspace: true,
      sensitive: false,
    },
    { allowedChoices: ["once", "session", "reject"], outsideRewind: false },
  );
  assert.ok(opened.ok);

  const decided = await approvals.decide(
    { actor: "user" },
    { session: SES, request: opened.value.id, choice: { kind: "session" } },
  );
  assert.ok(decided.ok);
  assert.deepStrictEqual(decided.value.outcome, {
    outcome: "allow",
    scope: "session",
  });

  // 바깥 폴더가 열렸고 후속 judge가 run을 돌려준다.
  assert.deepStrictEqual(approvals.sessionGrants.openedFolders(SES), [
    "/outside",
  ]);
  const judgedAfter = await approvals.judge(
    {
      kind: "file_read",
      path: "/outside/other.md",
      folder: "/outside",
      outside_workspace: true,
      sensitive: false,
    },
    {
      agent: "lophn_home",
      session: SES,
      workspace: null,
      mode: "workspace",
      context: "attended",
    },
  );
  assert.ok(judgedAfter.ok);
  assert.deepStrictEqual(judgedAfter.value, { kind: "run" });

  // 개별 해제하면 다시 묻는다.
  const grantId = approvals.sessionGrants.list(SES)[0].id;
  const revoked = approvals.revokeGrant(
    { actor: "user" },
    { session: SES, grant: grantId },
  );
  assert.ok(revoked.ok && revoked.value.revoked === true);

  const judgedRevoked = await approvals.judge(
    {
      kind: "file_read",
      path: "/outside/other.md",
      folder: "/outside",
      outside_workspace: true,
      sensitive: false,
    },
    {
      agent: "lophn_home",
      session: SES,
      workspace: null,
      mode: "workspace",
      context: "attended",
    },
  );
  assert.ok(judgedRevoked.ok && judgedRevoked.value.kind === "ask");

  // turn_ended는 session grant를 유지하고, session_closed는 비운다.
  approvals.sessionGrants.grant(SES, {
    category: "shell",
    pattern: "npm test *",
    label: "npm test *",
  });
  approvals.cancelTurnRequests(SES, "turn_ended");
  assert.strictEqual(approvals.sessionGrants.list(SES).length, 1);
  approvals.cancelTurnRequests(SES, "session_closed");
  assert.strictEqual(approvals.sessionGrants.list(SES).length, 0);
});

test("부모가 푼 팀 자식 request는 once이고 always 규칙을 더하지 않으며 사람은 결정하지 못한다", async () => {
  const { approvals } = makeApprovals();
  const alwaysSaved: string[] = [];
  approvals.remember("shell", () => {
    alwaysSaved.push("saved");
    return Promise.resolve(ok(undefined));
  });

  const opened = approvals.openTurnRequest(
    {
      session: SES,
      turn: TRN,
      tool_call: TCL,
      workspace: null,
      toParent: true,
    },
    { kind: "shell", command: "npm test" },
  );
  assert.ok(opened.ok);
  const request = opened.value;
  assert.strictEqual(request.to_parent, true);
  assert.deepStrictEqual(request.always_patterns, []);
  assert.deepStrictEqual(request.allowed_choices, ["once", "reject"]);

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
  assert.deepStrictEqual(alwaysSaved, []);
});

test("publishDenial은 PermissionDenied event를 내고 최근 거부를 /permissions 응답에 싣는다", () => {
  const { approvals, published } = makeApprovals();
  const denial: PermissionDenial = {
    tool: "shell.run",
    category: "shell",
    target_summary: "rm -rf ~",
    reason_kind: "floor",
    rule_pattern: "rm -rf ~",
    message: "Blocked by floor rule",
    recovery_hint: null,
    recovery_action: null,
  };
  approvals.publishDenial({ session: SES, turn: TRN, tool_call: TCL }, denial);

  const event = published.find((e) => e.type === "PermissionDenied");
  assert.ok(event !== undefined);
  assert.deepStrictEqual(event.payload.denial, denial);

  const view = approvals.buildSessionPermissions({
    session: SES,
    mode: "workspace",
    workspace: null,
    workspaceFolders: ["/repo"],
    mcpServers: [{ name: "github", trust: "untrusted", enabled: true }],
    localTools: [],
  });
  assert.strictEqual(view.floor_count, PRODUCT_FLOOR_RULES.length);
  assert.strictEqual(view.recent_denials.length, 1);
  assert.deepStrictEqual(view.recent_denials[0].denial, denial);
});
