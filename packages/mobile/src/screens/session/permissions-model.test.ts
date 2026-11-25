import assert from "node:assert/strict";
import test from "node:test";
import type { TurnRequest } from "../../../../protocol/approvals/turn-request.ts";
import { PERMISSION_MODES } from "../../../../protocol/lophn-agent/turn-values.ts";
import {
  approvalFactsOf,
  approvalTitleOf,
  canDowngradeMode,
  downgradeModesOf,
  inboxPermissionDetails,
  jobApprovalModeInfo,
  permissionDenialDisplay,
  permissionModeLabel,
} from "./permissions-model.ts";

test("phone mode picker strictly allows downgrades and never allows raising or setting full", () => {
  assert.deepEqual(downgradeModesOf("full"), ["read_only", "ask", "workspace"]);
  assert.deepEqual(downgradeModesOf("workspace"), ["read_only", "ask"]);
  assert.deepEqual(downgradeModesOf("ask"), ["read_only"]);
  assert.deepEqual(downgradeModesOf("read_only"), []);

  for (const from of PERMISSION_MODES) {
    assert.equal(canDowngradeMode(from, "full"), false);
    assert.equal(canDowngradeMode(from, from), false);
  }
  assert.equal(canDowngradeMode("read_only", "ask"), false);
  assert.equal(canDowngradeMode("ask", "workspace"), false);
  assert.equal(canDowngradeMode("workspace", "read_only"), true);
  assert.equal(canDowngradeMode(null, "read_only"), false);

  assert.equal(permissionModeLabel("read_only"), "Read only");
  assert.equal(permissionModeLabel("ask"), "Ask every time");
  assert.equal(permissionModeLabel("workspace"), "Auto-edit in workspace");
  assert.equal(permissionModeLabel("full"), "Full access");
});

test("approval card helpers handle file_read, file_write, local_tool, session choice, reason, outside_rewind, and always_patterns", () => {
  const baseRequest: Omit<TurnRequest, "subject"> = {
    id: "apr_01h455vb4pex5v6nkc6gd5f001",
    session: "ses_01h455vb4pex5v6nkc6gd5f001",
    turn: "trn_01h455vb4pex5v6nkc6gd5f001",
    tool_call: "tcl_01h455vb4pex5v6nkc6gd5f001",
    always_patterns: ["npm test*"],
    allowed_choices: ["once", "session", "always", "reject"],
    reason: "Command is outside built-in read allowlist.",
    outside_rewind: true,
    to_parent: false,
    created_at: "2026-11-25T10:00:00Z",
  };

  const fileReadSubject = {
    kind: "file_read",
    path: "/tmp/notes.md",
    folder: "/tmp",
    outside_workspace: true,
    sensitive: false,
  } as const;
  const fileRead: TurnRequest = {
    ...baseRequest,
    always_patterns: [],
    allowed_choices: ["once", "session", "reject"],
    reason: "Path is outside the workspace.",
    outside_rewind: false,
    subject: fileReadSubject,
  };
  assert.equal(
    approvalTitleOf(fileReadSubject, "lophn", () => "fallback"),
    "lophn wants to read a file outside the workspace",
  );
  const readFacts = approvalFactsOf(
    {
      subject: fileReadSubject,
      choices: fileRead.allowed_choices,
      always_patterns: fileRead.always_patterns,
    },
    { changeText: () => "", targetOf: () => "", effectOf: () => null },
  );
  assert.ok(readFacts.some((f) => f.label === "Path" && f.value === "/tmp/notes.md"));
  assert.ok(readFacts.some((f) => f.label === "Folder" && f.value === "/tmp"));

  const fileWrite: TurnRequest = {
    ...baseRequest,
    always_patterns: [],
    allowed_choices: ["once", "session", "reject"],
    subject: {
      kind: "file_write",
      path: "/tmp/out.txt",
      folder: "/tmp",
      outside_workspace: true,
      sensitive: false,
      action: "write",
    },
  };
  const writeDetails = inboxPermissionDetails(fileWrite, {
    facts: [],
    factsPinned: false,
    choices: [],
  });
  assert.equal(writeDetails.outsideRewind, true);
  assert.deepEqual(writeDetails.choices, ["once", "session", "reject"]);
  assert.ok(writeDetails.facts.some((f) => f.value === "/tmp/out.txt"));

  const localTool: TurnRequest = {
    ...baseRequest,
    always_patterns: [],
    allowed_choices: ["once", "reject"],
    reason: "Script hash changed.",
    subject: {
      kind: "local_tool",
      name: "deploy.ts",
      path: "/repo/.lophn/tools/deploy.ts",
      sha256: "abc123",
      changed: true,
    },
  };
  const localDetails = inboxPermissionDetails(localTool, {
    facts: [],
    factsPinned: false,
    choices: [],
  });
  assert.equal(localDetails.title, "Run modified local tool deploy.ts");
  assert.ok(localDetails.facts.some((f) => f.label === "SHA-256" && f.value === "abc123"));

  // Shell request with "always" allowed surfaces exact always_patterns; without "always" strips it.
  const shellWithAlways: TurnRequest = {
    ...baseRequest,
    subject: { kind: "shell", command: "npm test" },
  };
  const shellDetails = inboxPermissionDetails(shellWithAlways, {
    title: "Run command",
    description: "Shell",
    facts: [{ label: "Command", value: "npm test", style: "code" }],
    factsPinned: true,
    choices: ["once", "always", "reject"],
  });
  assert.deepEqual(shellDetails.choices, ["once", "session", "always", "reject"]);
  assert.deepEqual(shellDetails.alwaysPatterns, ["npm test*"]);
  assert.ok(shellDetails.facts.some((f) => f.value === "npm test*"));
});

test("permission denial display and job approval mode escalation info format cleanly", () => {
  const denied = permissionDenialDisplay({
    tool: "shell.run",
    category: "shell",
    target_summary: "rm -rf ~",
    reason_kind: "floor",
    rule_pattern: "rm -rf ~",
    message: "Blocked by floor rule",
    recovery_hint: "Use a narrower path inside the workspace.",
    recovery_action: { kind: "none" },
  });
  assert.equal(denied.badge, "Blocked");
  assert.equal(denied.rulePattern, "rm -rf ~");
  assert.equal(denied.recoveryHint, "Use a narrower path inside the workspace.");

  const jobInfo = jobApprovalModeInfo({
    participant_modes: { lophn: "workspace", runner: "full" },
    approval_paused_reason: "mode_escalated",
  });
  assert.equal(jobInfo.modeEscalated, true);
  assert.deepEqual(jobInfo.participantModes, [
    { participant: "lophn", mode: "workspace", label: "Auto-edit in workspace", isFull: false },
    { participant: "runner", mode: "full", label: "Full access", isFull: true },
  ]);
});
