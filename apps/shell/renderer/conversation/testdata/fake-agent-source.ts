// Agent 화면 test의 AgentViewSource. 기록을 메모리에 두고 연결 상태·읽기 실패·보내기 답을 test가 정한다.
// 값의 모양은 agent-source.ts이고, model·명령·질문·승인 값은 부품 test가 쓰는 testdata를 그대로 쓴다.
// 시각·id는 고정이다.
import type { ConnectionState } from "../../desktop/connection/connection.ts";
import type {
  AgentFace,
  AgentNotice,
  AgentViewSource,
  BodyPart,
  ModelView,
  SendInput,
  SessionEntry,
  SourceResult,
  ThreadEntry,
  ThreadMessage,
  ThreadView,
} from "../agent-source.ts";
import type { ContextChipView } from "../composer/agent-composer.tsx";
import type { GroupAnswer } from "../question-card/model.ts";
import type { ApprovalChoice } from "../approval-card/model.ts";
import type { PickerModelRef } from "../model-picker/model-picker.tsx";
import type {
  SlashEntryView,
  SlashGroupView,
} from "../slash-menu/slash-menu.tsx";
import { LOPHN_ALL } from "./slash-menu.ts";
import {
  FITTED_NOTICE,
  HAIKU,
  LAYOUT_ALL,
  OPUS,
  type PickerScenario,
  SOL,
  SONNET,
  SONNET_AFTER_SOL,
} from "./model-picker.ts";
import { READ_TOOL, REPORT_EDIT, TASKS } from "./activity.ts";
import { REPORT_GROUP } from "./question-card.ts";
import { TOOL_ASK_REQUEST } from "./approval-card.ts";

/** 화면이 받는 "지금". 모든 줄의 시각은 이 날의 아침이다. */
export const NOW = Date.parse("2026-10-06T09:00:00Z");

export function at(minutes: number): string {
  return new Date(NOW + minutes * 60_000).toISOString();
}

function fakeId(prefix: string, n: number): string {
  return `${prefix}_01h455vb4pex5v6nkc6gd5f${String(n).padStart(3, "0")}`;
}

export const assignmentId = (n: number) => fakeId("asg", n);
export const sessionId = (n: number) => fakeId("ses", n);
export const messageId = (n: number) => fakeId("msg", n);
export const runId = (n: number) => fakeId("run", n);

export const LOPHN: AgentFace = {
  assignment: assignmentId(1),
  name: "lophn",
  profile: { kind: "icon", icon: "search" },
  role: "lophn",
  state: "enabled",
  place: { kind: "project", name: "phroner" },
  permissionSummary: "Ask first, 1 edit allowed this session",
};

export const CONTEXT_ENGINEER: AgentFace = {
  ...LOPHN,
  assignment: assignmentId(2),
  name: "Context Engineer",
  role: "context_engineer",
};

/** 이 test가 쓰는 model 목록. 이름을 고르면 그 model의 축과 값으로 바뀐다. */
const SCENARIOS: Readonly<Record<string, PickerScenario>> = {
  "Sonnet 5.5": SONNET,
  "Opus 5.5": OPUS,
  "Haiku 5.5": HAIKU,
  "GPT-6.1 Sol": SOL,
};

export const SESSION_WEEK: SessionEntry = {
  id: sessionId(1),
  assignment: LOPHN.assignment,
  title: "Week 41 summary",
  status: "idle",
  activeAt: at(-5),
  archived: false,
  closed: false,
};

export const SESSION_EARLIER: SessionEntry = {
  id: sessionId(2),
  assignment: LOPHN.assignment,
  title: "Release notes check",
  status: "waiting",
  activeAt: at(-2 * 24 * 60),
  archived: false,
  closed: false,
};

export const EMPTY_THREAD: ThreadView = {
  entries: [],
  run: null,
  tasks: [],
  approval: null,
};

