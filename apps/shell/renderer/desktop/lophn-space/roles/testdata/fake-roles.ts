// roles 화면 테스트의 RolesSource. 기록을 메모리에 두고 부른 순서와 입력을 남긴다. core를 흉내 내지
// 않고 화면이 무엇을 언제 부르는지만 본다.
import {
  fakeSource as fakeConversation,
  sessionId,
} from "../../../../conversation/testdata/fake-source.ts";
import type {
  OperatorDraft,
  OperatorScope,
  OutputChoice,
  Proposed,
  ReadChoice,
  Settled,
} from "../operator/source.ts";
import type {
  BodyKind,
  ContentKind,
  ExportResult,
  MadeLink,
  ModelAttempt,
  PresetChoices,
  PresetDefinition,
  PresetEntry,
  ReviewTrace,
  RoleRow,
  RolesSource,
  SourceResult,
  StoredBody,
  ToolStep,
  UsageTotals,
  WorkRow,
} from "../source.ts";

export const ASG_LOPHN = "asg_01h455vb4pex5v6nkc6gd5fd01";
export const ASG_APP = "asg_01h455vb4pex5v6nkc6gd5fd02";
export const ASG_OLD = "asg_01h455vb4pex5v6nkc6gd5fd03";
export const ASG_OPERATOR = "asg_01h455vb4pex5v6nkc6gd5fd04";
export const PST_DEFAULT = "pst_01h455vb4pex5v6nkc6gd5fd01";
export const PST_MINE = "pst_01h455vb4pex5v6nkc6gd5fd02";
export const PVD = "pvd_01h455vb4pex5v6nkc6gd5fd01";
export const APP = "app_01h455vb4pex5v6nkc6gd5fd01";

export function runId(n: number): string {
  return `run_01h455vb4pex5v6nkc6gd5fd${String(n).padStart(2, "0")}`;
}

export function toolId(n: number): string {
  return `tcl_01h455vb4pex5v6nkc6gd5fd${String(n).padStart(2, "0")}`;
}

export function role(over: Partial<RoleRow> = {}): RoleRow {
  return {
    id: ASG_LOPHN,
    role: "lophn",
    state: "enabled",
    revision: 1,
    scope: { kind: "all", id: null },
    preset: { id: PST_DEFAULT, revision: 1 },
    presetName: "lophn",
    outputs: [],
    ...over,
  };
}

export function work(n: number, over: Partial<WorkRow> = {}): WorkRow {
  return {
    id: runId(n),
    session: sessionId(1),
    state: "finished",
    outcome: { kind: "completed", reason: "answer_completed" },
    startedAt: "2026-10-06T08:00:00.000Z",
    finishedAt: "2026-10-06T08:05:00.000Z",
    stateSeq: String(10 + n),
    acceptedSeq: String(n),
    origin: "message",
    requestMessage: `msg_01h455vb4pex5v6nkc6gd5f${String(n).padStart(3, "0")}`,
    after: null,
    startConfirmed: false,
    ...over,
  };
}

export function trace(
  workId: string,
  over: Partial<ReviewTrace> = {},
): ReviewTrace {
  return {
    work: workId,
    session: sessionId(1),
    state: "finished",
    startedAt: "2026-10-06T08:00:00.000Z",
    finishedAt: "2026-10-06T08:05:00.000Z",
    outcome: { kind: "completed", reason: "answer_completed" },
    basis: "b".repeat(64),
    messages: ["msg_1", "msg_2"],
    toolCalls: [],
    modelCalls: [],
    handoffs: [],
    tools: {
      steps: 0,
      succeeded: 0,
      failed: [],
      denied: [],
      notExecuted: [],
      uncertain: [],
      unfinished: [],
      external: [],
    },
    models: {
      attempts: 0,
      failed: [],
      partial: [],
      cancelled: [],
      uncertain: [],
      unfinished: [],
    },
    activeMs: 1000,
    waitingMs: 0,
    missing: [],
    ...over,
  };
}

export function step(n: number, over: Partial<ToolStep> = {}): ToolStep {
  return {
    id: toolId(n),
    tool: "document.create",
    effect: "write",
    source: "tool",
    server: null,
    originalTool: null,
    app: null,
    outcome: "success",
    code: null,
    decision: {
      kind: "allow",
      reason: "Writing a new document is allowed.",
      byPerson: false,
    },
    startedAt: "2026-10-06T08:01:00.000Z",
    durationMs: 100,
    hasInput: true,
    hasOutput: true,
    ...over,
  };
}

