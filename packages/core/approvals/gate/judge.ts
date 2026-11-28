import type {
  GateCall,
  IsolationBackend,
  Judgment,
  PermissionCategory,
  PermissionRule,
  PermissionRuleCategory,
  PermissionRuleLayers,
  RecoveryAction,
  SessionGrant,
  TurnRequestChoiceKind,
} from "../../../protocol/approvals/mod.ts";
import type { McpTrust } from "../../../protocol/lophn-agent/mcp-settings.ts";
import type {
  ExecutionContext,
  PermissionMode,
} from "../../../protocol/lophn-agent/turn-values.ts";
import { buildPermissionDenial, categoryOfCall } from "./denial.ts";
import {
  checkFileSelfProtection,
  isPathInside,
  isSensitiveWorkspaceFile,
  normalizePath,
} from "./paths.ts";
import {
  alwaysPatterns,
  evaluateShellUserRules,
  isReadOnlySegment,
  isReadOnlyShellCommand,
  matchFloorRules,
  type ShellScanResult,
  scanShellCommand,
  shellRuleMatches,
} from "./shell-match.ts";

// project command 판정에 필요한 정책 값(ledger에서 읽은 값). 없으면 fail-closed(거절·승인 필요).
export type ProjectCommandPolicy = {
  readonly allowed: boolean;
  readonly askBeforeRun: boolean;
  readonly approveWrites: boolean;
};

const DEFAULT_PROJECT_COMMAND_POLICY: ProjectCommandPolicy = {
  allowed: false,
  askBeforeRun: true,
  approveWrites: true,
};

export type PermissionRequest = {
  readonly call: GateCall;
  readonly tool?: string;
  // app_tool 호출의 앱이 이 session에 닿는지다. 닿으면(그 앱의 public skill이 배포돼 이 session이 받거나 앱 자기 workspace) 묻지 않는다.
  // `skills`는 그 앱의 public skill 이름이고 비어 있으면 `always`(배포)를 열지 않는다. `mayDeploy`는 이 agent가 묻지 않고 배포할 수 있는가다.
  readonly appAccess?: {
    readonly reached: boolean;
    readonly slug: string;
    // 묻는 문장에 쓰는 agent의 보이는 이름. 모르면 "This agent"로 쓴다.
    readonly agent?: string;
    readonly skills: readonly string[];
    readonly mayDeploy: boolean;
  } | null;
  readonly projectCommand?: ProjectCommandPolicy;
  readonly mcpTrust?: McpTrust;
  readonly localToolTrusted?: boolean;
  readonly homeDir?: string;
  readonly dataRoot?: string;
  // OS sandbox 격리 슬롯. 이번 판은 none만 둔다.
  readonly isolation?: IsolationBackend;
};

function ruleCategoryForCall(call: GateCall): PermissionRuleCategory | null {
  switch (call.kind) {
    case "shell":
      return "shell";
    case "file_read":
    case "file_write":
      return "file";
    case "app_tool":
      return "app_tool";
    case "mcp_tool":
      return "mcp_tool";
    case "local_tool":
      return "local_tool";
    case "setting":
    case "project_command":
    case "project_command_definition":
    case "workflow_run":
    case "worktree_remove":
      return null;
  }
}

function nonShellRuleTargets(call: GateCall, homeDir?: string): string[] {
  switch (call.kind) {
    case "file_read":
    case "file_write":
      return [...new Set([call.path, normalizePath(call.path, homeDir)])];
    case "app_tool":
      return [`${call.app}/${call.tool}`, call.tool];
    case "mcp_tool":
      return [`${call.server}/${call.tool}`];
    case "local_tool":
      return [
        ...new Set([call.path, normalizePath(call.path, homeDir), call.name]),
      ];
    default:
      return [];
  }
}