export interface FakeCalls {
  sent: SendInput[];
  opened: { id: string; contexts: readonly ContextChipView[] }[];
  renamed: [session: string, title: string][];
  archived: string[];
  unarchived: string[];
  deleted: string[];
  forked: { id: string; session: string; through: string | null }[];
  compacted: string[];
  stopped: { run: string; key: string }[];
  answered: { group: string; answers: readonly GroupAnswer[] }[];
  deferred: string[];
  approvals: { approval: string; choice: ApprovalChoice }[];
  rewinds: [session: string, message: string | null][];
  undone: string[];
  redone: string[];
  commands: { session: string; entry: SlashEntryView }[];
  chosen: PickerModelRef[];
  options: [axis: string, value: string][];
  starred: PickerModelRef[];
  commandQueries: string[];
  modelQueries: string[];
}

export interface FakeAgentState {
  agent: AgentFace;
  sessions: SessionEntry[];
  threads: Record<string, ThreadView>;
  /** 메시지 id별 본문. 없으면 not_found다. 보낸 말은 접수될 때 여기에 남는다. */
  bodies: Record<string, readonly BodyPart[]>;
  titles: Record<string, string>;
  notices: AgentNotice[];
  /** `/` 메뉴의 전체 묶음. query가 이것을 거른다. */
  slashGroups: readonly SlashGroupView[];
  /** session(또는 아직 없는 새 session은 "new")별로 고른 model과 option 값. 없으면 Sonnet 5.5 · Medium이다. */
  models: Record<string, PickerScenario>;
  /** 다음 보내기 답. 비면 접수한다. */
  replies: SourceResult<void>[];
  /** 읽기를 모두 실패시킨다(연결 끊김). */
  readsFail: boolean;
  /** 이 이름의 쓰기를 이 code로 실패시킨다. */
  writeFails: Partial<Record<keyof FakeCalls | "openSession", string>>;
  /** 있으면 보내기 답을 이것이 풀릴 때까지 미룬다. */
  gate: Promise<void> | null;
  bodyReads: string[];
  calls: FakeCalls;
}

function modelView(
  scenario: PickerScenario,
  query: string,
  notices: ModelView["notices"] = [],
): ModelView {
  const needle = query.trim().toLowerCase();
  const matches = (name: string) =>
    needle === "" || name.toLowerCase().includes(needle);
  return {
    current: scenario.current,
    currentLabel: scenario.currentLabel,
    axes: scenario.axes,
    optionValues: scenario.optionValues,
    layout: {
      favorites: LAYOUT_ALL.favorites.filter((row) => matches(row.modelName)),
      providers: LAYOUT_ALL.providers
        .map((group) => ({
          ...group,
          models: group.models.filter((row) => matches(row.modelName)),
        }))
        .filter((group) => group.models.length > 0),
    },
    notices,
  };
}

/** `/` 뒤 글자로 거른 묶음. 규칙은 lophn-agent/commands의 단어 머리 기준이다. */
function filterGroups(
  groups: readonly SlashGroupView[],
  query: string,
  hasSession: boolean,
): ReturnType<AgentViewSource["commands"]> {
  const needle = query.toLowerCase();
  const needsSession = new Set(["rename", "archive", "compact", "fork"]);
  const startsWord = (text: string, separator: RegExp) =>
    text.toLowerCase().split(separator).some((word) => word.startsWith(needle));
  const found = groups.map((group) => ({
    ...group,
    entries: group.entries.filter((entry) =>
      (hasSession || !needsSession.has(entry.name)) &&
      (needle === "" || entry.name.startsWith(needle) ||
        startsWord(entry.name, /-/) ||
        startsWord(entry.description, /\s+/))
    ),
  })).filter((group) => group.entries.length > 0);
  return Promise.resolve({ ok: true, value: found });
}

