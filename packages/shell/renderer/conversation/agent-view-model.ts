// Agent 화면의 순수 규칙. 화면은 이 값을 그대로 그린다. 시각은 인자로 받는다.
import type { BodyState } from "./drafts.ts";
import type {
  AgentFace,
  ThreadEntry,
  ThreadMessage,
  ThreadView,
} from "./agent-tab-source.ts";
import type { ViewDetail } from "./activity/model.ts";

/** 아직 만들지 않은 새 session의 입력 메모리 key. 같은 창의 다른 agent와 섞이지 않는다. */
export function newSessionKey(agent: AgentFace | null): string {
  if (agent === null) return "new:";
  return `new:${agent.role}:${agent.name}:${agent.place.kind}:${agent.place.name}`;
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
 * reasoning뿐인 agent message도 같은 이유로 뺀다(글 없는 묶음이 남는다). 아직 읽지 않은 본문은 남긴다.
 */
export function shownEntries(
  entries: readonly ThreadEntry[],
  detail: ViewDetail,
  bodyOf: (message: string) => BodyState | undefined,
): readonly ThreadEntry[] {
  return detail === "messages"
    ? entries.filter(
        (entry) =>
          entry.kind !== "tools" &&
          !(entry.kind === "turn-end" && entry.outcome === "completed") &&
          !(
            entry.kind === "message" &&
            entry.actor === "agent" &&
            reasoningOnly(bodyOf(entry.id))
          ),
      )
    : entries;
}

/** 읽은 본문에 reasoning 밖의 part가 없다. */
function reasoningOnly(body: BodyState | undefined): boolean {
  return (
    body?.state === "ready" &&
    body.parts.every((part) => part.kind === "reasoning")
  );
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
        : [],
  );
}

const EXCERPT_CHARS = 60;

/** 글 part만 이은 본문. 읽지 못했으면 null이다. */
export function textOfBody(body: BodyState | undefined): string | null {
  if (body?.state !== "ready") return null;
  return body.parts
    .flatMap((part) => (part.kind === "text" ? [part.text] : []))
    .join("\n");
}

/** 시점을 고르는 목록에서 메시지를 알아볼 한 줄. 본문을 아직 읽지 못했으면 줄임표다. */
export function excerptOf(body: BodyState | undefined): string {
  const text = textOfBody(body)?.replace(/\s+/g, " ").trim() ?? "";
  if (text === "") return "…";
  return text.length > EXCERPT_CHARS
    ? `${text.slice(0, EXCERPT_CHARS)}…`
    : text;
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
