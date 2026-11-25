import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type Assignment,
  type GateCall,
  type PermissionRule,
  type PermissionRuleLayers,
  PRODUCT_FLOOR_RULES,
  type SessionGrant,
} from "../../../protocol/approvals/mod.ts";
import type {
  ExecutionContext,
  PermissionMode,
} from "../../../protocol/lophn-agent/turn-values.ts";
import { evaluatePermission, type PermissionRequest } from "./judge.ts";

const APP = "app_0000000000000000000000000a";
const OTHER = "app_0000000000000000000000000b";
const SES = "ses_0000000000000000000000000a";
const HOME = "/home/alice";
const DATA_ROOT = "/home/alice/.lophn";
const MODES: PermissionMode[] = ["read_only", "ask", "workspace", "full"];
const CONTEXTS: ExecutionContext[] = ["attended", "unattended", "team_child"];

function layers(
  global: PermissionRule[] = [],
  project: PermissionRule[] = [],
): PermissionRuleLayers {
  return { floor: PRODUCT_FLOOR_RULES, global, project };
}

function evalReq(
  call: GateCall,
  mode: PermissionMode,
  context: ExecutionContext = "attended",
  extra: Omit<PermissionRequest, "call"> = {},
  ruleLayers: PermissionRuleLayers = layers(),
  grants: SessionGrant[] = [],
) {
  return evaluatePermission(
    { call, homeDir: HOME, dataRoot: DATA_ROOT, ...extra },
    ruleLayers,
    grants,
    mode,
    context,
  );
}

test("floor와 사용자 deny 규칙은 모든 단계·맥락·allow 규칙·session grant를 이긴다", () => {
  const withAllowAndDeny = layers(
    [
      {
        id: "r-allow",
        category: "shell",
        pattern: "git push *",
        action: "allow",
        source: "global",
      },
      {
        id: "r-floor-override",
        category: "shell",
        pattern: "rm -rf *",
        action: "allow",
        source: "global",
      },
    ],
    [
      {
        id: "r-deny",
        category: "shell",
        pattern: "git push *",
        action: "deny",
        source: "project",
      },
    ],
  );
  const grants: SessionGrant[] = [
    {
      id: "grt_0000000000000000000000000a",
      session: SES,
      category: "shell",
      pattern: "git push *",
      label: "git push *",
      created_at: "2026-01-01T00:00:00.000Z",
    },
  ];

  for (const mode of MODES) {
    for (const context of CONTEXTS) {
      const floorRes = evalReq(
        { kind: "shell", command: 'sh -c "rm -rf $HOME"' },
        mode,
        context,
        {},
        withAllowAndDeny,
        grants,
      );
      assert.strictEqual(floorRes.kind, "deny", `${mode}/${context} floor`);
      assert.strictEqual(floorRes.denial.reason_kind, "floor");
      assert.strictEqual(floorRes.denial.recovery_action, null);

      const userDenyRes = evalReq(
        { kind: "shell", command: "git push origin main" },
        mode,
        context,
        {},
        withAllowAndDeny,
        grants,
      );
      assert.strictEqual(userDenyRes.kind, "deny", `${mode}/${context} deny`);
      assert.strictEqual(userDenyRes.denial.reason_kind, "user_deny");
      assert.strictEqual(userDenyRes.denial.rule_pattern, "git push *");
      assert.deepStrictEqual(userDenyRes.denial.recovery_action, {
        kind: "edit_rule",
        category: "shell",
      });
    }
  }
});

