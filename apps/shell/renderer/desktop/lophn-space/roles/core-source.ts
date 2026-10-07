// RolesSource를 main의 core 통로로 만든다. 응답은 main의 contract client가 route output schema로
// 이미 검사했다. 아래 모양은 그 schema에서 이 화면이 읽는 field만 옮긴 것이다. 본문(근거·도구 입력·
// 도구 결과)은 `runs/body-view`로만 읽는다. 사람 전용이고 core가 지금의 redaction을 거친 값이다.
import type { FolderPickerApi } from "../../../../ipc/folder-picker.ts";
import { coreConversationSource } from "../../../conversation/core-source.ts";
import type { CoreSource } from "../../connection/connection.ts";
import { windowFolderPicker } from "../../launcher/core-source.ts";
import { call, command, type Page, pages } from "./core-calls.ts";
import { coreOperatorSource } from "./operator/core-source.ts";
import { newId } from "../model.ts";
import type {
  BodyKind,
  CallOutcome,
  ContentKind,
  ContextChoice,
  ConversationSource,
  Cost,
  ModelAttempt,
  ModelPick,
  OperatorFacts,
  PauseFacts,
  PresetChoices,
  PresetDefinition,
  PresetEntry,
  ReviewTrace,
  RoleKind,
  RoleRow,
  RolesSource,
  SourceResult,
  StepOutcome,
  ToolStep,
  UndoOutcome,
  UsageTotals,
  WorkRow,
} from "./source.ts";

interface AssignmentValue {
  id: string;
  role: RoleKind;
  scope: RoleRow["scope"];
  state: RoleRow["state"];
  preset: string;
  preset_revision: number;
  outputs: { document: string; content?: string }[];
  read_apps?: string[];
  read_commands?: { app: string; command: string }[];
  schedule?: { first_at: string; every_ms: number } | null;
  last_due_at?: string | null;
  pause_reason?: { kind: PauseFacts["kind"]; detail: string } | null;
  revision: number;
}

interface ModelValue {
  provider: string;
  credentials: string[];
  model_name: string;
  reasoning_level: string;
  options: Record<string, unknown>;
}

export interface PresetValue {
  id: string;
  revision: number;
  definition_hash?: string;
  definition: {
    kind: RoleKind;
    name: string;
    origin: "product" | "user";
    prompt: string;
    capability: {
      bundles: { name: string; revision: number }[];
      tools: { tool: string; app_command: string | null }[];
    };
    context: ContextChoice[];
    mcp: {
      servers: string[];
      tools: { server_name: string; original_tool: string }[];
    };
    safe_tools: { server_name: string; original_tool: string }[];
    skills: string[];
    model: ModelValue | null;
    organizing_model: ModelValue | null;
    instructions: unknown[];
  };
}

interface RunValue {
  id: string;
  session: string | null;
  state: WorkRow["state"];
  source: { kind: "message" | "schedule" | "handoff"; message?: string };
  start_after: string | null;
  start_confirmed_seq: string | null;
  started_at: string | null;
  finished_at: string | null;
  outcome: WorkRow["outcome"];
  state_seq: string;
  accepted_seq: string;
}

interface MessageValue {
  message: {
    id: string;
    actor: string;
    run: string | null;
    links: { kind: string; document?: string; version?: string }[];
  };
}

interface ToolValue {
  id: string;
  tool: string;
  effect: ToolStep["effect"];
  app_command: { app: string } | null;
  extension: { server_name: string; original_tool: string } | null;
  input: string;
  output: string | null;
  state: "requested" | "started" | "finished";
  started_at: string | null;
  duration_ms: number | null;
  outcome: {
    kind: "success" | "failure" | "not_executed" | "uncertain";
    code: string;
  } | null;
  decision: {
    decision: "allow" | "ask" | "deny";
    reason: string;
    approval: string | null;
  } | null;
}

interface CallValue {
  id: string;
  attempt_order: number;
  model: { name: string; billing_route: ModelAttempt["billing"] };
  state: "started" | "finished";
  started_at: string;
  duration_ms: number | null;
  outcome: { kind: Exclude<CallOutcome, "unfinished"> } | null;
  usage: {
    input: number | null;
    output: number | null;
    cache_read: number | null;
    cache_write: number | null;
  };
  cost: { kind: Cost["kind"]; amount: string | null; currency: string | null };
}

