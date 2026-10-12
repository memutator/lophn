// Agent 화면의 순수 규칙. 화면은 이 값을 그대로 그린다. 시각은 인자로 받는다.
import type { SaveState } from "../workspace/visuals/block-frame.tsx";
import type { BodyState, SaveRecord } from "./drafts.ts";
import type { Outgoing } from "./delivery-state.ts";
import type {
  ThreadEntry,
  ThreadHidden,
  ThreadMessage,
  ThreadView,
} from "./agent-source.ts";
import type { ViewDetail } from "./activity/model.ts";
import type { SlashEntryView, SlashGroupView } from "./slash-menu/types.ts";

/** 아직 만들지 않은 새 session의 입력 메모리 key. 같은 창의 다른 agent와 섞이지 않는다. */
export function newSessionKey(assignment: string): string {
  return `new:${assignment}`;
}

/** 사용자 달력으로 오늘이면 Today, 아니면 Earlier다(shell/desktop#R39). */
export function sessionGroup(
  activeAt: string,
  now: number,
): "today" | "earlier" {
  const day = (value: Date) =>
    `${value.getFullYear()}-${value.getMonth()}-${value.getDate()}`;
  return day(new Date(activeAt)) === day(new Date(now)) ? "today" : "earlier";
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

export type DeliveryLabel =
  | "sending"
  | "received"
  | "applied"
  | "saved"
  | "not-sent"
  | "unconfirmed";

/** 사람 말의 접수 표시. 접수와 반영은 따로 보인다(conversation#R3). */
export function confirmedDelivery(message: ThreadMessage): DeliveryLabel {
  if (message.applied) return "applied";
  // 수정이 아닌 요청이 run 없이 남은 것은 담당이 없을 때 보존된 말이다.
  if (message.mode === "request" && message.run === null) return "saved";
  return "received";
}

export function outgoingDelivery(outgoing: Outgoing): DeliveryLabel {
  switch (outgoing.phase) {
    case "sending":
      return "sending";
    case "accepted":
      return "received";
    case "not_sent":
      return "not-sent";
    case "unconfirmed":
      return "unconfirmed";
  }
}

/** 보기 상세에서 tool 줄을 아예 그리지 않는 경우. 줄만 있는 agent 묶음이 이름만 남지 않게 걸러 낸다. */
export function shownEntries(
  entries: readonly ThreadEntry[],
  detail: ViewDetail,
): readonly ThreadEntry[] {
  return detail === "messages"
    ? entries.filter((entry) => entry.kind !== "tools")
    : entries;
}

/** 대화의 확정 메시지 전부. 접힌 숨긴 구간 안의 메시지도 든다(펼치면 읽으므로 본문을 읽어 둔다). */
export function messagesOf(thread: ThreadView | null): ThreadMessage[] {
  return flatMessages(thread?.entries ?? []);
}

function flatMessages(entries: readonly ThreadEntry[]): ThreadMessage[] {
  return entries.flatMap((entry) =>
    entry.kind === "message"
      ? [entry]
      : entry.kind === "hidden"
      ? flatMessages(entry.entries)
      : []
  );
}

const EXCERPT_CHARS = 60;

/** 시점을 고르는 목록에서 메시지를 알아볼 한 줄. 본문을 아직 읽지 못했으면 줄임표다. */
export function excerptOf(body: BodyState | undefined): string {
  if (body?.state !== "ready") return "…";
  const text = body.parts.flatMap((part) =>
    part.kind === "text" ? [part.text] : []
  ).join(" ").replace(/\s+/g, " ").trim();
  if (text === "") return "…";
  return text.length > EXCERPT_CHARS
    ? `${text.slice(0, EXCERPT_CHARS)}…`
    : text;
}

/** 숨긴 구간 줄 전부. */
export function hiddenOf(thread: ThreadView | null): ThreadHidden[] {
  return (thread?.entries ?? []).filter((entry): entry is ThreadHidden =>
    entry.kind === "hidden"
  );
}

/**
 * 시각 블록 문서로 남기기의 진행(shell/workspace#R13). 요청으로 보낸 말이 맡긴 run의 lophn 답에
 * 문서·판 결과 링크가 있으면 저장된 것이다. 링크는 실제로 만들거나 바꾼 문서뿐이라
 * (lophn-agent/conversation#R4) 저장하지 않은 문서의 링크를 지어내지 않는다. run이 끝났는데
 * 링크가 없으면 저장하지 않은 것이고 그 이유는 답이 말한다.
 */
export function visualSaveState(
  record: SaveRecord | undefined,
  outgoing: Outgoing | null,
  messages: readonly ThreadMessage[],
): SaveState {
  if (record === undefined) return { state: "idle" };
  if (record.failed) return { state: "failed" };
  const request = messages.find((message) => message.id === record.request);
  if (request === undefined) {
    if (outgoing?.id !== record.request) return { state: "requested" };
    return { state: outgoing.phase === "not_sent" ? "failed" : "sending" };
  }
  if (request.run === null) return { state: "requested" };
  const run = request.run;
  const links = messages
    .filter((message) =>
      message.actor === "agent" && message.run?.id === run.id
    )
    .flatMap((message) => message.results)
    .flatMap((link) =>
      link.kind === "context" ? [] : [{
        document: link.document,
        version: link.kind === "version" ? link.version : null,
      }]
    );
  if (links.length > 0) return { state: "saved", links };
  return { state: run.ended ? "not-saved" : "requested" };
}

/** 입력칸이 `/이름` 하나이면 그 이름이다. 공백이 들어가면 인자를 쓰는 중이라 메뉴를 닫는다. */
export function slashQuery(text: string): string | null {
  return text.startsWith("/") && !/\s/.test(text) ? text.slice(1) : null;
}

export function slashEntries(
  groups: readonly SlashGroupView[],
): readonly SlashEntryView[] {
  return groups.flatMap((group) => group.entries);
}

export interface SlashSubmit {
  readonly name: string;
  /** 이름 뒤에 쓴 글. 앞뒤 공백을 뺀다. */
  readonly argument: string;
  /** 이름 뒤에 공백이 있었다. */
  readonly hasArgument: boolean;
}

export function parseSlash(text: string): SlashSubmit {
  const match = /^\/(\S*)(\s*)([\s\S]*)$/.exec(text)!;
  return {
    name: match[1]!,
    argument: match[3]!.trim(),
    hasArgument: match[2]! !== "",
  };
}

export type SlashDecision =
  | { readonly kind: "run"; readonly entry: SlashEntryView }
  | { readonly kind: "choose"; readonly candidates: readonly SlashEntryView[] }
  | { readonly kind: "unknown" };

/**
 * 제출한 `/…`가 무엇을 하는지(commands#R6, R11). 메뉴가 열려 있으면 고른 줄이 우선이되, 고른 줄과 이름이
 * 같은 skill이 둘 이상이면 어느 것인지 묻는다. 메뉴 없이 이름과 인자를 쳤으면 이름이 같은 것이 하나일 때만
 * 실행한다. 맞는 것이 없으면 알 수 없는 명령이다.
 */
export function decideSlash(
  submit: SlashSubmit,
  listed: readonly SlashEntryView[],
  highlighted: number,
): SlashDecision {
  const same = listed.filter((entry) => entry.name === submit.name);
  const pick = submit.hasArgument ? undefined : listed[highlighted];
  const chosen = pick ?? (same.length === 1 ? same[0] : undefined);
  if (chosen !== undefined) {
    const twins = listed.filter((entry) => entry.name === chosen.name);
    return twins.length >= 2
      ? { kind: "choose", candidates: twins }
      : { kind: "run", entry: chosen };
  }
  if (same.length >= 2) return { kind: "choose", candidates: same };
  return { kind: "unknown" };
}
