// Antigravity (`agy acp`) dialect implementation over AcpDialect.
// Encapsulates all agy-specific flags, configOptions/thought_level mapping,
// version-gated mid-turn steer, 3-way slash classification + withheldCommands,
// subagent/swarm classification, reactive wakeups (excluding daemon/cron),
// interaction_* questions, agy.security.warning, and read-only brain child work.

import { isAbsolute, join } from "node:path";
import type {
  AcpToolDetail,
  AcpToolItem,
} from "../../../protocol/acp/items.ts";
import type {
  AcpCommand,
  AcpModelGroup,
} from "../../../protocol/acp/session.ts";
import type { AcpApprovalSubject } from "../../../protocol/approvals/gate-call.ts";
import {
  readAntigravityChildTranscript,
  readAntigravityChildWork,
} from "./antigravity-child-work.ts";
import type {
  AcpDialect,
  AcpSubagentClassification,
  ConfigOption,
  ConfigOptionChoice,
  DialectPermissionAction,
  DialectToolClassification,
  DialectToolInput,
  LaunchSpec,
  ReactiveWakeupTimers,
  SlashCommandClass,
} from "./dialect.ts";
import { computeTextDiff } from "./text-diff.ts";
import type { Json } from "./transport.ts";

export const AGY_RECORDED_VERSION = "1.5.9";
export const AGY_CLIENT_VERSION = "0.0.0";
export const AGY_REPLAY_QUIET_MS = 200;
export const AGY_CHILD_POLL_MS = 1000;

export const DEFAULT_AGY_REACTIVE_TIMERS: ReactiveWakeupTimers = {
  usageSettleMs: 500,
  quietMs: 20_000,
  runningToolsQuietMs: 120_000,
  maxHoldMs: 30 * 60_000,
};

const EFFORT_ORDER = ["low", "medium", "high"];
const WITHHELD_COMMANDS = ["logout"] as const;
const MAINTENANCE_COMMANDS = new Set(["compact"]);
const LOCAL_COMMANDS_SET = new Set(["resume"]);

const ADAPTER_COMMANDS: readonly AcpCommand[] = [
  {
    name: "resume",
    aliases: [],
    description: "Open an earlier conversation in this folder",
    argument_hint: null,
    source: "harness",
    opens: "resume",
  },
];

const AGY_ACP_BOOL_FLAGS = new Set([
  "--dangerously-skip-permissions",
  "--sandbox",
  "--disable-telemetry",
  "--disable_telemetry",
  "--include-default-customizations",
  "--process-per-session",
]);
const AGY_ACP_VALUE_FLAGS = new Set([
  "--add-dir",
  "--agent",
  "--log-file",
  "--app-data-dir",
  "--app_data_dir",
  "--gemini-dir",
  "--gemini_dir",
  "--ide-mcp-port",
  "--ide_mcp_port",
]);

const COMMAND_KEYS = ["CommandLine", "command_line", "commandLine", "command"];
const PATH_KEYS = [
  "Path",
  "path",
  "AbsolutePath",
  "TargetFile",
  "FilePath",
  "file_path",
];
const OTHER_KEYS = ["Url", "url", "Query", "query", "Pattern", "pattern"];
const SHELL_HEADER =
  /^(?:(?:Created At|Completed At): .*\n)*(?:Command exited with code -?\d+\.\n\n)?(?:Command output:\n)?/;
const CATEGORIES: Record<string, AcpToolItem["category"]> = {
  execute: "command",
  read: "read",
  search: "search",
  fetch: "web",
  list_dir: "list",
};
const SUBAGENT_TOOL_NAMES = new Set([
  "invoke_subagent",
  "start_subagent",
  "Task",
  "Agent",
]);