function evaluateNonShellUserRules(
  call: GateCall,
  layers: PermissionRuleLayers,
  homeDir?: string,
): { action: PermissionRule["action"] | null; pattern: string | null } {
  const category = ruleCategoryForCall(call);
  if (category === null || category === "shell") {
    return { action: null, pattern: null };
  }
  const rules = [...layers.global, ...layers.project].filter(
    (r) => r.category === category,
  );
  if (rules.length === 0) return { action: null, pattern: null };
  const targets = nonShellRuleTargets(call, homeDir);

  // 고정 우선순위: deny > ask > allow.
  for (const action of ["deny", "ask", "allow"] as const) {
    for (const rule of rules) {
      if (rule.action !== action) continue;
      if (targets.some((t) => shellRuleMatches(rule.pattern, t))) {
        return { action, pattern: rule.pattern };
      }
    }
  }
  return { action: null, pattern: null };
}

export function matchesSessionGrant(
  grants: readonly SessionGrant[],
  call: GateCall,
  options?: { scan?: ShellScanResult; homeDir?: string; dataRoot?: string },
): boolean {
  if (grants.length === 0) return false;
  switch (call.kind) {
    case "file_read":
      return grants.some(
        (g) =>
          (g.category === "file_outside" || g.category === "file_read") &&
          isPathInside(call.path, g.pattern, options?.homeDir),
      );
    case "file_write":
      return grants.some(
        (g) =>
          (g.category === "file_outside" || g.category === "file_write") &&
          isPathInside(call.path, g.pattern, options?.homeDir),
      );
    case "shell": {
      if (call.opaque === true) return false;
      const scan =
        options?.scan ?? scanShellCommand(call.command, options?.homeDir);
      if (
        scan.opaque ||
        scan.elevated ||
        scan.hasOutputRedirection ||
        scan.hasDangerousEnv ||
        scan.segments.some(
          (seg) =>
            seg.hasCommandSubstitution ||
            seg.hasDangerousEnv ||
            seg.viaEvalOrXargs,
        )
      ) {
        return false;
      }
      const shellGrants = grants.filter((g) => g.category === "shell");
      if (shellGrants.length === 0) return false;
      const executableSegments = scan.segments.filter(
        (s) => s.origin !== "wrapper",
      );
      if (executableSegments.length === 0) return false;
      const pathOpts = {
        homeDir: options?.homeDir,
        dataRoot: options?.dataRoot,
      };
      let matchedGrant = false;
      for (const seg of executableSegments) {
        if (shellGrants.some((g) => shellRuleMatches(g.pattern, seg.raw))) {
          matchedGrant = true;
          continue;
        }
        if (isReadOnlySegment(seg, pathOpts)) {
          continue;
        }
        return false;
      }
      return matchedGrant;
    }
    case "mcp_tool":
      return grants.some(
        (g) =>
          g.category === "mcp_tool" &&
          (g.pattern === call.server ||
            g.pattern === `${call.server}/*` ||
            g.pattern === `${call.server}/${call.tool}`),
      );
    case "app_tool":
      return grants.some(
        (g) =>
          g.category === "app_tool" &&
          (g.pattern === `${call.app}/${call.tool}` ||
            g.pattern === `${call.app}/*`),
      );
    default:
      return false;
  }
}

type AskDecision = {
  readonly kind: "ask";
  readonly reason: string | null;
  readonly outside_rewind: boolean;
  readonly allowed_choices: TurnRequestChoiceKind[];
  readonly personOnly?: boolean;
  readonly rulePattern?: string | null;
  readonly unattendedRecovery?: RecoveryAction | null;
  readonly unattendedHint?: string | null;
  readonly categoryOverride?: PermissionCategory;
  // `always`가 하는 일의 줄(카드가 보인다). 있어야 always가 열린다.
  readonly alwaysPatterns?: readonly string[];
};

