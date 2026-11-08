import { z } from "zod";
import { idSchema } from "../base/ids.ts";
import { defineMemory } from "../base/route.ts";

// core 메모리의 host queue다. core가 shell에 시킬 일(탭 열기·닫기)을 담고, shell main이 1초마다 가져가
// 그 workspace를 보이는 창에 push한다(harness queue와 같은 꼴: core 메모리 + shell main이 가져감).
// shell이 없거나 그 workspace를 보이는 창이 없으면 요청은 대기하고, core가 다시 뜨면 사라진다.
//
// host/*는 shell main이 사람 token(actor user)으로만 부르고 renderer 통로에는 없다.
// tabs/*와 browser/read는 agent가 `lophn tab`·`lophn browser` 명령으로 부른다. 부른 session은 자격의
// session 조건에서 읽고 입력으로 받지 않는다.

const errors = [
  "invalid_input",
  "forbidden",
  "not_found",
  "conflict",
  "unavailable",
  "unauthorized",
] as const;

// shell이 그리는 자리다. home에는 session의 workspace가 없다.
export const hostWorkspaceSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("home") }),
  z.strictObject({ kind: z.literal("project"), id: idSchema("prj") }),
  z.strictObject({ kind: z.literal("app"), id: idSchema("app") }),
]);
export type HostWorkspace = z.infer<typeof hostWorkspaceSchema>;

// 놓는 자리 힌트다. 실제 자리는 renderer의 `openAt()`이 정한다.
export const TAB_PLACES = ["beside", "group", "float"] as const;
export const tabPlaceSchema = z.enum(TAB_PLACES);
export type TabPlace = z.infer<typeof tabPlaceSchema>;

// `tui`는 harness agent session을 터미널 탭에서 그 CLI의 resume으로 연다(project workspace의 session만).
export const hostTabTargetSchema = z.union([
  z.strictObject({ session: idSchema("ses") }),
  z.strictObject({ tui: idSchema("ses") }),
  z.strictObject({
    browser: z.strictObject({ url: z.string().min(1).max(8192) }),
  }),
]);
export type HostTabTarget = z.infer<typeof hostTabTargetSchema>;

const tabOpenPayloadSchema = z.strictObject({
  tab: idSchema("tab"),
  target: hostTabTargetSchema,
  place: tabPlaceSchema.nullable(),
  // 연 agent session이다. renderer가 그 session의 탭 옆에 놓는다.
  source: idSchema("ses").nullable(),
  // target이 tui일 때 CLI를 다시 여는 값이다. harness는 `HARNESS_ADAPTERS`의 id, external_session은 그 CLI의 session id다.
  // renderer는 session의 CLI id를 읽을 길이 없어 core가 실어 보낸다.
  resume: z
    .strictObject({
      harness: z.string().min(1),
      external_session: z.string().min(1),
    })
    .nullable(),
});

export const hostRequestSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    id: idSchema("hrq"),
    kind: z.literal("tab_open"),
    workspace: hostWorkspaceSchema,
    payload: tabOpenPayloadSchema,
  }),
  z.strictObject({
    id: idSchema("hrq"),
    kind: z.literal("tab_close"),
    workspace: hostWorkspaceSchema,
    payload: z.strictObject({ tab: idSchema("tab") }),
  }),
]);
export type HostRequest = z.infer<typeof hostRequestSchema>;

// browser 탭의 마지막 상태다. renderer가 host 탭만 알려 준다.
export const browserTabStateSchema = z.strictObject({
  url: z.string(),
  title: z.string(),
  loading: z.boolean(),
});
export type BrowserTabState = z.infer<typeof browserTabStateSchema>;

// 그 workspace들의 가장 오래된, 빌려 가지 않은 요청 하나를 빌려 준다. 없으면 null이다.
// 빌려 간 요청은 done이 오거나 빌린 기한이 지나면 다시 대기한다.
export const hostTake = defineMemory({
  resource: "host",
  method: "take",
  name: "HostTake",
  input: z.strictObject({
    workspaces: z.array(hostWorkspaceSchema).max(64),
  }),
  output: z.strictObject({ request: hostRequestSchema.nullable() }),
  actors: ["user"],
  errors,
});

// `retry`면 창이 받지 못한 것이라 요청은 다시 대기한다.
export const hostDone = defineMemory({
  resource: "host",
  method: "done",
  name: "HostDone",
  input: z.strictObject({
    id: idSchema("hrq"),
    result: z.enum(["done", "retry"]),
  }),
  output: z.strictObject({}),
  actors: ["user"],
  errors,
});

// host 탭의 browser 상태나 닫힘이다. 닫힌 탭은 표에서 빠진다.
export const hostReport = defineMemory({
  resource: "host",
  method: "report",
  name: "HostReport",
  input: z.strictObject({
    tab: idSchema("tab"),
    state: z.union([browserTabStateSchema, z.literal("closed")]),
  }),
  output: z.strictObject({}),
  actors: ["user"],
  errors,
});

const acceptedSchema = z.strictObject({
  tab: idSchema("tab"),
  status: z.literal("accepted"),
});

// 같은 workspace의 열린 session이나 http(s) url의 탭을 연다. 접수만 답하고 기다리지 않는다.
// session이 아니면 `not_found`, url이 http·https가 아니면 `invalid_input`이다.
// `tui`는 harness agent session을 터미널 탭에서 CLI의 resume으로 연다. harness가 아니거나 project workspace의 session이 아니면
// `invalid_input`, 첫 turn 전이거나 turn이 돌거나 이미 TUI로 열려 있으면 `conflict`다. 열리면 그 session의 headless turn은
// TUI가 끝날 때까지 시작하지 않고 입력은 queue에 남는다(`harness-host.ts`의 Take).
export const tabsOpen = defineMemory({
  resource: "tabs",
  method: "open",
  name: "OpenTab",
  input: z.strictObject({
    target: hostTabTargetSchema,
    place: tabPlaceSchema.optional(),
  }),
  output: acceptedSchema,
  actors: ["agent"],
  errors,
});

// 자기가 연 탭만 닫는다. 남이 연 탭이면 `forbidden`, 없는 탭이면 `not_found`다.
export const tabsClose = defineMemory({
  resource: "tabs",
  method: "close",
  name: "CloseTab",
  input: z.strictObject({ tab: idSchema("tab") }),
  output: acceptedSchema,
  actors: ["agent"],
  errors,
});

// 자기가 연 browser 탭의 url·title·loading이다. 남의 탭이거나 상태가 아직 없으면 `not_found`다.
export const browserRead = defineMemory({
  resource: "browser",
  method: "read",
  name: "ReadBrowserTab",
  input: z.strictObject({ tab: idSchema("tab") }),
  output: browserTabStateSchema,
  actors: ["agent"],
  errors,
});

export const HOST_QUEUE_MEMORY_ROUTES = [
  hostTake,
  hostDone,
  hostReport,
  tabsOpen,
  tabsClose,
  browserRead,
] as const;