// biome-ignore lint/suspicious/noControlCharactersInRegex: strip ANSI color escapes from shell output.
const ANSI = /\u001b\[[0-9;]*m/g;
const POSIX_SAFE = /^[A-Za-z0-9._/:=+@-]+$/;

const isRec = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const rec = (value: unknown): Json => (isRec(value) ? value : {});
const arr = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const str = (value: unknown): string =>
  typeof value === "string" ? value : "";
const plain = (text: string): string => text.replace(ANSI, "");
const capital = (word: string): string =>
  word.charAt(0).toUpperCase() + word.slice(1);
const shq = (value: string): string =>
  POSIX_SAFE.test(value) ? value : `'${value.replace(/'/g, "'\\''")}'`;
const oneLine = (text: string, max: number): string =>
  text
    .replace(/\s*\n\s*/g, " ")
    .trim()
    .slice(0, max);
const countLines = (text: string): number =>
  text === "" ? 0 : text.replace(/\n$/, "").split("\n").length;

function initialEditCounts(args: Json): { added: number; removed: number } {
  const chunks =
    arr(args.ReplacementChunks).length > 0
      ? arr(args.ReplacementChunks)
      : arr(args.replacement_chunks);
  if (chunks.length > 0) {
    let added = 0;
    let removed = 0;
    for (const chunk of chunks) {
      const c = rec(chunk);
      const diff = computeTextDiff(
        pick(c, ["TargetContent", "target_content", "Target"]),
        pick(c, ["ReplacementContent", "replacement_content", "Replacement"]),
      );
      added += diff.added;
      removed += diff.removed;
    }
    return { added, removed };
  }
  const before = pick(args, ["Target", "TargetContent", "target_content"]);
  const after = pick(args, [
    "Replacement",
    "ReplacementContent",
    "replacement_content",
  ]);
  if (before !== "" || after !== "") {
    const diff = computeTextDiff(before, after);
    return { added: diff.added, removed: diff.removed };
  }
  return {
    added: countLines(pick(args, ["Content", "content", "CodeContent"])),
    removed: 0,
  };
}
const relativePath = (cwd: string, path: string): string =>
  path.startsWith(`${cwd}/`) ? path.slice(cwd.length + 1) : path;
const pick = (args: Json, keys: readonly string[]): string => {
  for (const key of keys) {
    const value = str(args[key]);
    if (value !== "") return value;
  }
  return "";
};

/** Semver comparison `version >= min`. Unparseable/empty versions return true (modern default). */
export function isAgyVersionAtLeast(
  version: string | null,
  min: readonly [number, number, number],
): boolean {
  if (version === null || version.trim() === "") return true;
  const match = /^v?(\d+)\.(\d+)(?:\.(\d+))?/.exec(version.trim());
  if (match === null) return true;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3] ?? 0);
  if (major !== min[0]) return major > min[0];
  if (minor !== min[1]) return minor > min[1];
  return patch >= min[2];
}

export function parseAgyLaunchSpec(raw: readonly string[]): LaunchSpec {
  const acpArgs: string[] = [];
  const tuiRest: string[] = [];
  let model: string | undefined;
  let effort: string | undefined;
  let mode: string | undefined;

  for (let i = 0; i < raw.length; i += 1) {
    const token = raw[i]!;
    if (token === "--") break;
    const eq = token.indexOf("=");
    const flag = eq > 0 ? token.slice(0, eq) : token;
    const inline = eq > 0 ? token.slice(eq + 1) : undefined;
    const takeValue = (): string | undefined => {
      if (inline !== undefined) return inline;
      const next = raw[i + 1];
      if (next !== undefined && !next.startsWith("-")) {
        i += 1;
        return next;
      }
      return undefined;
    };
    if (flag === "--model") {
      model = takeValue() ?? model;
      continue;
    }
    if (flag === "--effort") {
      effort = takeValue() ?? effort;
      continue;
    }
    if (flag === "--mode") {
      mode = takeValue() ?? mode;
      continue;
    }
    if (AGY_ACP_BOOL_FLAGS.has(flag)) {
      acpArgs.push(token);
      tuiRest.push(token);
      continue;
    }
    if (AGY_ACP_VALUE_FLAGS.has(flag)) {
      if (inline !== undefined) {
        acpArgs.push(token);
        tuiRest.push(token);
      } else {
        const val = takeValue();
        if (val !== undefined) {
          acpArgs.push(flag, val);
          tuiRest.push(flag, val);
        }
      }
      continue;
    }
    tuiRest.push(token);
  }
  return {
    args: ["acp", ...acpArgs],
    tuiRest,
    parsedFlags: {
      ...(model === undefined ? {} : { model }),
      ...(effort === undefined ? {} : { effort }),
      ...(mode === undefined ? {} : { mode }),
    },
  };
}

