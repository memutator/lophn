// WorkspaceLayout 값. 파일 계약이다. 판 2부터 떠 있는 탭(floats)이, 판 3부터 detached 탭(OS 창)이, 판 4부터 자리(desk)가 있다.
// 판 5에서 쓰지 않던 desktop 창 bounds(`window_bounds`)를 뺐다. 창 자리는 `window-state.ts`가 앱에 하나 둔다.
// 판 6에서 좌우 두 칸의 `split_ratio`를 칸 배치 tree(`layout`)로 바꿨다. 칸은 최대 6개이고 위아래로도 나뉜다.
// 판 7에서 activity bar에 고정한 앱 패널 목록(`rail_apps`)이 project마다 생겼다.
// renderer가 보내는 wire 모양은 ipc/workspace.ts가 정한다. 여기는 파일에 남는
// schema 원본과 검증·기본값의 순수 동작만 둔다.
import { z } from "zod";

import { type LayoutTab, tabKindOf } from "./kinds/registry.ts";
import { appId, tabKey } from "./kinds/values.ts";

export const LAYOUT_SCHEMA_VERSION = 7;

// 칸 최대 수. renderer layout-tree.ts의 MAX_PANES와 짝이다.
export const MAX_PANES = 6;

// default 자리의 key. workflow 이름은 slug라 `_`로 시작할 수 없어 겹치지 않는다. renderer model.ts의 DEFAULT_DESK와 짝이다.
export const DEFAULT_DESK = "_default";

// 탭 값은 등록된 kind의 schema가 정한다(kinds/registry.ts). tagged union이고 preview(mode)는 복원 파일에서
// 제외된다. 등록되지 않은 kind는 이 schema가 거절하고, 파일을 읽는
// parseLayoutFile이 먼저 그런 탭을 건너뛴다.
export const layoutTabSchema: z.ZodType<LayoutTab> = z
  .unknown()
  .transform((value, ctx) => {
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
  }) as unknown as z.ZodType<LayoutTab>;

export type { LayoutTab };

// 칸은 탭 목록과 그 안의 선택뿐이다.
const layoutPaneSchema = z
  .strictObject({
    tabs: z.array(layoutTabSchema).max(200),
    selected_tab: tabKey.nullable(),
  })
  .refine(
    (pane) =>
      pane.selected_tab === null ||
      pane.tabs.some((tab) => tab.key === pane.selected_tab),
    { message: "selected_tab is not in tabs" },
  );

// 정수 rectangle. floated 탭의 rect와 detached 창 bounds가 같이 쓴다. 과도한 크기는 받지 않는다.
export const windowBounds = z.strictObject({
  x: z.number().int().min(-32768).max(32768),
  y: z.number().int().min(-32768).max(32768),
  width: z.number().int().min(1).max(32768),
  height: z.number().int().min(1).max(32768),
});

export type WindowBounds = z.infer<typeof windowBounds>;

// 떠 있는 탭. rect는 workspace 안의 CSS px이고 minimized여도 접기 전 값을 지닌다.
const layoutFloatSchema = z.strictObject({
  tab: layoutTabSchema,
  rect: windowBounds,
  minimized: z.boolean(),
  origin_pane: z
    .number()
    .int()
    .min(0)
    .max(MAX_PANES - 1),
  // 탭 menu의 Minimize로 칸에서 바로 접은 탭의 그 칸 안 자리. 복원하면 floating이 아니라 이 자리로 간다.
  docked_at: z.number().int().min(0).max(1000).optional(),
});

// detached 탭. OS 창 하나가 탭 하나를 가진다. bounds는 화면 좌표다.
const layoutDetachedSchema = z.strictObject({
  tab: layoutTabSchema,
  bounds: windowBounds,
});

// 칸 배치 tree. 잎은 "leaf"이고 나눔은 row(a가 왼쪽)나 column(a가 위)이다. ratio는 a가 차지하는 몫이다.
// 잎의 순서(왼쪽·위에서 오른쪽·아래로)가 panes의 순서다. renderer layout-tree.ts의 LayoutNode와 짝이다.
export type LayoutNode =
  | "leaf"
  | {
      dir: "row" | "column";
      ratio: number;
      a: LayoutNode;
      b: LayoutNode;
    };

