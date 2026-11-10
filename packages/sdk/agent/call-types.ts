// 앱이 agent에게 보내는 call(A2A)의 값 모양이다. protocol/lophn-agent/app-calls.ts의 입력·`AppCallRow`와 agent 명함(`AgentCard`)의 사본이다
// (SDK는 zod를 import하지 않는다). 필드가 바뀌면 같이 바꾼다(agent_test.ts가 어긋남을 type 오류로 잡는다).

export type CallReply = "none" | "result";
export type CallState = "accepted" | "done" | "failed" | "cancelled";
export type CallFailReason =
  | "not_found"
  | "closed"
  | "receiver_ended"
  | "lophn_restarted";

/**
 * 받는 곳. `session`은 보이는 session이고, `agent`는 handle이다(workspace를 빼면 이 앱 workspace에 새 session이 열린다. Home은 `{home: true}`로 밝힌다).
 * `agent`와 `session`을 같이 주면 그 session이 아직 열려 있으면 거기로, 아니면 `fallback: "new"`로 새 session을 연다.
 */
export type CallAddress =
  | { session: string }
  | {
      agent: string;
      workspace?: { project: string } | { app: string } | { home: true };
    }
  | {
      agent: string;
      workspace?: { project: string } | { app: string } | { home: true };
      session: string;
      fallback: "new";
    };

export type CallSendInput = {
  to: CallAddress;
  /**
   * 같은 key로 다시 보내면 첫 call을 돌려준다(이 앱 안에서). `calls.send`가 호출마다 만들어 주므로 앱이 안 줘도 SDK 안 재시도는 두 번 가지 않는다.
   * 앱 자신이 재시도하려면 같은 key를 넘긴다.
   */
  key?: string;
  /** `none`은 맡기고 끝, `result`는 agent의 답 글 하나를 받는다(call 행의 `result`, `call.settled` event). */
  reply: CallReply;
  text: string;
};

export type CallSent = {
  call: string;
  state: CallState;
  fail_reason: CallFailReason | null;
};

export type CallFrom =
  | { kind: "human" }
  | { kind: "program" }
  | { kind: "agent"; session: string }
  | { kind: "app"; app: string; slug: string };

export type CallTarget =
  | {
      kind: "new_session";
      agent: {
        agent: string;
        workspace: { kind: "project" | "app"; id: string } | null;
      };
    }
  | { kind: "open_session"; session: string }
  | {
      kind: "open_session_or_new";
      session: string;
      agent: {
        agent: string;
        workspace: { kind: "project" | "app"; id: string } | null;
      };
    };

export type CallRow = {
  call: string;
  from: CallFrom;
  to: CallTarget;
  receiver_session: string | null;
  reply: "none" | "result" | "conversation";
  state: CallState;
  fail_reason: CallFailReason | null;
  /** 이 앱이 보낸 result call의 답 글. 아직 없거나 남이 보낸 call이면 null이다. */
  result: string | null;
  created_at: string;
  state_changed_at: string;
};

/** `call.settled` event의 payload. */
export type CallSettled = {
  call: string;
  state: "done" | "failed" | "cancelled";
  fail_reason: CallFailReason | null;
};

/** `lophn`이 내는 call 끝남 event 이름이다(`subscribe("lophn", CALL_SETTLED_EVENT, …)`). 이 앱이 보낸 call만 이 앱에 온다. */
export const CALL_SETTLED_EVENT = "call.settled";

export type AgentCard = {
  handle: string;
  name: string;
  workspace: { kind: "project" | "app"; id: string } | null;
  description?: string;
  runtime: string;
  model?: {
    provider: string;
    model_name: string;
    price: { input: string | null; output: string | null } | null;
  };
  modality: { input: string[]; output: string[] };
  replies: ("none" | "result" | "conversation")[];
  diff: { plus: string[]; minus: string[] };
  notes: string[];
  callable?: { home: boolean; here: boolean };
};