export function parseAgyConfigs(list: unknown): ConfigOption[] {
  if (!Array.isArray(list)) return [];
  return list.map(rec).flatMap((one) => {
    const options: ConfigOptionChoice[] = arr(one.options).flatMap((option) => {
      const inner = rec(option);
      const flat = Array.isArray(inner.options) ? inner.options : [inner];
      return flat.map(rec).map((it) => ({
        value: str(it.value),
        name: str(it.name) || str(it.value),
        description: str(it.description) || null,
      }));
    });
    return str(one.id) === ""
      ? []
      : [{ id: str(one.id), current: str(one.currentValue), options }];
  });
}

function effortsOf(
  configs: readonly ConfigOption[],
  legacy: readonly string[],
  model: string,
): ConfigOptionChoice[] {
  const seen = legacy.flatMap((id) =>
    id.startsWith(`${model}-`) &&
    EFFORT_ORDER.includes(id.slice(model.length + 1))
      ? [id.slice(model.length + 1)]
      : [],
  );
  if (seen.length > 0) {
    return EFFORT_ORDER.filter((one) => seen.includes(one)).map((one) => ({
      value: one,
      name: capital(one),
      description: null,
    }));
  }
  const now = configs.find((one) => one.id === "model")?.current ?? "";
  return model === now
    ? (configs.find((one) => one.id === "thought_level")?.options ?? [])
    : [];
}

export function buildAgyModelGroups(
  configs: readonly ConfigOption[],
  legacy: readonly string[],
): AcpModelGroup[] {
  const model = configs.find((one) => one.id === "model");
  if (model === undefined) return [];
  return [
    {
      id: "antigravity",
      label: "Antigravity",
      models: model.options
        .filter((one) => one.value !== "")
        .map((one) => {
          const levels = effortsOf(configs, legacy, one.value);
          return {
            id: one.value,
            label: one.name,
            axes:
              levels.length === 0
                ? []
                : [
                    {
                      id: "effort",
                      label: "Thinking",
                      kind: "choice" as const,
                      values: levels.map((level) => ({
                        value: level.value,
                        label: level.name,
                      })),
                    },
                  ],
          };
        }),
    },
  ];
}

function isDaemonOrRecurringCron(name: string, args: Json): boolean {
  if (args.IsDaemon === true || args.is_daemon === true) return true;
  if (name === "schedule") {
    const cron = str(args.CronExpression) || str(args.cron_expression);
    if (cron.trim() !== "") return true;
  }
  return false;
}

function classifySubagentTool(
  tool: DialectToolInput,
): AcpSubagentClassification | undefined {
  const { name, args, toolCallId } = tool;
  if (SUBAGENT_TOOL_NAMES.has(name)) {
    const roleOrAgent =
      pick(args, [
        "Name",
        "name",
        "subagent_type",
        "Role",
        "role",
        "TypeName",
        "type",
      ]) || name;
    const description = oneLine(
      pick(args, ["Task", "task", "description", "Prompt", "prompt"]) ||
        tool.title ||
        roleOrAgent,
      120,
    );
    const childKey =
      pick(args, ["conversationId", "childId", "subagent_id"]) || toolCallId;
    const model = pick(args, ["Model", "model"]) || null;
    return {
      kind: "subagent",
      childKey,
      roleOrAgent,
      description,
      model,
      outlivesPrompt: true,
    };
  }
  if (name === "swarm") {
    const action = str(args.action).toLowerCase();
    const isSpawn =
      action === "add" ||
      Array.isArray(args.tasks) ||
      typeof args.brief === "string";
    if (isSpawn) {
      const roleOrAgent = pick(args, ["name", "Name"]) || "swarm";
      const description = oneLine(
        pick(args, ["brief", "Brief", "description"]) ||
          tool.title ||
          roleOrAgent,
        120,
      );
      const model = pick(args, ["model", "Model"]) || null;
      return {
        kind: "swarm_worker",
        childKey: toolCallId,
        roleOrAgent,
        description,
        model,
        outlivesPrompt: true,
      };
    }
  }
  return undefined;
}

