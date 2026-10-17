// [Report a problem]의 main 쪽.
// 버튼을 누른 desktop renderer가 view_session만 보내면 main이 그 시점의 view
// `{view_session, generation, app, release, mode, screen, observedAt}`를 고정하고 같은 창
// overlay에 dialog를 연다. 앱·release·화면은 renderer가 아니라 main이 정한다. 제보는 글만 보낸다.
// 원문 글·binding은 이 모듈의 메모리에만 있고 취소·창 닫힘에 버린다. 보내기는 core의
// `problem.submit_feedback` 입력으로 넘기는 adapter이고 shell의 새 command가 아니다.
import type { ZodType } from "zod";

import {
  FEEDBACK_BEGIN_CHANNEL,
  FEEDBACK_CANCEL_CHANNEL,
  FEEDBACK_OPEN_ISSUE_CHANNEL,
  FEEDBACK_SEND_CHANNEL,
  type FeedbackAccepted,
  feedbackBeginSchema,
  feedbackCancelSchema,
  type FeedbackProblem,
  type FeedbackReply,
  feedbackSendSchema,
} from "../../ipc/feedback.ts";
import {
  type CallerContents,
  checkCaller,
  checkInput,
  type ContentsRegistry,
  type IpcEvent,
} from "../desktop/ipc-guard.ts";
import type { FeedbackViewSnapshot } from "./view-model.ts";

/** 한 창의 overlay에서 feedback dialog를 다루는 handle. */
interface FeedbackDialog {
  open(draftRef: string, problems?: readonly FeedbackProblem[]): boolean;
  close(draftRef: string): void;
}

/** core `problem.submit_feedback` 입력(protocol/problems/problem-feedback.ts)과 같은 모양. */
interface SubmitFeedbackRequest {
  report_id: string;
  app: string;
  text: string;
  existing_problem: string | null;
  observed_at: string;
  view: {
    binding: string;
    name: string;
    app: string;
    release: string | null;
    mode: "live" | "preview";
    bundle_hash: string | null;
    diagnostic_scope: string | null;
    observed_at: string;
  };
}

interface FeedbackDeps {
  registry: ContentsRegistry;
  /** sender가 본문인 desktop 창. desktop 창이 아니면 undefined다. */
  windowOfShell(sender: CallerContents): string | undefined;
  /** sender가 overlay view인 창. overlay가 아니면 undefined다. */
  windowOfOverlay(sender: CallerContents): string | undefined;
  view(view_session: string): FeedbackViewSnapshot | undefined;
  dialog(window: string): FeedbackDialog | undefined;
  /** core `problem.submit_feedback`. */
  submit(
    input: SubmitFeedbackRequest,
  ): Promise<FeedbackReply<FeedbackAccepted>>;
  /** 그 앱의 열린 문제. 읽지 못하면 undefined이고 dialog는 고르기 없이 새 문제로만 보낸다. */
  problems(app: string): Promise<readonly FeedbackProblem[] | undefined>;
  /** 묶인 Issue로 간다. 그 창 renderer가 앱 공간을 연다. */
  openIssue(window: string, target: { app: string; problem: string }): void;
  /**
   * 이 Report ID가 이미 접수됐는지 읽는다(problems GetReport). 접수됐으면 그 결과, 없으면 null이고
   * 읽지 못하면 ok: false다. 응답을 잃은 제출을 다시 보내기 전에 쓴다.
   */
  lookup(report: string): Promise<
    | { ok: true; value: FeedbackAccepted | null }
    | { ok: false }
  >;
  ids: { draft(): string; report(): string };
  clock: { nowIso(): string };
}

interface Draft {
  draftRef: string;
  window: string;
  view: FeedbackViewSnapshot;
  observedAt: string;
  report: string;
  status: "draft" | "sending" | "accepted";
  accepted?: FeedbackAccepted;
  /** 보낸 뒤 접수 여부를 모르는 채 끝났다. 다시 보내기 전에 최신 상태를 읽는다. */
  unconfirmed: boolean;
}

const DESKTOP_HOST = "desktop";
const OVERLAY_HOST = "overlay";

function fail(
  code: "invalid_input" | "forbidden" | "conflict" | "unavailable",
  message: string,
): FeedbackReply<never> {
  return { ok: false, error: { code, message } };
}

