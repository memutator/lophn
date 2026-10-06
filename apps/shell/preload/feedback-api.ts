// [Report a problem] preload 통로. desktop renderer는 버튼 시점의 view_session만 보내고, overlay의
// dialog는 자기 draftRef로 제출·취소·Issue 열기만 한다. 신원·binding·이미지는 main에 있다.
import {
  FEEDBACK_BEGIN_CHANNEL,
  FEEDBACK_CANCEL_CHANNEL,
  FEEDBACK_OPEN_ISSUE_CHANNEL,
  FEEDBACK_PREVIEW_CHANNEL,
  FEEDBACK_SUBMIT_CHANNEL,
  type FeedbackAccepted,
  type FeedbackPreview,
  feedbackPreviewSchema,
  type FeedbackReply,
  type LophnOverlayFeedback,
  type LophnShellFeedbackBegin,
} from "../ipc/feedback.ts";

export interface FeedbackTransport {
  invoke(channel: string, input: unknown): Promise<unknown>;
  on(
    channel: string,
    callback: (event: unknown, payload: unknown) => void,
  ): void;
  removeListener(
    channel: string,
    callback: (event: unknown, payload: unknown) => void,
  ): void;
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
      beginFeedback: (view_session) =>
        call<{ draftRef: string }>(transport, FEEDBACK_BEGIN_CHANNEL, {
          view_session,
        }),
    } satisfies LophnShellFeedbackBegin,
  );
}

/**
 * overlay의 feedback 통로. 미리보기는 overlay가 뜨자마자 올 수 있어 preload가 곧바로 듣고
 * 마지막 하나를 들고 있다가 구독에 넘긴다.
 */
export function createOverlayFeedback(
  transport: FeedbackTransport,
): LophnOverlayFeedback {
  const listeners = new Set<(preview: FeedbackPreview) => void>();
  let latest: FeedbackPreview | null = null;
  transport.on(FEEDBACK_PREVIEW_CHANNEL, (_event, payload) => {
    const parsed = feedbackPreviewSchema.safeParse(payload);
    if (!parsed.success) return;
    latest = parsed.data;
    for (const listener of listeners) listener(parsed.data);
  });
  return Object.freeze(
    {
      submitFeedback: (draftRef, text, selection) =>
        call<FeedbackAccepted>(transport, FEEDBACK_SUBMIT_CHANNEL, {
          draftRef,
          text,
          selection: {
            screen: selection.screen,
            screenshot: selection.screenshot,
          },
        }),
      cancelFeedback: async (draftRef) => {
        await call<null>(transport, FEEDBACK_CANCEL_CHANNEL, { draftRef });
      },
      openFeedbackIssue: async (draftRef) => {
        await call<null>(transport, FEEDBACK_OPEN_ISSUE_CHANNEL, { draftRef });
      },
      subscribePreview(listener) {
        listeners.add(listener);
        if (latest !== null) listener(latest);
        return () => void listeners.delete(listener);
      },
    } satisfies LophnOverlayFeedback,
  );
}
