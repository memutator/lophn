// Pure permission view-model helpers for mobile screens (approval cards, 4-stage mode picker,
// PermissionDenied timeline cards, and job approval participant modes). Kept React-free so Node tests import it directly.
import { t } from "@lophn/i18n";
import type { PermissionDenial } from "../../../../protocol/approvals/denial.ts";
import type {
  TurnRequest,
  TurnRequestChoiceKind,
} from "../../../../protocol/approvals/turn-request.ts";
import type { JobRecord } from "../../../../protocol/jobs/jobs.ts";
import {
  PERMISSION_MODES,
  type PermissionMode,
} from "../../../../protocol/lophn-agent/turn-values.ts";
import type { ApprovalSubject } from "../../../../shell/renderer/conversation/agent-tab-source.ts";
import type { WaitingChoice } from "../../../../shell/renderer/desktop/connection/waiting/decide.ts";

// ---- 4-stage permission modes

export const PERMISSION_MODE_LABELS: Readonly<Record<PermissionMode, string>> =
  {
    read_only: "Read only",
    ask: "Ask every time",
    workspace: "Auto-edit in workspace",
    full: "Full access",
  };

export const PERMISSION_MODE_DESCRIPTIONS: Readonly<
  Record<PermissionMode, string>
> = {
  read_only: "Reads and searches only.",
  ask: "Reads run automatically; edits, shell, and external actions ask.",
  workspace:
    "Workspace edits and built-in read commands run automatically; other shell and outside paths ask.",
  full: "Runs without asking except floor rules, deny rules, and user-only actions.",
};

export function isPermissionMode(
  value: string | null | undefined,
): value is PermissionMode {
  return (
    value !== null &&
    value !== undefined &&
    (PERMISSION_MODES as readonly string[]).includes(value)
  );
}

/** Display name for a session mode. Known 4-stage modes use the canonical labels; harness modes fall back to meta labels. */
export function permissionModeLabel(
  mode: string | null | undefined,
  modes?: readonly { readonly id: string; readonly label: string }[],
): string | null {
  if (mode === null || mode === undefined) return null;
  if (isPermissionMode(mode)) return PERMISSION_MODE_LABELS[mode];
  return modes?.find((entry) => entry.id === mode)?.label ?? mode;
}

/** True when switching from `from` to `to` changes the session's permission mode. */
export function canSelectMode(
  from: PermissionMode | null,
  to: PermissionMode,
): boolean {
  return from !== null && from !== to;
}

// ---- approval cards (conversation + inbox + home)

export interface ApprovalFact {
  readonly label: string;
  readonly value: string;
  readonly fit?: boolean;
}

export interface ApprovalCardData {
  readonly subject: ApprovalSubject;
  readonly choices: readonly TurnRequestChoiceKind[];
  readonly always_patterns: readonly string[];
  readonly reason?: string | null;
  readonly outside_rewind?: boolean;
}

function projectCommandSummaryLine(item: {
  readonly name: string;
  readonly command: string;
  readonly cwd: string | null;
  readonly env_keys: readonly string[];
}): string {
  return [
    `${item.name}: ${item.command}`,
    item.cwd === null ? null : `cwd: ${item.cwd}`,
    item.env_keys.length === 0 ? null : `env: ${item.env_keys.join(", ")}`,
  ]
    .filter((part): part is string => part !== null)
    .join("\n");
}

/** Title for an approval subject, handling new Wave 1 AskedCall kinds directly and delegating the rest. */
export function approvalTitleOf(
  subject: ApprovalSubject,
  agent: string,
  fallback: (subject: ApprovalSubject, agent: string) => string,
): string {
  switch (subject.kind) {
    case "file_read":
      if (subject.sensitive) return `${agent} wants to read a sensitive file`;
      if (subject.outside_workspace) {
        return `${agent} wants to read a file outside the workspace`;
      }
      return `${agent} wants to read a file`;
    case "file_write": {
      const verb =
        subject.action === "delete"
          ? "delete"
          : subject.action === "edit"
            ? "edit"
            : "write";
      if (subject.sensitive) {
        return `${agent} wants to ${verb} a sensitive file`;
      }
      if (subject.outside_workspace) {
        return `${agent} wants to ${verb} a file outside the workspace`;
      }
      return `${agent} wants to ${verb} a file`;
    }
    case "local_tool":
      return subject.changed
        ? `${agent} wants to run modified local tool ${subject.name}`
        : `${agent} wants to run local tool ${subject.name}`;
    default:
      return fallback(subject, agent);
  }
}

/** Target text for approval result rows in the thread, covering new AskedCall kinds safely. */
export function approvalTargetOf(
  subject: ApprovalSubject,
  fallback: (subject: ApprovalSubject) => string,
): string {
  switch (subject.kind) {
    case "file_read":
      return subject.path;
    case "file_write":
      return `${subject.action} ${subject.path}`;
    case "local_tool":
      return `${subject.name} (${subject.path})`;
    default:
      return fallback(subject);
  }
}

