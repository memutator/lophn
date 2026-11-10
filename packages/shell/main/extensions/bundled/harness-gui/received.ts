// 사람이 치지 않은 user 글(다른 agent나 앱의 lophn call·reply, task 알림, 다른 session)을 가려낸다. 모르는 꼴은 null이라
// 호출한 쪽이 지금처럼 사람 메시지로 둔다.
import type { AcpSender } from "../../../../../protocol/acp/items.ts";

export type ReceivedText = {
  sender: AcpSender;
  call: string | null;
  reply_to: string | null;
  text: string;
};

// Claude transcript 줄의 `origin`. human만 사람이 친 것이고 나머지는 남이 넣은 것이다.
export type TranscriptOrigin = {
  kind?: string;
  name?: string;
  from?: string;
  body?: string;
};

// core가 만드는 `<lophn-call from="…" call="…" reply="…">본문</lophn-call>`과 `<lophn-reply call="…" from="…" …>`.
// 본문 안의 `<lophn-…`는 core가 `&lt;`로 무력화해 두었다. 사람이 tag를 붙여 넣는 일은 드물어 origin보다 tag를 먼저 본다:
// lophn이 TUI에 붙여 넣은 call은 origin이 human이다.
const TAG =
  /^<lophn-(call|reply)((?: [a-z_]+="[^"]*")*)>\n([\s\S]*?)\n<\/lophn-\1>/;

function attributes(raw: string): Record<string, string> {
  return Object.fromEntries(
    [...raw.matchAll(/ ([a-z_]+)="([^"]*)"/g)].map((one) => [one[1], one[2]]),
  );
}

export function classifyReceived(
  text: string,
  origin?: TranscriptOrigin | null,
): ReceivedText | null {
  const tag = TAG.exec(text.trimStart());
  if (tag !== null) {
    const attr = attributes(tag[2] ?? "");
    const from = attr.from ?? "";
    // 사람이 보낸 call이다. 받은 메시지가 아니라 지금처럼 사람 메시지로 둔다(호출한 쪽이 풀어 그리지 않는다).
    if (from === "human") return null;
    const id = attr.call === undefined || attr.call === "" ? null : attr.call;
    // 앱이 보낸 call은 `app:<slug>`다. tag에는 앱 id가 없어 app은 null이다.
    const appSlug = from.startsWith("app:") ? from.slice("app:".length) : null;
    return {
      sender:
        from === "program"
          ? { kind: "program" }
          : appSlug !== null
            ? { kind: "app", app: null, name: appSlug }
            : { kind: "agent", agent: null, name: from === "" ? null : from },
      call: tag[1] === "call" ? id : null,
      reply_to: tag[1] === "reply" ? id : null,
      text: (tag[3] ?? "").replace(/&lt;(\/?)lophn-/g, "<$1lophn-"),
    };
  }
  // 다시 뜬 CLI는 앞 process가 띄운 task의 알림을 origin 없이 SDK 입력(`promptSource: "sdk"`)으로 적는다. 글 꼴로도 가른다.
  if (/^\s*<task-notification>/.test(text))
    return { sender: { kind: "program" }, call: null, reply_to: null, text };
  if (origin?.kind === undefined || origin.kind === "human") return null;
  if (origin.kind === "peer") {
    return {
      sender: {
        kind: "agent",
        agent: null,
        name: origin.name ?? origin.from ?? null,
      },
      call: null,
      reply_to: null,
      text: origin.body ?? text,
    };
  }
  return { sender: { kind: "program" }, call: null, reply_to: null, text };
}

// content block 목록의 첫 글 block으로 가른다(Codex·omp처럼 transcript에 출처 칸이 없는 harness).
export function classifyBlocks(
  blocks: readonly { type: string; text?: string }[],
): ReceivedText | null {
  const first = blocks[0];
  return first?.type === "text" && first.text !== undefined
    ? classifyReceived(first.text)
    : null;
}
