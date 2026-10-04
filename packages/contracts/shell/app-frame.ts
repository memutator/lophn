import { z } from "zod";
import { ERROR_CODES, type ErrorCode } from "../../base/mod.ts";
import { idSchema } from "../platform/ids.ts";
import {
  type AppScreenRequest,
  appScreenRequestSchema,
} from "../apps/channel.ts";
import {
  screenKeySchema,
  screenSizeSchema,
  viewModeSchema,
} from "../apps/channel-values.ts";

// view ID는 main이 만든 메모리 식별이다. credential이 아니다(architecture/shell 5.2).
const viewSessionSchema = z.string().min(1).refine(
  (value) => !/\p{Cc}/u.test(value),
  { message: "view session contains a control character" },
);

const windowRefSchema = z.string().min(1).refine(
  (value) => !/\p{Cc}/u.test(value),
  { message: "window ref contains a control character" },
);

const generationSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

// 창 본문 경계 안의 정수 rectangle(architecture/shell 5.2).
export const viewBoundsSchema = z.strictObject({
  x: z.number().int(),
  y: z.number().int(),
  width: z.number().int().min(0),
  height: z.number().int().min(0),
});

export type ViewBounds = z.infer<typeof viewBoundsSchema>;

// 앱 통로의 AppScreenRequest 이름과 field를 그대로 쓴다(domain-model apps/runtime).
export { type AppScreenRequest, appScreenRequestSchema };

// live는 release가 필수다. preview는 release 없는 준비 전 bundle을 허용한다.
const openFields = {
  app: idSchema("app"),
  mode: viewModeSchema,
  release: idSchema("rel").nullable(),
  screen: screenKeySchema,
  size: screenSizeSchema,
  parentWindow: windowRefSchema,
  bounds: viewBoundsSchema,
};

function openShape(
  value: { mode: "live" | "preview"; release: string | null },
): boolean {
  return value.mode === "preview" || value.release !== null;
}

export const appFrameOpenSchema = z.strictObject(openFields).refine(openShape, {
  message: "live view requires a release",
});

export type AppFrameOpen = z.infer<typeof appFrameOpenSchema>;

// 교체 대상은 같은 view_session에 묶는다. 페이지가 주장한 신원은 field로 받지 않는다.
export const appFrameReplaceSchema = z.strictObject({
  view_session: viewSessionSchema,
  target: appFrameOpenSchema,
});

export type AppFrameReplace = z.infer<typeof appFrameReplaceSchema>;

export const appFrameCloseSchema = z.strictObject({
  view_session: viewSessionSchema,
});

export type AppFrameClose = z.infer<typeof appFrameCloseSchema>;

// 화면 연결 표시는 apps/runtime의 RuntimeState.state와 같다.
export const VIEW_CONNECTION_STATES = [
  "preparing",
  "stopped",
  "running",
  "unavailable",
] as const;

const viewStateFields = {
  view_session: viewSessionSchema,
  app: idSchema("app"),
  release: idSchema("rel").nullable(),
  mode: viewModeSchema,
  screen: screenKeySchema,
  size: screenSizeSchema,
  connectionState: z.enum(VIEW_CONNECTION_STATES),
};

export const appFrameViewStateSchema = z.object(viewStateFields).refine(
  openShape,
  { message: "live view requires a release" },
);

export type AppFrameViewState = z.infer<typeof appFrameViewStateSchema>;

export type AppFrame = {
  open(input: AppFrameOpen): Promise<AppFrameViewState>;
  replace(
    view_session: string,
    target: AppFrameOpen,
  ): Promise<AppFrameViewState>;
  close(view_session: string): Promise<void>;
};

export const appViewOpenSchema = z.strictObject({
  app: idSchema("app"),
  mode: viewModeSchema,
  release: idSchema("rel").optional(),
  screen: screenKeySchema,
  size: screenSizeSchema,
});

export const documentViewOpenSchema = z.strictObject({
  version: idSchema("ver"),
});

export const viewBoundsRequestSchema = z.strictObject({
  view_session: viewSessionSchema,
  bounds: viewBoundsSchema,
});

export const viewsHiddenSchema = z.strictObject({
  view_sessions: z.array(viewSessionSchema).min(1),
});

export const viewCloseRequestSchema = z.strictObject({
  view_session: viewSessionSchema,
});

