// [Report a problem]의 main 쪽(shell/app-frame#R31, R32, R34, problems/feedback#R5, R6, R10–R13).
// 버튼을 누른 desktop renderer가 view_session만 보내면 main이 그 시점의 view
// `{view_session, generation, app, release, mode, screen, observedAt}`를 고정하고, 그 앱 view의
// 캡처를 먼저 요청한 뒤 같은 창 overlay에 dialog를 연다. 앱 view는 숨기지 않는다. 보호 창·lophn
// dialog가 떠 있거나 view가 숨겨졌으면 캡처하지 않고 이유만 남긴다. 캡처는 1,500ms까지 기다리고
// 늦거나 그 사이 view가 바뀌면 버린다. 원문 글·binding·raw PNG는 이 모듈의 메모리에만 있고
// 취소·창 닫힘에 버린다(architecture/shell 5.2). 제출은 problems의 `SubmitFeedback` 원자료로
// 넘기는 adapter이고 shell의 새 command가 아니다.
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import type { ZodType } from "zod";

import {
  FEEDBACK_BEGIN_CHANNEL,
  FEEDBACK_CANCEL_CHANNEL,
  FEEDBACK_CAPTURE_MS,
  FEEDBACK_LIMITS,
  FEEDBACK_OPEN_ISSUE_CHANNEL,
  FEEDBACK_SUBMIT_CHANNEL,
  type FeedbackAccepted,
  feedbackBeginSchema,
  feedbackCancelSchema,
  type FeedbackCaptureBlock,
  type FeedbackPreview,
  type FeedbackReply,
  type FeedbackSelection,
  feedbackSubmitSchema,
} from "../../ipc/feedback.ts";
import {
  type CallerContents,
  checkCaller,
  checkInput,
  type ContentsRegistry,
  type IpcEvent,
} from "../desktop/ipc-guard.ts";
import type { FeedbackViewSnapshot } from "./view-model.ts";

/** 한 창의 overlay에서 feedback dialog를 다루는 자리. */
export interface FeedbackDialog {
  open(draftRef: string): boolean;
  close(draftRef: string): void;
  preview(preview: FeedbackPreview): void;
  /** lophn dialog·sheet가 이미 떠 있다. */
  dialogOpen(): boolean;
}

/**
 * problems `SubmitFeedback` 입력(contracts/problems/feedback.ts submitFeedbackInputSchema)과 같은
 * 모양. main tsc는 contracts를 보지 않는다. feedback_test.ts가 contracts schema로 검사한다.
 */
export interface SubmitFeedbackRequest {
  report_id: string;
  app: string;
  text: string;
  existing_problem: string | null;
  observed_at: string;
  selection: FeedbackSelection;
  view: {
    binding: string;
    name: string;
    app: string;
    release: string | null;
    mode: "live" | "preview";
    bundle_hash: string | null;
    diagnostic_scope: string | null;
    observed_at: string;
    capture: FeedbackCaptureBlock | null;
    final_screenshot_hash: string | null;
  };
  facts: {
    tab: string | null;
    url: string | null;
    inputs: { name: string; value: unknown }[];
  } | null;
  targets: {
    invocation: string | null;
    automation: string | null;
    version: string | null;
    command_start: "started" | "blocked_before_start" | "unknown";
  };
  screenshot: { size_bytes: number } | null;
}

export interface FeedbackDeps {
  registry: ContentsRegistry;
  /** sender가 본문인 desktop 창. desktop 창이 아니면 undefined다. */
  windowOfShell(sender: CallerContents): string | undefined;
  /** sender가 overlay view인 창. overlay가 아니면 undefined다. */
  windowOfOverlay(sender: CallerContents): string | undefined;
  view(view_session: string): FeedbackViewSnapshot | undefined;
  dialog(window: string): FeedbackDialog | undefined;
  /** 그 창에 child modal confirmation window가 떠 있다. */
  protectedWindow(window: string): boolean;
  /** problems `POST /v1/problems/submit-feedback`. PNG는 고른 경우에만 byte channel로 간다. */
  submit(
    input: SubmitFeedbackRequest,
    screenshot: Uint8Array | null,
  ): Promise<FeedbackReply<FeedbackAccepted>>;
  /** 묶인 Issue로 간다. 그 창 renderer가 앱 공간을 연다. */
  openIssue(window: string, target: { app: string; problem: string }): void;
  /**
   * 그 view의 마지막 앱 호출이 입력 검사 등으로 시작되지 못했으면 `blocked_before_start`다
   * (problems/feedback#R4). 없으면 모른다.
   */
  commandStart?(view_session: string): "blocked_before_start" | "unknown";
  /**
   * 이 Report ID가 이미 접수됐는지 읽는다(problems GetReport). 접수됐으면 그 결과, 없으면 null이고
   * 읽지 못하면 ok: false다. 응답을 잃은 제출을 다시 보내기 전에 쓴다(problems/reporting#R9).
   */
  lookup(report: string): Promise<
    | { ok: true; value: FeedbackAccepted | null }
    | { ok: false }
  >;
  ids: { draft(): string; report(): string };
  clock: { nowIso(): string };
  timer: {
    set(callback: () => void, ms: number): unknown;
    clear(handle: unknown): void;
  };
}