export function fakeAgentSource(initial: Partial<FakeAgentState> = {}) {
  const calls: FakeCalls = {
    sent: [],
    opened: [],
    renamed: [],
    archived: [],
    unarchived: [],
    deleted: [],
    forked: [],
    compacted: [],
    stopped: [],
    answered: [],
    deferred: [],
    approvals: [],
    rewinds: [],
    undone: [],
    redone: [],
    commands: [],
    chosen: [],
    options: [],
    starred: [],
    commandQueries: [],
    modelQueries: [],
  };
  const state: FakeAgentState = {
    agent: LOPHN,
    sessions: [],
    threads: {},
    bodies: {},
    titles: {},
    notices: [],
    slashGroups: LOPHN_ALL,
    models: {},
    replies: [],
    readsFail: false,
    writeFails: {},
    gate: null,
    bodyReads: [],
    calls,
    ...initial,
  };
  const listeners = new Set<(state: ConnectionState) => void>();
  let connection: ConnectionState = { state: "ready", confirmedAt: 1 };

  function read<T>(value: () => T): Promise<SourceResult<T>> {
    if (state.readsFail) {
      return Promise.resolve({ ok: false, code: "unavailable" });
    }
    return Promise.resolve({ ok: true, value: value() });
  }

  function write(
    name: keyof FakeCalls | "openSession",
    change: () => void,
  ): Promise<SourceResult<void>> {
    const code = state.writeFails[name];
    if (code !== undefined) return Promise.resolve({ ok: false, code });
    change();
    return Promise.resolve({ ok: true, value: undefined });
  }

  const key = (session: string | null) => session ?? "new";
  const scenarioOf = (session: string | null): PickerScenario =>
    state.models[key(session)] ?? SONNET;
  const thread = (session: string): ThreadView =>
    state.threads[session] ?? EMPTY_THREAD;
  const patchSession = (session: string, patch: Partial<SessionEntry>) => {
    state.sessions = state.sessions.map((item) =>
      item.id === session ? { ...item, ...patch } : item
    );
  };
  const reshape = (
    session: string | null,
    scenario: PickerScenario,
    query: string,
    notices: ModelView["notices"] = [],
  ): ModelView => {
    state.models[key(session)] = scenario;
    return modelView(scenario, query, notices);
  };

  const source: AgentViewSource = {
    watch(listener) {
      listeners.add(listener);
      listener(connection);
      return () => listeners.delete(listener);
    },
    agent: () => read(() => state.agent),
    sessions: () => read(() => [...state.sessions]),
    thread(session) {
      if (state.readsFail) {
        return Promise.resolve({ ok: false, code: "unavailable" });
      }
      if (!state.sessions.some((item) => item.id === session)) {
        return Promise.resolve({ ok: false, code: "not_found" });
      }
      return Promise.resolve({ ok: true, value: thread(session) });
    },
    body(message) {
      state.bodyReads.push(message);
      const parts = state.bodies[message];
      return Promise.resolve(
        parts === undefined
          ? { ok: false, code: "not_found" }
          : { ok: true, value: parts },
      );
    },
    documentTitle: (document) =>
      Promise.resolve(
        state.titles[document] === undefined
          ? { ok: false, code: "not_found" }
          : { ok: true, value: state.titles[document]! },
      ),
    notices: () => read(() => [...state.notices]),

    model(session, query) {
      calls.modelQueries.push(query);
      return read(() => modelView(scenarioOf(session), query));
    },
    chooseModel(session, model, query) {
      calls.chosen.push(model);
      const before = scenarioOf(session);
      const target = SCENARIOS[model.modelName]!;
      // XHigh를 가진 model에서 가진 값이 없는 model로 바꾸면 가까운 약한 값으로 맞추고 알린다.
      const fitted = before.optionValues.effort === "very_high" &&
        target === SONNET;
      return read(() =>
        reshape(
          session,
          fitted ? SONNET_AFTER_SOL : target,
          query,
          fitted ? [FITTED_NOTICE] : [],
        )
      );
    },
    setModelOption(session, axis, value, query) {
      calls.options.push([axis, value]);
      const current = scenarioOf(session);
      return read(() =>
        reshape(session, {
          ...current,
          optionValues: { ...current.optionValues, [axis]: value },
        }, query)
      );
    },
    toggleFavorite(session, model, query) {
      calls.starred.push(model);
      return read(() => modelView(scenarioOf(session), query));
    },

    commands(session, query) {
      calls.commandQueries.push(query);
      if (state.readsFail) {
        return Promise.resolve({ ok: false, code: "unavailable" });
      }
      return filterGroups(state.slashGroups, query, session !== null);
    },
    runCommand(session, entry) {
      return write("commands", () => {
        calls.commands.push({ session, entry });
      });
    },

    openSession({ id, contexts }) {
      return write("openSession", () => {
        calls.opened.push({ id, contexts });
        state.sessions.push({
          id,
          assignment: state.agent.assignment,
          title: null,
          status: "idle",
          activeAt: at(0),
          archived: false,
          closed: false,
        });
        state.threads[id] = EMPTY_THREAD;
        // 아직 session이 없을 때 고른 model이 이 session의 것이 된다.
        if (state.models.new !== undefined) {
          state.models[id] = state.models.new;
          delete state.models.new;
        }
      });
    },
    renameSession(session, title) {
      return write("renamed", () => {
        calls.renamed.push([session, title]);
        patchSession(session, { title });
      });
    },
    archiveSession(session) {
      return write("archived", () => {
        calls.archived.push(session);
        patchSession(session, { archived: true });
      });
    },
    unarchiveSession(session) {
      return write("unarchived", () => {
        calls.unarchived.push(session);
        patchSession(session, { archived: false });
      });
    },
    deleteSession(session) {
      return write("deleted", () => {
        calls.deleted.push(session);
        state.sessions = state.sessions.filter((item) => item.id !== session);
        delete state.threads[session];
      });
    },
    forkSession({ id, session, through }) {
      return write("forked", () => {
        calls.forked.push({ id, session, through });
        const origin = state.sessions.find((item) => item.id === session)!;
        const entries = thread(session).entries;
        const last = through === null
          ? entries.length
          : entries.findIndex((entry) => entry.id === through) + 1;
        state.sessions.push({ ...origin, id, status: "idle" });
        state.threads[id] = {
          ...EMPTY_THREAD,
          entries: entries.slice(0, last).filter((entry) =>
            entry.kind === "message"
          ),
        };
      });
    },
    compactSession(session) {
      return write("compacted", () => {
        calls.compacted.push(session);
      });
    },

    async send(input) {
      calls.sent.push(input);
      if (state.gate) await state.gate;
      const reply = state.replies.shift() ?? { ok: true, value: undefined };
      if (!reply.ok) return reply;
      const current = thread(input.session);
      if (!current.entries.some((entry) => entry.id === input.id)) {
        const run = input.run ?? runId(9);
        const message: ThreadMessage = {
          kind: "message",
          id: input.id,
          at: at(0),
          actor: "user",
          run: { id: run, ended: false },
          mode: input.mode,
          applied: false,
          results: [],
        };
        state.bodies[input.id] = [{ kind: "text", text: input.text }];
        state.threads[input.session] = {
          ...current,
          entries: [...current.entries, message],
          run: { id: run, phase: "working" },
        };
        const session = state.sessions.find((item) =>
          item.id === input.session
        );
        if (session && session.title === null) {
          patchSession(input.session, {
            title: input.text.slice(0, 60),
            status: "working",
          });
        }
      }
      return reply;
    },
    stop(run, key) {
      return write("stopped", () => {
        calls.stopped.push({ run, key });
        for (const [session, view] of Object.entries(state.threads)) {
          if (view.run?.id !== run) continue;
          state.threads[session] = {
            ...view,
            run: { id: run, phase: "ended" },
            tasks: [],
            entries: [...view.entries, {
              kind: "run-end",
              id: `end-${run}`,
              at: at(1),
              outcome: "stopped",
              durationMs: 4000,
            }],
          };
        }
      });
    },

    answerQuestions({ group, answers }) {
      return write("answered", () => {
        calls.answered.push({ group, answers });
        for (const [session, view] of Object.entries(state.threads)) {
          state.threads[session] = {
            ...view,
            run: view.run && { ...view.run, phase: "working" },
            entries: view.entries.map((entry) =>
              entry.kind === "questions" && entry.group.id === group
                ? { ...entry, answered: { status: "answered", answers } }
                : entry
            ),
          };
        }
      });
    },
    deferQuestions(group) {
      return write("deferred", () => {
        calls.deferred.push(group);
        for (const [session, view] of Object.entries(state.threads)) {
          state.threads[session] = {
            ...view,
            entries: view.entries.map((entry) =>
              entry.kind === "questions" && entry.group.id === group
                ? { ...entry, answered: { status: "skipped", answers: [] } }
                : entry
            ),
          };
        }
      });
    },
    openApproval({ approval, choice }) {
      return write("approvals", () => {
        calls.approvals.push({ approval, choice });
      });
    },

    rewind(session, message) {
      return write("rewinds", () => {
        calls.rewinds.push([session, message]);
      });
    },
    undoEdit(edit) {
      return write("undone", () => {
        calls.undone.push(edit);
      });
    },
    redoEdit(edit) {
      return write("redone", () => {
        calls.redone.push(edit);
      });
    },
  };

  return {
    source,
    state,
    calls,
    connect(next: ConnectionState) {
      connection = next;
      for (const listener of listeners) listener(next);
    },
  };
}

