// 요청 본문에서 읽기만 한다. 판단은 test가 한다. lane의 match와 함수 대답이 앞 tool 결과에서
// id를 뽑는 데 쓴다.

import type { JournalEntry } from "./types.ts";

type Block = { type?: string; text?: string; name?: string; content?: unknown };
type Message = { role?: string; content?: string | Block[] };
type Body = { system?: unknown; tools?: Block[]; messages?: Message[] };

const body = (request: JournalEntry): Body => (request.body ?? {}) as Body;

const textOf = (content: unknown): string => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((b: Block) => b.text ?? "").join("");
};

export function systemText(request: JournalEntry): string {
  return textOf(body(request).system);
}

export function toolNames(request: JournalEntry): string[] {
  return (body(request).tools ?? []).map((t) => t.name ?? "");
}

function lastUser(request: JournalEntry): Message | undefined {
  return (body(request).messages ?? []).findLast((m) => m.role === "user");
}

export function lastUserText(request: JournalEntry): string {
  const content = lastUser(request)?.content;
  if (typeof content === "string") return content;
  return (content ?? []).filter((b) => b.type === "text").map((b) => b.text)
    .join("");
}

// toolUseId가 없으면 마지막 tool_result를 본다.
export function lastToolResult(
  request: JournalEntry,
  toolUseId?: string,
): string | undefined {
  const content = lastUser(request)?.content;
  if (!Array.isArray(content)) return undefined;
  const results = content.filter((b) =>
    b.type === "tool_result" &&
    (toolUseId === undefined ||
      (b as { tool_use_id?: string }).tool_use_id === toolUseId)
  );
  const last = results.at(-1);
  return last === undefined ? undefined : textOf(last.content);
}

// packages/base/id.ts의 id: prefix + `_` + Crockford base32 소문자 26자.
export function idIn(text: string, prefix: string): string | undefined {
  return text.match(new RegExp(`${prefix}_[0-9a-hjkmnp-tv-z]{26}`))?.[0];
}