/** Facts listed on the conversation approval card, including new AskedCall kinds and exact always_patterns. */
export function approvalFactsOf(
  request: ApprovalCardData,
  helpers: {
    readonly changeText: (
      change: Extract<
        ApprovalSubject,
        { kind: "file_change" }
      >["changes"][number],
    ) => string;
    readonly targetOf: (subject: ApprovalSubject) => string;
    readonly effectOf: (subject: ApprovalSubject) => string | null;
  },
): ApprovalFact[] {
  const { subject } = request;
  let facts: ApprovalFact[];
  switch (subject.kind) {
    case "shell":
      facts = [
        {
          label: t("conversation.label.approval-command"),
          value: subject.command,
        },
      ];
      break;
    case "file_read":
      facts = [
        { label: "Path", value: subject.path },
        { label: "Folder", value: subject.folder },
        ...(subject.sensitive
          ? [{ label: "Notice", value: "Sensitive path", fit: true }]
          : subject.outside_workspace
            ? [{ label: "Scope", value: "Outside workspace", fit: true }]
            : []),
      ];
      break;
    case "file_write":
      facts = [
        { label: "Action", value: subject.action, fit: true },
        { label: "Path", value: subject.path },
        { label: "Folder", value: subject.folder },
        ...(subject.sensitive
          ? [{ label: "Notice", value: "Sensitive path", fit: true }]
          : subject.outside_workspace
            ? [{ label: "Scope", value: "Outside workspace", fit: true }]
            : []),
      ];
      break;
    case "local_tool":
      facts = [
        { label: "Tool", value: subject.name, fit: true },
        { label: "Path", value: subject.path },
        { label: "SHA-256", value: subject.sha256 },
        ...(subject.changed
          ? [
              {
                label: "Notice",
                value: "Script content changed since last trusted",
                fit: true,
              },
            ]
          : []),
      ];
      break;
    case "file_change":
      facts = [
        {
          label: t("conversation.label.approval-changes"),
          value: subject.changes.map(helpers.changeText).join("\n"),
        },
      ];
      break;
    case "plan":
      facts = [{ label: t("conversation.label.plan"), value: subject.plan }];
      break;
    case "setting":
      facts = [
        {
          label: t("conversation.label.approval-changes"),
          value: subject.lines.join("\n"),
        },
      ];
      break;
    case "project_command":
      facts = [
        {
          label: t("conversation.label.approval-command"),
          value: subject.command,
        },
        ...(subject.cwd === null
          ? []
          : [
              {
                label: t("conversation.label.approval-cwd"),
                value: subject.cwd,
              },
            ]),
        ...(subject.env_keys.length === 0
          ? []
          : [
              {
                label: t("conversation.label.approval-env-keys"),
                value: subject.env_keys.join(", "),
              },
            ]),
      ];
      break;
    case "project_command_definition":
      facts = [
        ...(subject.before === null
          ? []
          : [
              {
                label: t("conversation.label.approval-before"),
                value: projectCommandSummaryLine(subject.before),
              },
            ]),
        ...(subject.after === null
          ? []
          : [
              {
                label: t("conversation.label.approval-after"),
                value: projectCommandSummaryLine(subject.after),
              },
            ]),
      ];
      break;
    case "workflow_run":
      facts = [
        {
          label: t("conversation.label.approval-changes"),
          value: subject.lines.join("\n"),
        },
      ];
      break;
    case "worktree_remove":
      facts = [
        { label: "Path", value: subject.path },
        ...(subject.branch === null
          ? []
          : [{ label: "Branch", value: subject.branch, fit: true }]),
        ...(subject.dirty_count + subject.untracked_count > 0
          ? [{ label: "Notice", value: "Uncommitted changes", fit: true }]
          : []),
      ];
      break;
    case "app_tool":
    case "mcp_tool":
      facts = [
        {
          label: t("conversation.label.approval-target"),
          value: helpers.targetOf(subject),
        },
        {
          label: t("conversation.label.approval-effect"),
          value: helpers.effectOf(subject) ?? "",
        },
      ];
      break;
  }

  if (
    request.choices.includes("always") &&
    request.always_patterns.length > 0
  ) {
    facts.push({
      label: t("conversation.label.approval-always"),
      value: request.always_patterns.join("\n"),
      fit: true,
    });
  }
  return facts;
}

export interface InboxFact {
  readonly label: string;
  readonly value: string;
  readonly style: "text" | "code" | "effect";
}

export interface InboxPermissionDetails {
  readonly title: string;
  readonly description: string;
  readonly facts: readonly InboxFact[];
  readonly factsPinned: boolean;
  readonly choices: readonly TurnRequestChoiceKind[];
  readonly reason: string | null;
  readonly outsideRewind: boolean;
  readonly alwaysPatterns: readonly string[];
}

