// 앱 화면 annotation의 shell IPC. renderer ↔ main, 앱 view preload ↔ main 두 통로가 같이 import한다.
// main tsc는 protocol을 보지 않으므로 값 모양은 protocol/apps/annotation.ts의 사본이다(app-frame.ts와 같은 이유).
// 신원(앱, release, 화면)은 sender view가 정한다. 페이지 주장은 쓰지 않는다.
import { z } from "zod";

const noControl = (value: string) => !/\p{Cc}/u.test(value);
const viewSession = z.string().min(1).refine(noControl);
const sessionId = z.string().regex(/^ses_[0-7][0-9a-hjkmnp-tv-z]{25}$/);
const kind = z.enum(["element", "region"]);
const elementText = z.string().max(200).nullable();

// renderer ↔ main
export const ANNOTATE_MODE_CHANNEL = "shell:annotate-mode";
export const ANNOTATE_REMOVE_CHANNEL = "shell:annotate-remove";
export const ANNOTATE_SEND_CHANNEL = "shell:annotate-send";
export const ANNOTATE_STATE_CHANNEL = "shell:annotate-state";

export const annotateModeRequestSchema = z.strictObject({
  view_session: viewSession,
  on: z.boolean(),
});
export const annotateRemoveRequestSchema = z.strictObject({
  view_session: viewSession,
  n: z.union([z.number().int().min(1), z.literal("all")]),
});
// session은 앱 공간 agent pane에 열린 그 앱 project의 Project Manager의 session이다. 없으면 null.
export const annotateSendRequestSchema = z.strictObject({
  view_session: viewSession,
  session: sessionId.nullable(),
});

// label은 component 이름, 없으면 role과 접근 이름이다(모은 목록 panel이 그린다).
export const annotateStateSchema = z.strictObject({
  view_session: viewSession,
  on: z.boolean(),
  phase: z.enum(["idle", "sending"]),
  items: z.array(z.strictObject({
    n: z.number().int().min(1),
    kind,
    note: z.string(),
    label: z.string(),
  })),
});

// "N annotations sent" toast의 재료.
const annotateSendResultSchema = z.strictObject({
  sent: z.number().int().min(1),
  session: sessionId,
});

type AnnotateModeRequest = z.infer<typeof annotateModeRequestSchema>;
type AnnotateRemoveRequest = z.infer<typeof annotateRemoveRequestSchema>;
type AnnotateSendRequest = z.infer<typeof annotateSendRequestSchema>;
export type AnnotateState = z.infer<typeof annotateStateSchema>;
export type AnnotateSendResult = z.infer<typeof annotateSendResultSchema>;

export type AnnotateErrorCode =
  | "invalid_input"
  | "forbidden"
  | "conflict"
  | "unavailable";

/** main이 IPC로 돌려주는 모양(`ViewReply`와 같다). preload가 값 또는 거절로 바꾼다. */
export type AnnotateReply<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: AnnotateErrorCode; message: string } };

/** shell preload의 annotation API. 실패는 code를 message로 싣은 Error로 거절한다. */
export interface LophnShellAnnotateApi {
  setMode(input: AnnotateModeRequest): Promise<AnnotateState>;
  remove(input: AnnotateRemoveRequest): Promise<AnnotateState>;
  send(input: AnnotateSendRequest): Promise<AnnotateSendResult>;
  subscribeState(listener: (state: AnnotateState) => void): () => void;
}

// artifact는 domain의 artifacts 폴더 안 이름이고, file은 사람의 폴더에 있는 .html(그 project)이다.
export type AnnotateTarget =
  | { kind: "app"; app: string; release: string | null; screen: string }
  | { kind: "artifact"; domain: string; name: string }
  | { kind: "file"; project: string };

/**
 * main 안의 view 쪽 port(type만). 구현은 view registry가
 * `annotateView(view_session)`과 `senderAnnotateView(contentsId)`로 내놓는다.
 */
export type AnnotateViewPort = {
  view_session: string;
  target: AnnotateTarget;
  pageUrl(): string | null;
  current(): boolean;
  /** 그 view의 페이지로 보낸다(`webContents.send`). */
  send(channel: string, payload: unknown): void;
  /** view의 PNG byte. */
  capture(): Promise<Uint8Array>;
};

// 앱 view의 preload ↔ main
// main → page
export const ANNOTATE_PAGE_SET_MODE = "annotate:set-mode";
export const ANNOTATE_PAGE_REMOVE = "annotate:remove";
// 그 annotation의 윤곽과 번호 표지를 그린다.
export const ANNOTATE_PAGE_PREPARE_CAPTURE = "annotate:prepare-capture";
export const ANNOTATE_PAGE_CLEAR_CAPTURE = "annotate:clear-capture";
// page → main
export const ANNOTATE_PAGE_ITEMS = "annotate:items";
export const ANNOTATE_PAGE_EXIT = "annotate:exit";
export const ANNOTATE_PAGE_CAPTURE_READY = "annotate:capture-ready";

export const annotatePageSetModeSchema = z.strictObject({ on: z.boolean() });
export const annotatePageRemoveSchema = z.strictObject({
  n: z.union([z.number().int().min(1), z.literal("all")]),
});
export const annotatePagePrepareCaptureSchema = z.strictObject({
  n: z.number().int().min(1),
});

const pickedItemSchema = z.strictObject({
  n: z.number().int().min(1),
  kind,
  note: z.string().max(2000),
  component: z.string().nullable(),
  element: z.strictObject({
    role: elementText,
    name: elementText,
    text: elementText,
  }),
  rect: z.strictObject({
    x_ratio: z.number().min(0).max(1),
    width_ratio: z.number().min(0).max(1),
    y_px: z.number(),
    height_px: z.number(),
    scroll_x: z.number(),
    scroll_y: z.number(),
  }),
  path: z.string().max(512),
});
// 목록이 바뀔 때마다 전체를 보낸다.
export const annotatePageItemsSchema = z.strictObject({
  items: z.array(pickedItemSchema),
});
// 표지를 그린 뒤 자를 범위(고른 사각형과 표지를 합친 것에 둘레 여백, viewport CSS px).
export const annotatePageCaptureReadySchema = z.strictObject({
  n: z.number().int().min(1),
  crop: z.strictObject({
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
  }),
  // crop이 viewport CSS px라 PNG px로 바꾸는 데 쓴다.
  viewport: z.strictObject({
    width: z.number().positive(),
    height: z.number().positive(),
  }),
});

export type PickedItem = z.infer<typeof pickedItemSchema>;
export type AnnotatePageCaptureReady = z.infer<
  typeof annotatePageCaptureReadySchema
>;
