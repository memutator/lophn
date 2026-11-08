// Agent 화면의 순수 규칙. 화면은 이 값을 그대로 그린다. 시각은 인자로 받는다.
import type {
  AgentFace,
  BodyPart,
  ThreadEntry,
  ThreadMessage,
  ThreadSubagent,
  ThreadView,
  TurnView,
} from "./agent-tab-source.ts";
import { summaryOfParts } from "./agent-tab-source.ts";
import type { ViewDetail } from "./activity/model.ts";
import {
  ACP_COMMAND_SOURCES,
  type AcpCapabilities,
  type AcpCommand,
  type AcpCommandOpens,
  type AcpDecideChoice,
  type AcpSessionMeta,
  type AcpState,
} from "../../../protocol/acp/mod.ts";
import { turnChoiceOf } from "../desktop/connection/waiting/decide.ts";
import { layoutOf } from "./thread-layout.ts";
import type {
  SlashEntryView,
  SlashGroupKey,
  SlashListState,
} from "./slash-menu/types.ts";

/** 아직 만들지 않은 새 session의 입력 메모리 key. 같은 창의 다른 agent와 섞이지 않는다. */
export function newSessionKey(agent: AgentFace | null): string {
  if (agent === null) return "new:";
  const workspace =
    agent.workspace === null
      ? "home"
      : `${agent.workspace.kind}:${agent.workspace.name}`;
  return `new:${agent.agent}:${workspace}`;
}

/** agent 묶음 위에 보이는 시각. 잘못된 시각은 비운다. */
export function clockTime(at: string): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en", {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

/** 메시지 아래에 보이는 시각. 오늘이면 시각만, 다른 날이면 날짜를 붙인다. 잘못된 시각은 비운다. */
export function messageTime(at: string, now: Date): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return "";
  if (date.toDateString() === now.toDateString()) return clockTime(at);
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

/**
 * Messages는 tool 줄과 끝난 turn의 꼬리를 그리지 않는다. 줄만 있는 agent 묶음이 이름만 남지 않게 걸러 낸다.
 * reasoning뿐인 agent message도 같은 이유로 뺀다(글 없는 묶음이 남는다).
 */
export function shownEntries(
  entries: readonly ThreadEntry[],
  detail: ViewDetail,
): readonly ThreadEntry[] {
  return detail === "messages"
    ? entries.filter(
        (entry) =>
          entry.kind !== "tools" &&
          entry.kind !== "subagent" &&
          !(entry.kind === "turn-end" && entry.outcome === "completed") &&
          !(
            entry.kind === "message" &&
            entry.actor === "agent" &&
            reasoningOnly(entry.parts)
          ),
      )
    : entries;
}

/** 본문에 reasoning 밖의 part가 없다. */
function reasoningOnly(parts: readonly BodyPart[]): boolean {
  return parts.every((part) => part.kind === "reasoning");
}

/** 대화의 확정 메시지 전부. 접힌 숨긴 구간 안의 메시지도 든다. */
export function messagesOf(thread: ThreadView | null): ThreadMessage[] {
  return flatMessages(thread?.entries ?? []);
}

/** 숨긴 구간 안까지 펼친 줄. 입력 history, 전체 펼치기, background 판정이 쓴다. */
export function flatEntries(entries: readonly ThreadEntry[]): ThreadEntry[] {
  return entries.flatMap((entry) =>
    entry.kind === "hidden" ? flatEntries(entry.entries) : [entry],
  );
}

/** 사람이 보낸 글의 입력 history. 새 것이 앞이다. 글이 없는 줄(그림만)은 뺀다. */
export function historyOf(thread: ThreadView | null): string[] {
  return messagesOf(thread)
    .filter((message) => message.actor === "user")
    .map((message) =>
      message.parts
        .flatMap((part) => (part.kind === "text" ? [part.text] : []))
        .join("\n"),
    )
    .filter((text) => text !== "")
    .reverse();
}

function flatMessages(entries: readonly ThreadEntry[]): ThreadMessage[] {
  return entries.flatMap((entry) =>
    entry.kind === "message"
      ? [entry]
      : entry.kind === "hidden"
        ? flatMessages(entry.entries)
        : [],
  );
}

const EXCERPT_CHARS = 60;

/** 글 part만 이은 본문. */
export function textOfParts(parts: readonly BodyPart[]): string {
  return parts
    .flatMap((part) => (part.kind === "text" ? [part.text] : []))
    .join("\n");
}

