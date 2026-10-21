import type { Id } from "../../protocol/base/ids.ts";
import type { CodingOptions } from "../../protocol/coding-agent/harness-id.ts";
import type {
  CallFailReason,
  CallFrom,
  CallRef,
  CallReply,
  CallState,
  CallTo,
  CallToInput,
  NamedAgent,
} from "../../protocol/lophn-agent/calls.ts";
import type { InputDelivery } from "../../protocol/lophn-agent/inputs.ts";
import type { RoutedInput } from "./ports.ts";

// 순수 함수만 둔다. 받는 곳 해석 순서, 실패 이유를 오류로 바꾸는 규칙, 실패 알림 글.

// zod가 읽은 ID는 글자라서 port가 요구하는 모양으로 좁힌다.
export const sesId = (value: string) => value as Id<"ses">;
export const calId = (value: string) => value as Id<"cal">;

// route 한 번의 입력이다. 사람, program, agent, coding agent가 모두 이 모양으로 넣는다.
export type RouteInput = {
  from: CallFrom;
  to: CallToInput | CallTo;
  reply: CallReply;
  body: string;
  refs: readonly CallRef[];
  reply_to: string | null;
  // agent가 보낸 call에만 있다(tool call ID).
  dedup: string | null;
  options: CodingOptions | null;
  kind: RoutedInput["kind"];
  delivery: InputDelivery;
  // 사람 메시지는 보내는 쪽이 먼저 session 기록에 쓴 message ID를 싣는다.
  message?: string | null;
  // reaction이면 근거 domain event type.
  event?: string | null;
  // agent의 SendCall·ReplyCall만 싣는다. 없으면 false.
  unattended?: boolean;
};

export type RouteResult = {
  // agent가 보낸 call만 ID가 있다. 사람 메시지와 program 입력은 null이다.
  call: string | null;
  state: CallState;
  fail_reason: CallFailReason | null;
  session: string | null;
};

// 보낸 쪽이 쓴 받는 곳이 어느 모양인지. 이미 풀린 CallTo는 `kind`가 있다.
type Addressing =
  | { form: "resolved"; to: CallTo }
  | { form: "session"; session: string }
  | { form: "named"; named: NamedAgent }
  | { form: "named_or_session"; named: NamedAgent; session: string };

export function addressingOf(to: CallToInput | CallTo): Addressing {
  if ("kind" in to) return { form: "resolved", to };
  if (!("role" in to)) return { form: "session", session: to.session };
  if ("session" in to) {
    const { session, fallback: _fallback, ...named } = to;
    return { form: "named_or_session", named, session };
  }
  return { form: "named", named: to };
}

export function isFinished(state: CallState): boolean {
  return state !== "accepted";
}

// 사람이 보낸 쪽일 때 배달 실패를 오류 코드로 돌려준다.
export function failureCode(
  reason: CallFailReason,
): "not_found" | "forbidden" | "conflict" | "unavailable" {
  switch (reason) {
    case "not_found":
      return "not_found";
    case "not_allowed":
      return "forbidden";
    case "closed":
      return "conflict";
    case "receiver_ended":
    case "lophn_restarted":
      return "unavailable";
  }
}

// 실패를 보낸 session에 돌려주는 입력의 글이다. 고정 문구라 앞단이 미리 blob으로 준비해 둔다.
export const FAILURE_TEXTS: Record<CallFailReason, string> = {
  not_found: "The call was not delivered: no such agent or session.",
  not_allowed:
    "The call was not delivered: your grant does not allow calling that agent.",
  closed:
    "The call was not delivered: that session is closed. Call its role and place to open a new session.",
  receiver_ended: "The receiving session ended without replying.",
  lophn_restarted: "lophn restarted before the receiving session got the call.",
};

// 취소 알림은 글이 없다. 알림 종류(call_cancelled)가 말한다.
export const CANCEL_TEXT = "";

// route가 보낸 쪽에 돌려주는 입력의 꼴이다. call 행이 없는 program 입력과 같다(근거 seq 없음).
export function failureInput(
  call: Id<"cal">,
  reason: CallFailReason,
  unattended: boolean,
): RoutedInput {
  return {
    kind: "reply",
    from: { kind: "program", event_seq: "0" },
    call,
    reply_to: call,
    body: FAILURE_TEXTS[reason],
    refs: [],
    delivery: "next_turn",
    message: null,
    reply: null,
    outcome: { state: "failed", reason },
    event: null,
    notice: null,
    unattended,
  };
}