export type FakeAgent = ReturnType<typeof fakeAgentSource>;

/** 테스트가 직접 부르는 다시 읽기 박자. */
export function manualTicks() {
  const listeners = new Set<() => void>();
  return {
    ticks: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    tick() {
      for (const listener of listeners) listener();
    },
  };
}

/** 사람 말 또는 agent 답 하나. 본문은 state.bodies에 둔다. */
export function say(
  fake: FakeAgent,
  n: number,
  actor: ThreadMessage["actor"],
  text: string,
  over: Partial<ThreadMessage> = {},
): ThreadMessage {
  const id = messageId(n);
  fake.state.bodies[id] = [{ kind: "text", text }];
  return {
    kind: "message",
    id,
    at: at(n - 20),
    actor,
    run: { id: runId(1), ended: true },
    mode: actor === "user" ? "request" : null,
    applied: actor === "user",
    results: [],
    ...over,
  };
}

/** 문서를 바꾼 일 한 번이 끝난 대화: 사람 요청 → tool 줄 → 답 → 편집 카드 → Worked for. */
export function finishedReport(fake: FakeAgent): ThreadView {
  const entries: ThreadEntry[] = [
    say(
      fake,
      1,
      "user",
      "Write this week's eval report from the new findings.",
    ),
    { kind: "tools", id: READ_TOOL.id, at: at(-18), tool: READ_TOOL },
    say(fake, 2, "agent", "I wrote the report from the three findings."),
    {
      kind: "edit",
      id: REPORT_EDIT.id,
      at: at(-16),
      edit: REPORT_EDIT,
      undone: false,
      canRedo: false,
    },
    {
      kind: "run-end",
      id: "end-1",
      at: at(-15),
      outcome: "completed",
      durationMs: 18_000,
    },
  ];
  return {
    entries,
    run: { id: runId(1), phase: "ended" },
    tasks: [],
    approval: null,
  };
}