export function createFeedback(deps: FeedbackDeps) {
  const drafts = new Map<string, Draft>();

  function overlayDraft(
    event: IpcEvent,
    draftRef: string,
  ): FeedbackReply<Draft> {
    const window = deps.windowOfOverlay(event.sender);
    const draft = drafts.get(draftRef);
    // 다른 창의 초안은 없는 초안과 같은 답이다.
    if (window === undefined) {
      return fail("forbidden", "caller is not a window overlay");
    }
    if (draft === undefined || draft.window !== window) {
      return fail("invalid_input", "draft is not open");
    }
    return { ok: true, value: draft };
  }

  function guard<T>(
    event: IpcEvent,
    host: string,
    schema: ZodType<T>,
    input: unknown,
  ): FeedbackReply<T> {
    const caller = checkCaller(deps.registry, event);
    if (!caller.ok) return caller;
    if (caller.value.origin.host !== host) {
      return fail("forbidden", "caller cannot use this feedback channel");
    }
    return checkInput(schema, input);
  }

  function request(draft: Draft, text: string, existing: string | null) {
    const view = draft.view;
    return {
      report_id: draft.report,
      app: view.app,
      text,
      existing_problem: existing,
      observed_at: draft.observedAt,
      view: {
        // 불투명한 메모리 참조다. 권한이 아니다.
        binding: `${view.view_session}#${view.generation}`,
        name: view.screen,
        app: view.app,
        release: view.release,
        mode: view.mode,
        bundle_hash: view.bundleHash,
        diagnostic_scope: view.mode === "live"
          ? null
          : `preview:${view.processNonce}`,
        observed_at: draft.observedAt,
      },
    } satisfies SubmitFeedbackRequest;
  }

  return {
    async begin(
      event: IpcEvent,
      input: unknown,
    ): Promise<FeedbackReply<{ draftRef: string }>> {
      const checked = guard(event, DESKTOP_HOST, feedbackBeginSchema, input);
      if (!checked.ok) return checked;
      const window = deps.windowOfShell(event.sender);
      if (window === undefined) {
        return fail("forbidden", "caller is not a desktop window");
      }
      // 다른 창의 view는 없는 view와 같은 답이다.
      const view = deps.view(checked.value.view_session);
      if (view === undefined || view.window !== window) {
        return fail("invalid_input", "view is not open");
      }
      const dialog = deps.dialog(window);
      if (dialog === undefined) return fail("unavailable", "overlay is gone");
      // core는 live view의 문제에만 덧붙인다. preview는 늘 새 문제다.
      const problems = view.mode === "live"
        ? await deps.problems(view.app)
        : undefined;
      if ([...drafts.values()].some((draft) => draft.window === window)) {
        return fail("conflict", "a report is already open in this window");
      }
      const draft: Draft = {
        draftRef: deps.ids.draft(),
        window,
        view,
        observedAt: deps.clock.nowIso(),
        report: deps.ids.report(),
        status: "draft",
        unconfirmed: false,
      };
      drafts.set(draft.draftRef, draft);
      if (!dialog.open(draft.draftRef, problems)) {
        drafts.delete(draft.draftRef);
        return fail("unavailable", "overlay is not available");
      }
      return { ok: true, value: { draftRef: draft.draftRef } };
    },

    async send(
      event: IpcEvent,
      input: unknown,
    ): Promise<FeedbackReply<FeedbackAccepted>> {
      const checked = guard(event, OVERLAY_HOST, feedbackSendSchema, input);
      if (!checked.ok) return checked;
      const found = overlayDraft(event, checked.value.draftRef);
      if (!found.ok) return found;
      const draft = found.value;
      // 이미 접수한 것은 같은 Report를 다시 돌려준다. 다시 보내지 않는다.
      if (draft.status === "accepted" && draft.accepted) {
        return { ok: true, value: draft.accepted };
      }
      if (draft.status === "sending") {
        return fail("conflict", "the report is being sent");
      }
      const { text, existing_problem } = checked.value;
      draft.status = "sending";
      // 응답을 잃어 접수 여부를 모르는 제출은 보내기 전에 최신 상태를 읽는다. 이미 접수됐으면 그
      // 결과를 돌려주고, 못 읽으면 보내지 않는다. 다시 보내도 같은 Report ID라 중복이 아니다.
      if (draft.unconfirmed) {
        const known = await deps.lookup(draft.report);
        if (drafts.get(draft.draftRef) !== draft) {
          return fail("unavailable", "the draft was closed");
        }
        if (!known.ok) {
          draft.status = "draft";
          return fail("unavailable", "the earlier submission is not confirmed");
        }
        if (known.value !== null) {
          draft.status = "accepted";
          draft.accepted = known.value;
          draft.unconfirmed = false;
          return { ok: true, value: known.value };
        }
      }
      let reply: FeedbackReply<FeedbackAccepted>;
      try {
        reply = await deps.submit(
          request(draft, text, existing_problem),
        );
      } catch {
        reply = fail("unavailable", "report transport failed");
      }
      if (drafts.get(draft.draftRef) !== draft) {
        // 그 사이 창·overlay가 닫혔다. 접수된 Report는 그대로 남는다.
        return reply;
      }
      if (reply.ok) {
        draft.status = "accepted";
        draft.accepted = reply.value;
        draft.unconfirmed = false;
      } else {
        draft.status = "draft";
        // 입력·권한 거절은 접수되지 않은 것이다. 그 밖의 실패는 접수됐을 수 있다. conflict는 같은
        // Report ID가 이미 다른 내용으로 접수됐다는 뜻이라 읽어서 그 접수를 돌려받는다.
        draft.unconfirmed = reply.error.code !== "invalid_input" &&
          reply.error.code !== "forbidden";
      }
      return reply;
    },

    /** 미제출 초안은 버린다. 이미 접수한 Report는 지우지 않는다. */
    cancel(event: IpcEvent, input: unknown): FeedbackReply<null> {
      const checked = guard(event, OVERLAY_HOST, feedbackCancelSchema, input);
      if (!checked.ok) return checked;
      const found = overlayDraft(event, checked.value.draftRef);
      if (!found.ok) return found;
      drafts.delete(found.value.draftRef);
      deps.dialog(found.value.window)?.close(found.value.draftRef);
      return { ok: true, value: null };
    },

    /** 접수 뒤 묶인 Issue로 간다. */
    openIssue(event: IpcEvent, input: unknown): FeedbackReply<null> {
      const checked = guard(event, OVERLAY_HOST, feedbackCancelSchema, input);
      if (!checked.ok) return checked;
      const found = overlayDraft(event, checked.value.draftRef);
      if (!found.ok) return found;
      const draft = found.value;
      const problem = draft.accepted?.problem ?? null;
      if (draft.status !== "accepted" || problem === null) {
        return fail("invalid_input", "the report has no issue yet");
      }
      drafts.delete(draft.draftRef);
      deps.dialog(draft.window)?.close(draft.draftRef);
      deps.openIssue(draft.window, { app: draft.view.app, problem });
      return { ok: true, value: null };
    },

    /** overlay crash 등으로 dialog가 feedback 통로 밖에서 닫혔다. 초안을 버린다. */
    ended(draftRef: string): void {
      drafts.delete(draftRef);
    },

    closeWindow(window: string): void {
      for (const draft of [...drafts.values()]) {
        if (draft.window === window) drafts.delete(draft.draftRef);
      }
    },

    /** 테스트가 메모리에 남은 초안 수를 본다. */
    get size(): number {
      return drafts.size;
    },
  };
}

type FeedbackService = ReturnType<typeof createFeedback>;

interface FeedbackIpcMain {
  handle(
    channel: string,
    listener: (event: IpcEvent, input: unknown) => Promise<unknown> | unknown,
  ): void;
  removeHandler(channel: string): void;
}

const CHANNELS = [
  [FEEDBACK_BEGIN_CHANNEL, "begin"],
  [FEEDBACK_SEND_CHANNEL, "send"],
  [FEEDBACK_CANCEL_CHANNEL, "cancel"],
  [FEEDBACK_OPEN_ISSUE_CHANNEL, "openIssue"],
] as const;

export function registerFeedbackIpc(
  ipc: FeedbackIpcMain,
  feedback: FeedbackService,
): void {
  for (const [channel, method] of CHANNELS) {
    ipc.handle(channel, (event, input) => feedback[method](event, input));
  }
}

export function removeFeedbackIpc(
  ipc: Pick<FeedbackIpcMain, "removeHandler">,
): void {
  for (const [channel] of CHANNELS) ipc.removeHandler(channel);
}