/** Normalizes a TurnRequest + desktop CardView for Inbox and Home permission cards across all AskedCall kinds. */
export function inboxPermissionDetails(
  request: TurnRequest,
  view: {
    readonly title?: string;
    readonly description?: string;
    readonly facts: readonly InboxFact[];
    readonly factsPinned: boolean;
    readonly choices: readonly WaitingChoice[];
  },
): InboxPermissionDetails {
  const { subject } = request;
  const choices: readonly TurnRequestChoiceKind[] =
    subject.kind === "harness" ? [] : [...request.allowed_choices];
  const alwaysLabel = t("waiting.label.fact-always");
  const hasAlwaysFact = view.facts.some((fact) => fact.label === alwaysLabel);
  const alwaysFact: InboxFact[] =
    choices.includes("always") &&
    request.always_patterns.length > 0 &&
    !hasAlwaysFact
      ? [
          {
            label: alwaysLabel,
            value: request.always_patterns.join("\n"),
            style: "code",
          },
        ]
      : [];

  let title = view.title ?? "";
  let description = view.description ?? "";
  let facts: readonly InboxFact[] = view.facts;
  let factsPinned = view.factsPinned;

  if (subject.kind === "file_read") {
    title = subject.sensitive
      ? "Read sensitive file"
      : subject.outside_workspace
        ? "Read file outside workspace"
        : "Read file";
    description = subject.sensitive
      ? "Asks before reading a sensitive file."
      : "Asks before reading outside the workspace.";
    factsPinned = true;
    facts = [
      { label: "Path", value: subject.path, style: "code" },
      { label: "Folder", value: subject.folder, style: "text" },
      ...alwaysFact,
    ];
  } else if (subject.kind === "file_write") {
    const actionLabel =
      subject.action === "delete"
        ? "Delete"
        : subject.action === "edit"
          ? "Edit"
          : "Write";
    title = subject.sensitive
      ? `${actionLabel} sensitive file`
      : subject.outside_workspace
        ? `${actionLabel} file outside workspace`
        : `${actionLabel} file`;
    description = subject.sensitive
      ? "Asks before changing a sensitive file."
      : "Asks before changing a file outside the workspace.";
    factsPinned = true;
    facts = [
      { label: "Path", value: subject.path, style: "code" },
      { label: "Folder", value: subject.folder, style: "text" },
      { label: "Action", value: subject.action, style: "text" },
      ...alwaysFact,
    ];
  } else if (subject.kind === "local_tool") {
    title = subject.changed
      ? `Run modified local tool ${subject.name}`
      : `Run local tool ${subject.name}`;
    description = subject.changed
      ? "This local script changed since it was last trusted."
      : "Asks before trusting and running a local script.";
    factsPinned = true;
    facts = [
      { label: "Path", value: subject.path, style: "code" },
      { label: "SHA-256", value: subject.sha256, style: "code" },
      ...alwaysFact,
    ];
  } else if (alwaysFact.length > 0) {
    facts = [...view.facts, ...alwaysFact];
  } else if (!choices.includes("always") && hasAlwaysFact) {
    // Strip always_patterns fact if core disallowed "always" on this request (e.g. risky / opaque command).
    facts = view.facts.filter((fact) => fact.label !== alwaysLabel);
  }

  return {
    title,
    description,
    facts,
    factsPinned,
    choices,
    reason:
      request.reason !== null && request.reason.trim() !== ""
        ? request.reason
        : null,
    outsideRewind: request.outside_rewind,
    alwaysPatterns: choices.includes("always") ? request.always_patterns : [],
  };
}

// ---- timeline PermissionDenied formatting

export interface DeniedDisplay {
  readonly badge: string;
  readonly target: string;
  readonly reason: string;
  readonly rulePattern: string | null;
  readonly recoveryHint: string | null;
}

export function permissionDenialDisplay(
  denial: PermissionDenial,
): DeniedDisplay {
  return {
    badge: "Blocked",
    target:
      denial.target_summary.trim() !== ""
        ? `${denial.tool} · ${denial.target_summary}`
        : denial.tool,
    reason: denial.message,
    rulePattern:
      denial.rule_pattern !== null && denial.rule_pattern.trim() !== ""
        ? denial.rule_pattern
        : null,
    recoveryHint:
      denial.recovery_hint !== null && denial.recovery_hint.trim() !== ""
        ? denial.recovery_hint
        : null,
  };
}

// ---- job approval participant modes & escalation notice

export interface JobParticipantModeRow {
  readonly participant: string;
  readonly mode: PermissionMode;
  readonly label: string;
  readonly isFull: boolean;
}

export function jobApprovalModeInfo(
  job: Pick<JobRecord, "participant_modes" | "approval_paused_reason">,
): {
  readonly modeEscalated: boolean;
  readonly participantModes: readonly JobParticipantModeRow[];
} {
  const modes = job.participant_modes ?? {};
  const participantModes = Object.entries(modes).map(([participant, mode]) => ({
    participant,
    mode,
    label: PERMISSION_MODE_LABELS[mode],
    isFull: mode === "full",
  }));
  return {
    modeEscalated: job.approval_paused_reason === "mode_escalated",
    participantModes,
  };
}
