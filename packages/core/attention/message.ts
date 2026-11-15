// push 글. 고정 문장에 session 제목·agent 이름·앱 이름만 끼운다. 대화 글, 명령, 질문 글, 앱 notice의 body는 어디에도 싣지 않는다.
// 폰이 OS가 그리는 글을 고칠 수 없어서 글은 core가 다 만든다.
import type { PushDevice, PushMessage } from "./ports.ts";
import { CAUSE_ROW, type Cause, type Who } from "./triggers.ts";

const TTL_SECONDS = 3600;
const TITLE_MAX = 120;
const BODY_MAX = 200;

const cut = (text: string, max: number): string => {
  const chars = [...text];
  return chars.length <= max ? text : chars.slice(0, max).join("");
};

const sessionName = (who: Who) => who.title ?? who.agent ?? "An agent";
const agentName = (who: Who) => who.agent ?? who.harness ?? "An agent";

type Text = { title: string; body?: string };

function textOf(cause: Cause, showNames: boolean): Text {
  switch (cause.kind) {
    case "approval":
      return showNames
        ? {
            title: `${sessionName(cause.who)} is waiting for you`,
            body: `${agentName(cause.who)} asks for approval.`,
          }
        : { title: "An agent needs you" };
    case "question":
      return showNames
        ? {
            title: `${sessionName(cause.who)} has a question`,
            body: `${agentName(cause.who)} has a question for you.`,
          }
        : { title: "An agent needs you" };
    case "terminal_waiting":
      return showNames
        ? {
            title: `${sessionName(cause.who)} is waiting for you`,
            body: `${cause.who.harness ?? "An agent"} needs you.`,
          }
        : { title: "An agent needs you" };
    case "long_finish": {
      const minutes = Math.max(1, Math.round(cause.active_ms / 60_000));
      return showNames
        ? {
            title: `${sessionName(cause.who)} ${cause.outcome}`,
            body: `${agentName(cause.who)} worked for ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`,
          }
        : { title: `An agent ${cause.outcome}` };
    }
    case "consent":
    case "share_request":
      return showNames
        ? { title: `${cause.app_name} is waiting for you`, body: "lophn" }
        : { title: "An app needs you" };
    case "program_notice":
      return showNames
        ? { title: cause.title, body: "lophn" }
        : { title: "An app needs you" };
    case "app_notify":
      return showNames
        ? { title: cause.title, body: cause.app_name ?? "An app" }
        : { title: "An app has something for you" };
    case "job_held":
      return showNames
        ? {
            title: `${cause.job_title} was missed`,
            body: "Choose whether to run it now.",
          }
        : { title: "A job needs you" };
  }
}

function dataOf(cause: Cause, host: string): Pick<PushMessage, "data"> {
  switch (cause.kind) {
    case "approval":
    case "question":
    case "terminal_waiting":
    case "long_finish":
      return { data: { host, kind: "session", session: cause.session } };
    case "consent":
    case "share_request":
      return { data: { host, kind: "inbox" } };
    case "program_notice":
      return cause.app === null
        ? { data: { host, kind: "inbox" } }
        : { data: { host, kind: "app", app: cause.app } };
    case "app_notify":
      return { data: { host, kind: "app", app: cause.app } };
    case "job_held":
      return { data: { host, kind: "inbox" } };
  }
}

export function buildMessage(
  cause: Cause,
  device: PushDevice,
  host: string,
): PushMessage {
  const text = textOf(cause, device.prefs.show_names);
  const row = CAUSE_ROW[cause.kind];
  return {
    to: device.token,
    title: cut(text.title, TITLE_MAX),
    ...(text.body === undefined ? {} : { body: cut(text.body, BODY_MAX) }),
    ...dataOf(cause, host),
    channelId: row.channelId,
    priority: row.priority,
    ttl: TTL_SECONDS,
  };
}
