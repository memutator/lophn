import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type CallPolicy,
  DEFAULT_CALL_POLICY,
  mayCall,
} from "./call-policy.ts";
import type { AgentAtWorkspace, AgentId } from "./workspaces.ts";

// 권한 경계다. private workspace는 다른 workspace와 call을 주고받지 않고, workspace 쌍과 agent 쌍 규칙이 그 위의 예외다.
test("a private workspace takes and sends no call across workspaces unless a pair rule opens it", () => {
  const work = { kind: "project", id: "prj_work" } as const;
  const hobby = { kind: "project", id: "prj_hobby" } as const;
  const a = "agt_a" as AgentId;
  const b = "agt_b" as AgentId;
  const at = (
    agent: AgentId,
    workspace: AgentAtWorkspace["workspace"],
  ): AgentAtWorkspace => ({
    agent,
    workspace,
  });
  const isolated: CallPolicy = { ...DEFAULT_CALL_POLICY, private: [work] };
  const cases: [
    string,
    CallPolicy,
    AgentAtWorkspace,
    AgentAtWorkspace,
    boolean,
  ][] = [
    ["no rule", DEFAULT_CALL_POLICY, at(a, hobby), at(b, work), true],
    ["into private", isolated, at(a, hobby), at(b, work), false],
    ["out of private", isolated, at(a, work), at(b, hobby), false],
    ["private to home", isolated, at(a, work), at(b, null), false],
    ["home to private", isolated, at(a, null), at(b, work), false],
    ["inside private", isolated, at(a, work), at(b, work), true],
    ["between public", isolated, at(a, hobby), at(b, null), true],
    [
      "workspace pair opens private",
      {
        ...isolated,
        workspaces: [{ from: work, to: { kind: "home" }, allow: true }],
      },
      at(a, work),
      at(b, null),
      true,
    ],
    [
      "agent pair opens private",
      { ...isolated, agents: [{ from: a, to: b, allow: true }] },
      at(a, hobby),
      at(b, work),
      true,
    ],
    [
      "agent pair beats workspace pair",
      {
        ...DEFAULT_CALL_POLICY,
        workspaces: [{ from: hobby, to: work, allow: false }],
        agents: [{ from: a, to: b, allow: true }],
      },
      at(a, hobby),
      at(b, work),
      true,
    ],
    [
      "workspace pair refuses inside one workspace",
      {
        ...DEFAULT_CALL_POLICY,
        workspaces: [{ from: work, to: work, allow: false }],
      },
      at(a, work),
      at(b, work),
      false,
    ],
  ];
  for (const [name, policy, from, to, allowed] of cases) {
    assert.deepStrictEqual(mayCall(policy, from, to), allowed, name);
  }
});

// 권한 경계다. home의 기본 lophn이 private workspace의 lophn에게 reply none으로 일을 넘기는 예외 하나만 있다.
test("only the home lophn hands work into a private workspace, and only with reply none", () => {
  const app = { kind: "app", id: "app_private" } as const;
  const at = (
    agent: AgentId,
    workspace: AgentAtWorkspace["workspace"],
  ): AgentAtWorkspace => ({ agent, workspace });
  const lophn = "lophn" as AgentId;
  const other = "agt_other" as AgentId;
  const policy: CallPolicy = { ...DEFAULT_CALL_POLICY, private: [app] };
  const cases: [
    string,
    AgentAtWorkspace,
    AgentAtWorkspace,
    "none" | "result" | "conversation" | undefined,
    boolean,
  ][] = [
    ["handoff", at(lophn, null), at(lophn, app), "none", true],
    ["result reply", at(lophn, null), at(lophn, app), "result", false],
    [
      "conversation reply",
      at(lophn, null),
      at(lophn, app),
      "conversation",
      false,
    ],
    ["unknown reply", at(lophn, null), at(lophn, app), undefined, false],
    ["other home agent", at(other, null), at(lophn, app), "none", false],
    ["to another agent", at(lophn, null), at(other, app), "none", false],
    ["out of private", at(lophn, app), at(lophn, null), "none", false],
  ];
  for (const [name, from, to, reply, allowed] of cases) {
    assert.deepStrictEqual(mayCall(policy, from, to, reply), allowed, name);
  }
  // 쌍 규칙이 예외보다 앞선다.
  const closed: CallPolicy = {
    ...policy,
    agents: [{ from: lophn, to: lophn, allow: false }],
  };
  assert.deepStrictEqual(
    mayCall(closed, at(lophn, null), at(lophn, app), "none"),
    false,
  );
});
