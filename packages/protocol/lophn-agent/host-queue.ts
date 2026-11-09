import { z } from "zod";
import { ERROR_CODES } from "../../base/mod.ts";
import { idSchema } from "../base/ids.ts";
import { defineMemory } from "../base/route.ts";
import { extensionToolContentSchema } from "../extensions/manifest.ts";
import { artifactNameSchema } from "../projects/values.ts";
import { loginIdSchema } from "../secrets/logins.ts";
import { workspaceSchema } from "./workspaces.ts";

// core 메모리의 host queue다. core가 shell에 시킬 일(탭 열기·닫기, extension tool 호출, browser 호출)을 담고, shell main이
// `host/take`를 이어 불러(long-poll) 가져가 그 workspace를 보이는 창에 push한다(harness queue와 같은 꼴: core 메모리 + shell main이 가져감).
// shell이 없거나 그 workspace를 보이는 창이 없으면 요청은 대기하고, core가 다시 뜨면 사라진다.
//
// host/*는 shell main이 사람 token(actor user)으로만 부르고 renderer 통로에는 없다.
// tabs/*와 browser/*는 agent session이나 사람 token이 `lophn tab`·`lophn browser` 명령으로 부른다. 부른 session은 자격의
// session 조건에서 읽고 입력으로 받지 않는다. 탭의 주인은 그 session이고, 사람 token은 모두 같은 주인 "person"이다.

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

// 연 탭이 연 session(source)에게 무엇인지다. agent는 자리가 아니라 이 뜻만 말하고, 자리는 renderer의 `openAt()`이 정한다.
// - peer: source와 같은 일을 나눠 하는 동료(병렬 팀원). source의 group에 같이 선다.
// - stage: 다음 단계나 다른 일을 맡는 coordinator. source 뒤에 새 group을 시작할 자리에 선다.
// - aside: 사람에게 보여 주려는 것(결과 page, artifact, preview, TUI). source 옆 칸이다.
// - work: agent가 혼자 쓰는 작업 탭(browser-use). 접힌 float이고 사람이 펴서 지켜보거나 take control한다.
// - glance: 잠깐 보여 주는 것. 펴진 float이고 사람이 밖을 누르면 접힌다.
export const TAB_RELATIONS = [
  "peer",
  "stage",
  "aside",
  "work",
  "glance",
] as const;
export const tabRelationSchema = z.enum(TAB_RELATIONS);
export type TabRelation = z.infer<typeof tabRelationSchema>;

// `tui`는 harness agent session을 터미널 탭에서 그 CLI의 resume으로 연다(project workspace의 session만).
// `preview`는 그 앱에서 지금 돌고 있는 preview를 앱 view 탭으로 연다(요청의 workspace는 그 앱이다).
// device는 설정 `shell.devices`의 이름이다. 없으면 null이고 desktop 크기다. core가 이름을 확인해 보낸다.
// `artifact`는 요청 workspace(project나 앱)의 artifact `artifacts/<name>/`을 artifact 탭으로 연다.
// `coding`은 project 터미널 탭에서 그 harness의 TUI를 띄운다. handoff 글은 core가 file로 쓰고 payload의 `handoff`에는 file만 간다.
const sharedTargets = [
  z.strictObject({ session: idSchema("ses") }),
  z.strictObject({ tui: idSchema("ses") }),
  z.strictObject({
    browser: z.strictObject({ url: z.string().min(1).max(8192) }),
  }),
  z.strictObject({
    preview: z.strictObject({
      app: idSchema("app"),
      device: z.string().min(1).max(40).nullable().default(null),
    }),
  }),
  z.strictObject({ artifact: z.strictObject({ name: artifactNameSchema }) }),
] as const;
export const hostTabTargetSchema = z.union([
  ...sharedTargets,
  z.strictObject({
    coding: z.strictObject({ harness: z.string().min(1).max(64) }),
  }),
]);
export type HostTabTarget = z.infer<typeof hostTabTargetSchema>;

// `tabs/open` 입력의 coding target이다. payload의 target과 달리 handoff 글을 싣는다.
export const HANDOFF_MAX_BYTES = 64 * 1024;
const codingOpenSchema = z.strictObject({
  coding: z.strictObject({
    harness: z.string().min(1).max(64),
    handoff: z
      .string()
      .min(1)
      .refine(
        (text) =>
          new TextEncoder().encode(text).byteLength <= HANDOFF_MAX_BYTES,
        {
          message: `handoff is at most ${HANDOFF_MAX_BYTES} bytes`,
        },
      ),
  }),
});

