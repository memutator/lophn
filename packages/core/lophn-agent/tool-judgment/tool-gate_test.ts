import assert from "node:assert/strict";
import { test } from "node:test";
import { ok } from "../../../base/mod.ts";
import type {
  Judgment,
  PermissionDenial,
  TurnRequest,
  TurnRequestChoiceKind,
  TurnRequestOutcome,
} from "../../../protocol/approvals/mod.ts";
import {
  createToolGate,
  type DeniedToolNotice,
  type ToolGateApprovals,
  type ToolGateCall,
} from "./tool-gate.ts";

const BASE_CALL: ToolGateCall = {
  session: "ses_01hzzzzzzzzzzzzzzzzzzzzz01",
  turn: "trn_01hzzzzzzzzzzzzzzzzzzzzz01",
  toolCall: "tcl_01hzzzzzzzzzzzzzzzzzzzzz01",
  agent: "lophn_home",
  workspace: null,
  mode: "attended",
  permissionMode: "workspace",
  executionContext: "attended",
  toParent: false,
  tool: "shell.run",
  call: { kind: "shell", command: "rm -rf /" },
};

// deny 판정은 rule_pattern을 포함한 전체 PermissionDenial을 돌려주고 PermissionDenied 알림 port를 호출한다.
test("tool-gate deny는 전체 PermissionDenial을 보존하고 onDenied/publishDenial을 호출한다", async () => {
  const denial: PermissionDenial = {
    tool: "shell.run",
    category: "shell",
    target_summary: "rm -rf /",
    reason_kind: "user_deny",
    rule_pattern: "shell:rm -rf *",
    message: "blocked by deny rule shell:rm -rf *",
    recovery_hint: "Ask the person to remove or adjust the deny rule.",
    recovery_action: null,
  };
  const notices: DeniedToolNotice[] = [];
  const published: DeniedToolNotice[] = [];
  const approvals: ToolGateApprovals = {
    judge: async () => ok({ kind: "deny", denial } satisfies Judgment),
    openTurnRequest: () => {
      throw new Error("should not open turn request on deny");
    },
    waitTurnDecision: async () => {
      throw new Error("should not wait on deny");
    },
    publishDenial: (entry) => published.push(entry),
  };

  // onDenied port가 있으면 그쪽으로 알린다.
  const gateWithPort = createToolGate({
    approvals,
    onDenied: (entry) => notices.push(entry),
  });
  const denied = await gateWithPort.check(BASE_CALL);
  assert.ok(denied.ok);
  assert.deepStrictEqual(denied.value, { kind: "denied", denial });
  assert.equal(notices.length, 1);
  assert.deepStrictEqual(notices[0], {
    session: BASE_CALL.session,
    turn: BASE_CALL.turn,
    tool_call: BASE_CALL.toolCall,
    denial,
  });
  assert.equal(published.length, 0);

  // onDenied가 없으면 approvals.publishDenial로 알린다.
  const gateFallback = createToolGate({ approvals });
  const denied2 = await gateFallback.check(BASE_CALL);
  assert.ok(denied2.ok);
  assert.equal(published.length, 1);
  assert.equal(published[0]?.denial.rule_pattern, "shell:rm -rf *");
});

// ask 판정은 allowed_choices, reason, outside_rewind를 openTurnRequest로 그대로 넘기고 거절/취소/실행을 변환한다.
test("tool-gate ask는 allowed_choices·reason·outside_rewind를 openTurnRequest에 넘긴다", async () => {
  let openedOptions:
    | {
        allowedChoices?: readonly TurnRequestChoiceKind[];
        reason?: string | null;
        outsideRewind?: boolean;
      }
    | undefined;
  let nextOutcome: TurnRequestOutcome = {
    outcome: "reject",
    reason: "not now",
  };
  const approvals: ToolGateApprovals = {
    judge: async (_call, who) => {
      assert.equal(who.permissionMode, "workspace");
      assert.equal(who.executionContext, "attended");
      return ok({
        kind: "ask",
        allowed_choices: ["once", "session"],
        reason: "outside workspace folder",
        outside_rewind: true,
      } satisfies Judgment);
    },
    openTurnRequest: (origin, subject, options) => {
      openedOptions = options;
      return ok({
        id: "trq_01hzzzzzzzzzzzzzzzzzzzzz01",
        session: origin.session,
        turn: origin.turn,
        tool_call: origin.tool_call,
        workspace: origin.workspace,
        to_parent: origin.toParent,
        subject,
      } as unknown as TurnRequest);
    },
    waitTurnDecision: async () => nextOutcome,
  };

  const gate = createToolGate({ approvals });
  const rejected = await gate.check(BASE_CALL);
  assert.ok(rejected.ok);
  assert.deepStrictEqual(openedOptions, {
    allowedChoices: ["once", "session"],
    reason: "outside workspace folder",
    outsideRewind: true,
  });
  assert.deepStrictEqual(rejected.value, {
    kind: "rejected",
    reason: "not now",
    by: "person",
  });

  nextOutcome = { outcome: "allow", scope: "once" };
  const allowed = await gate.check(BASE_CALL);
  assert.ok(allowed.ok);
  assert.deepStrictEqual(allowed.value, { kind: "run" });
});
