// 사람이 치지 않은 user 글(다른 agent나 앱의 lophn call·reply, program의 알림, 다른 session)을 가려낸다. 모르는 꼴은 null이라
// 호출한 쪽이 지금처럼 사람 메시지로 둔다.
import type { AcpSender } from "../../protocol/acp/items.ts";
import type { AcpSessionHandle, AcpUpdate } from "../../protocol/acp/mod.ts";

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

// core가 만드는 `<lophn-call from="…" call="…" reply="…">본문</lophn-call>`과 `<lophn-reply call="…" from="…" …>`,
// 그리고 program이 넣는 reaction·step·notice(`packages/protocol/lophn-agent/input-tags.ts`).
// 본문 안의 `<lophn-…`는 core가 `&lt;`로 무력화해 두었다. 사람이 tag를 붙여 넣는 일은 드물어 origin보다 tag를 먼저 본다:
// lophn이 TUI에 붙여 넣은 call은 origin이 human이다.
const TAG =
  /^<lophn-(call|reply|reaction|step|notice)((?: [a-z_]+="[^"]*")*)>\n([\s\S]*?)\n<\/lophn-\1>/;

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
    const body = (tag[3] ?? "").replace(/&lt;(\/?)lophn-/g, "<$1lophn-");
    if (tag[1] !== "call" && tag[1] !== "reply")
      return {
        sender: { kind: "program" },
        call: null,
        reply_to: null,
        text: body,
      };
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
      text: body,
    };
  }
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

// Claude가 background task·subagent가 끝났을 때 넣는 알림이다. live는 이것을 대화 줄로 그리지 않고(Agent 줄과 task가 상태를
// 보인다) 다시 그릴 때도 그리지 않는다. 다시 뜬 CLI는 앞 process가 띄운 task의 알림을 origin 없이 SDK 입력
// (`promptSource: "sdk"`)으로 적으므로 글 꼴로도 가른다.
export function isTaskNotification(
  text: string,
  origin?: TranscriptOrigin | null,
): boolean {
  return (
    origin?.kind === "task-notification" || /^\s*<task-notification>/.test(text)
  );
}

// lophn 팀원 탭에 core가 넣은 입력(call, reply, 알림)은 lophn tag로 싼 `send`다. adapter는 live로 그 글을 사람 메시지로 그리므로 그 id의
// message를 받은 메시지로 바꿔 내고, 사람 메시지만 받는 CLI message id(rewind 시점, bookmark)도 붙이지 않는다. 다시 열 때는 adapter가
// 같은 글을 `classifyReceived`로 가른다.
export function receivedSends(session: AcpSessionHandle): AcpSessionHandle {
  const injected = new Map<string, ReceivedText>();
  const rewrite = (update: AcpUpdate): AcpUpdate | null => {
    if (update.type === "origin_set" && injected.has(update.message)) {
      return null;
    }
    const received =
      update.type === "message_added" && update.item.actor === "user"
        ? injected.get(update.item.id)
        : undefined;
    return received === undefined || update.type !== "message_added"
      ? update
      : {
          ...update,
          item: {
            ...update.item,
            actor: "received",
            sender: received.sender,
            call: received.call,
            reply_to: received.reply_to,
            origin: null,
            content: [{ type: "text", text: received.text }],
          },
        };
  };
  return {
    id: session.id,
    publish(update) {
      const mapped = rewrite(update);
      if (mapped !== null) session.publish(mapped);
    },
    ...(session.commit === undefined
      ? {}
      : {
          commit(updates) {
            const mapped: AcpUpdate[] = [];
            for (const update of updates) {
              const next = rewrite(update);
              if (next !== null) mapped.push(next);
            }
            session.commit!(mapped);
          },
        }),
    onInput(listener) {
      session.onInput((input) => {
        if (input.type === "send") {
          const received = classifyBlocks(input.content);
          if (received !== null) injected.set(input.id, received);
        }
        listener(input);
      });
    },
    onClose: (listener) => session.onClose(listener),
    close: () => session.close(),
  };
}
