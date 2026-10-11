import { z } from "zod";
import { ERROR_CODES, type ErrorCode } from "../../base/mod.ts";
import {
  appIdSchema,
  documentIdSchema,
  projectIdSchema,
  sectionKeySchema,
  versionIdSchema,
} from "../documents/values.ts";
import { idSchema } from "../platform/ids.ts";
import { defineMemory } from "../platform/route.ts";
import { atSchema } from "../platform/values.ts";

// 요약은 UTF-8 2048 bytes, 탭 상세는 한 page 20개(shell/workspace#R10).
export const SUMMARY_MAX_BYTES = 2048;
export const TAB_PAGE_SIZE = 20;

// 화면 상태 문자열은 80자를 넘기면 원값 대신 안전한 형태로 줄인다(platform/redaction#R12).
export const VIEW_STRING_MAX_CHARS = 80;

export const VIEW_AVAILABILITY = [
  "current",
  "disconnected",
  "unavailable",
] as const;

export const TAB_KINDS = [
  "document_editor",
  "terminal",
  "app_panel",
] as const;

export const APP_VIEW_MODES = ["live", "preview"] as const;

const WINDOW_REF = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

const viewString = z.string().min(1).max(VIEW_STRING_MAX_CHARS);

const generationSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

const lineSchema = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);

export const windowRefSchema = z.string().regex(WINDOW_REF);

const sessionIdSchema = idSchema("ses");
const releaseIdSchema = idSchema("rel");

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).length;
}

export const summarySchema = z.string().refine(
  (value) => utf8Bytes(value) <= SUMMARY_MAX_BYTES,
  { message: "summary exceeds 2048 UTF-8 bytes" },
);

const tabBase = {
  key: viewString,
  selected: z.boolean(),
};

// 탭은 허용 종류와 대상 참조만 담는다. 본문·초안·터미널 출력·DOM은 field로도 받지 않는다.
export const viewTabSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    ...tabBase,
    kind: z.literal("document_editor"),
    document: documentIdSchema,
  }),
  z.strictObject({
    ...tabBase,
    kind: z.literal("terminal"),
    project_folder: viewString,
  }),
  z.strictObject({
    ...tabBase,
    kind: z.literal("app_panel"),
    app: appIdSchema,
    surface: viewString,
    // 그 패널 view의 불투명 session 식별자다. agent가 앱의 화면 context를 읽고 쓸 때 가리키는 view이며
    // 허락이 아니다. 패널 view가 아직 서지 않았으면 없다(apps/agent-context).
    view_session: viewString.optional(),
  }),
]);

export type ViewTab = z.infer<typeof viewTabSchema>;

export const tabPageSchema = z.array(viewTabSchema).max(TAB_PAGE_SIZE);

// 출력은 additive다. 입력 strict union과 같은 가지·제약만 두고 모르는 field는 거절하지 않는다.
const viewTabOutputSchema = z.discriminatedUnion("kind", [
  z.object({
    ...tabBase,
    kind: z.literal("document_editor"),
    document: documentIdSchema,
  }),
  z.object({
    ...tabBase,
    kind: z.literal("terminal"),
    project_folder: viewString,
  }),
  z.object({
    ...tabBase,
    kind: z.literal("app_panel"),
    app: appIdSchema,
    surface: viewString,
    view_session: viewString.optional(),
  }),
]);

export const tabPageOutputSchema = z.array(viewTabOutputSchema).max(
  TAB_PAGE_SIZE,
);

// 문서 선택은 판·절·줄 범위만. 선택 본문은 없다.
export const selectionSchema = z.strictObject({
  document: documentIdSchema,
  version: versionIdSchema,
  section: sectionKeySchema.max(VIEW_STRING_MAX_CHARS),
  start_line: lineSchema,
  end_line: lineSchema,
}).refine((value) => value.end_line >= value.start_line, {
  message: "selection line range is inverted",
});

export type Selection = z.infer<typeof selectionSchema>;

// 앱 상세 context는 apps/agent-context의 read command다. 여기에는 참조만 둔다.
export const appViewSchema = z.strictObject({
  app: appIdSchema,
  release: releaseIdSchema,
  mode: z.enum(APP_VIEW_MODES),
  surface: viewString,
  view_generation: generationSchema,
});

export type AppView = z.infer<typeof appViewSchema>;

export const omissionSchema = z.strictObject({
  reason: viewString,
  truncated: z.boolean(),
  next_page: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
});

export type ViewOmission = z.infer<typeof omissionSchema>;

export const currentViewStateSchema = z.strictObject({
  window_ref: windowRefSchema,
  generation: generationSchema,
  observed_at: atSchema,
  project: projectIdSchema.nullable(),
  tabs: z.array(viewTabSchema),
  focused_pane: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable(),
  selection: selectionSchema.nullable(),
  app_view: appViewSchema.nullable(),
  availability: z.enum(VIEW_AVAILABILITY),
  omissions: z.array(omissionSchema),
});

export type CurrentViewState = z.infer<typeof currentViewStateSchema>;

const errors = [...ERROR_CODES] as [
  ErrorCode,
  ...ErrorCode[],
];

export const workspacePublish = defineMemory({
  resource: "workspace",
  method: "publish",
  name: "workspace.publish",
  input: z.strictObject({
    window_ref: windowRefSchema,
    generation: generationSchema,
    observed_at: atSchema,
    summary: summarySchema,
    tab_pages: z.array(tabPageSchema),
  }),
  output: z.object({}),
  actors: ["user"],
  errors,
});

export const workspaceBind = defineMemory({
  resource: "workspace",
  method: "bind",
  name: "workspace.bind",
  input: z.strictObject({
    session: sessionIdSchema,
    window_ref: windowRefSchema,
  }),
  output: z.object({}),
  actors: ["user"],
  errors,
});

export const workspaceUnpublish = defineMemory({
  resource: "workspace",
  method: "unpublish",
  name: "workspace.unpublish",
  input: z.strictObject({ window_ref: windowRefSchema }),
  output: z.object({}),
  actors: ["user"],
  errors,
});

// next_page는 다음 page의 index다. page를 준 read는 그 index의 tab_page를 돌려준다.
// 요약만 주는 첫 read는 tab_page를 생략한다(shell/workspace#R10).
const currentReadSchema = z.object({
  availability: z.literal("current"),
  observed_at: atSchema,
  generation: generationSchema,
  summary: summarySchema,
  next_page: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  tab_page: tabPageOutputSchema.optional(),
});

const absentReadSchema = z.object({
  availability: z.enum(["disconnected", "unavailable"]),
  reason: viewString,
});

export const workspaceReadOutputSchema = z.union([
  currentReadSchema,
  absentReadSchema,
]);

export type WorkspaceReadOutput = z.infer<typeof workspaceReadOutputSchema>;

export const workspaceRead = defineMemory({
  resource: "workspace",
  method: "read",
  name: "workspace.read",
  input: z.strictObject({
    session: sessionIdSchema,
    page: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  }),
  output: workspaceReadOutputSchema,
  actors: ["agent"],
  errors,
});

export const WORKSPACE_ROUTES = [
  workspacePublish,
  workspaceBind,
  workspaceUnpublish,
  workspaceRead,
] as const;