function finalizeContext(
  verdict: Judgment | AskDecision,
  request: PermissionRequest,
  context: ExecutionContext,
): Judgment {
  if (verdict.kind !== "ask") return verdict;

  const ask = verdict as AskDecision;
  if (context === "unattended") {
    return {
      kind: "deny",
      denial: buildPermissionDenial({
        call: request.call,
        tool: request.tool,
        category: ask.categoryOverride,
        reasonKind: "no_person",
        rulePattern: ask.rulePattern ?? null,
        message:
          ask.reason ??
          "This action requires approval, but no person is present in an unattended run.",
        recoveryHint:
          ask.unattendedHint ??
          "Pre-approve with a permission rule or run with permission mode set to full.",
        recoveryAction: ask.unattendedRecovery ?? null,
      }),
    };
  }

  if (context === "team_child") {
    if (ask.personOnly) {
      return {
        kind: "deny",
        denial: buildPermissionDenial({
          call: request.call,
          tool: request.tool,
          category: ask.categoryOverride,
          reasonKind: "no_person",
          rulePattern: ask.rulePattern ?? null,
          message:
            ask.reason ??
            "This action requires direct person approval and cannot be delegated to a parent session.",
          recoveryHint:
            ask.unattendedHint ??
            "Perform or trust this action directly from a person-attended session.",
          recoveryAction: ask.unattendedRecovery ?? null,
        }),
      };
    }
    // 팀 자식의 물음은 부모에게 once만 열린다.
    return {
      kind: "ask",
      reason: ask.reason,
      outside_rewind: ask.outside_rewind,
      allowed_choices: ["once", "reject"],
    };
  }

  return {
    kind: "ask",
    reason: ask.reason,
    outside_rewind: ask.outside_rewind,
    allowed_choices: ask.allowed_choices,
    ...(ask.alwaysPatterns === undefined
      ? {}
      : { always_patterns: [...ask.alwaysPatterns] }),
  };
}

function modeDeny(
  request: PermissionRequest,
  message: string,
  categoryOverride?: PermissionCategory,
): Judgment {
  return {
    kind: "deny",
    denial: buildPermissionDenial({
      call: request.call,
      tool: request.tool,
      category: categoryOverride,
      reasonKind: "mode",
      message,
      recoveryHint:
        "Switch the session permission mode to 'workspace' or higher to allow this action.",
      recoveryAction: { kind: "change_mode", suggested_mode: "workspace" },
    }),
  };
}

