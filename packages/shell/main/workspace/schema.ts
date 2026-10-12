// WorkspaceLayout(domain-model/shell/workspace) 값. 파일 계약 첫 판이다.
// renderer가 보내는 wire 모양은 ipc/workspace.ts가 정한다. 여기는 파일에 남는
// schema 원본과 검증·기본값의 순수 동작만 둔다.
import { z } from "zod";

import { type LayoutTab, tabKindOf } from "./kinds/registry.ts";
import { tabKey } from "./kinds/values.ts";

export const LAYOUT_SCHEMA_VERSION = 1;

// 탭 값은 등록된 kind의 schema가 정한다(kinds/registry.ts). tagged union이고 preview(mode)는 복원 파일에서
// 제외된다(domain-model TabLayout). 등록되지 않은 kind는 이 schema가 거절하고, 파일을 읽는
// parseLayoutFile이 먼저 그런 탭을 건너뛴다.
export const layoutTabSchema: z.ZodType<LayoutTab> = z.unknown().transform(
  (value, ctx) => {
    const kind = tabKindOf((value as { kind?: unknown } | null)?.kind);
    if (kind === undefined) {
      ctx.addIssue({ code: "custom", message: "unknown tab kind" });
      return z.NEVER;
    }
    const parsed = kind.layout.safeParse(value);
    if (!parsed.success) {
      ctx.addIssue({ code: "custom", message: "invalid tab value" });
      return z.NEVER;
    }
    return parsed.data as LayoutTab;
  },
) as unknown as z.ZodType<LayoutTab>;

export type { LayoutTab };

// 칸은 탭 목록과 그 안의 선택뿐이다.
export const layoutPaneSchema = z.strictObject({
  tabs: z.array(layoutTabSchema).max(200),
  selected_tab: tabKey.nullable(),
}).refine(
  (pane) =>
    pane.selected_tab === null ||
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