test("사용자 규칙 우선순위는 등록 순서와 무관하게 deny > ask > allow로 고정된다", () => {
  // allow가 deny·ask보다 뒤에 와도 deny와 ask가 이긴다.
  const denyAndAllow = layers(
    [
      {
        id: "r1",
        category: "shell",
        pattern: "npm test *",
        action: "deny",
        source: "global",
      },
    ],
    [
      {
        id: "r2",
        category: "shell",
        pattern: "npm test *",
        action: "allow",
        source: "project",
      },
    ],
  );
  const resDeny = evalReq(
    { kind: "shell", command: "npm test" },
    "full",
    "attended",
    {},
    denyAndAllow,
  );
  assert.strictEqual(resDeny.kind, "deny");
  assert.strictEqual(resDeny.denial.reason_kind, "user_deny");

  const askAndAllow = layers(
    [
      {
        id: "r1",
        category: "shell",
        pattern: "npm test *",
        action: "ask",
        source: "global",
      },
    ],
    [
      {
        id: "r2",
        category: "shell",
        pattern: "npm test *",
        action: "allow",
        source: "project",
      },
    ],
  );
  const resAsk = evalReq(
    { kind: "shell", command: "npm test" },
    "full",
    "attended",
    {},
    askAndAllow,
  );
  assert.strictEqual(resAsk.kind, "ask");
});

test("자기 보호 경로(~/.ssh, ~/.aws, ~/.gnupg, data root 설정·agent·secret)는 모든 단계에서 scope로 막힌다", () => {
  const blockedCalls: GateCall[] = [
    {
      kind: "file_read",
      path: `${HOME}/.ssh/id_rsa`,
      folder: `${HOME}/.ssh`,
      outside_workspace: true,
      sensitive: false,
    },
    {
      kind: "file_read",
      path: "~/.aws/credentials",
      folder: "~/.aws",
      outside_workspace: true,
      sensitive: false,
    },
    {
      kind: "file_write",
      path: `${HOME}/.gnupg/secring.gpg`,
      folder: `${HOME}/.gnupg`,
      outside_workspace: true,
      sensitive: false,
      action: "write",
    },
    {
      kind: "file_read",
      path: `${DATA_ROOT}/secrets.json`,
      folder: DATA_ROOT,
      outside_workspace: true,
      sensitive: false,
    },
    {
      kind: "file_write",
      path: `${DATA_ROOT}/settings.json`,
      folder: DATA_ROOT,
      outside_workspace: true,
      sensitive: false,
      action: "write",
    },
    {
      kind: "file_write",
      path: `${DATA_ROOT}/agents/lophn_home.md`,
      folder: `${DATA_ROOT}/agents`,
      outside_workspace: true,
      sensitive: false,
      action: "edit",
    },
  ];

  for (const call of blockedCalls) {
    for (const mode of MODES) {
      const res = evalReq(call, mode, "attended");
      const label = "path" in call ? call.path : call.kind;
      assert.strictEqual(res.kind, "deny", `${mode}: ${label}`);
      assert.strictEqual(res.denial.reason_kind, "scope");
      assert.strictEqual(res.denial.recovery_action, null);
    }
  }
});

test("민감 workspace 파일(.env*, .git/hooks/*, .git/config, .lophn/tools/*)은 full에서도 묻고 .env.example은 통과한다", () => {
  const envRead: GateCall = {
    kind: "file_read",
    path: "/repo/.env.local",
    folder: "/repo",
    outside_workspace: false,
    sensitive: false,
  };
  for (const mode of MODES) {
    const res = evalReq(envRead, mode, "attended");
    assert.strictEqual(res.kind, "ask", `${mode} .env.local`);
    assert.deepStrictEqual(res.allowed_choices, ["once", "reject"]);
  }
  const envUnattended = evalReq(envRead, "full", "unattended");
  assert.strictEqual(envUnattended.kind, "deny");
  assert.strictEqual(envUnattended.denial.reason_kind, "no_person");

  // .env.example과 .env.sample은 민감 파일에서 제외한다.
  for (const name of [".env.example", ".env.sample"]) {
    const res = evalReq(
      {
        kind: "file_read",
        path: `/repo/${name}`,
        folder: "/repo",
        outside_workspace: false,
        sensitive: false,
      },
      "workspace",
      "attended",
    );
    assert.deepStrictEqual(res, { kind: "run" }, name);
  }

  for (const path of [
    "/repo/.git/hooks/pre-commit",
    "/repo/.git/config",
    "/repo/.lophn/tools/deploy.ts",
  ]) {
    const call: GateCall = {
      kind: "file_write",
      path,
      folder: "/repo",
      outside_workspace: false,
      sensitive: false,
      action: "write",
    };
    const ro = evalReq(call, "read_only", "attended");
    assert.strictEqual(ro.kind, "deny");
    assert.strictEqual(ro.denial.reason_kind, "mode");
    for (const mode of ["ask", "workspace", "full"] as PermissionMode[]) {
      const res = evalReq(call, mode, "attended");
      assert.strictEqual(res.kind, "ask", `${mode}: ${path}`);
      assert.deepStrictEqual(res.allowed_choices, ["once", "reject"]);
    }
  }
});