function extractSecurityWarning(obj: Json): string | null {
  const meta = rec(obj._meta);
  const direct = str(meta["agy.security.warning"]).trim();
  if (direct !== "") return direct;
  const nested = str(rec(rec(meta.agy).security).warning).trim();
  return nested === "" ? null : nested;
}

export type AntigravityDialectOptions = {
  home: string;
  exists(path: string): Promise<boolean>;
  loadReplayQuietPeriodMs?: number;
  childPollIntervalMs?: number;
  reactiveTimers?: Partial<ReactiveWakeupTimers>;
};

export function createAntigravityDialect(
  options: AntigravityDialectOptions,
): AcpDialect {
  const dbPath = (id: string) =>
    join(
      options.home,
      ".gemini",
      "antigravity-cli",
      "conversations",
      `${id}.db`,
    );

  const reactiveTimers: ReactiveWakeupTimers = {
    ...DEFAULT_AGY_REACTIVE_TIMERS,
    ...options.reactiveTimers,
  };

  return {
    id: "antigravity",
    command: "agy",
    label: "Antigravity",
    clientInfo: { name: "lophn", version: AGY_CLIENT_VERSION },
    clientCapabilities: {
      fs: { readTextFile: false, writeTextFile: false },
      terminal: false,
      elicitation: { form: {} },
    },
    resumePreference: "resume",
    loadReplayQuietPeriodMs:
      options.loadReplayQuietPeriodMs ?? AGY_REPLAY_QUIET_MS,
    reactiveWakeups: true,
    reactiveTimers,
    withheldCommands: WITHHELD_COMMANDS,
    localCommands: ADAPTER_COMMANDS,
    childPollIntervalMs: options.childPollIntervalMs ?? AGY_CHILD_POLL_MS,

    buildLaunchSpec: parseAgyLaunchSpec,

    supportsMidTurnPromptSteer(agentVersion) {
      return isAgyVersionAtLeast(agentVersion, [1, 5, 0]);
    },

    classifySlashCommand(name): SlashCommandClass {
      const lower = name.toLowerCase();
      if (
        WITHHELD_COMMANDS.includes(lower as (typeof WITHHELD_COMMANDS)[number])
      ) {
        return "withheld";
      }
      if (LOCAL_COMMANDS_SET.has(lower)) return "local";
      if (MAINTENANCE_COMMANDS.has(lower)) return "maintenance";
      // Default: conversational/agent command (/swarm, /plan, /goal, /grill-me,
      // /browser, /schedule, /learn, skills, unknown /...) -> recorded as normal user message.
      return "conversational";
    },

    classifyToolCall(tool, cwd): DialectToolClassification {
      const located = str(rec(tool.locations[0]).path);
      const given = pick(tool.args, PATH_KEYS) || located;
      const absPath =
        given === "" ? "" : isAbsolute(given) ? given : join(cwd, given);

      const subagent = classifySubagentTool(tool);
      if (subagent !== undefined) {
        return {
          category: "other",
          title: `${tool.name} ${subagent.roleOrAgent}`,
          path: absPath,
          detail: {
            kind: "subagent",
            agent: subagent.roleOrAgent,
            description: subagent.description,
            child: subagent.childKey,
            state: "running",
            model: subagent.model,
            last: null,
          },
          subagent,
          outlivesPrompt: subagent.outlivesPrompt,
        };
      }

      let detail: AcpToolDetail = { kind: "generic" };
      if (tool.name === "ask_question") {
        detail = { kind: "question", group: null, outcome: null, lines: [] };
      } else if (tool.kind === "edit" && absPath !== "") {
        const counts = initialEditCounts(tool.args);
        detail = {
          kind: "edit",
          document: absPath,
          path: relativePath(cwd, absPath),
          added: counts.added,
          removed: counts.removed,
        };
      }

      const firstQuestion = rec(arr(tool.args.questions)[0]);
      const summary = oneLine(
        pick(tool.args, COMMAND_KEYS) ||
          (absPath === "" ? "" : relativePath(cwd, absPath)) ||
          str(firstQuestion.question) ||
          pick(tool.args, OTHER_KEYS),
        120,
      );

      // Async commands and one-shot timers can legitimately outlive end_turn,
      // while IsDaemon commands and recurring cron schedules must never hold the turn.
      const isDaemonOrCron = isDaemonOrRecurringCron(tool.name, tool.args);
      const outlivesPrompt =
        !isDaemonOrCron &&
        (tool.kind === "execute" ||
          tool.name === "run_command" ||
          tool.name === "schedule");

      return {
        category:
          CATEGORIES[tool.kind] ?? CATEGORIES[tool.name] ?? ("other" as const),
        title: summary === "" ? tool.name : `${tool.name} ${summary}`,
        path: absPath,
        detail,
        outlivesPrompt,
      };
    },

    normalizeToolOutput(tool, rawUpdate, cwd) {
      const raw = rec(rawUpdate.rawOutput);
      const written = str(raw.output);
      let output: string | null = null;
      if (tool.kind === "execute" || written !== "") {
        const text = plain(written).replace(/\r\n/g, "\n");
        output =
          (tool.kind === "execute" ? text.replace(SHELL_HEADER, "") : text) ||
          null;
      } else {
        const text = arr(rawUpdate.content)
          .map((one) => {
            const inner = rec(rec(one).content);
            return rec(one).type === "content" ? str(inner.text) : "";
          })
          .join("");
        output = text === "" ? null : text;
      }

      let diffDetail: AcpToolDetail | null = null;
      const diff = arr(rawUpdate.content)
        .map(rec)
        .find((one) => one.type === "diff");
      if (diff !== undefined) {
        const path = str(diff.path).trim();
        if (path !== "") {
          const document = isAbsolute(path) ? path : join(cwd, path);
          const computed = computeTextDiff(
            typeof diff.oldText === "string" ? diff.oldText : undefined,
            str(diff.newText),
          );
          diffDetail = {
            kind: "edit",
            document,
            path: relativePath(cwd, document),
            added: computed.added,
            removed: computed.removed,
          };
          // Store minimal hunks in output when the tool produced no text output,
          // so large/path-only edits still render a compact diff with real line numbers.
          if (output === null && computed.patch !== null) {
            output = computed.patch;
          }
        }
      }
      return { output, diffDetail };
    },

    extractPermissionAction(params, call, cwd): DialectPermissionAction {
      const tc = rec(params.toolCall);
      const agyId = str(tc.toolCallId);
      const securityWarnings: string[] = [];
      const topWarning =
        extractSecurityWarning(params) ?? extractSecurityWarning(tc);
      if (topWarning !== null) securityWarnings.push(topWarning);

      const options = arr(params.options)
        .map(rec)
        .map((one) => {
          const warn = extractSecurityWarning(one);
          if (warn !== null && !securityWarnings.includes(warn)) {
            securityWarnings.push(warn);
          }
          return {
            id: str(one.optionId),
            kind: str(one.kind),
            name: str(one.name) || str(one.optionId),
            securityWarning: warn,
          };
        });

      if (agyId.startsWith("interaction_")) {
        return {
          kind: "question",
          label: str(tc.title) || "Question",
          options: options.map((one) => ({ id: one.id, label: one.name })),
          securityWarnings,
        };
      }

      const kind = call?.kind ?? str(tc.kind);
      const name = call?.name ?? str(tc.name);
      const args = call?.args ?? rec(tc.rawInput);
      const command = pick(args, COMMAND_KEYS);

      let subject: AcpApprovalSubject;
      if (kind === "execute" && command !== "") {
        subject = { kind: "shell", command };
      } else if (kind === "edit" && call !== undefined && call.path !== "") {
        subject = {
          kind: "file_change",
          changes: [
            {
              path: relativePath(cwd, call.path),
              change: name.includes("write") ? "create" : "update",
              added: null,
              removed: null,
            },
          ],
        };
      } else {
        subject = {
          kind: "mcp_tool",
          server: "antigravity",
          tool: name || "tool",
          effect:
            kind === "read" || kind === "search"
              ? "read"
              : kind === "edit"
                ? "write"
                : "external",
        };
      }

      const hasAlways = options.some((one) => one.kind === "allow_always");
      return {
        kind: "approval",
        subject,
        options,
        alwaysPatterns: hasAlways
          ? ["Saved permanently to Antigravity's permission settings"]
          : [],
        securityWarnings,
      };
    },

    isWarningChunk(text) {
      return /^\s*⚠/u.test(text);
    },

    formatWarningText(text) {
      return text.trim().replace(/^⚠\s*/u, "");
    },

    parseConfigs: parseAgyConfigs,
    buildModelGroups: buildAgyModelGroups,

    formatMaintenanceOutput(command, context) {
      if (command === "compact") {
        return `Compacted the conversation.${
          context === null
            ? ""
            : ` The context now holds ${context.used} of ${context.size} tokens.`
        }`;
      }
      return `Ran /${command}.`;
    },

    checkVersionWarning(agentVersion) {
      if (agentVersion !== "" && agentVersion !== AGY_RECORDED_VERSION) {
        return `Antigravity ${agentVersion} differs from ${AGY_RECORDED_VERSION}, the version lophn checked, so some features may not work.`;
      }
      return null;
    },

    buildTuiCommand({ sessionId, launchSpec, configs, legacyModels, changed }) {
      const cfg = (id: string) => configs.find((one) => one.id === id);
      const parts = [
        "agy",
        "--conversation",
        shq(sessionId),
        ...launchSpec.tuiRest.map(shq),
      ];
      if (changed.model || changed.thought) {
        const model = cfg("model")?.current ?? "";
        const thought = cfg("thought_level")?.current ?? "";
        const composite = `${model}-${thought}`;
        if (thought !== "" && legacyModels.includes(composite)) {
          parts.push("--model", shq(composite));
        } else {
          parts.push("--model", shq(model));
          if (changed.thought && thought !== "") {
            parts.push("--effort", shq(thought));
          }
        }
      } else {
        if (launchSpec.parsedFlags.model !== undefined) {
          parts.push("--model", shq(launchSpec.parsedFlags.model));
        }
        if (launchSpec.parsedFlags.effort !== undefined) {
          parts.push("--effort", shq(launchSpec.parsedFlags.effort));
        }
      }
      const mode = cfg("mode")?.current ?? null;
      if (changed.mode && (mode === "accept-edits" || mode === "plan")) {
        parts.push("--mode", mode);
      } else if (!changed.mode && launchSpec.parsedFlags.mode !== undefined) {
        parts.push("--mode", shq(launchSpec.parsedFlags.mode));
      }
      return parts.join(" ");
    },

    sessionExists(sessionId) {
      return options.exists(dbPath(sessionId));
    },

    readChildWork(parentSessionId) {
      return readAntigravityChildWork(options.home, parentSessionId);
    },

    readChildTranscript(childConversationId) {
      return readAntigravityChildTranscript(options.home, childConversationId);
    },
  };
}
