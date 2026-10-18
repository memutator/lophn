// shell renderer와 main 사이 browser 탭 경계.
// main·preload·renderer가 함께 부르므로 import는 zod뿐이다.
// view의 bounds·숨기기·폐기는 app-frame.ts의 shell:view-bounds, shell:views-hidden,
// shell:view-close를 그대로 쓴다.
import { z } from "zod";

const noControl = (value: string) => !/\p{Cc}/u.test(value);
// app-frame.ts의 viewSession과 같은 규칙.
const viewSession = z.string().min(1).refine(noControl);
const address = z.string().max(8192);
const bookmarkTitle = z.string().max(200);
const bookmarkId = z.string().min(1).max(128);
// page favicon. shell CSP가 img-src data:만 받으므로 main이 받아 data URL로 바꾼 것만 싣는다.
const favicon = z.string().max(65536).startsWith("data:image/");

export const BROWSER_ADOPT_CHANNEL = "shell:browser-adopt";
export const BROWSER_NAVIGATE_CHANNEL = "shell:browser-navigate";
export const BROWSER_COMMAND_CHANNEL = "shell:browser-command";
export const BROWSER_CLEAR_DATA_CHANNEL = "shell:browser-clear-data";
// DevTools는 page에 붙인 native view 하나다. 위치는 shell:view-bounds로 온다.
export const BROWSER_DEVTOOLS_OPEN_CHANNEL = "shell:browser-devtools-open";
export const BROWSER_DEVTOOLS_CLOSE_CHANNEL = "shell:browser-devtools-close";
export const BROWSER_DEVTOOLS_WINDOW_CHANNEL = "shell:browser-devtools-window";
export const BOOKMARKS_LIST_CHANNEL = "shell:bookmarks-list";
export const BOOKMARKS_ADD_CHANNEL = "shell:bookmarks-add";
export const BOOKMARKS_UPDATE_CHANNEL = "shell:bookmarks-update";
export const BOOKMARKS_REMOVE_CHANNEL = "shell:bookmarks-remove";
// main → renderer push.
export const BROWSER_STATE_CHANNEL = "shell:browser-state";
export const BROWSER_EVENT_CHANNEL = "shell:browser-event";
// payload 없음. 받은 쪽이 목록을 다시 읽는다.
export const BOOKMARKS_CHANGED_CHANNEL = "shell:bookmarks-changed";

// popup으로 생긴 view를 이 탭이 가져온다.
export const browserAdoptSchema = z.object({ view_session: viewSession })
  .strict();

// 주소 칸에 적은 글 그대로. 정리(https:// 붙이기)와 거절은 main이 한다.
export const browserNavigateSchema = z.object({
  view_session: viewSession,
  input: address,
}).strict();

// 그 page의 DevTools를 연다. 이미 열려 있으면 conflict다. 답은 DevTools view의 session이다.
export const browserDevtoolsOpenSchema = z.object({ view_session: viewSession })
  .strict();

export const browserDevtoolsCloseSchema = z.object({
  devtools_session: viewSession,
}).strict();

// true면 DevTools view를 따로 뜬 OS 창으로 옮기고, false면 project 창으로 되돌린다. 연결은 끊기지 않는다.
export const browserDevtoolsWindowSchema = z.object({
  devtools_session: viewSession,
  window: z.boolean(),
}).strict();

export const browserCommandSchema = z.object({
  view_session: viewSession,
  command: z.enum(["back", "forward", "reload"]),
}).strict();

export const bookmarkAddSchema = z.object({
  title: bookmarkTitle,
  url: address,
  favicon: favicon.optional(),
}).strict();

export const bookmarkUpdateSchema = z.object({
  id: bookmarkId,
  title: bookmarkTitle.optional(),
  url: address.optional(),
}).strict().refine((value) =>
  value.title !== undefined || value.url !== undefined
);

export const bookmarkRemoveSchema = z.object({ id: bookmarkId }).strict();

export const browserViewStateSchema = z.object({
  view_session: viewSession,
  // main이 보내는 page 주소다. 길이로 거르면 state push가 소리 없이 버려진다.
  url: z.string(),
  // 1024자까지 받는다. 자르기는 main이 한다.
  title: z.string().max(1024),
  favicon: favicon.optional(),
  loading: z.boolean(),
  canGoBack: z.boolean(),
  canGoForward: z.boolean(),
  health: z.enum(["ok", "unresponsive", "crashed"]),
}).strict();

// main/browser/popup.ts의 type과 같은 모양이다. main은 import하지 않고 이 type을 쓴다.
const popupPlacementSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("docked") }).strict(),
  z.object({
    kind: z.literal("floated"),
    width: z.number(),
    height: z.number(),
  }).strict(),
]);