/** 일하는 중: 요청 하나, 진행 chip의 할 일 넷. */
export function workingReport(fake: FakeAgent): ThreadView {
  return {
    entries: [
      say(fake, 1, "user", "Write this week's eval report.", {
        run: { id: runId(1), ended: false },
      }),
      { kind: "tools", id: READ_TOOL.id, at: at(-18), tool: READ_TOOL },
    ],
    run: { id: runId(1), phase: "working" },
    tasks: TASKS,
    approval: null,
  };
}

/** 질문 묶음 하나가 대화 안에서 답을 기다린다. */
export function waitingQuestions(fake: FakeAgent): ThreadView {
  return {
    entries: [
      say(fake, 1, "user", "Set up the weekly report.", {
        run: { id: runId(1), ended: false },
      }),
      {
        kind: "questions",
        id: REPORT_GROUP.id,
        at: at(-10),
        group: REPORT_GROUP,
        answered: null,
      },
    ],
    run: { id: runId(1), phase: "waiting" },
    tasks: [],
    approval: null,
  };
}

/** 승인 하나가 composer 위에서 결정을 기다린다. */
export function waitingApproval(fake: FakeAgent): ThreadView {
  return {
    entries: [
      say(fake, 1, "user", "Fix last week's numbers.", {
        run: { id: runId(1), ended: false },
      }),
    ],
    run: { id: runId(1), phase: "waiting" },
    tasks: [],
    approval: TOOL_ASK_REQUEST,
  };
}