interface TraceValue {
  run: string | null;
  session: string | null;
  state: ReviewTrace["state"];
  started_at: string | null;
  finished_at: string | null;
  basis: string | null;
  messages: string[];
  model_calls: string[];
  tool_calls: string[];
  handoff_links: { sender_run: string; receiver_run: string }[];
  activity: {
    model: {
      attempts: number;
      failed: string[];
      partial: string[];
      cancelled: string[];
      uncertain: string[];
      unfinished: string[];
    };
    tools: {
      steps: number;
      succeeded: number;
      failed: string[];
      denied: string[];
      not_executed: string[];
      uncertain: string[];
      unfinished: string[];
      external: string[];
    };
  };
  times: { active_ms: number; waiting_ms: number };
  reason: ReviewTrace["outcome"];
  missing: ReviewTrace["missing"][number][];
}

interface ProviderValue {
  id: string;
  name: string;
  definition: { key: string };
  credentials: { key: string; label: string; order: number }[];
}

interface McpValue {
  name: string;
  enabled: boolean;
  classifications?: Record<string, unknown>;
}

const MCP_SERVERS = "lophn-agent.extensions.mcp_servers";
/** 만든 것을 모을 때 읽는 가장 최근 대화 수. */
const MADE_SESSIONS = 12;
const DAY = 24 * 60 * 60 * 1000;

function modelOf(value: ModelValue | null): ModelPick | null {
  return value === null ? null : {
    provider: value.provider,
    accounts: value.credentials,
    model: value.model_name,
    raw: value,
  };
}

export function presetOf(value: PresetValue): PresetEntry {
  const definition = value.definition;
  const definitionView: PresetDefinition = {
    name: definition.name,
    origin: definition.origin,
    role: definition.kind,
    decisions: modelOf(definition.model),
    summaries: modelOf(definition.organizing_model),
    context: definition.context,
    skills: definition.skills,
    servers: definition.mcp.servers,
    tools: definition.mcp.tools.map((tool) => ({
      server: tool.server_name,
      tool: tool.original_tool,
    })),
    internals: {
      prompt: definition.prompt,
      bundles: definition.capability.bundles,
      capabilityTools: definition.capability.tools.map((tool) => tool.tool),
      instructions: definition.instructions.length,
    },
    raw: definition,
  };
  return {
    id: value.id,
    revision: value.revision,
    definition: definitionView,
    ...(value.definition_hash === undefined
      ? {}
      : { hash: value.definition_hash }),
  };
}

function pickOf(pick: ModelPick | null): ModelValue | null {
  if (pick === null) return null;
  const raw = pick.raw as ModelValue | null;
  return {
    provider: pick.provider,
    credentials: [...pick.accounts],
    model_name: pick.model,
    reasoning_level: raw?.reasoning_level ?? "provider_default",
    options: raw?.options ?? {},
  };
}

/** 고친 자리를 원본 정의에 덮는다. 고치지 않는 자리(prompt·capability·지침)는 원본 그대로다. */
export function definitionOf(
  edited: PresetDefinition,
): PresetValue["definition"] {
  const raw = edited.raw as PresetValue["definition"];
  const tools = edited.tools.filter((tool) =>
    edited.servers.includes(tool.server)
  ).map((tool) => ({ server_name: tool.server, original_tool: tool.tool }));
  const selected = new Set(
    tools.map((tool) => `${tool.server_name}\0${tool.original_tool}`),
  );
  return {
    ...raw,
    name: edited.name,
    model: pickOf(edited.decisions),
    organizing_model: pickOf(edited.summaries),
    context: edited.context.map((item) => ({
      kind: item.kind,
      target: item.target,
      section: item.section,
    })),
    skills: [...edited.skills],
    mcp: { servers: [...edited.servers], tools },
    safe_tools: raw.safe_tools.filter((tool) =>
      selected.has(`${tool.server_name}\0${tool.original_tool}`)
    ),
  };
}

export function factsOf(item: AssignmentValue): OperatorFacts | null {
  if (item.role !== "operator") return null;
  return {
    schedule: item.schedule == null ? null : {
      firstAt: item.schedule.first_at,
      everyMs: item.schedule.every_ms,
    },
    lastDueAt: item.last_due_at ?? null,
    outputs: item.outputs.map((output) => ({
      document: output.document,
      content: output.content ?? "",
    })),
    readApps: item.read_apps ?? [],
    readCommands: item.read_commands ?? [],
    pause: item.pause_reason == null ? null : {
      kind: item.pause_reason.kind,
      detail: item.pause_reason.detail,
    },
  };
}