// state는 "지금 값"이고 이쪽은 사건이다.
// popup-blocked: 사용자 입력 없이 열려던 popup을 거절했다.
// open-tab: 크기 없는 popup(target=_blank, 크기 없는 window.open)을 거절했고, renderer가 연 탭 뒤에
// 그 url로 새 탭을 연다. opener는 끊긴다(크기 준 popup만 native view로 받아 opener를 지킨다).
// close: page가 window.close()를 불렀다.
// bookmark-key: page에 focus가 있을 때 Ctrl/Cmd+D가 눌렸다.
export const browserEventSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("popup"),
    opener: viewSession,
    view_session: viewSession,
    placement: popupPlacementSchema,
  }).strict(),
  z.object({ kind: z.literal("popup-blocked"), view_session: viewSession })
    .strict(),
  z.object({
    kind: z.literal("open-tab"),
    opener: viewSession,
    url: z.string().max(8192),
  }).strict(),
  z.object({ kind: z.literal("close"), view_session: viewSession }).strict(),
  z.object({ kind: z.literal("bookmark-key"), view_session: viewSession })
    .strict(),
  // DevTools view나 그 page가 사라졌거나 사람이 따로 뜬 DevTools 창을 닫았다.
  z.object({
    kind: z.literal("devtools-closed"),
    view_session: viewSession,
    devtools_session: viewSession,
  }).strict(),
]);

export const bookmarkReasonSchema = z.enum([
  "url",
  "title",
  "duplicate",
  "limit",
  "corrupt",
  "missing",
  "unreadable",
  "unwritable",
]);

export type BrowserAdopt = z.infer<typeof browserAdoptSchema>;
export type BrowserNavigate = z.infer<typeof browserNavigateSchema>;
export type BrowserCommand = z.infer<typeof browserCommandSchema>;
export type BrowserDevtoolsOpen = z.infer<typeof browserDevtoolsOpenSchema>;
export type BrowserDevtoolsClose = z.infer<typeof browserDevtoolsCloseSchema>;
export type BrowserDevtoolsWindow = z.infer<typeof browserDevtoolsWindowSchema>;
export type BookmarkAdd = z.infer<typeof bookmarkAddSchema>;
export type BookmarkUpdate = z.infer<typeof bookmarkUpdateSchema>;
export type BookmarkRemove = z.infer<typeof bookmarkRemoveSchema>;
export type BrowserViewState = z.infer<typeof browserViewStateSchema>;
export type PopupPlacement = z.infer<typeof popupPlacementSchema>;
export type BrowserEvent = z.infer<typeof browserEventSchema>;
export type BookmarkReason = z.infer<typeof bookmarkReasonSchema>;

export interface Bookmark {
  id: string;
  title: string;
  url: string;
  created_at: string;
  favicon?: string;
}

// 목록이 깨진 것은 오류가 아니라 상태다. 화면이 목록 자리에 보여야 한다. 쓰기만 corrupt로 거절된다.
export type BookmarkList =
  | { state: "ok"; bookmarks: Bookmark[] }
  | { state: "corrupt" };

type BrowserErrorCode =
  | "invalid_input"
  | "not_found"
  | "forbidden"
  | "conflict"
  | "unavailable";

/** main이 IPC로 돌려주는 모양. bookmark 요청의 실패는 message가 BookmarkReason 하나다. */
export type BrowserReply<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: BrowserErrorCode; message: string } };

/**
 * shell preload의 browser API(window.lophnBrowser). 거절은 code만 실은 Error다.
 * bookmarks의 거절은 Error.message가 BookmarkReason이고, 나머지 거절은 code다.
 */
export interface LophnBrowserApi {
  adopt(input: BrowserAdopt): Promise<BrowserViewState>;
  navigate(input: BrowserNavigate): Promise<BrowserViewState>;
  command(input: BrowserCommand): Promise<void>;
  clearData(): Promise<void>;
  devtools: {
    open(input: BrowserDevtoolsOpen): Promise<{ devtools_session: string }>;
    close(input: BrowserDevtoolsClose): Promise<void>;
    window(input: BrowserDevtoolsWindow): Promise<void>;
  };
  subscribeState(listener: (state: BrowserViewState) => void): () => void;
  subscribeEvents(listener: (event: BrowserEvent) => void): () => void;
  bookmarks: {
    list(): Promise<BookmarkList>;
    add(input: BookmarkAdd): Promise<Bookmark>;
    update(input: BookmarkUpdate): Promise<Bookmark>;
    remove(input: BookmarkRemove): Promise<void>;
    subscribe(listener: () => void): () => void;
  };
}