test("단계별 기본 판정 표(file_read, file_write, shell)와 unattended·team_child 맥락이 맞다", () => {
  const inRead: GateCall = {
    kind: "file_read",
    path: "/repo/a.ts",
    folder: "/repo",
    outside_workspace: false,
    sensitive: false,
  };
  const outRead: GateCall = {
    kind: "file_read",
    path: "/other/a.ts",
    folder: "/other",
    outside_workspace: true,
    sensitive: false,
  };
  const inWrite: GateCall = {
    kind: "file_write",
    path: "/repo/a.ts",
    folder: "/repo",
    outside_workspace: false,
    sensitive: false,
    action: "edit",
  };
  const outWrite: GateCall = {
    kind: "file_write",
    path: "/other/a.ts",
    folder: "/other",
    outside_workspace: true,
    sensitive: false,
    action: "write",
  };
  const roShell: GateCall = { kind: "shell", command: "git status" };
  const writeShell: GateCall = { kind: "shell", command: "npm test" };
  const sudoShell: GateCall = { kind: "shell", command: "sudo ls" };

  // read_only
  assert.deepStrictEqual(evalReq(inRead, "read_only"), { kind: "run" });
  assert.strictEqual(evalReq(outRead, "read_only").kind, "ask");
  assert.strictEqual(evalReq(inWrite, "read_only").kind, "deny");
  assert.strictEqual(evalReq(roShell, "read_only").kind, "run");
  const roShellDeny = evalReq(writeShell, "read_only");
  assert.strictEqual(roShellDeny.kind, "deny");
  assert.strictEqual(roShellDeny.denial.reason_kind, "mode");
  assert.deepStrictEqual(roShellDeny.denial.recovery_action, {
    kind: "change_mode",
    suggested_mode: "workspace",
  });

  // ask
  assert.deepStrictEqual(evalReq(inRead, "ask"), { kind: "run" });
  assert.strictEqual(evalReq(inWrite, "ask").kind, "ask");
  assert.deepStrictEqual(evalReq(roShell, "ask"), { kind: "run" });
  const askShell = evalReq(writeShell, "ask");
  assert.strictEqual(askShell.kind, "ask");
  assert.deepStrictEqual(askShell.allowed_choices, [
    "once",
    "session",
    "always",
    "reject",
  ]);
  assert.strictEqual(askShell.outside_rewind, true);

  // workspace
  assert.deepStrictEqual(evalReq(inWrite, "workspace"), { kind: "run" });
  const wsOutWrite = evalReq(outWrite, "workspace");
  assert.strictEqual(wsOutWrite.kind, "ask");
  assert.strictEqual(wsOutWrite.outside_rewind, true);
  assert.deepStrictEqual(wsOutWrite.allowed_choices, [
    "once",
    "session",
    "reject",
  ]);
  assert.strictEqual(evalReq(writeShell, "workspace").kind, "ask");

  // full
  assert.deepStrictEqual(evalReq(outRead, "full"), { kind: "run" });
  assert.deepStrictEqual(evalReq(outWrite, "full"), { kind: "run" });
  assert.deepStrictEqual(evalReq(writeShell, "full"), { kind: "run" });
  // sudo는 full에서도 once-only ask다.
  const fullSudo = evalReq(sudoShell, "full");
  assert.strictEqual(fullSudo.kind, "ask");
  assert.deepStrictEqual(fullSudo.allowed_choices, ["once", "reject"]);

  // unattended: ask는 모두 no_person deny로 바뀌며 안전한 shell은 add_allow_rule 복구를 싣는다.
  const unattendedShell = evalReq(writeShell, "workspace", "unattended");
  assert.strictEqual(unattendedShell.kind, "deny");
  assert.strictEqual(unattendedShell.denial.reason_kind, "no_person");
  assert.deepStrictEqual(unattendedShell.denial.recovery_action, {
    kind: "add_allow_rule",
    suggested_pattern: "npm test *",
    category: "shell",
  });
  // full 단계의 unattended는 opt-in이라 일반 shell을 통과한다.
  assert.deepStrictEqual(evalReq(writeShell, "full", "unattended"), {
    kind: "run",
  });

  // team_child: 일반 ask는 부모에게 once-only로 간다.
  const childShell = evalReq(writeShell, "workspace", "team_child");
  assert.strictEqual(childShell.kind, "ask");
  assert.deepStrictEqual(childShell.allowed_choices, ["once", "reject"]);
});