const layoutNodeSchema: z.ZodType<LayoutNode> = z.lazy(() =>
  z.union([
    z.literal("leaf"),
    z.strictObject({
      dir: z.enum(["row", "column"]),
      ratio: z.number().finite().gt(0).lt(1),
      a: layoutNodeSchema,
      b: layoutNodeSchema,
    }),
  ]),
);

function leafCount(node: LayoutNode): number {
  return node === "leaf" ? 1 : leafCount(node.a) + leafCount(node.b);
}

// 자리 하나. 판 3의 최상위 칸과 같은 값이 자리마다 있다.
const deskSchema = z
  .strictObject({
    panes: z.array(layoutPaneSchema).min(1).max(MAX_PANES),
    layout: layoutNodeSchema,
    focused_pane: z
      .number()
      .int()
      .min(0)
      .max(MAX_PANES - 1),
    floats: z.array(layoutFloatSchema).max(20),
    detached: z.array(layoutDetachedSchema).max(20),
  })
  .refine((desk) => desk.focused_pane < desk.panes.length, {
    message: "focused_pane is not a valid pane index",
  })
  .refine((desk) => leafCount(desk.layout) === desk.panes.length, {
    message: "layout leaves do not match panes",
  });

export type WorkspaceDesk = z.infer<typeof deskSchema>;

// 자리 key. workflow 이름이거나 DEFAULT_DESK다.
export const deskKey = z
  .string()
  .min(1)
  .max(200)
  .refine((key) => ![...key].some((ch) => ch <= "\u001f" || ch === "\u007f"), {
    message: "desk key has a control character",
  });

// activity bar에 고정한 앱 패널 하나. app_panel 탭의 app·surface와 같은 값이고 title은 앱 이름(tooltip 대체)이다.
// open은 새로 열 때의 자리다. 없으면 dock이라 open이 없던 판 7 파일도 그대로 읽힌다.
const railAppSchema = z.strictObject({
  app: appId,
  surface: z.string().min(1).max(128),
  title: z.string().min(1).max(200).optional(),
  open: z.enum(["dock", "float"]).optional(),
});

export type RailApp = z.infer<typeof railAppSchema>;

// WorkspaceLayout. 승인·credential·앱 업무 상태·preview·transient 탭은 schema에 없다.
export const workspaceLayoutSchema = z
  .strictObject({
    schema_version: z.literal(LAYOUT_SCHEMA_VERSION),
    project: z.string().regex(/^prj_[0-7][0-9a-hjkmnp-tv-z]{25}$/),
    active_desk: deskKey,
    desks: z.record(deskKey, deskSchema),
    rail_apps: z.array(railAppSchema).max(20),
  })
  .refine(
    (layout) => {
      const count = Object.keys(layout.desks).length;
      return count >= 1 && count <= 200;
    },
    { message: "desks must have 1 to 200 entries" },
  )
  .refine((layout) => Object.hasOwn(layout.desks, DEFAULT_DESK), {
    message: "desks has no default desk",
  })
  .refine((layout) => Object.hasOwn(layout.desks, layout.active_desk), {
    message: "active_desk is not in desks",
  })
  .refine(
    (layout) =>
      new Set(layout.rail_apps.map((item) => `${item.app}:${item.surface}`))
        .size === layout.rail_apps.length,
    { message: "rail_apps has a duplicate" },
  );

export type WorkspaceLayout = z.infer<typeof workspaceLayoutSchema>;

// 미지원 schema는 이 판으로 읽지 않는다. 복원 파일의 판 표시다.
export const layoutFileSchema = z.strictObject({
  schema_version: z.number().int().min(1),
  layout: workspaceLayoutSchema,
});

export type LayoutFile = z.infer<typeof layoutFileSchema>;