// visibility 완료는 main이 적용한 generation을 돌려준다.
export const visibilityResultSchema = z.strictObject({
  generation: generationSchema,
});

export const APP_FRAME_IPC = {
  "shell:view-open-app": appViewOpenSchema,
  "shell:view-open-document": documentViewOpenSchema,
  "shell:view-bounds": viewBoundsRequestSchema,
  "shell:views-hidden": viewsHiddenSchema,
  "shell:view-close": viewCloseRequestSchema,
} as const;

export type AppFrameIpc = keyof typeof APP_FRAME_IPC;

// push는 ledger event가 아니다. 창 표시 갱신이다.
export const APP_FRAME_PUSH = {
  "shell:view-state": appFrameViewStateSchema,
} as const;

export type LophnShellViews = {
  openApp(
    input: z.infer<typeof appViewOpenSchema>,
  ): Promise<AppFrameViewState>;
  openDocumentView(
    input: z.infer<typeof documentViewOpenSchema>,
  ): Promise<AppFrameViewState>;
  setViewBounds(
    input: z.infer<typeof viewBoundsRequestSchema>,
  ): Promise<z.infer<typeof visibilityResultSchema>>;
  setViewsHidden(
    input: z.infer<typeof viewsHiddenSchema>,
  ): Promise<z.infer<typeof visibilityResultSchema>>;
  closeView(input: z.infer<typeof viewCloseRequestSchema>): Promise<void>;
};

// scheme 세 개. host는 DNS label이고 entity ID를 직접 넣지 않는다(architecture/shell 5.2).
export const VIEW_SCHEMES = [
  "lophn-shell",
  "lophn-app",
  "lophn-document",
] as const;

const ULID_LABEL = "[0-7][0-9a-hjkmnp-tv-z]{25}";

export const appLabelSchema = z.string().regex(
  new RegExp(`^app-${ULID_LABEL}$`),
);
export const versionLabelSchema = z.string().regex(
  new RegExp(`^ver-${ULID_LABEL}$`),
);

export function appHostLabel(appId: string): string {
  return `app-${appId.slice("app_".length)}`;
}

export function documentHostLabel(versionId: string): string {
  return `ver-${versionId.slice("ver_".length)}`;
}

function parsed(value: string): URL | undefined {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

export const appViewUrlSchema = z.string().refine((value) => {
  const url = parsed(value);
  return url !== undefined && url.protocol === "lophn-app:" &&
    appLabelSchema.safeParse(url.hostname).success && url.username === "" &&
    url.password === "" && url.port === "";
}, { message: "app view url is not a lowercase app label" });

export const documentViewUrlSchema = z.string().refine((value) => {
  const url = parsed(value);
  return url !== undefined && url.protocol === "lophn-document:" &&
    versionLabelSchema.safeParse(url.hostname).success && url.username === "" &&
    url.password === "" && url.port === "";
}, { message: "document view url is not a lowercase version label" });

// partition 이름. 실제 분리는 main의 session manager가 한다.
export const SHELL_PARTITION = "persist:shell";

export function livePartition(appId: string): string {
  return `persist:app-${appId}:live`;
}

export function previewPartition(appId: string, bundleHash: string): string {
  return `persist:app-${appId}:preview-${bundleHash}`;
}

export function documentPartition(
  versionId: string,
  viewSession: string,
): string {
  return `document-${versionId}-${viewSession}`;
}

export const livePartitionSchema = z.string().regex(
  new RegExp(`^persist:app-app_${ULID_LABEL}:live$`),
);
export const previewPartitionSchema = z.string().regex(
  new RegExp(`^persist:app-app_${ULID_LABEL}:preview-[0-9a-f]{64}$`),
);
export const documentPartitionSchema = z.string().regex(
  new RegExp(`^document-ver_${ULID_LABEL}-.+$`),
);

// architecture/shell 5.2가 적는 오류. capture 실패는 이 오류가 아니다.
export const APP_FRAME_ERRORS = [
  "invalid_input",
  "forbidden",
  "conflict",
  "unavailable",
] as const satisfies readonly ErrorCode[];

for (const code of APP_FRAME_ERRORS) {
  if (!ERROR_CODES.includes(code)) {
    throw new Error(`unknown app frame error: ${code}`);
  }
}