type Shot =
  | { state: "pending" }
  | { state: "ready"; png: Uint8Array; hash: string }
  | { state: "blocked"; block: FeedbackCaptureBlock };

interface Draft {
  draftRef: string;
  window: string;
  view: FeedbackViewSnapshot;
  observedAt: string;
  report: string;
  facts: NonNullable<SubmitFeedbackRequest["facts"]>;
  screenHash: string;
  shot: Shot;
  status: "draft" | "sending" | "accepted";
  accepted?: FeedbackAccepted;
  /** 버튼 시점에 고정한 시작 여부. 제출 시점의 새 호출로 바꾸지 않는다. */
  commandStart: "blocked_before_start" | "unknown";
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

function sha256(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

// URL은 path만 남긴다. query 값과 fragment는 화면 상태로 보내지 않는다(problems/feedback#R7).
function pathOf(url: string | null): string | null {
  if (url === null) return null;
  try {
    return new URL(url).pathname || null;
  } catch {
    return null;
  }
}

export function createFeedback(deps: FeedbackDeps) {
  const drafts = new Map<string, Draft>();

  function preview(draft: Draft): FeedbackPreview {
    const shot = draft.shot;
    return {
      draftRef: draft.draftRef,
      text: null,
      screen: draft.screenHash,
      screen_missing_reason: null,
      screenshot: shot.state === "ready" ? shot.hash : null,
      screenshot_png: shot.state === "ready"
        ? `data:image/png;base64,${Buffer.from(shot.png).toString("base64")}`
        : null,
      screenshot_block: shot.state === "ready"
        ? null
        : shot.state === "pending"
        ? "pending"
        : shot.block,
      screen_summary: { name: draft.view.screen, path: draft.facts.url },
    };
  }

  function push(draft: Draft): void {
    if (drafts.get(draft.draftRef) !== draft) return;
    deps.dialog(draft.window)?.preview(preview(draft));
  }

  // 캡처는 1,500ms까지만 기다린다. 늦은 결과·그 사이 바뀐 view·한도를 넘는 PNG는 버린다.
  function settle(draft: Draft, capture: Promise<Uint8Array>): void {
    let handle: unknown;
    const timeout = new Promise<"timeout">((resolve) => {
      handle = deps.timer.set(() => resolve("timeout"), FEEDBACK_CAPTURE_MS);
    });
    void Promise.race([capture, timeout]).then(
      (result) => result,
      () => "failed" as const,
    ).then((result) => {
      deps.timer.clear(handle);
      if (drafts.get(draft.draftRef) !== draft) return;
      if (draft.shot.state !== "pending") return;
      if (
        typeof result === "string" || !draft.view.current() ||
        result.length === 0 || result.length > FEEDBACK_LIMITS.png_bytes
      ) {
        draft.shot = { state: "blocked", block: "capture_failed" };
      } else {
        draft.shot = { state: "ready", png: result, hash: sha256(result) };
      }
      push(draft);
    });
  }

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

  function request(
    draft: Draft,
    text: string,
    selection: FeedbackSelection,
  ): SubmitFeedbackRequest {
    const view = draft.view;
    const shot = draft.shot;
    const attach = selection.screenshot && shot.state === "ready";
    return {
      report_id: draft.report,
      app: view.app,
      text,
      existing_problem: null,
      observed_at: draft.observedAt,
      selection,
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
        // 제출까지 이미지가 오지 않았으면 얻지 못한 것이다.
        capture: shot.state === "ready"
          ? null
          : shot.state === "pending"
          ? "capture_failed"
          : shot.block,
        final_screenshot_hash: attach ? shot.hash : null,
      },
      facts: selection.screen ? draft.facts : null,
      targets: {
        invocation: null,
        automation: null,
        version: null,
        command_start: draft.commandStart,
      },
      screenshot: attach ? { size_bytes: shot.png.length } : null,
    };
  }

  return {
    begin(
      event: IpcEvent,
      input: unknown,
    ): FeedbackReply<{ draftRef: string }> {
      const checked = guard(event, DESKTOP_HOST, feedbackBeginSchema, input);
      if (!checked.ok) return checked;
      const window = deps.windowOfShell(event.sender);
      if (window === undefined) {
        return fail("forbidden", "caller is not a desktop window");
      }
      // 다른 창의 view는 없는 view와 같은 답이다. 그 창은 캡처하지 않는다.
      const view = deps.view(checked.value.view_session);
      if (view === undefined || view.window !== window) {
        return fail("invalid_input", "view is not open");
      }
      const dialog = deps.dialog(window);
      if (dialog === undefined) return fail("unavailable", "overlay is gone");
      if ([...drafts.values()].some((draft) => draft.window === window)) {
        return fail("conflict", "a report is already open in this window");
      }
      // 캡처 여부는 dialog를 열기 전 화면으로 정한다.
      const block: FeedbackCaptureBlock | null =
        deps.protectedWindow(window) || dialog.dialogOpen()
          ? "protected_window"
          : view.visible
          ? null
          : "hidden";
      const capture = block === null ? view.capture() : null;
      capture?.catch(() => {});
      const path = pathOf(view.url);
      const facts = { tab: null, url: path, inputs: [] };
      const draft: Draft = {
        draftRef: deps.ids.draft(),
        window,
        view,
        observedAt: deps.clock.nowIso(),
        report: deps.ids.report(),
        facts,
        screenHash: sha256(JSON.stringify({ name: view.screen, ...facts })),
        shot: block === null
          ? { state: "pending" }
          : { state: "blocked", block },
        status: "draft",
        commandStart: deps.commandStart?.(view.view_session) ?? "unknown",
        unconfirmed: false,
      };
      drafts.set(draft.draftRef, draft);
      if (!dialog.open(draft.draftRef)) {
        drafts.delete(draft.draftRef);
        return fail("unavailable", "overlay is not available");
      }
      push(draft);
      if (capture !== null) settle(draft, capture);
      return { ok: true, value: { draftRef: draft.draftRef } };
    },

    async submit(
      event: IpcEvent,
      input: unknown,
    ): Promise<FeedbackReply<FeedbackAccepted>> {
      const checked = guard(event, OVERLAY_HOST, feedbackSubmitSchema, input);
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
      const { text, selection } = checked.value;
      if (selection.screenshot && draft.shot.state !== "ready") {
        return fail("invalid_input", "there is no screenshot to attach");
      }
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
      const body = request(draft, text, selection);
      const png = body.screenshot !== null && draft.shot.state === "ready"
        ? draft.shot.png
        : null;
      let reply: FeedbackReply<FeedbackAccepted>;
      try {
        reply = await deps.submit(body, png);
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

    /** 미제출 초안은 버린다. 이미 접수한 Report는 지우지 않는다(problems/feedback#R12). */
    cancel(event: IpcEvent, input: unknown): FeedbackReply<null> {
      const checked = guard(event, OVERLAY_HOST, feedbackCancelSchema, input);
      if (!checked.ok) return checked;
      const found = overlayDraft(event, checked.value.draftRef);
      if (!found.ok) return found;
      drafts.delete(found.value.draftRef);
      deps.dialog(found.value.window)?.close(found.value.draftRef);
      return { ok: true, value: null };
    },

    /** 접수 뒤 묶인 Issue로 간다(problems/feedback#R13). */
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

export type FeedbackService = ReturnType<typeof createFeedback>;

export interface FeedbackIpcMain {
  handle(
    channel: string,
    listener: (event: IpcEvent, input: unknown) => Promise<unknown> | unknown,
  ): void;
  removeHandler(channel: string): void;
}

const CHANNELS = [
  [FEEDBACK_BEGIN_CHANNEL, "begin"],
  [FEEDBACK_SUBMIT_CHANNEL, "submit"],
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
