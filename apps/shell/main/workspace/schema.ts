// WorkspaceLayout(domain-model/shell/workspace) 값. 파일 계약 첫 판이다.
// renderer가 보내는 wire 모양은 ipc/workspace.ts가 정한다. 여기는 파일에 남는
// schema 원본과 검증·기본값의 순수 동작만 둔다.
import { z } from "zod";

export const LAYOUT_SCHEMA_VERSION = 1;

// 로컬 탭 참조. credential이 아니라 workspace 안 유일 key다(domain-model 제약).
const tabKey = z.string().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/);

// 읽던 위치는 section key와 0 이상 scroll offset뿐이다. 본문은 없다(shell/workspace#R8).
const readPosition = z.strictObject({
  section: z.string().min(1).max(128),
  scroll_offset: z.number().min(0).max(Number.MAX_SAFE_INTEGER),
});

const documentId = z.string().regex(/^doc_[0-7][0-9a-hjkmnp-tv-z]{25}$/);
const versionId = z.string().regex(/^ver_[0-7][0-9a-hjkmnp-tv-z]{25}$/);
const appId = z.string().regex(/^app_[0-7][0-9a-hjkmnp-tv-z]{25}$/);

// tagged union. preview(mode)는 복원 파일에서 제외된다(domain-model TabLayout).
export const layoutTabSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("document_editor"),
    key: tabKey,
    document: documentId,
    read_position: readPosition.optional(),
  }),
  z.strictObject({
    kind: z.literal("document_viewer"),
    key: tabKey,
    document: documentId,
    version: versionId,
    read_position: readPosition.optional(),
  }),
  z.strictObject({
    kind: z.literal("terminal"),
    key: tabKey,
    project_folder: z.string().min(1).max(4096),
  }),
  z.strictObject({
    kind: z.literal("app_panel"),
    key: tabKey,
    app: appId,
    surface: z.string().min(1).max(128),
  }),
]);

export type LayoutTab = z.infer<typeof layoutTabSchema>;

// 칸은 탭 목록과 그 안의 선택뿐이다.
export const layoutPaneSchema = z.strictObject({
  tabs: z.array(layoutTabSchema).max(200),
  selected_tab: tabKey.nullable(),
}).refine(
  (pane) => pane.selected_tab === null ||
    pane.tabs.some((tab) => tab.key === pane.selected_tab),
  { message: "selected_tab is not in tabs" },
);

export type LayoutPane = z.infer<typeof layoutPaneSchema>;

// 정보 패널은 공간별 열림·마지막 탭만 남긴다(shell/editor#R6).
export const informationPanelSchema = z.strictObject({
  open: z.boolean(),
  tab: z.enum(["info", "versions", "contexts"]),
});

export type InformationPanel = z.infer<typeof informationPanelSchema>;

// 창 bounds는 화면 상의 정수 rectangle이다. 음수·과도한 크기는 받지 않는다.
const windowBounds = z.strictObject({
  x: z.number().int().min(-32768).max(32768),
  y: z.number().int().min(-32768).max(32768),
  width: z.number().int().min(1).max(32768),
  height: z.number().int().min(1).max(32768),
});

export type WindowBounds = z.infer<typeof windowBounds>;

// WorkspaceLayout. 승인·credential·앱 업무 상태·preview는 schema에 없다.
export const workspaceLayoutSchema = z.strictObject({
  schema_version: z.literal(LAYOUT_SCHEMA_VERSION),
  project: z.string().regex(/^prj_[0-7][0-9a-hjkmnp-tv-z]{25}$/),
  window_bounds: windowBounds,
  last_space: z.string().min(1).max(80),
  panes: z.array(layoutPaneSchema).min(1).max(2),
  split_ratio: z.number().finite().gt(0).lt(1),
  focused_pane: z.number().int().min(0).max(1),
  information_panel: informationPanelSchema,
}).refine(
  (layout) => layout.focused_pane < layout.panes.length,
  { message: "focused_pane is not a valid pane index" },
);

export type WorkspaceLayout = z.infer<typeof workspaceLayoutSchema>;

// 미지원 schema는 이 판으로 읽지 않는다. 복원 파일의 판 표시다.
export const layoutFileSchema = z.strictObject({
  schema_version: z.number().int().min(1),
  layout: workspaceLayoutSchema,
});

export type LayoutFile = z.infer<typeof layoutFileSchema>;