export function definition(
  over: Partial<PresetDefinition> = {},
): PresetDefinition {
  return {
    name: "lophn",
    origin: "product",
    role: "lophn",
    decisions: {
      provider: PVD,
      accounts: ["main"],
      model: "claude-a",
      raw: { reasoning_level: "medium", options: {} },
    },
    summaries: null,
    context: [{ kind: "all", target: null, section: null }],
    skills: [],
    servers: [],
    tools: [],
    internals: {
      prompt: "p".repeat(64),
      bundles: [{ name: "documents", revision: 1 }],
      capabilityTools: ["document.create"],
      instructions: 0,
    },
    raw: { marker: "raw" },
    ...over,
  };
}

export const CHOICES: PresetChoices = {
  connections: [{
    id: PVD,
    name: "Claude",
    definition: "anthropic",
    accounts: [
      { key: "main", label: "Main", order: 0 },
      { key: "spare", label: "Spare", order: 1 },
    ],
  }],
  servers: [{
    name: "files",
    enabled: true,
    tools: ["read_file", "write_file"],
  }],
};

export const PRJ = "prj_01h455vb4pex5v6nkc6gd5fd01";
export const DOC_REPORT = "doc_01h455vb4pex5v6nkc6gd5fd01";
export const DOC_NOTES = "doc_01h455vb4pex5v6nkc6gd5fd02";
export const VER_REPORT = "ver_01h455vb4pex5v6nkc6gd5fd01";
export const VER_NOTES = "ver_01h455vb4pex5v6nkc6gd5fd02";
export const APR = "apr_01h455vb4pex5v6nkc6gd5fd01";
export const ASG_NEW = "asg_01h455vb4pex5v6nkc6gd5fd09";

export interface FakeOperatorData {
  presets?: readonly PresetEntry[];
  outputs?: Record<string, readonly OutputChoice[]>;
  reads?: Record<string, readonly ReadChoice[]>;
  versions?: Record<string, string>;
  /** `settle`이 차례로 돌려주는 상태. 끝나면 마지막 값이 계속된다. */
  settled?: readonly Settled[];
  settleFails?: string;
  proposeFails?: string;
  pauseFails?: boolean;
  withdrawFails?: boolean;
}

export interface FakeRolesData {
  operator?: FakeOperatorData;
  roles?: readonly RoleRow[];
  works?: Record<string, readonly WorkRow[]>;
  made?: Record<string, readonly MadeLink[]>;
  titles?: Record<string, string>;
  traces?: Record<string, ReviewTrace>;
  steps?: Record<string, readonly ToolStep[]>;
  attempts?: Record<string, readonly ModelAttempt[]>;
  usage?: Record<string, UsageTotals>;
  bodies?: Record<string, StoredBody | string>;
  requests?: Record<string, string | null>;
  results?: Record<string, readonly MadeLink[]>;
  presets?: Record<string, readonly PresetEntry[]>;
  choices?: PresetChoices;
  models?: readonly string[];
  exported?: SourceResult<ExportResult | null>;
  undone?: { ok: true } | { ok: false; code: string };
  /** 읽기를 실패시킨다. */
  readsFail?: boolean;
  saveFails?: string;
  applyFails?: boolean;
}

export type Call = readonly [string, ...unknown[]];