function stepOutcome(value: ToolValue): StepOutcome {
  return value.state === "finished" && value.outcome !== null
    ? value.outcome.kind
    : "unfinished";
}

export type DecisionIntent = {
  request:
    | {
      kind: "owner_decision";
      concern: string;
      decision: string;
      targets: string[];
    }
    | { kind: "approval_request"; approval: string };
  parentWindow: string;
};

export interface RolesDeps {
  picker: FolderPickerApi | undefined;
  openDecision: ((intent: DecisionIntent) => Promise<unknown>) | undefined;
  now: () => number;
  random: () => string;
  /** 대화 통로. 테스트가 바꾼다. */
  conversation: ConversationSource | undefined;
}

type OpenDecision = NonNullable<RolesDeps["openDecision"]>;

export function windowDecisionOpener(): OpenDecision | undefined {
  const shell = (globalThis as {
    lophnShell?: { openConfirmation?: OpenDecision };
  }).lophnShell;
  return typeof shell?.openConfirmation === "function"
    ? (intent) => shell.openConfirmation!(intent)
    : undefined;
}

// 보호 창의 부모. main은 이 값이 아니라 IPC를 보낸 창을 부모로 쓴다(contracts#T13).
const PARENT_WINDOW = "requesting-window";

export function coreRolesSource(
  core: CoreSource,
  deps: Partial<RolesDeps> = {},
): RolesSource {
  const picker = "picker" in deps ? deps.picker : windowFolderPicker();
  const openDecision = "openDecision" in deps
    ? deps.openDecision
    : windowDecisionOpener();
  const now = deps.now ?? Date.now;
  const random = deps.random ?? (() => crypto.randomUUID().slice(0, 8));
  const base = deps.conversation ?? coreConversationSource(core);

  async function textOf(message: string): Promise<SourceResult<string>> {
    const body = await base.body(message);
    if (!body.ok) return body;
    const text = body.value.flatMap((part) =>
      part.kind === "text" ? [part.text] : []
    ).join("\n");
    return { ok: true, value: text };
  }

  return {
    operator: coreOperatorSource(core, {
      openDecision,
      now,
      random,
      presetOf,
    }),
    watch: (listener) => core.subscribe(listener),

    async roles() {
      const listed = await pages<
        AssignmentValue,
        Page & { assignments: AssignmentValue[] }
      >(core, "assignments", "list", {}, (value) => value.assignments);
      if (!listed.ok) return listed;
      const presets = await pages<
        PresetValue,
        Page & { presets: PresetValue[] }
      >(
        core,
        "presets",
        "list",
        {},
        (value) => value.presets,
      );
      const names = new Map(
        presets.ok
          ? presets.value.map((preset) => [preset.id, preset.definition.name])
          : [],
      );
      return {
        ok: true,
        value: listed.value.map((item): RoleRow => ({
          id: item.id,
          role: item.role,
          state: item.state,
          revision: item.revision,
          scope: item.scope,
          preset: { id: item.preset, revision: item.preset_revision },
          presetName: names.get(item.preset) ?? null,
          outputs: item.outputs.map((output) => output.document),
          operator: factsOf(item),
        })),
      };
    },

    async works(role) {
      const listed = await pages<RunValue, Page & { runs: RunValue[] }>(
        core,
        "runs",
        "list",
        { assignment: role.id },
        (value) => value.runs,
      );
      if (!listed.ok) return listed;
      const byId = new Map(listed.value.map((run) => [run.id, run]));
      return {
        ok: true,
        value: listed.value.map((run): WorkRow => {
          const before = run.start_after === null
            ? undefined
            : byId.get(run.start_after);
          return {
            id: run.id,
            session: run.session,
            state: run.state,
            outcome: run.outcome,
            startedAt: run.started_at,
            finishedAt: run.finished_at,
            stateSeq: run.state_seq,
            acceptedSeq: run.accepted_seq,
            origin: run.source.kind,
            requestMessage: run.source.kind === "message"
              ? run.source.message ?? null
              : null,
            after: before === undefined ? null : {
              id: before.id,
              stateSeq: before.state_seq,
              stopped: before.state === "finished" &&
                before.outcome?.kind !== "completed",
            },
            startConfirmed: run.start_confirmed_seq !== null,
          };
        }),
      };
    },

    async made(role) {
      const found: {
        document: string;
        version: string | null;
        work: string | null;
      }[] = [];
      const sessions = await pages<
        { id: string },
        Page & { sessions: { id: string }[] }
      >(
        core,
        "sessions",
        "list",
        { assignment: role.id },
        (value) => value.sessions,
      );
      if (sessions.ok) {
        const recent = [...sessions.value].sort((a, b) =>
          b.id.localeCompare(a.id)
        )
          .slice(0, MADE_SESSIONS);
        for (const session of recent) {
          const listed = await pages<
            MessageValue,
            Page & { messages: MessageValue[] }
          >(
            core,
            "messages",
            "list",
            { session: session.id },
            (value) => value.messages,
          );
          if (!listed.ok) return listed;
          for (const { message } of [...listed.value].reverse()) {
            if (message.actor === "user" || message.actor === "machine") {
              continue;
            }
            for (const link of message.links) {
              if (link.kind === "document" && link.document) {
                found.push({
                  document: link.document,
                  version: null,
                  work: message.run,
                });
              } else if (
                link.kind === "version" && link.document && link.version
              ) {
                found.push({
                  document: link.document,
                  version: link.version,
                  work: message.run,
                });
              }
            }
          }
        }
      } else if (role.outputs.length === 0) return sessions;
      for (const document of role.outputs) {
        found.push({ document, version: null, work: null });
      }
      const seen = new Set<string>();
      const unique = found.filter((link) => {
        const key = `${link.document}@${link.version ?? ""}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      return { ok: true, value: unique };
    },

    documentTitle: (document) => base.documentTitle(document),

    conversation(role) {
      return {
        ...base,
        agent: () =>
          Promise.resolve({
            ok: true,
            value: {
              id: role.id,
              state: role.state,
              revision: role.revision,
              role: role.role,
            },
          }),
      };
    },

    async resume(role) {
      const sent = await command(core, "assignments", "resume", {
        input: { assignment: role.id },
        compare: { revision: role.revision, state: "paused" },
        key: `assignments-resume-${role.id}-${role.revision}`,
      });
      return sent.ok ? { ok: true, value: null } : sent;
    },

    async stop(work, key) {
      const stopped = await command(core, "runs", "stop", {
        input: { run: work.id, request_key: key, reason: "user_stopped" },
        compare: { state_seq: work.stateSeq },
        key,
      });
      return stopped.ok ? { ok: true, value: null } : stopped;
    },

    async restart(work) {
      if (work.after === null) return { ok: false, code: "invalid_input" };
      const sent = await command(core, "runs", "confirm-next", {
        input: { run: work.id, predecessor: work.after.id },
        compare: {
          accepted_seq: work.acceptedSeq,
          predecessor_state_seq: work.after.stateSeq,
        },
        key: `runs-confirm-next-${work.id}`,
      });
      return sent.ok ? { ok: true, value: null } : sent;
    },

    async requestText(work) {
      if (work.requestMessage === null) return { ok: false, code: "not_found" };
      return await textOf(work.requestMessage);
    },

    async trace(work) {
      const read = await call<{ trace: TraceValue }>(
        core,
        "read",
        "agent-traces",
        "read",
        { target: { kind: "run", run: work } },
      );
      if (!read.ok) return read;
      const trace = read.value.trace;
      return {
        ok: true,
        value: {
          work,
          session: trace.session,
          state: trace.state,
          startedAt: trace.started_at,
          finishedAt: trace.finished_at,
          outcome: trace.reason,
          basis: trace.basis,
          messages: trace.messages,
          toolCalls: trace.tool_calls,
          modelCalls: trace.model_calls,
          handoffs: trace.handoff_links.map((link) => ({
            sender: link.sender_run,
            receiver: link.receiver_run,
          })),
          tools: {
            steps: trace.activity.tools.steps,
            succeeded: trace.activity.tools.succeeded,
            failed: trace.activity.tools.failed,
            denied: trace.activity.tools.denied,
            notExecuted: trace.activity.tools.not_executed,
            uncertain: trace.activity.tools.uncertain,
            unfinished: trace.activity.tools.unfinished,
            external: trace.activity.tools.external,
          },
          models: trace.activity.model,
          activeMs: trace.times.active_ms,
          waitingMs: trace.times.waiting_ms,
          missing: trace.missing,
        },
      };
    },

    async steps(work) {
      const listed = await pages<ToolValue, Page & { tool_calls: ToolValue[] }>(
        core,
        "tool-calls",
        "list",
        { run: work, limit: 100 },
        (value) => value.tool_calls,
      );
      if (!listed.ok) return listed;
      return {
        ok: true,
        value: listed.value.map((call): ToolStep => ({
          id: call.id,
          tool: call.tool,
          effect: call.effect,
          source: call.extension !== null
            ? "outside"
            : call.app_command !== null
            ? "app"
            : "tool",
          server: call.extension?.server_name ?? null,
          originalTool: call.extension?.original_tool ?? null,
          app: call.app_command?.app ?? null,
          outcome: stepOutcome(call),
          code: call.outcome?.code ?? null,
          decision: call.decision === null ? null : {
            kind: call.decision.decision,
            reason: call.decision.reason,
            byPerson: call.decision.approval !== null,
          },
          startedAt: call.started_at,
          durationMs: call.duration_ms,
          hasInput: true,
          hasOutput: call.output !== null,
        })),
      };
    },

    async attempts(work) {
      const listed = await pages<CallValue, Page & { calls: CallValue[] }>(
        core,
        "model-calls",
        "list",
        { run: work },
        (value) => value.calls,
      );
      if (!listed.ok) return listed;
      return {
        ok: true,
        value: [...listed.value]
          .sort((a, b) => a.attempt_order - b.attempt_order)
          .map((item): ModelAttempt => ({
            id: item.id,
            order: item.attempt_order,
            model: item.model.name,
            outcome: item.state === "finished" && item.outcome !== null
              ? item.outcome.kind
              : "unfinished",
            startedAt: item.started_at,
            durationMs: item.duration_ms,
            usage: {
              input: item.usage.input,
              output: item.usage.output,
              cacheRead: item.usage.cache_read,
              cacheWrite: item.usage.cache_write,
            },
            cost: {
              kind: item.cost.kind,
              amount: item.cost.amount,
              currency: item.cost.currency,
            },
            billing: item.model.billing_route,
          })),
      };
    },

    async usage(work) {
      const read = await call<{
        totals: {
          calls: number;
          costs: UsageTotals["costs"][number][];
          complete: boolean;
        }[];
      }>(core, "read", "agent-usage", "read", {
        run: work,
        from_at: new Date(0).toISOString(),
        through_at: new Date(now() + DAY).toISOString(),
      });
      if (!read.ok) return read;
      const total = read.value.totals[0];
      return {
        ok: true,
        value: total === undefined ? { calls: 0, costs: [], complete: true } : {
          calls: total.calls,
          costs: total.costs,
          complete: total.complete,
        },
      };
    },

    async body(kind: BodyKind, id: string) {
      const read = await call<{ value: unknown; truncated: boolean }>(
        core,
        "read",
        "runs",
        "body-view",
        { kind, id },
      );
      return read.ok
        ? {
          ok: true,
          value: { value: read.value.value, truncated: read.value.truncated },
        }
        : read;
    },

    async workMessages(_role, work) {
      if (work.session === null) {
        return { ok: true, value: { request: null, results: [] } };
      }
      const listed = await pages<
        MessageValue,
        Page & { messages: MessageValue[] }
      >(
        core,
        "messages",
        "list",
        { session: work.session, run: work.id },
        (value) => value.messages,
      );
      if (!listed.ok) return listed;
      const results: {
        document: string;
        version: string | null;
        work: string | null;
      }[] = [];
      for (const { message } of listed.value) {
        if (message.actor === "user" || message.actor === "machine") continue;
        for (const link of message.links) {
          if (link.kind === "document" && link.document) {
            results.push({
              document: link.document,
              version: null,
              work: work.id,
            });
          } else if (link.kind === "version" && link.document && link.version) {
            results.push({
              document: link.document,
              version: link.version,
              work: work.id,
            });
          }
        }
      }
      const request = work.requestMessage === null
        ? null
        : await textOf(work.requestMessage);
      return {
        ok: true,
        value: {
          request: request !== null && request.ok ? request.value : null,
          results,
        },
      };
    },

    async exportTrace(work, kinds: readonly ContentKind[]) {
      if (picker === undefined) return { ok: false, code: "unavailable" };
      const picked = await picker.pick();
      if (!picked.ok) return { ok: false, code: picked.code };
      if (picked.path === null) return { ok: true, value: null };
      const sent = await command<{ sent: number; not_sent: number }>(
        core,
        "agent-traces",
        "export",
        {
          input: {
            targets: [{ kind: "run", run: work }],
            format: "ndjson",
            format_version: 1,
            destination: `${
              picked.path.replace(/[\\/]$/, "")
            }/lophn-work-${work}.ndjson`,
            content_kinds: [...kinds],
          },
          key: `agent-traces-export-${work}-${random()}`,
        },
      );
      return sent.ok
        ? {
          ok: true,
          value: { sent: sent.value.sent, notSent: sent.value.not_sent },
        }
        : sent;
    },

    async undo(work): Promise<UndoOutcome> {
      if (openDecision === undefined) return { ok: false, code: "unavailable" };
      try {
        const opened = await openDecision({
          request: {
            kind: "owner_decision",
            concern: "lophn-agent/revert",
            decision: "RevertRun",
            targets: [work],
          },
          parentWindow: PARENT_WINDOW,
        }) as { windowId?: string; code?: string };
        return typeof opened?.windowId === "string"
          ? { ok: true }
          : { ok: false, code: opened?.code ?? "internal" };
      } catch {
        return { ok: false, code: "unavailable" };
      }
    },

    async presets(role) {
      const listed = await pages<
        PresetValue,
        Page & { presets: PresetValue[] }
      >(
        core,
        "presets",
        "list",
        { kind: role.role },
        (value) => value.presets,
      );
      return listed.ok
        ? { ok: true, value: listed.value.map(presetOf) }
        : listed;
    },

    async choices() {
      const providers = await pages<
        ProviderValue,
        Page & { providers: ProviderValue[] }
      >(
        core,
        "providers",
        "list",
        {},
        (value) => value.providers,
      );
      if (!providers.ok) return providers;
      const got = await call<{ settings: { key: string; value: unknown }[] }>(
        core,
        "read",
        "settings",
        "get",
        {},
      );
      const servers = got.ok
        ? got.value.settings.find((setting) => setting.key === MCP_SERVERS)
        : undefined;
      const serverValues = Array.isArray(servers?.value)
        ? servers.value as McpValue[]
        : [];
      const value: PresetChoices = {
        connections: providers.value.map((provider) => ({
          id: provider.id,
          name: provider.name,
          definition: provider.definition.key,
          accounts: provider.credentials
            .map((account) => ({
              key: account.key,
              label: account.label,
              order: account.order,
            }))
            .sort((a, b) => a.order - b.order),
        })),
        servers: serverValues.map((server) => ({
          name: server.name,
          enabled: server.enabled,
          tools: Object.keys(server.classifications ?? {}).sort(),
        })),
      };
      return { ok: true, value };
    },

    async models(definition) {
      const read = await call<{ entries: { model_name: string }[] }>(
        core,
        "read",
        "agent-model-catalog",
        "read",
        { provider_definition: definition },
      );
      if (!read.ok) return read;
      const names = [...new Set(read.value.entries.map((e) => e.model_name))];
      return { ok: true, value: names.sort((a, b) => a.localeCompare(b)) };
    },

    async savePreset(role, entry, edited, reason) {
      const definition = definitionOf(edited);
      const sent = entry !== null && entry.definition.origin === "user"
        ? await command<{ preset: PresetValue }>(core, "presets", "revise", {
          input: { preset: entry.id, definition, reason },
          compare: { revision: entry.revision },
          key: `presets-revise-${entry.id}-${entry.revision}-${random()}`,
        })
        : await command<{ preset: PresetValue }>(core, "presets", "create", {
          input: {
            id: newId("pst", now()),
            definition: { ...definition, kind: role.role, origin: "user" },
            copied_from: entry === null
              ? null
              : { preset: entry.id, revision: entry.revision },
          },
          key: `presets-create-${random()}`,
        });
      return sent.ok ? { ok: true, value: presetOf(sent.value.preset) } : sent;
    },

    async applyPreset(role, preset, revision) {
      const sent = await command(core, "assignments", "change-preset", {
        input: { assignment: role.id, preset, preset_revision: revision },
        compare: { revision: role.revision, role: role.role },
        key:
          `assignments-change-preset-${role.id}-${role.revision}-${preset}-${revision}`,
      });
      return sent.ok ? { ok: true, value: null } : sent;
    },
  };
}