test("사람 전용 등급(setting, project_command_definition, 미신뢰 local_tool)은 full에서도 묻고 unattended·team_child는 막는다", () => {
  const personOnlyCalls: GateCall[] = [
    {
      kind: "setting",
      key: "folder.destinations",
      lines: ['Add sync folder "personal": /tmp/sync'],
    },
    {
      kind: "project_command_definition",
      project: "prj_0000000000000000000000000a",
      action: "add",
      before: null,
      after: {
        id: "build",
        name: "Build",
        command: "npm run build",
        cwd: null,
        env_keys: [],
      },
    },
    {
      kind: "local_tool",
      name: "deploy",
      path: "/repo/.lophn/tools/deploy.ts",
      sha256: "abc123",
      changed: false,
    },
  ];

  for (const call of personOnlyCalls) {
    const attended = evalReq(call, "full", "attended", {
      localToolTrusted: false,
    });
    assert.strictEqual(attended.kind, "ask", `attended full: ${call.kind}`);
    assert.deepStrictEqual(attended.allowed_choices, ["once", "reject"]);

    for (const ctx of ["unattended", "team_child"] as ExecutionContext[]) {
      const blocked = evalReq(call, "full", ctx, { localToolTrusted: false });
      assert.strictEqual(blocked.kind, "deny", `${ctx} full: ${call.kind}`);
      assert.strictEqual(blocked.denial.reason_kind, "no_person");
      if (call.kind === "local_tool") {
        assert.deepStrictEqual(blocked.denial.recovery_action, {
          kind: "trust_local_tool",
          tool_path: call.path,
          sha256: call.sha256,
        });
      }
    }
  }

  // 신뢰되고 바뀌지 않은 local_tool은 workspace에서 통과, 내용이 바뀌면 다시 묻는다.
  assert.deepStrictEqual(
    evalReq(
      {
        kind: "local_tool",
        name: "deploy",
        path: "/repo/.lophn/tools/deploy.ts",
        sha256: "abc123",
        changed: false,
      },
      "workspace",
      "attended",
      { localToolTrusted: true },
    ),
    { kind: "run" },
  );
  assert.strictEqual(
    evalReq(
      {
        kind: "local_tool",
        name: "deploy",
        path: "/repo/.lophn/tools/deploy.ts",
        sha256: "def456",
        changed: true,
      },
      "full",
      "attended",
      { localToolTrusted: true },
    ).kind,
    "ask",
  );
});