// 통합 순수 판정 엔진. IO 없이 결정적으로 같은 입력에 같은 결과를 낸다.
// 순서: 1. Floor/자기보호 → 2. 사용자 규칙(deny>ask>allow) → 3. 사람 전용 등급 →
//       4. 민감 workspace 파일 → 5. 이번 대화 허락(sessionGrants) → 6. 단계 기본값 → 7. 실행 맥락.
export function evaluatePermission(
  request: PermissionRequest,
  layers: PermissionRuleLayers,
  sessionGrants: readonly SessionGrant[],
  mode: PermissionMode,
  context: ExecutionContext,
): Judgment {
  const { call } = request;
  // 격리 슬롯은 판정 입력으로 열어 두되 이번 판은 "none"만 쓴다.
  const _isolation: IsolationBackend = request.isolation ?? "none";
  void _isolation;

  const projectCommand =
    request.projectCommand ?? DEFAULT_PROJECT_COMMAND_POLICY;

  // ---------- 1. Floor / 자기 보호 ----------
  if (call.kind === "shell") {
    const scan = scanShellCommand(call.command, request.homeDir);
    const isOpaque = scan.opaque || call.opaque === true;
    const floorHit = matchFloorRules(layers.floor, scan);
    if (floorHit !== null) {
      return {
        kind: "deny",
        denial: buildPermissionDenial({
          call,
          tool: request.tool,
          category: "shell",
          reasonKind: "floor",
          rulePattern: floorHit.pattern,
          message: `Command matches protected safety floor rule: ${floorHit.pattern}`,
          recoveryHint:
            "This command is permanently blocked by safety rules and cannot be overridden.",
          recoveryAction: null,
        }),
      };
    }

    // ---------- 2. 사용자 규칙 (shell) ----------
    const shellPathOpts = {
      homeDir: request.homeDir,
      dataRoot: request.dataRoot,
    };
    const userRule = evaluateShellUserRules(layers, scan, shellPathOpts);
    if (userRule.action === "deny") {
      return {
        kind: "deny",
        denial: buildPermissionDenial({
          call,
          tool: request.tool,
          category: "shell",
          reasonKind: "user_deny",
          rulePattern: userRule.pattern,
          message: `Command blocked by permission deny rule: ${userRule.pattern}`,
          recoveryHint:
            "Edit or remove the matching deny rule in Settings > Permissions.",
          recoveryAction: { kind: "edit_rule", category: "shell" },
        }),
      };
    }

    const patterns = alwaysPatterns(
      layers,
      call.command,
      request.homeDir,
      request.dataRoot,
    );
    const unattendedRecovery: RecoveryAction | null =
      patterns.length > 0
        ? {
            kind: "add_allow_rule",
            suggested_pattern: patterns[0],
            category: "shell",
          }
        : null;
    const unattendedHint =
      patterns.length > 0
        ? `Add an allow rule for "${patterns[0]}" or set permission mode to full.`
        : "Run this command interactively or review why it cannot be auto-allowed.";

    if (userRule.action === "ask") {
      return finalizeContext(
        {
          kind: "ask",
          reason: `Matched permission ask rule: ${userRule.pattern}`,
          outside_rewind: true,
          allowed_choices: ["once", "reject"],
          rulePattern: userRule.pattern,
          unattendedRecovery,
          unattendedHint,
        },
        request,
        context,
      );
    }

    // 내장 읽기 명령 목록(opaque·elevated·출력 리다이렉션·위험 env가 없을 때).
    if (!isOpaque && isReadOnlyShellCommand(scan, shellPathOpts)) {
      return { kind: "run" };
    }

    // read_only 단계에서는 읽기 목록 밖의 shell 실행을 막는다(저장된 allow 규칙·session grant도 우회 불가).
    if (mode === "read_only") {
      return modeDeny(
        request,
        "Non-read-only shell commands are blocked in read-only mode.",
        "shell",
      );
    }

    // elevated(sudo 등)와 opaque 명령은 user allow·session grant·읽기 목록으로 통과하지 못한다.
    if (userRule.action === "allow" && !isOpaque && !scan.elevated) {
      return { kind: "run" };
    }

    // ---------- 5. 이번 대화 허락 (shell) ----------
    if (
      !isOpaque &&
      !scan.elevated &&
      matchesSessionGrant(sessionGrants, call, {
        scan,
        homeDir: request.homeDir,
        dataRoot: request.dataRoot,
      })
    ) {
      return { kind: "run" };
    }

    // ---------- 6. 단계 기본값 (shell) ----------
    if (scan.elevated) {
      return finalizeContext(
        {
          kind: "ask",
          reason:
            "Elevated shell command (sudo/doas/su) requires explicit one-time approval.",
          outside_rewind: true,
          allowed_choices: ["once", "reject"],
          unattendedRecovery: null,
          unattendedHint:
            "Elevated commands require an interactive person and cannot be auto-allowed.",
        },
        request,
        context,
      );
    }

    if (isOpaque) {
      return finalizeContext(
        {
          kind: "ask",
          reason:
            call.opaque === true
              ? "Opening an interactive shell requires explicit one-time approval."
              : "Shell command could not be statically verified (unclosed syntax, dynamic expansion, or size limit).",
          outside_rewind: true,
          allowed_choices: ["once", "reject"],
          unattendedRecovery: null,
          unattendedHint:
            call.opaque === true
              ? "Pass --command with a specific command, or open the interactive shell in an attended session."
              : "Simplify the command so it can be verified, or run it interactively.",
        },
        request,
        context,
      );
    }

    if (mode === "full") {
      return { kind: "run" };
    }

    // ask / workspace 단계의 비-읽기 shell 명령.
    const choices: TurnRequestChoiceKind[] = ["once", "session"];
    if (patterns.length > 0) choices.push("always");
    choices.push("reject");
    return finalizeContext(
      {
        kind: "ask",
        reason:
          "Shell commands run outside rewind tracking and require approval.",
        outside_rewind: true,
        allowed_choices: choices,
        unattendedRecovery,
        unattendedHint,
      },
      request,
      context,
    );
  }

  // ---------- file_read / file_write ----------
  if (call.kind === "file_read" || call.kind === "file_write") {
    const protectedHit = checkFileSelfProtection(call, {
      homeDir: request.homeDir,
      dataRoot: request.dataRoot,
    });
    if (protectedHit !== null) {
      return {
        kind: "deny",
        denial: buildPermissionDenial({
          call,
          tool: request.tool,
          category: "file_sensitive",
          reasonKind: "scope",
          message: protectedHit.message,
          recoveryHint:
            "Protected credentials and lophn data root files cannot be accessed by file tools.",
          recoveryAction: null,
        }),
      };
    }

    const sensitive = isSensitiveWorkspaceFile(call, request.homeDir);
    const category = categoryOfCall(call, { sensitive });

    const userRule = evaluateNonShellUserRules(call, layers, request.homeDir);
    if (userRule.action === "deny") {
      return {
        kind: "deny",
        denial: buildPermissionDenial({
          call,
          tool: request.tool,
          category,
          reasonKind: "user_deny",
          rulePattern: userRule.pattern,
          message: `File access blocked by permission deny rule: ${userRule.pattern}`,
          recoveryHint:
            "Edit or remove the matching deny rule in Settings > Permissions.",
          recoveryAction: { kind: "edit_rule", category },
        }),
      };
    }

    // read_only 단계에서는 모든 파일 쓰기를 막는다(민감 파일·session grant 포함).
    if (call.kind === "file_write" && mode === "read_only") {
      return modeDeny(
        request,
        "File modifications are blocked in read-only mode.",
        category,
      );
    }

    if (userRule.action === "ask") {
      return finalizeContext(
        {
          kind: "ask",
          reason: `Matched permission ask rule: ${userRule.pattern}`,
          outside_rewind: call.kind === "file_write" && call.outside_workspace,
          allowed_choices: ["once", "reject"],
          rulePattern: userRule.pattern,
          categoryOverride: category,
        },
        request,
        context,
      );
    }

    // ---------- 4. 민감 workspace 파일 (모든 단계에서 묻는다) ----------
    if (sensitive) {
      return finalizeContext(
        {
          kind: "ask",
          reason:
            call.kind === "file_read"
              ? "Reading sensitive environment files (.env*) requires approval in all modes."
              : "Writing sensitive workspace configuration or tool files requires approval in all modes.",
          outside_rewind: call.kind === "file_write" && call.outside_workspace,
          allowed_choices: ["once", "reject"],
          categoryOverride: "file_sensitive",
        },
        request,
        context,
      );
    }

    if (userRule.action === "allow") {
      return { kind: "run" };
    }

    // ---------- 5. 이번 대화 허락 ----------
    if (
      matchesSessionGrant(sessionGrants, call, { homeDir: request.homeDir })
    ) {
      return { kind: "run" };
    }

    // ---------- 6. 단계 기본값 (file_read / file_write) ----------
    if (call.kind === "file_read") {
      if (!call.outside_workspace || mode === "full") {
        return { kind: "run" };
      }
      return finalizeContext(
        {
          kind: "ask",
          reason: `File is outside the workspace folder (${call.folder}).`,
          outside_rewind: false,
          allowed_choices: ["once", "session", "reject"],
          categoryOverride: "file_outside",
        },
        request,
        context,
      );
    }

    // file_write (mode는 read_only가 아님)
    if (mode === "full") {
      return { kind: "run" };
    }
    if (mode === "workspace") {
      if (!call.outside_workspace) return { kind: "run" };
      return finalizeContext(
        {
          kind: "ask",
          reason: `Writing outside the workspace folder (${call.folder}) requires approval.`,
          outside_rewind: true,
          allowed_choices: ["once", "session", "reject"],
          categoryOverride: "file_outside",
        },
        request,
        context,
      );
    }
    // mode === "ask"
    return finalizeContext(
      {
        kind: "ask",
        reason: call.outside_workspace
          ? `Writing outside the workspace folder (${call.folder}) requires approval.`
          : "File modifications require approval in ask mode.",
        outside_rewind: call.outside_workspace,
        allowed_choices: ["once", "session", "reject"],
        categoryOverride: category,
      },
      request,
      context,
    );
  }

  // ---------- 3. 사람 전용 등급: setting ----------
  if (call.kind === "setting") {
    return finalizeContext(
      {
        kind: "ask",
        reason: `Changing protected setting "${call.key}" requires explicit person approval.`,
        outside_rewind: true,
        allowed_choices: ["once", "reject"],
        personOnly: true,
      },
      request,
      context,
    );
  }

  // ---------- project_command ----------
  if (call.kind === "project_command") {
    if (!projectCommand.allowed) {
      return {
        kind: "deny",
        denial: buildPermissionDenial({
          call,
          tool: request.tool,
          category: "project_command",
          reasonKind: "unassigned",
          message: `Agent is not allowed to run project command "${call.name}".`,
          recoveryHint:
            "Allow this agent in the project command's allowed agents settings.",
          recoveryAction: null,
        }),
      };
    }
    if (mode === "read_only") {
      return modeDeny(
        request,
        "Running project commands is blocked in read-only mode.",
        "project_command",
      );
    }
    if (!projectCommand.askBeforeRun) return { kind: "run" };
    return finalizeContext(
      {
        kind: "ask",
        reason: `Project command "${call.name}" requires approval before running.`,
        outside_rewind: true,
        allowed_choices: ["once", "reject"],
      },
      request,
      context,
    );
  }

  // ---------- project_command_definition ----------
  if (call.kind === "project_command_definition") {
    if (!projectCommand.approveWrites) {
      if (mode === "read_only") {
        return modeDeny(
          request,
          "Modifying project command definitions is blocked in read-only mode.",
          "project_command_definition",
        );
      }
      return { kind: "run" };
    }
    return finalizeContext(
      {
        kind: "ask",
        reason:
          "Modifying project command definitions requires explicit person approval.",
        outside_rewind: true,
        allowed_choices: ["once", "reject"],
        personOnly: true,
      },
      request,
      context,
    );
  }

  // ---------- workflow_run ----------
  if (call.kind === "workflow_run") {
    if (mode === "read_only") {
      return modeDeny(
        request,
        "Running or overriding workflows is blocked in read-only mode.",
        "workflow_run",
      );
    }
    const reason =
      call.mode === "one_off"
        ? `Starting a one-off workflow "${call.workflow}" requires explicit person approval.`
        : call.mode === "override"
          ? `Starting "${call.workflow}" with per-instance overrides requires explicit person approval.`
          : `Patching flow code for "${call.workflow}" requires explicit person approval.`;
    return finalizeContext(
      {
        kind: "ask",
        reason,
        outside_rewind: true,
        allowed_choices: ["once", "reject"],
        personOnly: true,
      },
      request,
      context,
    );
  }

  // ---------- worktree_remove ----------
  if (call.kind === "worktree_remove") {
    if (mode === "read_only") {
      return modeDeny(
        request,
        "Removing git worktrees is blocked in read-only mode.",
        "worktree_remove",
      );
    }
    const target = call.branch
      ? `worktree "${call.branch}" (${call.path})`
      : `worktree (${call.path})`;
    return finalizeContext(
      {
        kind: "ask",
        reason: `Removing ${target} requires approval.`,
        outside_rewind: true,
        allowed_choices: ["once", "reject"],
        categoryOverride: "worktree_remove",
      },
      request,
      context,
    );
  }

  // ---------- local_tool ----------
  if (call.kind === "local_tool") {
    const userRule = evaluateNonShellUserRules(call, layers, request.homeDir);
    if (userRule.action === "deny") {
      return {
        kind: "deny",
        denial: buildPermissionDenial({
          call,
          tool: request.tool,
          category: "local_tool",
          reasonKind: "user_deny",
          rulePattern: userRule.pattern,
          message: `Local tool blocked by permission deny rule: ${userRule.pattern}`,
          recoveryHint:
            "Edit or remove the matching deny rule in Settings > Permissions.",
          recoveryAction: { kind: "edit_rule", category: "local_tool" },
        }),
      };
    }

    // wiring/approvals.ts가 매 판정마다 라이브 (path, sha256)을 local_tool_trust와 대조한다.
    // call.changed는 아직 신뢰되지 않았을 때 안내 문구를 고르는 용도로만 쓴다.
    const trusted = request.localToolTrusted === true;
    if (!trusted) {
      return finalizeContext(
        {
          kind: "ask",
          reason: call.changed
            ? `Local tool "${call.name}" changed since it was last trusted and requires re-approval.`
            : `Local tool "${call.name}" is not yet trusted and requires person approval.`,
          outside_rewind: true,
          allowed_choices: ["once", "reject"],
          personOnly: true,
          unattendedRecovery: {
            kind: "trust_local_tool",
            tool_path: call.path,
            sha256: call.sha256,
          },
          unattendedHint: `Trust the local tool "${call.name}" in /permissions before running unattended.`,
        },
        request,
        context,
      );
    }

    if (userRule.action === "ask") {
      return finalizeContext(
        {
          kind: "ask",
          reason: `Matched permission ask rule: ${userRule.pattern}`,
          outside_rewind: true,
          allowed_choices: ["once", "reject"],
          rulePattern: userRule.pattern,
        },
        request,
        context,
      );
    }

    if (mode === "read_only") {
      return modeDeny(
        request,
        "Running local tool scripts is blocked in read-only mode.",
        "local_tool",
      );
    }
    return { kind: "run" };
  }

  // ---------- app_tool ----------
  if (call.kind === "app_tool") {
    const userRule = evaluateNonShellUserRules(call, layers, request.homeDir);
    if (userRule.action === "deny") {
      return {
        kind: "deny",
        denial: buildPermissionDenial({
          call,
          tool: request.tool,
          category: "app_tool",
          reasonKind: "user_deny",
          rulePattern: userRule.pattern,
          message: `App tool blocked by permission deny rule: ${userRule.pattern}`,
          recoveryHint:
            "Edit or remove the matching deny rule in Settings > Permissions.",
          recoveryAction: { kind: "edit_rule", category: "app_tool" },
        }),
      };
    }

    if (mode === "read_only" && call.effect !== "read") {
      return modeDeny(
        request,
        `Non-read app tool "${call.tool}" is blocked in read-only mode.`,
        "app_tool",
      );
    }

    if (userRule.action === "ask") {
      return finalizeContext(
        {
          kind: "ask",
          reason: `Matched permission ask rule: ${userRule.pattern}`,
          outside_rewind: call.effect !== "read",
          allowed_choices: ["once", "reject"],
          rulePattern: userRule.pattern,
        },
        request,
        context,
      );
    }

    if (userRule.action === "allow") {
      return { kind: "run" };
    }

    if (matchesSessionGrant(sessionGrants, call)) {
      return { kind: "run" };
    }

    // 그 앱의 skill이 이 session에 닿으면(배포) 묻지 않고, 앱 자기 workspace의 session도 묻지 않는다. 닿지 않은 앱은 사람이 허락해야 한다.
    // 사람이 `full`을 골랐으면 맡긴 것이다(사람이 없는 실행은 아래에서 막힌다).
    const access = request.appAccess;
    if (access?.reached === true) return { kind: "run" };
    if (mode === "full" && context !== "unattended") return { kind: "run" };
    const slug = access?.slug ?? call.app;
    // `always`는 그 앱의 public skill을 이 session의 workspace에 배포하는 일이라 배포할 skill이 있어야 연다.
    const deployable = (access?.skills.length ?? 0) > 0;
    // 사람이 없는 실행과 팀 자식에게 알리는 말은 그 agent가 실제로 할 수 있는 일이어야 한다.
    const hint = !deployable
      ? `App ${slug} has no public skill, so there is nothing to deploy. The agent in the app's own workspace has to write one.`
      : access?.mayDeploy === true
        ? `Deploy a skill of app ${slug} first (\`lophn skill deploy ${slug} <skill> --to workspace\`, \`--to agent:<handle>\` or \`--to global\`).`
        : `This agent cannot deploy it. Ask the person to deploy a skill of app ${slug}, or to allow the call in a session they are in.`;
    return finalizeContext(
      {
        kind: "ask",
        // 사람만 허락한다: 부모 agent가 팀 자식 대신 허락하면 사람 없이 앱이 돈다(배포 승인과 같다).
        personOnly: true,
        reason: `${access?.agent ?? "This agent"} has no skill of ${slug}, so it asks before using it.`,
        outside_rewind: call.effect !== "read",
        allowed_choices: deployable
          ? ["once", "session", "always", "reject"]
          : ["once", "session", "reject"],
        ...(deployable
          ? {
              alwaysPatterns: access!.skills.map(
                (skill) => `the skill ${skill} of ${slug} for this workspace`,
              ),
            }
          : {}),
        unattendedHint: hint,
      },
      request,
      context,
    );
  }

  // ---------- mcp_tool ----------
  const userRule = evaluateNonShellUserRules(call, layers, request.homeDir);
  if (userRule.action === "deny") {
    return {
      kind: "deny",
      denial: buildPermissionDenial({
        call,
        tool: request.tool,
        category: "mcp_tool",
        reasonKind: "user_deny",
        rulePattern: userRule.pattern,
        message: `MCP tool blocked by permission deny rule: ${userRule.pattern}`,
        recoveryHint:
          "Edit or remove the matching deny rule in Settings > Permissions.",
        recoveryAction: { kind: "edit_rule", category: "mcp_tool" },
      }),
    };
  }

  const isReadOnlyMcp = call.read_only === true;
  if (mode === "read_only" && !isReadOnlyMcp) {
    return modeDeny(
      request,
      `Non-read-only MCP tool "${call.server}/${call.tool}" is blocked in read-only mode.`,
      "mcp_tool",
    );
  }

  if (userRule.action === "ask") {
    return finalizeContext(
      {
        kind: "ask",
        reason: `Matched permission ask rule: ${userRule.pattern}`,
        outside_rewind: true,
        allowed_choices: ["once", "reject"],
        rulePattern: userRule.pattern,
        unattendedRecovery: { kind: "trust_mcp", server: call.server },
        unattendedHint: `Mark MCP server "${call.server}" as trusted or adjust the ask rule.`,
      },
      request,
      context,
    );
  }

  if (userRule.action === "allow") {
    return { kind: "run" };
  }

  if (matchesSessionGrant(sessionGrants, call)) {
    return { kind: "run" };
  }

  const trust: McpTrust = request.mcpTrust ?? "untrusted";
  if (trust === "trusted" || isReadOnlyMcp || mode === "full") {
    return { kind: "run" };
  }

  return finalizeContext(
    {
      kind: "ask",
      reason: `MCP server "${call.server}" is untrusted and tool "${call.tool}" is not marked read-only.`,
      outside_rewind: true,
      allowed_choices: ["once", "session", "reject"],
      unattendedRecovery: { kind: "trust_mcp", server: call.server },
      unattendedHint: `Mark MCP server "${call.server}" as trusted in Settings or /permissions.`,
    },
    request,
    context,
  );
}
