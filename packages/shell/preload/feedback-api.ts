// [Report a problem] preload 통로. desktop renderer는 버튼 시점의 view_session만 보내고, overlay의
// dialog는 자기 draftRef로 보내기·취소·Issue 열기만 한다. 신원·binding은 main에 있다.
import {
  FEEDBACK_BEGIN_CHANNEL,
  FEEDBACK_CANCEL_CHANNEL,
  FEEDBACK_OPEN_ISSUE_CHANNEL,
  FEEDBACK_SEND_CHANNEL,
  type FeedbackAccepted,
  type FeedbackReply,
  type LophnOverlayFeedback,
  type LophnShellFeedbackBegin,
} from "../ipc/feedback.ts";

export interface FeedbackTransport {
  invoke(channel: string, input: unknown): Promise<unknown>;
}

// 거절은 code만 싣는다. contextBridge가 Error의 다른 property를 넘기지 않는다.
async function call<T>(
  transport: FeedbackTransport,
  channel: string,
  input: unknown,
): Promise<T> {
  let reply: FeedbackReply<T>;
  try {
    reply = await transport.invoke(channel, input) as FeedbackReply<T>;
  } catch {
    throw new Error("unavailable");
  }
  if (!reply.ok) throw new Error(reply.error.code);
  return reply.value;
}

export function createFeedbackBegin(
  transport: FeedbackTransport,
): LophnShellFeedbackBegin {
  return Object.freeze(
    {
      beginFeedback: (view_session, problem) =>
        call<{ draftRef: string }>(transport, FEEDBACK_BEGIN_CHANNEL, {
          view_session,
          ...(problem === undefined ? {} : { problem }),
        }),
    } satisfies LophnShellFeedbackBegin,
  );
}

/** overlay의 feedback 통로. 글만 보낸다. */
export function createOverlayFeedback(
  transport: FeedbackTransport,
): LophnOverlayFeedback {
  return Object.freeze(
    {
      sendFeedback: (draftRef, text, existing_problem) =>
        call<FeedbackAccepted>(transport, FEEDBACK_SEND_CHANNEL, {
          draftRef,
          text,
          existing_problem,
        }),
      cancelFeedback: async (draftRef) => {
        await call<null>(transport, FEEDBACK_CANCEL_CHANNEL, { draftRef });
      },
      openFeedbackIssue: async (draftRef) => {
        await call<null>(transport, FEEDBACK_OPEN_ISSUE_CHANNEL, { draftRef });
      },
    } satisfies LophnOverlayFeedback,
  );
}