test("app_tool 할당·제외·ask_tools와 MCP 서버 신뢰 수준이 단계에 맞게 판정된다", () => {
  const assignment: Assignment = {
    agent: "lophn_home",
    entries: [
      {
        app: APP,
        removed_tools: ["notes.delete"],
        ask_tools: ["notes.publish"],
      },
      {
        app: OTHER,
        machine: "mch_0000000000000000000000000c",
        name: "remote-only",
        removed_tools: [],
      },
    ],
  };

  // 미할당(다른 기계만 할당 포함)과 제외 tool은 어느 단계에서도 막힌다.
  const unassigned = evalReq(
    { kind: "app_tool", app: OTHER, tool: "x.run", effect: "read" },
    "full",
    "attended",
    { assignment },
  );
  assert.strictEqual(unassigned.kind, "deny");
  assert.strictEqual(unassigned.denial.reason_kind, "unassigned");
  assert.deepStrictEqual(unassigned.denial.recovery_action, {
    kind: "assign_app",
    app: OTHER,
  });

  const removed = evalReq(
    { kind: "app_tool", app: APP, tool: "notes.delete", effect: "write" },
    "full",
    "attended",
    { assignment },
  );
  assert.strictEqual(removed.kind, "deny");
  assert.strictEqual(removed.denial.reason_kind, "removed");

  // ask_tools에 든 tool은 workspace에서 묻고, 일반 할당 tool은 통과한다.
  assert.strictEqual(
    evalReq(
      { kind: "app_tool", app: APP, tool: "notes.publish", effect: "external" },
      "workspace",
      "attended",
      { assignment },
    ).kind,
    "ask",
  );
  assert.deepStrictEqual(
    evalReq(
      { kind: "app_tool", app: APP, tool: "notes.add", effect: "external" },
      "workspace",
      "attended",
      { assignment },
    ),
    { kind: "run" },
  );

  // 비신뢰 MCP 서버의 비읽기 tool은 workspace에서 묻고, 읽기 전용이나 신뢰 서버는 통과한다.
  const mcpWrite: GateCall = {
    kind: "mcp_tool",
    server: "github",
    tool: "create_issue",
    effect: "external",
    read_only: false,
  };
  const mcpRead: GateCall = {
    kind: "mcp_tool",
    server: "github",
    tool: "list_issues",
    effect: "read",
    read_only: true,
  };
  assert.strictEqual(
    evalReq(mcpWrite, "workspace", "attended", { mcpTrust: "untrusted" }).kind,
    "ask",
  );
  assert.deepStrictEqual(
    evalReq(mcpRead, "read_only", "attended", { mcpTrust: "untrusted" }),
    { kind: "run" },
  );
  assert.deepStrictEqual(
    evalReq(mcpWrite, "workspace", "attended", { mcpTrust: "trusted" }),
    { kind: "run" },
  );
  const mcpUnattended = evalReq(mcpWrite, "workspace", "unattended", {
    mcpTrust: "untrusted",
  });
  assert.strictEqual(mcpUnattended.kind, "deny");
  assert.deepStrictEqual(mcpUnattended.denial.recovery_action, {
    kind: "trust_mcp",
    server: "github",
  });
});

test("session grant는 같은 대화의 후속 호출을 허용하되 read_only로 낮추면 쓰기·shell은 다시 막힌다", () => {
  const grants: SessionGrant[] = [
    {
      id: "grt_0000000000000000000000000a",
      session: SES,
      category: "file_outside",
      pattern: "/docs",
      label: "/docs",
      created_at: "2026-01-01T00:00:00.000Z",
    },
    {
      id: "grt_0000000000000000000000000b",
      session: SES,
      category: "shell",
      pattern: "npm test *",
      label: "npm test *",
      created_at: "2026-01-01T00:00:00.000Z",
    },
  ];

  // 열린 바깥 폴더 읽기·쓰기와 허락된 shell은 workspace에서 통과한다.
  assert.deepStrictEqual(
    evalReq(
      {
        kind: "file_read",
        path: "/docs/guide.md",
        folder: "/docs",
        outside_workspace: true,
        sensitive: false,
      },
      "workspace",
      "attended",
      {},
      layers(),
      grants,
    ),
    { kind: "run" },
  );
  assert.deepStrictEqual(
    evalReq(
      { kind: "shell", command: "npm test -- --run" },
      "workspace",
      "attended",
      {},
      layers(),
      grants,
    ),
    { kind: "run" },
  );

  // read_only로 낮추면 바깥 폴더 읽기는 유지되지만 shell 실행과 파일 쓰기는 막힌다.
  assert.deepStrictEqual(
    evalReq(
      {
        kind: "file_read",
        path: "/docs/guide.md",
        folder: "/docs",
        outside_workspace: true,
        sensitive: false,
      },
      "read_only",
      "attended",
      {},
      layers(),
      grants,
    ),
    { kind: "run" },
  );
  assert.strictEqual(
    evalReq(
      { kind: "shell", command: "npm test" },
      "read_only",
      "attended",
      {},
      layers(),
      grants,
    ).kind,
    "deny",
  );
});