/** 시점을 고르는 목록에서 메시지를 알아볼 한 줄. 메시지가 대화에 없으면 줄임표다. */
export function excerptOf(parts: readonly BodyPart[] | undefined): string {
  const text = summaryOfParts(parts ?? [])
    .replace(/\s+/g, " ")
    .trim();
  if (text === "") return "…";
  return text.length > EXCERPT_CHARS
    ? `${text.slice(0, EXCERPT_CHARS)}…`
    : text;
}

/** 일하는 중 줄이 세는 시계. core가 센 active와 그 기준 시각이고 모르면 null이다. */
export function clockOf(
  turn: TurnView | null,
): { activeMs: number; at: number } | null {
  if (turn === null) return null;
  if (turn.elapsed !== null) {
    return { activeMs: turn.elapsed.activeMs, at: Date.parse(turn.elapsed.at) };
  }
  return turn.startedAt === null
    ? null
    : { activeMs: 0, at: Date.parse(turn.startedAt) };
}

/** 대화 안 subagent 줄(숨긴 구간 밖). */
export function subagentsOf(entries: readonly ThreadEntry[]): ThreadSubagent[] {
  return entries.filter(
    (entry): entry is ThreadSubagent => entry.kind === "subagent",
  );
}

/** 이 자식 대화를 맡긴 subagent 줄. 자식의 자식(손자)은 그 자식 대화 안에 있다. */
export function subagentOfChild(
  thread: ThreadView,
  child: string,
): ThreadSubagent | null {
  const direct = subagentsOf(thread.entries).find(
    (entry) => entry.child === child,
  );
  if (direct !== undefined) return direct;
  for (const state of Object.values(thread.children)) {
    const nested = subagentsOf(layoutOf(state).entries).find(
      (entry) => entry.child === child,
    );
    if (nested !== undefined) return nested;
  }
  return null;
}

/** 받은 메시지가 답하는 call의 맡긴 글. 그 call이 이 대화에 없으면 undefined다. */
export function taskOfCall(
  entries: readonly ThreadEntry[],
  call: string | null,
): string | undefined {
  if (call === null) return undefined;
  for (const entry of entries) {
    if (entry.kind === "call" && entry.call.call === call) {
      return entry.call.task;
    }
    if (entry.kind === "hidden") {
      const inner = taskOfCall(entry.entries, call);
      if (inner !== undefined) return inner;
    }
  }
  return undefined;
}

/**
 * rewind의 시점으로 고를 수 있는 메시지: turn을 시작한 사람 메시지다(steer는 아니다). 숨긴 구간 안의 메시지는
 * `hidden` 항목 안에 있어 top-level만 보면 빠진다. 오래된 순.
 */
export function rewindPointsOf(state: AcpState): string[] {
  return state.items.flatMap((item) =>
    item.kind === "message" &&
    item.actor === "user" &&
    item.delivery === "next_turn" &&
    item.turn !== null
      ? [item.id]
      : [],
  );
}

/**
 * source가 session meta를 아직 모르면(null) lophn 화면이 늘 갖던 칸을 그린다. meta가 있으면 그 `capabilities`만 본다.
 */
export const LOPHN_CAPABILITIES: AcpCapabilities = {
  model: true,
  effort: true,
  mode: true,
  commands: true,
  rewind: true,
  rewind_files: true,
  fork: true,
  compact: true,
  rename: true,
  usage: true,
  steer: true,
  background: false,
  queue_edit: true,
  images: true,
  retry: true,
  sessions: true,
  stop_child: false,
  steer_child: false,
  tasks: false,
  toggles: false,
  goal: false,
  roles: false,
  shell: false,
  resume: false,
};

export function capabilitiesOf(meta: AcpSessionMeta | null): AcpCapabilities {
  return meta === null ? LOPHN_CAPABILITIES : meta.capabilities;
}

/** 카드의 단추 하나를 `decide` 입력의 choice로. 거절 이유는 한 줄로 맞춘다. `{mode}`는 plan 승인이다. */
export function decideChoiceOf(
  choice: "once" | "session" | "always" | "reject" | { readonly mode: string },
  reason?: string,
): AcpDecideChoice {
  if (typeof choice === "object") return { kind: "mode", mode: choice.mode };
  return choice === "session"
    ? { kind: "session" }
    : turnChoiceOf(choice, reason);
}

// session이 있어야 하는 화면 동작. session을 만들기 전 화면은 이 명령을 목록에서 뺀다.
const SESSION_OPENS: ReadonlySet<AcpCommandOpens | null> = new Set([
  "rename",
  "archive",
  "compact",
  "fork",
  "rewind",
  "mode",
  "status",
  "usage",
  "context",
  "subagents",
  "tasks",
  "goal",
]);

