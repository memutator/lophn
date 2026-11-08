import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type Assignment,
  type GateCall,
  type Judgment,
  PRODUCT_SHELL_RULES,
  type ShellRule,
  type ShellRuleLayers,
} from "../../../protocol/approvals/mod.ts";
import type { TurnMode } from "../../../protocol/lophn-agent/turn-values.ts";
import { judge as judgeTurn } from "./judge.ts";

// toParent는 팀 자식(사람이 skip을 켜지 않은 session)이다. 따로 말하지 않은 test는 팀 밖이다.
const judge = (
  call: GateCall,
  assignment: Parameters<typeof judgeTurn>[1],
  shell: ShellRuleLayers,
  mode: TurnMode,
  toParent = false,
) => judgeTurn(call, assignment, shell, mode, toParent);

const APP = "app_0000000000000000000000000a";
const OTHER = "app_0000000000000000000000000b";
const MODES: TurnMode[] = ["attended", "unattended", "skip"];

const shellCall = (command: string): GateCall => ({ kind: "shell", command });
const appCall = (
  effect: "read" | "external",
  tool = "notes.add",
): GateCall => ({
  kind: "app_tool",
  app: APP,
  tool,
  effect,
});

// 제품 기본(floor, ask)에 사람 규칙 층만 더한다.
function rules(...humanLayers: ShellRule[][]): ShellRuleLayers {
  return {
    floor: PRODUCT_SHELL_RULES.floor,
    layers: [PRODUCT_SHELL_RULES.ask, ...humanLayers],
  };
}

const denied = (pattern: string): Judgment => ({
  kind: "deny",
  reason: "shell_rule",
  pattern,
});

test("floor deny와 사람이 쓴 deny 규칙은 unattended와 skip에서도 막는다", () => {
  const shell = rules([{ pattern: "git push *", action: "deny" }]);
  const cases: [string, Judgment][] = [
    ["rm -rf /", denied("rm -rf /")],
    ["rm  -rf   /", denied("rm -rf /")],
    ["echo ok && rm -rf ~", denied("rm -rf ~")],
    ["rm -rf /*", denied("rm -rf /\\*")],
    ["rm -fr ~", denied("rm -fr ~")],
    ["sudo rm -r -f /", denied("sudo rm -r -f /")],
    [":(){ :|:& };:", denied(":(){ :|:& };:")],
    ["git push origin main", denied("git push *")],
  ];
  for (const mode of MODES) {
    for (const [command, expected] of cases) {
      assert.deepStrictEqual(
        judge(shellCall(command), null, shell, mode),
        expected,
        `${mode}: ${command}`,
      );
    }
  }
  // 대조: ask는 attended에서만 묻는다. `rm -rf /tmp/x`는 floor가 아니다.
  for (const command of ["rm -r build", "rm -rf /tmp/x"]) {
    assert.deepStrictEqual(judge(shellCall(command), null, shell, "attended"), {
      kind: "ask",
    });
    assert.deepStrictEqual(
      judge(shellCall(command), null, shell, "unattended"),
      {
        kind: "run",
      },
    );
    assert.deepStrictEqual(judge(shellCall(command), null, shell, "skip"), {
      kind: "run",
    });
  }
});

test("할당하지 않은 앱 tool과 뺀 tool은 어느 mode에서도 막는다", () => {
  const agent = "lophn" as const;
  const other: Assignment = {
    agent,
    entries: [{ app: OTHER, removed_tools: [] }],
  };
  const removed: Assignment = {
    agent,
    entries: [{ app: APP, removed_tools: ["notes.add"] }],
  };
  const assigned: Assignment = {
    agent,
    entries: [{ app: APP, removed_tools: ["notes.drop"] }],
  };
  const none: Judgment = {
    kind: "deny",
    reason: "not_assigned",
    pattern: null,
  };
  const gone: Judgment = { kind: "deny", reason: "removed", pattern: null };
  for (const mode of MODES) {
    assert.deepStrictEqual(judge(appCall("read"), null, rules(), mode), none);
    assert.deepStrictEqual(judge(appCall("read"), other, rules(), mode), none);
    assert.deepStrictEqual(
      judge(appCall("read"), removed, rules(), mode),
      gone,
    );
    // 바깥 효과는 묻지 않는다.
    assert.deepStrictEqual(
      judge(appCall("external"), assigned, rules(), mode),
      {
        kind: "run",
      },
    );
  }
});

test("project 층의 allow 규칙은 floor deny를 덮지 못한다", () => {
  const shell = rules(
    [],
    [
      { pattern: "rm -rf *", action: "allow" },
      { pattern: "rm -rf /", action: "allow" },
    ],
  );
  for (const mode of MODES) {
    assert.deepStrictEqual(
      judge(shellCall("rm -rf /"), null, shell, mode),
      denied("rm -rf /"),
    );
    // 뒤 층이 제품 기본 ask를 덮는다.
    assert.deepStrictEqual(
      judge(shellCall("rm -rf build"), null, shell, mode),
      {
        kind: "run",
      },
    );
  }
});

test("부모에게 가는 session의 shell ask는 mode와 상관없이 ask이고 deny는 부모도 풀지 못한다", () => {
  const shell = rules([{ pattern: "git push *", action: "deny" }]);
  for (const mode of MODES) {
    assert.deepStrictEqual(
      judge(shellCall("rm -r build"), null, shell, mode, true),
      { kind: "ask" },
      mode,
    );
    // deny는 ask 앞에서 끝나 request도 call도 열리지 않는다.
    assert.deepStrictEqual(
      judge(shellCall("git push origin main"), null, shell, mode, true),
      denied("git push *"),
      mode,
    );
    assert.deepStrictEqual(
      judge(shellCall("rm -rf /"), null, shell, mode, true),
      denied("rm -rf /"),
      mode,
    );
  }
  // 팀 밖(toParent false)은 그대로다: unattended와 skip은 묻지 않는다.
  assert.deepStrictEqual(
    judge(shellCall("rm -r build"), null, shell, "unattended"),
    { kind: "run" },
  );
});
