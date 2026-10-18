// shell renderer와 main 사이 앱 view 경계.
// main tsc는 protocol package를 보지 않으므로 같은 모양을 여기 둔다.
// view ID는 main이 만든 메모리 식별이다.
import { z } from "zod";

const ULID = "[0-7][0-9a-hjkmnp-tv-z]{25}";
const appId = z.string().regex(new RegExp(`^app_${ULID}$`));
const releaseId = z.string().regex(new RegExp(`^rel_${ULID}$`));
const projectId = z.string().regex(new RegExp(`^prj_${ULID}$`));
const noControl = (value: string) => !/\p{Cc}/u.test(value);
const viewSession = z.string().min(1).refine(noControl);
const screenKey = z.string().min(1).refine((value) =>
  value.trim().length > 0 && noControl(value)
);
const mode = z.enum(["live", "preview"]);
const size = z.enum(["full", "panel", "card"]);

export const VIEW_OPEN_APP_CHANNEL = "shell:view-open-app";
export const VIEW_BOUNDS_CHANNEL = "shell:view-bounds";
export const VIEW_PROJECT_CHANNEL = "shell:view-project";
export const VIEWS_HIDDEN_CHANNEL = "shell:views-hidden";
export const VIEW_CLOSE_CHANNEL = "shell:view-close";
export const VIEW_REOPEN_CHANNEL = "shell:view-reopen";
export const VIEW_STATE_CHANNEL = "shell:view-state";

// 창 본문 경계 안의 정수 rectangle. renderer는 CSS pixel로 보내고 main이 창 DIP로 바꾼다.
const viewBoundsSchema = z.object({
  x: z.number().int(),
  y: z.number().int(),
  width: z.number().int().min(0),
  height: z.number().int().min(0),
}).strict();

// 세션 앱 카드의 message·block 표시 참조. 카드만 싣는다.
const appViewCardSchema = z.object({
  message: z.string().regex(new RegExp(`^msg_${ULID}$`)),
  block: z.string().regex(/^[a-z0-9_-]{1,64}$/),
}).strict();

export const appViewOpenSchema = z.object({
  app: appId,
  mode,
  release: releaseId.optional(),
  screen: screenKey,
  size,
  card: appViewCardSchema.optional(),
  project: projectId.optional(),
}).strict().refine(
  (value) => (value.size === "card") === (value.card !== undefined),
);

export const viewBoundsRequestSchema = z.object({
  view_session: viewSession,
  bounds: viewBoundsSchema,
  layer: z.number().int().min(0).max(32).optional(), // 없으면 0 = pane view. 1.. = floated view(floats 배열 index + 1). 클수록 위.
}).strict();

// 앱 place의 앱 화면이 project를 고르면 main에 알린다. null은 project에서 푼다.
export const viewProjectRequestSchema = z.object({
  view_session: viewSession,
  project: projectId.nullable(),
}).strict();

export const viewsHiddenSchema = z.object({
  view_sessions: z.array(viewSession).min(1),
}).strict();

export const viewCloseRequestSchema = z.object({
  view_session: viewSession,
}).strict();

export const appFrameViewStateSchema = z.object({
  view_session: viewSession,
  app: appId,
  release: releaseId.nullable(),
  mode,
  screen: screenKey,
  size,
  connectionState: z.enum(["preparing", "stopped", "running", "unavailable"]),
  project: projectId.nullable(),
  // 화면 process 상태. main은 늘 싣고, 없으면 ok로 읽는다. 깨진 view만
  // [새 view 열기]를 받는다.
  viewHealth: z.enum(["ok", "unresponsive", "crashed"]).optional(),
}).refine((value) => value.mode === "preview" || value.release !== null);

export type AppViewOpen = z.infer<typeof appViewOpenSchema>;
type ViewBoundsRequest = z.infer<typeof viewBoundsRequestSchema>;
type ViewProjectRequest = z.infer<typeof viewProjectRequestSchema>;
type ViewsHidden = z.infer<typeof viewsHiddenSchema>;
type ViewCloseRequest = z.infer<typeof viewCloseRequestSchema>;
export type AppFrameViewState = z.infer<typeof appFrameViewStateSchema>;
export type VisibilityResult = { generation: number };

type ViewErrorCode =
  | "invalid_input"
  | "forbidden"
  | "conflict"
  | "unavailable";

/** main이 IPC로 돌려주는 모양. preload가 contract 모양(값 또는 거절)으로 바꾼다. */
export type ViewReply<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: ViewErrorCode; message: string } };

/**
 * shell preload의 view API(LophnShellViewsApi 중 앱 view). 실패는 code 하나를
 * message로 싣은 Error로 거절한다. `subscribeViewState`는 `shell:view-state` push를 받는다.
 */
export interface LophnShellViewsApi {
  openApp(input: AppViewOpen): Promise<AppFrameViewState>;
  setViewBounds(input: ViewBoundsRequest): Promise<VisibilityResult>;
  /** 같은 view_session의 view를 그 project에 묶는다. 바뀐 state가 push된다. */
  setViewProject(input: ViewProjectRequest): Promise<AppFrameViewState>;
  setViewsHidden(input: ViewsHidden): Promise<VisibilityResult>;
  closeView(input: ViewCloseRequest): Promise<void>;
  /** crash·멈춘 view를 지금 연결로 새로 연다. 건강한 view는 conflict다. */
  reopenView(input: ViewCloseRequest): Promise<AppFrameViewState>;
  subscribeViewState(listener: (state: AppFrameViewState) => void): () => void;
}