export function fakeRoles(data: FakeRolesData = {}) {
  const calls: Call[] = [];
  const conversations = new Map<string, ReturnType<typeof fakeConversation>>();
  const gone = <T>(): Promise<SourceResult<T>> =>
    Promise.resolve({ ok: false, code: "unavailable" });
  const read = <T>(value: () => T): Promise<SourceResult<T>> =>
    data.readsFail ? gone<T>() : Promise.resolve({ ok: true, value: value() });
  const listeners = new Set<(state: { state: string }) => void>();

  const operatorData = data.operator ?? {};
  let settles = 0;
  const operator: RolesSource["operator"] = {
    presets: () => read(() => operatorData.presets ?? []),
    outputChoices: (scope: OperatorScope) =>
      read(() => operatorData.outputs?.[`${scope.kind}:${scope.id}`] ?? []),
    versionOf: (document) =>
      Promise.resolve(
        operatorData.versions?.[document] === undefined
          ? { ok: false, code: "not_found" }
          : { ok: true, value: operatorData.versions[document]! },
      ),
    readChoices: (app) => read(() => operatorData.reads?.[app] ?? []),
    propose(draft: OperatorDraft) {
      calls.push(["propose", draft]);
      if (operatorData.proposeFails !== undefined) {
        return Promise.resolve({ ok: false, code: operatorData.proposeFails });
      }
      const proposed: Proposed = {
        approval: APR,
        assignment: draft.change?.id ?? ASG_NEW,
      };
      return Promise.resolve({ ok: true, value: proposed });
    },
    settle(proposed) {
      calls.push(["settle", proposed.approval]);
      if (operatorData.settleFails !== undefined) {
        return Promise.resolve({ ok: false, code: operatorData.settleFails });
      }
      const list = operatorData.settled ?? ["waiting"];
      const value = list[Math.min(settles, list.length - 1)]!;
      settles += 1;
      return Promise.resolve({ ok: true, value });
    },
    pause(item) {
      calls.push(["pause", item.id]);
      return Promise.resolve(
        operatorData.pauseFails
          ? { ok: false, code: "conflict" }
          : { ok: true, value: null },
      );
    },
    withdraw(item) {
      calls.push(["withdraw", item.id]);
      return Promise.resolve(
        operatorData.withdrawFails
          ? { ok: false, code: "conflict" }
          : { ok: true, value: null },
      );
    },
  };

  const source: RolesSource = {
    operator,
    watch(listener) {
      listeners.add(listener);
      listener({ state: "ready" });
      return () => listeners.delete(listener);
    },
    roles: () => read(() => data.roles ?? []),
    works: (item) => read(() => data.works?.[item.id] ?? []),
    made: (item) => read(() => data.made?.[item.id] ?? []),
    documentTitle: (document) =>
      Promise.resolve(
        data.titles?.[document] === undefined
          ? { ok: false, code: "not_found" }
          : { ok: true, value: data.titles[document]! },
      ),
    conversation(item) {
      let known = conversations.get(item.id);
      if (known === undefined) {
        known = fakeConversation({
          agent: { id: item.id, state: item.state, revision: item.revision },
        });
        conversations.set(item.id, known);
      }
      return known.source;
    },
    resume(item) {
      calls.push(["resume", item.id]);
      return Promise.resolve({ ok: true, value: null });
    },
    stop(item, key) {
      calls.push(["stop", item.id, key]);
      return Promise.resolve({ ok: true, value: null });
    },
    restart(item) {
      calls.push(["restart", item.id]);
      return Promise.resolve({ ok: true, value: null });
    },
    requestText(item) {
      calls.push(["request-text", item.id]);
      const text = data.requests?.[item.id];
      return Promise.resolve(
        text === undefined || text === null
          ? { ok: false, code: "not_found" }
          : { ok: true, value: text },
      );
    },
    trace: (id) => read(() => data.traces?.[id] ?? trace(id)),
    steps: (id) => read(() => data.steps?.[id] ?? []),
    attempts: (id) => read(() => data.attempts?.[id] ?? []),
    usage: (id) =>
      read(() => data.usage?.[id] ?? { calls: 0, costs: [], complete: true }),
    body(kind: BodyKind, id: string) {
      calls.push(["body", kind, id]);
      const found = data.bodies?.[`${kind}:${id}`];
      return Promise.resolve(
        found === undefined
          ? { ok: false, code: "not_found" }
          : typeof found === "string"
          ? { ok: false, code: found }
          : { ok: true, value: found },
      );
    },
    workMessages: (_role, item) =>
      read(() => ({
        request: data.requests?.[item.id] ?? null,
        results: data.results?.[item.id] ?? [],
      })),
    exportTrace(id: string, kinds: readonly ContentKind[]) {
      calls.push(["export", id, [...kinds]]);
      return Promise.resolve(
        data.exported ?? { ok: true, value: { sent: 3, notSent: 0 } },
      );
    },
    undo(id) {
      calls.push(["undo", id]);
      return Promise.resolve(data.undone ?? { ok: true });
    },
    presets: (item) => read(() => data.presets?.[item.role] ?? []),
    choices: () => read(() => data.choices ?? CHOICES),
    models: () => read(() => data.models ?? ["claude-a", "claude-b"]),
    savePreset(item, entry, edited, reason) {
      calls.push(["save-preset", entry?.id ?? null, edited, reason]);
      if (data.saveFails !== undefined) {
        return Promise.resolve({ ok: false, code: data.saveFails });
      }
      const saved: PresetEntry =
        entry !== null && entry.definition.origin === "user"
          ? { id: entry.id, revision: entry.revision + 1, definition: edited }
          : {
            id: PST_MINE,
            revision: 1,
            definition: { ...edited, origin: "user", role: item.role },
          };
      return Promise.resolve({ ok: true, value: saved });
    },
    applyPreset(item, preset, revision) {
      calls.push(["apply-preset", item.id, preset, revision]);
      return Promise.resolve(
        data.applyFails
          ? { ok: false, code: "conflict" }
          : { ok: true, value: null },
      );
    },
  };

  return {
    source,
    calls,
    data,
    conversation: (item: RoleRow) => {
      source.conversation(item);
      return conversations.get(item.id)!;
    },
  };
}