const SOURCE_ORDER = (source: AcpCommand["source"]) =>
  ACP_COMMAND_SOURCES.indexOf(source);

const GROUP_OF: Readonly<Record<AcpCommand["source"], SlashGroupKey>> = {
  app: "app",
  harness: "harness",
  skill: "skill",
  plugin: "extension",
  mcp: "extension",
  custom_user: "custom",
  custom_project: "custom",
};

/** 이름·별칭·설명이 query와 맞은 정도. 낮을수록 위이고 맞지 않으면 null이다(fuzzy는 없다). */
function tierOf(
  command: AcpCommand,
  needle: string,
): { tier: number; alias: string | null } | null {
  const name = command.name.toLowerCase();
  if (name === needle) return { tier: 0, alias: null };
  if (name.startsWith(needle)) return { tier: 1, alias: null };
  const alias = command.aliases.find((one) => {
    const lower = one.toLowerCase();
    return lower === needle || lower.startsWith(needle);
  });
  if (alias !== undefined) return { tier: 2, alias };
  if (wordStarts(name, /[-_:]/, needle)) return { tier: 3, alias: null };
  if (name.includes(needle)) return { tier: 4, alias: null };
  if (wordStarts(command.description.toLowerCase(), /\s+/, needle)) {
    return { tier: 5, alias: null };
  }
  return null;
}

function wordStarts(text: string, separator: RegExp, needle: string): boolean {
  return text.split(separator).some((word) => word.startsWith(needle));
}

function entryOf(command: AcpCommand, alias: string | null): SlashEntryView {
  return {
    name: command.name,
    description: command.description,
    argumentHint: command.argument_hint,
    source: command.source,
    opens: command.opens,
    alias,
  };
}

/**
 * `/` 뒤 글자로 거른 명령. 이름이 정확히 맞은 것이 위이고 이름 앞부분, 별칭, 이름 조각, 이름 포함, 설명 단어 순이다
 * (`tierOf`). 이름 앞부분이 맞은 것끼리는 짧은 이름이 위이고, 같은 순위에서는 출처 순서(`ACP_COMMAND_SOURCES`)와 이름 순이다.
 * query가 비면 출처 순서만 지키고 묶음 안 순서는 source가 준 순서다.
 */
export function slashEntriesOf(
  commands: readonly AcpCommand[],
  query: string,
  hasSession: boolean,
): SlashEntryView[] {
  const needle = query.toLowerCase();
  const usable = commands.filter(
    (command) =>
      hasSession ||
      command.source !== "app" ||
      !SESSION_OPENS.has(command.opens),
  );
  if (needle === "") {
    return [...usable]
      .sort((a, b) => SOURCE_ORDER(a.source) - SOURCE_ORDER(b.source))
      .map((command) => entryOf(command, null));
  }
  return usable
    .flatMap((command) => {
      const found = tierOf(command, needle);
      return found === null ? [] : [{ command, ...found }];
    })
    .sort(
      (a, b) =>
        a.tier - b.tier ||
        (a.tier === 1 ? a.command.name.length - b.command.name.length : 0) ||
        SOURCE_ORDER(a.command.source) - SOURCE_ORDER(b.command.source) ||
        a.command.name.localeCompare(b.command.name),
    )
    .map(({ command, alias }) => entryOf(command, alias));
}

/** query가 비면 머리 글이 있는 묶음(lophn, harness, skill, plugin·MCP, custom)이고 있으면 순위대로 한 목록이다. */
export function slashListOf(
  commands: readonly AcpCommand[],
  query: string,
  hasSession: boolean,
): SlashListState {
  const entries = slashEntriesOf(commands, query, hasSession);
  if (query !== "") return { kind: "ranked", entries };
  const groups: { key: SlashGroupKey; entries: SlashEntryView[] }[] = [];
  for (const entry of entries) {
    const key = GROUP_OF[entry.source];
    const last = groups.at(-1);
    if (last?.key === key) last.entries.push(entry);
    else groups.push({ key, entries: [entry] });
  }
  return { kind: "groups", groups };
}

/** 메뉴에 보이는 순서대로 편 줄. 화살표와 Enter가 이 순서를 센다. */
export function slashRows(list: SlashListState): SlashEntryView[] {
  return list.kind === "ranked"
    ? [...list.entries]
    : list.groups.flatMap((group) => [...group.entries]);
}
