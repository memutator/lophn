// [Report a problem]. 버튼은 desktop 창 본문이 view_session만 보내고 dialog는 같은 창
// overlay에 연다. 보내기는 core `problem.submit_feedback`(worker route)로 글만 보낸다.
// 원문 글·binding은 main 메모리에만 있다.
import { randomBytes, randomUUID } from "node:crypto";

import { DESKTOP_INTENT_CHANNEL } from "../../../ipc/shortcuts.ts";
import { reportIdOf } from "../../app-frame/view-error.ts";
import {
  createFeedback,
  registerFeedbackIpc,
  removeFeedbackIpc,
} from "../../app-frame/feedback.ts";
import type { AppCalls } from "./app-calls.ts";
import type { AppViews } from "./app-views.ts";
import type { Registered, ShellContext } from "./context.ts";

export function register(
  ctx: ShellContext,
  views: AppViews,
  _calls: AppCalls,
): Registered {
  const { core, overlays, windows, windowRef, windowOfRef } = ctx;
  const feedback = createFeedback({
    registry: overlays.overlayRegistry(),
    windowOfShell: (sender) => {
      const window = ctx.shellWindowOf(sender);
      return window === undefined ? undefined : windowRef(window);
    },
    windowOfOverlay: (sender) => {
      const window = [...windows].find((window) =>
        !window.isDestroyed() &&
        overlays.controller(window)?.isOverlay(sender) === true
      );
      return window === undefined ? undefined : windowRef(window);
    },
    view: (view_session) => views.appFrame.feedbackView(view_session),
    dialog: (ref) => {
      const window = windowOfRef(ref);
      const overlay = window === undefined
        ? undefined
        : overlays.controller(window);
      if (overlay === undefined) return undefined;
      return {
        open: (draftRef) => overlay.openFeedback(draftRef),
        close: (draftRef) => overlay.closeFeedback(draftRef),
      };
    },
    async submit(input) {
      const session = core.session();
      if (session === null) {
        return {
          ok: false,
          error: { code: "unavailable", message: "core is not ready" },
        };
      }
      const reply = await session.internal(
        "worker",
        "problems",
        "submit_feedback",
        input,
      );
      if (!reply.ok) {
        const code = reply.error.code;
        return {
          ok: false,
          error: {
            code: code === "invalid_input" || code === "forbidden" ||
                code === "conflict"
              ? code
              : "unavailable",
            message: "report was not accepted",
          },
        };
      }
      const value = reply.value as { report: string; problem: string | null };
      return {
        ok: true,
        value: { report: value.report, problem: value.problem },
      };
    },
    // 응답을 잃은 제출은 다시 보내기 전에 그 Report ID가 접수됐는지 읽는다.
    async lookup(report) {
      const session = core.session();
      if (session === null) return { ok: false };
      const reply = await session.internal("read", "problems", "get-report", {
        report,
      });
      if (reply.ok) {
        const found = (reply.value as {
          report: { id: string; problem: string | null };
        }).report;
        return {
          ok: true,
          value: { report: found.id, problem: found.problem },
        };
      }
      return reply.error.code === "not_found"
        ? { ok: true, value: null }
        : { ok: false };
    },
    openIssue: (ref, target) => {
      const window = windowOfRef(ref);
      if (window !== undefined && !window.webContents.isDestroyed()) {
        window.webContents.send(DESKTOP_INTENT_CHANNEL, {
          kind: "app-issue",
          app: target.app,
          problem: target.problem,
        });
      }
    },
    ids: {
      draft: () => `draft-${randomUUID()}`,
      report: () => reportIdOf(Date.now(), randomBytes(10)),
    },
    clock: { nowIso: () => new Date().toISOString() },
  });
  overlays.onFeedbackEnded((draftRef) => feedback.ended(draftRef));
  registerFeedbackIpc(ctx.ipc, feedback);
  ctx.windowHooks.closed.push(({ ref }) => feedback.closeWindow(ref));
  return { stop: () => removeFeedbackIpc(ctx.ipc) };
}
