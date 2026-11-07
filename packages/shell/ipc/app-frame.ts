// shell renderer와 main 사이 앱 view 경계.
// main tsc는 protocol package를 보지 않으므로 같은 모양을 여기 둔다.
// view ID는 main이 만든 메모리 식별이다.
import { z } from "zod";

const ULID = "[0-7][0-9a-hjkmnp-tv-z]{25}";
const appId = z.string().regex(new RegExp(`^app_${ULID}$`));
const releaseId = z.string().regex(new RegExp(`^rel_${ULID}$`));
const noControl = (value: string) => !/\p{Cc}/u.test(value);
const viewSession = z.string().min(1).refine(noControl);
const screenKey = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0 && noControl(value));
const mode = z.enum(["live", "preview"]);
const place = z.enum(["tab", "panel", "card", "sidebar", "tray"]);

export const VIEW_OPEN_APP_CHANNEL = "shell:view-open-app";
export const VIEW_BOUNDS_CHANNEL = "shell:view-bounds";
export const VIEWS_HIDDEN_CHANNEL = "shell:views-hidden";
export const VIEW_CLOSE_CHANNEL = "shell:view-close";
export const VIEW_REOPEN_CHANNEL = "shell:view-reopen";
export const VIEW_STATE_CHANNEL = "shell:view-state";

// 창 본문 경계 안의 정수 rectangle. renderer는 CSS pixel로 보내고 main이 창 DIP로 바꾼다.
const viewBoundsSchema = z
  .object({
    x: z.number().int(),
    y: z.number().int(),
    width: z.number().int().min(0),
    height: z.number().int().min(0),
  })
  .strict();

// 세션 앱 카드의 message·block 표시 참조. 카드만 싣는다.
const appViewCardSchema = z
  .object({
    message: z.string().regex(new RegExp(`^msg_${ULID}$`)),
    block: z.string().regex(/^[a-z0-9_-]{1,64}$/),
  })
  .strict();

// 화면이 열린 workspace. 화면이 자기 workspace를 보고 맞춘다.
const placeWorkspaceSchema = z
  .object({
    kind: z.enum(["project", "home", "app"]),
    id: z.string().min(1),
    folders: z.array(z.string()),
  })
  .strict();

export const appViewOpenSchema = z
  .object({
    app: appId,
    mode,
    release: releaseId.optional(),
    screen: screenKey,
    place,
    // 그 화면 선언의 params schema로 main이 다시 검사한다.
    params: z.record(z.string(), z.json()).optional(),
    workspace: placeWorkspaceSchema.optional(),
    card: appViewCardSchema.optional(),
  })
  .strict()
  .refine((value) => (value.place === "card") === (value.card !== undefined));

export const viewBoundsRequestSchema = z
  .object({
    view_session: viewSession,
    bounds: viewBoundsSchema,
    layer: z.number().int().min(0).max(32).optional(), // 없으면 0 = pane view. 1.. = floated view(floats 배열 index + 1). 클수록 위.
  })
  .strict();

export const viewsHiddenSchema = z
  .object({
    view_sessions: z.array(viewSession).min(1),
  })
  .strict();

export const viewCloseRequestSchema = z
  .object({
    view_session: viewSession,
  })
  .strict();

export const appFrameViewStateSchema = z
  .object({
    view_session: viewSession,
    app: appId,
    release: releaseId.nullable(),
    mode,
    screen: screenKey,
    place,
    // renderer가 <webview src>에 그대로 넣는 주소. main이 붙일 화면을 새로 만들 때마다
    // (열기, release 바뀜, crash 뒤 다시 열기) 새 src를 낸다.
    src: z.string(),
    connectionState: z.enum(["preparing", "stopped", "running", "unavailable"]),
    // 화면 process 상태. main은 늘 싣고, 없으면 ok로 읽는다. 깨진 view만
    // [새 view 열기]를 받는다.
    viewHealth: z.enum(["ok", "unresponsive", "crashed"]).optional(),
  })
  .refine((value) => value.mode === "preview" || value.release !== null);

export type AppViewOpen = z.infer<typeof appViewOpenSchema>;
type ViewBoundsRequest = z.infer<typeof viewBoundsRequestSchema>;
type ViewsHidden = z.infer<typeof viewsHiddenSchema>;
type ViewCloseRequest = z.infer<typeof viewCloseRequestSchema>;
export type AppFrameViewState = z.infer<typeof appFrameViewStateSchema>;
export type VisibilityResult = { generation: number };

type ViewErrorCode = "invalid_input" | "forbidden" | "conflict" | "unavailable";

/** main이 IPC로 돌려주는 모양. preload가 contract 모양(값 또는 거절)으로 바꾼다. */
export type ViewReply<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: ViewErrorCode; message: string } };

/**
 * shell preload의 view API. 실패는 code 하나를
 * message로 싣은 Error로 거절한다. `subscribeViewState`는 `shell:view-state` push를 받는다.
 * 앱 화면·artifact 화면은 `<webview>`라 `src`가 위치·보임을 정한다. bounds·hidden은 browser의
 * 크기 준 popup·DevTools native view만 쓴다.
 */
export interface LophnShellViewsApi {
  openApp(input: AppViewOpen): Promise<AppFrameViewState>;
  /** browser native popup·DevTools의 자리. 앱·artifact view는 부르지 않는다. */
  setViewBounds(input: ViewBoundsRequest): Promise<VisibilityResult>;
  /** browser native popup·DevTools를 숨긴다. 앱·artifact view는 부르지 않는다. */
  setViewsHidden(input: ViewsHidden): Promise<VisibilityResult>;
  /** 앱 view·artifact view를 폐기한다. */
  closeView(input: ViewCloseRequest): Promise<void>;
  /** crash·멈춘 view를 지금 연결로 새로 연다. 건강한 view는 conflict다. */
  reopenView(input: ViewCloseRequest): Promise<AppFrameViewState>;
  subscribeViewState(listener: (state: AppFrameViewState) => void): () => void;
}