const tabOpenPayloadSchema = z.strictObject({
  tab: idSchema("tab"),
  target: hostTabTargetSchema,
  // null은 말하지 않은 것이다. 기본 뜻은 target마다 renderer가 정한다.
  relation: tabRelationSchema.nullable(),
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
  // target이 coding일 때 handoff 글을 쓴 file이다(data root `handoffs/<tab>.md`). 글 자체는 싣지 않는다.
  handoff: z
    .strictObject({ harness: z.string().min(1), file: z.string().min(1) })
    .nullable(),
});

// extension tool 호출이다. 어느 workspace의 일이 아니라 아무 shell main이나 가져간다(요청에 workspace 칸이 없다).
// `workspace`는 부른 session의 자리이고 handler의 호출 맥락이 된다. `credential`은 그 호출만 쓰는 agent token이다.
const toolCallPayloadSchema = z.strictObject({
  extension: z.string().min(1).max(64),
  tool: z.string().min(1).max(64),
  input: z.json(),
  session: idSchema("ses"),
  workspace: hostWorkspaceSchema,
  credential: z.string().min(1),
});

// browser 호출의 act 하나다. ref는 snapshot마다 새로 나고, 낡은 ref는 shell이 `conflict`로 답한다.
const browserRefSchema = z.string().regex(/^e[1-9][0-9]{0,8}$/);
export const browserActSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("click"), ref: browserRefSchema }),
  // 지금 값 끝에 입력한다.
  z.strictObject({
    type: z.literal("type"),
    ref: browserRefSchema,
    text: z.string().max(10_000),
  }),
  // 값을 바꾼다.
  z.strictObject({
    type: z.literal("fill"),
    ref: browserRefSchema,
    text: z.string().max(10_000),
  }),
  // "Enter", "Control+a".
  z.strictObject({
    type: z.literal("press"),
    key: z.string().min(1).max(64),
    ref: browserRefSchema.optional(),
  }),
  z.strictObject({ type: z.literal("hover"), ref: browserRefSchema }),
  // option의 value나 label.
  z.strictObject({
    type: z.literal("select"),
    ref: browserRefSchema,
    values: z.array(z.string().max(1_000)).min(1).max(64),
  }),
  // ref면 보이게, 아니면 page를 dy px.
  z.strictObject({
    type: z.literal("scroll"),
    ref: browserRefSchema.optional(),
    dy: z.number().int().min(-100_000).max(100_000).optional(),
  }),
  // 저장된 login의 값을 친다. id만 싣고 값은 싣지 않는다. core는 `username`이면 metadata의 글을 `fill`로 바꿔 보내고, shell main은
  // `password`·`totp`를 ref 요소가 든 frame의 origin으로 `logins/release`에서 받아 친다.
  z.strictObject({
    type: z.literal("fill_login"),
    ref: browserRefSchema,
    login: loginIdSchema,
    field: z.enum(["username", "password", "totp"]),
  }),
]);
export type BrowserAct = z.infer<typeof browserActSchema>;

export const BROWSER_WAIT_DEFAULT_MS = 10_000;
export const BROWSER_WAIT_MAX_MS = 25_000;
// core가 browser 호출의 답을 기다리는 기한이다. 넘으면 거두고 `unavailable`이다. wait의 최대(25초)가 이 안에 든다.
export const BROWSER_CALL_MS = 30_000;
// `host/take`가 요청을 기다리는 시간이다. 매 take가 TUI hold의 heartbeat이고 hold 갱신이 10초(`BEAT_MS`)라 그보다 짧아야 한다.
export const HOST_TAKE_WAIT_MS = 5_000;

// core가 browser를 쓰려고 shell(앱)을 띄우는 약속이다. 앱의 실행 intent와, 그 길을 켜 달라고 core를 띄운 쪽(shell main, CLI)이
// core env에 주는 표시다. test·boot처럼 사람이 아닌 쪽이 띄운 core는 이 표시가 없어 shell을 띄우지 않는다.
export const AGENT_WINDOW_INTENT = "--agent-window";
export const LAUNCH_SHELL_ENV = "LOPHN_LAUNCH_SHELL";

