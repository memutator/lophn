import type {
  DenyReasonKind,
  GateCall,
  PermissionCategory,
  PermissionDenial,
  RecoveryAction,
} from "../../../protocol/approvals/mod.ts";

export const ANTI_BYPASS_NOTICE =
  "Do not attempt to bypass this restriction using another tool (such as shell.run); explain the block to the user or follow the recovery guidance.";

export function defaultToolName(call: GateCall): string {
  switch (call.kind) {
    case "shell":
      return "shell.run";
    case "file_read":
      return "file.read";
    case "file_write":
      return `file.${call.action}`;
    case "app_tool":
      return call.tool;
    case "mcp_tool":
      return `${call.server}/${call.tool}`;
    case "local_tool":
      return `local__${call.name}`;
    case "setting":
      return "settings.update";
    case "project_command":
      return "project_commands.run";
    case "project_command_definition":
      return `project_commands.${call.action}`;
    case "workflow_run":
      return call.mode === "override_code"
        ? "workflow.override_code"
        : "workflow.run";
    case "worktree_remove":
      return "worktree.remove";
  }
}

export function categoryOfCall(
  call: GateCall,
  options?: { sensitive?: boolean },
): PermissionCategory {
  switch (call.kind) {
    case "shell":
      return "shell";
    case "file_read":
      if (options?.sensitive || call.sensitive) return "file_sensitive";
      if (call.outside_workspace) return "file_outside";
      return "file_read";
    case "file_write":
      if (options?.sensitive || call.sensitive) return "file_sensitive";
      if (call.outside_workspace) return "file_outside";
      return "file_write";
    case "app_tool":
      return "app_tool";
    case "mcp_tool":
      return "mcp_tool";
    case "local_tool":
      return "local_tool";
    case "setting":
      return "setting";
    case "project_command":
      return "project_command";
    case "project_command_definition":
      return "project_command_definition";
    case "workflow_run":
      return "workflow_run";
    case "worktree_remove":
      return "worktree_remove";
  }
}

export function targetSummaryOfCall(call: GateCall): string {
  switch (call.kind) {
    case "shell":
      return call.command.length > 160
        ? `${call.command.slice(0, 157)}...`
        : call.command;
    case "file_read":
    case "file_write":
      return call.path;
    case "app_tool":
      return `${call.app}/${call.tool}`;
    case "mcp_tool":
      return `${call.server}/${call.tool}`;
    case "local_tool":
      return `${call.name} (${call.path})`;
    case "setting":
      return call.key;
    case "project_command":
      return `${call.name}: ${call.command}`;
    case "project_command_definition":
      return `${call.action} ${call.after?.name ?? call.before?.name ?? call.project}`;
    case "workflow_run":
      return `${call.mode} ${call.workflow}`;
    case "worktree_remove":
      return call.branch ? `${call.branch} (${call.path})` : call.path;
  }
}

export function buildPermissionDenial(input: {
  readonly call: GateCall;
  readonly tool?: string;
  readonly category?: PermissionCategory;
  readonly reasonKind: DenyReasonKind;
  readonly rulePattern?: string | null;
  readonly message: string;
  readonly recoveryHint?: string | null;
  readonly recoveryAction?: RecoveryAction | null;
}): PermissionDenial {
  return {
    tool: input.tool ?? defaultToolName(input.call),
    category: input.category ?? categoryOfCall(input.call),
    target_summary: targetSummaryOfCall(input.call),
    reason_kind: input.reasonKind,
    rule_pattern: input.rulePattern ?? null,
    message: input.message,
    recovery_hint: input.recoveryHint ?? null,
    recovery_action: input.recoveryAction ?? null,
  };
}

// model에 돌려주는 거부 문자열. 이유·규칙·복구 안내·우회 금지 문장을 빠짐없이 싣는다.
export function formatDenialForModel(denial: PermissionDenial): string {
  const lines = [
    `Permission denied (${denial.reason_kind}): ${denial.message}`,
    `Target: ${denial.target_summary}`,
  ];
  if (denial.rule_pattern !== null) {
    lines.push(`Matched rule: ${denial.rule_pattern}`);
  }
  if (denial.recovery_hint !== null) {
    lines.push(`Recovery: ${denial.recovery_hint}`);
  }
  lines.push(ANTI_BYPASS_NOTICE);
  return lines.join("\n");
}
