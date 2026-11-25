// Layer 3: Declarative AcpDialect interface separating harness-specific ACP quirks
// from the generic JSON-RPC transport, protocol runtime, and state projector.

import type {
  AcpToolDetail,
  AcpToolItem,
} from "../../../protocol/acp/items.ts";
import type {
  AcpCommand,
  AcpModelGroup,
} from "../../../protocol/acp/session.ts";
import type { AcpApprovalSubject } from "../../../protocol/approvals/gate-call.ts";
import type { Json } from "./transport.ts";

export type ConfigOptionChoice = {
  value: string;
  name: string;
  description: string | null;
};

export type ConfigOption = {
  id: string;
  current: string;
  options: ConfigOptionChoice[];
};

export type SlashCommandClass =
  | "local"
  | "maintenance"
  | "conversational"
  | "withheld";

export type AcpSubagentClassification = {
  kind: "subagent" | "swarm_worker" | "background_task";
  childKey: string;
  roleOrAgent: string;
  description: string;
  model: string | null;
  outlivesPrompt: boolean;
};

export type DialectToolInput = {
  toolCallId: string;
  name: string;
  kind: string;
  title: string;
  args: Json;
  locations: readonly Json[];
};

export type DialectToolClassification = {
  category: AcpToolItem["category"];
  title: string;
  /** Resolved absolute path when applicable, else "". */
  path: string;
  detail: AcpToolDetail;
  subagent?: AcpSubagentClassification;
  outlivesPrompt: boolean;
};

export type DialectPermissionOption = {
  id: string;
  kind: string;
  name: string;
  securityWarning: string | null;
};

export type DialectPermissionAction =
  | {
      kind: "question";
      label: string;
      options: { id: string; label: string }[];
      securityWarnings: string[];
    }
  | {
      kind: "approval";
      subject: AcpApprovalSubject;
      options: DialectPermissionOption[];
      alwaysPatterns: string[];
      securityWarnings: string[];
    };

export type ChildWorkState = "running" | "ok" | "error" | "cancelled";

export type ChildWorkEntry = {
  conversationId: string;
  typeName: string;
  role: string;
  state: ChildWorkState;
  spawnStepIndex: number | null;
  workspaceUris: string[];
};

export type ChildTranscriptToolCall = {
  name: string;
  args: Json;
};

export type ChildTranscriptStep = {
  stepIndex: number;
  source: string;
  type: string;
  status: string;
  createdAt: string;
  content: string | null;
  thinking: string | null;
  error: string | null;
  toolCalls: ChildTranscriptToolCall[];
};

export type ReactiveWakeupTimers = {
  /** Wait after usage_update once no running tools remain (default 500ms). */
  usageSettleMs: number;
  /** Quiet timeout once no running tools remain (default 20_000ms). */
  quietMs: number;
  /** Quiet timeout while tools/subagents are still running (default 120_000ms). */
  runningToolsQuietMs: number;
  /** Absolute upper bound for holding a deferred turn open (default 30m). */
  maxHoldMs: number;
};

export type LaunchSpec = {
  args: string[];
  env?: Record<string, string>;
  tuiRest: string[];
  parsedFlags: {
    model?: string;
    effort?: string;
    mode?: string;
  };
};

export type AcpDialect = {
  readonly id: string;
  readonly command: string;
  readonly label: string;
  readonly clientInfo: { name: string; version: string };
  readonly clientCapabilities: Json;
  readonly resumePreference: "resume" | "load";
  readonly loadReplayQuietPeriodMs: number;
  readonly reactiveWakeups: boolean;
  readonly reactiveTimers: ReactiveWakeupTimers;
  readonly withheldCommands: readonly string[];
  readonly localCommands: readonly AcpCommand[];
  readonly childPollIntervalMs: number;

  buildLaunchSpec(rawArgs: readonly string[]): LaunchSpec;
  supportsMidTurnPromptSteer(agentVersion: string | null): boolean;
  classifySlashCommand(
    name: string,
    availableCommands: readonly string[],
  ): SlashCommandClass;
  classifyToolCall(
    tool: DialectToolInput,
    cwd: string,
  ): DialectToolClassification;
  normalizeToolOutput(
    tool: { name: string; kind: string; args: Json },
    rawUpdate: Json,
    cwd: string,
  ): { output: string | null; diffDetail: AcpToolDetail | null };
  extractPermissionAction(
    params: Json,
    call: { name: string; kind: string; args: Json; path: string } | undefined,
    cwd: string,
  ): DialectPermissionAction;
  isWarningChunk(text: string): boolean;
  formatWarningText(text: string): string;
  parseConfigs(raw: unknown): ConfigOption[];
  buildModelGroups(
    configs: readonly ConfigOption[],
    legacyModels: readonly string[],
  ): AcpModelGroup[];
  formatMaintenanceOutput(
    command: string,
    context: { used: number; size: number } | null,
  ): string;
  checkVersionWarning(agentVersion: string): string | null;
  buildTuiCommand(input: {
    sessionId: string;
    launchSpec: LaunchSpec;
    configs: readonly ConfigOption[];
    legacyModels: readonly string[];
    changed: { model: boolean; thought: boolean; mode: boolean };
  }): string;
  sessionExists?(sessionId: string): Promise<boolean>;
  readChildWork?(parentSessionId: string): Promise<ChildWorkEntry[] | null>;
  readChildTranscript?(
    childConversationId: string,
  ): Promise<ChildTranscriptStep[] | null>;
};