export const browserActionSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("snapshot") }),
  z.strictObject({ kind: z.literal("act"), act: browserActSchema }),
  z.strictObject({
    kind: z.literal("navigate"),
    url: z.string().min(1).max(8192),
  }),
  z.strictObject({ kind: z.literal("screenshot") }),
  z.strictObject({
    kind: z.literal("evaluate"),
    expression: z.string().min(1).max(65_536),
  }),
  z.strictObject({ kind: z.literal("logs") }),
  // text와 url 중 정확히 하나.
  z.strictObject({
    kind: z.literal("wait"),
    text: z.string().min(1).max(1_000).optional(),
    url: z.string().min(1).max(8192).optional(),
    timeout_ms: z.number().int().min(100).max(BROWSER_WAIT_MAX_MS),
  }),
]);
export type BrowserAction = z.infer<typeof browserActionSchema>;

// browser 탭을 CDP로 다루는 호출이다. `tool_call`처럼 workspace 칸이 없고 아무 shell main이 가져간다. 결과는 `host/done`의 output이다.
const browserCallPayloadSchema = z.strictObject({
  tab: idSchema("tab"),
  view: z.enum(["browser", "preview", "artifact"]),
  action: browserActionSchema,
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
  // 접힌 float을 그 자리에서 편다. layout과 focus는 바꾸지 않는다. float이 아니거나 이미 펴져 있으면 할 일이 없다.
  z.strictObject({
    id: idSchema("hrq"),
    kind: z.literal("tab_show"),
    workspace: hostWorkspaceSchema,
    payload: z.strictObject({ tab: idSchema("tab") }),
  }),
  z.strictObject({
    id: idSchema("hrq"),
    kind: z.literal("tool_call"),
    payload: toolCallPayloadSchema,
  }),
  z.strictObject({
    id: idSchema("hrq"),
    kind: z.literal("browser_call"),
    payload: browserCallPayloadSchema,
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

// 그 workspace들의 가장 오래된, 빌려 가지 않은 요청 하나를 빌려 준다. 있으면 바로, 없으면 요청이 들어올 때까지 기다리다
// `HOST_TAKE_WAIT_MS` 뒤 null이다(long-poll). core가 멈출 때도 null로 끝난다. workspaces가 비어도 부른다:
// 부르는 것이 shell이 붙어 있다는 표시(tool 호출의 `unavailable` 판정)이고 tui의 heartbeat다. `tool_call`·`browser_call` 요청은
// workspaces와 상관없이 아무 호출자에게 간다.
// 빌려 간 요청은 done이 오거나 빌린 기한이 지나면 다시 대기한다. 단 `tool_call`·`browser_call`은 기한이 없다: 오래 돌 수 있고 두 번
// 실행하면 안 된다. shell이 떨어지면 부른 쪽이 `unavailable`로 끝내고 요청을 거둔다.
export const hostTake = defineMemory({
  resource: "host",
  method: "take",
  name: "HostTake",
  input: z.strictObject({
    workspaces: z.array(hostWorkspaceSchema).max(64),
    // 지금 TUI 탭(`tabs/open`의 tui)이 열려 있는 session 전부다. 매 take가 hold의 heartbeat다.
    tui: z.array(idSchema("ses")).max(64),
  }),
  output: z.strictObject({ request: hostRequestSchema.nullable() }),
  actors: ["user"],
  errors,
});

// extension handler나 browser 호출의 결과다. `tool_call`·`browser_call` 요청의 done에만 싣는다.
export const hostToolOutputSchema = z.union([
  z.strictObject({ content: z.array(extensionToolContentSchema).max(64) }),
  z.strictObject({
    error: z.strictObject({
      code: z.enum(ERROR_CODES),
      message: z.string(),
      details: z.record(z.string(), z.unknown()).optional(),
    }),
  }),
]);
export type HostToolOutput = z.infer<typeof hostToolOutputSchema>;

// `retry`면 창이 받지 못한 것이라 요청은 다시 대기한다.
export const hostDone = defineMemory({
  resource: "host",
  method: "done",
  name: "HostDone",
  input: z.strictObject({
    id: idSchema("hrq"),
    result: z.enum(["done", "retry"]),
    output: hostToolOutputSchema.optional(),
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

// 같은 workspace의 열린 session이나 http(s) url의 탭, 그 앱의 preview 탭을 연다. 접수만 답하고 기다리지 않는다.
// session이 아니면 `not_found`, url이 http·https가 아니면 `invalid_input`이다.
// `preview`는 그 앱 workspace의 session과 사람 token만 연다(agent가 다른 앱이면 `not_found`). 돌고 있는 preview가 없으면 `conflict`다.
// `preview`의 device 이름이 `shell.devices`에 없으면 `not_found`다.
// `coding`은 agent가 부른 project workspace의 session만 연다. 그 밖(사람 token, home, 앱)이거나 harness가 `shell.coding_agents.favorites`에 없거나
// adapter에 TUI 첫 prompt 인자(`session.prompt`)가 없으면 `invalid_input`이고 message에 열 수 있는 harness id가 있다. 글은 최대 64 KiB다.
// 사람 token은 `browser`·`preview`·`artifact`만 연다(session·tui·coding은 `invalid_input`). 앱마다 preview 탭은 하나라 이미 있으면 그 탭을 돌려주고 주인이 새로 연 쪽이 된다.
// `artifact`는 agent면 자기 session의 workspace, 사람 token이면 입력의 workspace의 것이다. home이면 `invalid_input`, 입구 `index.html`이
// 없으면 `not_found`다. artifact마다 host 탭은 하나라 preview처럼 이미 있으면 그 탭을 돌려주고 주인이 바뀐다.
// `tui`는 harness agent session을 터미널 탭에서 CLI의 resume으로 연다. harness가 아니거나 project workspace의 session이 아니면
// `invalid_input`, 첫 turn 전이거나 turn이 돌거나 이미 TUI로 열려 있으면 `conflict`다. 열리면 그 session의 headless turn은
// TUI가 끝날 때까지 시작하지 않고 입력은 queue에 남는다(`harness-host.ts`의 Take).
export const tabsOpen = defineMemory({
  resource: "tabs",
  method: "open",
  name: "OpenTab",
  input: z.strictObject({
    target: z.union([...sharedTargets, codingOpenSchema]),
    relation: tabRelationSchema.optional(),
    // 사람 token이 browser 탭을 놓을 workspace다. 없으면 home이다. agent는 자기 session의 workspace를 쓰므로 이 칸을 무시한다.
    workspace: workspaceSchema.optional(),
  }),
  output: acceptedSchema,
  actors: ["agent", "user"],
  errors,
});

// 자기가 연 탭만 닫는다. 남이 연 탭이면 `forbidden`, 없는 탭이면 `not_found`다.
export const tabsClose = defineMemory({
  resource: "tabs",
  method: "close",
  name: "CloseTab",
  input: z.strictObject({ tab: idSchema("tab") }),
  output: acceptedSchema,
  actors: ["agent", "user"],
  errors,
});

// 자기가 연 browser 탭의 url·title·loading이다. 남의 탭이거나 상태가 아직 없으면 `not_found`다.
export const browserRead = defineMemory({
  resource: "browser",
  method: "read",
  name: "ReadBrowserTab",
  input: z.strictObject({ tab: idSchema("tab") }),
  output: browserTabStateSchema,
  actors: ["agent", "user"],
  errors,
});

// 아래 browser/* 호출은 자기가 연 browser·preview·artifact 탭만 다룬다(남의 탭, 사람이 손으로 연 탭, session·agent 탭은 `not_found`).
// 낡은 ref, DevTools가 열려 있음, 사람이 take control 중인 쓰기는 `conflict`, shell이 없거나 탭이 창에 열려 있지 않거나 기한이 지나면
// `unavailable`, 틀린 url(http(s)·about:blank 밖)·preview·artifact 탭의 navigate·틀린 act는 `invalid_input`이다.
const browserTabInput = { tab: idSchema("tab") };

// 접근성 tree다. 줄마다 `- <role> "<name>" [ref=e12]`고 들여쓰기가 깊이다.
export const browserSnapshot = defineMemory({
  resource: "browser",
  method: "snapshot",
  name: "BrowserSnapshot",
  input: z.strictObject(browserTabInput),
  output: z.strictObject({ snapshot: z.string() }),
  actors: ["agent", "user"],
  errors,
});

const browserPageSchema = z.strictObject({
  url: z.string(),
  title: z.string(),
  // 조작 중 열린 dialog를 닫았으면 그 내용이다.
  dialog: z.strictObject({ type: z.string(), message: z.string() }).optional(),
  // fill_login이 쳤다. 값은 어디에도 없다.
  filled: z.literal(true).optional(),
});
export type BrowserPage = z.infer<typeof browserPageSchema>;

export const browserAct = defineMemory({
  resource: "browser",
  method: "act",
  name: "BrowserAct",
  // browserActSchema의 칸을 펴 둔 것이다. core가 type별로 다시 검사한다.
  input: z.strictObject({
    ...browserTabInput,
    type: z.enum([
      "click",
      "type",
      "fill",
      "press",
      "hover",
      "select",
      "scroll",
      "fill_login",
    ]),
    ref: z.string().optional(),
    text: z.string().optional(),
    key: z.string().optional(),
    values: z.array(z.string()).optional(),
    dy: z.number().optional(),
    login: z.string().optional(),
    field: z.string().optional(),
  }),
  output: browserPageSchema,
  actors: ["agent", "user"],
  errors,
});

export const browserNavigate = defineMemory({
  resource: "browser",
  method: "navigate",
  name: "BrowserNavigate",
  input: z.strictObject({
    ...browserTabInput,
    url: z.string().min(1).max(8192),
  }),
  output: browserPageSchema,
  actors: ["agent", "user"],
  errors,
});

// 보이는 영역의 PNG다.
export const browserScreenshot = defineMemory({
  resource: "browser",
  method: "screenshot",
  name: "BrowserScreenshot",
  input: z.strictObject(browserTabInput),
  output: z.strictObject({
    image: z.strictObject({
      media_type: z.literal("image/png"),
      data_base64: z.string(),
    }),
  }),
  actors: ["agent", "user"],
  errors,
});

// page 안의 예외는 오류가 아니라 `exception` 글이다.
export const browserEvaluate = defineMemory({
  resource: "browser",
  method: "evaluate",
  name: "BrowserEvaluate",
  input: z.strictObject({
    ...browserTabInput,
    expression: z.string().min(1).max(65_536),
  }),
  output: z.strictObject({
    value: z.json().optional(),
    exception: z.string().optional(),
  }),
  actors: ["agent", "user"],
  errors,
});

// 붙은 뒤의 console 줄과 page 오류, 최근 200줄이다.
export const browserLogs = defineMemory({
  resource: "browser",
  method: "logs",
  name: "BrowserLogs",
  input: z.strictObject(browserTabInput),
  output: z.strictObject({ logs: z.string() }),
  actors: ["agent", "user"],
  errors,
});

// text·url 중 정확히 하나가 시간 안에 맞기를 기다린다.
export const browserWait = defineMemory({
  resource: "browser",
  method: "wait",
  name: "BrowserWait",
  input: z.strictObject({
    ...browserTabInput,
    text: z.string().min(1).max(1_000).optional(),
    url: z.string().min(1).max(8192).optional(),
    timeout_ms: z.number().int().min(100).max(BROWSER_WAIT_MAX_MS).optional(),
  }),
  output: browserPageSchema,
  actors: ["agent", "user"],
  errors,
});

// 자기가 연 탭을 사람에게 보인다(접힌 float을 편다). 사람 손이 필요할 때(로그인, captcha) `ask`와 같이 쓴다. 남이 연 탭이면
// `forbidden`, 없는 탭이면 `not_found`다. 접수만 답한다.
export const tabsShow = defineMemory({
  resource: "tabs",
  method: "show",
  name: "ShowTab",
  input: z.strictObject({ tab: idSchema("tab") }),
  output: acceptedSchema,
  actors: ["agent", "user"],
  errors,
});

export const HOST_QUEUE_MEMORY_ROUTES = [
  hostTake,
  hostDone,
  hostReport,
  tabsOpen,
  tabsClose,
  tabsShow,
  browserRead,
  browserSnapshot,
  browserAct,
  browserNavigate,
  browserScreenshot,
  browserEvaluate,
  browserLogs,
  browserWait,
] as const;
