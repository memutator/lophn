import { z } from "zod";
import { idSchema } from "../base/ids.ts";
import { defineMemory } from "../base/route.ts";
import { sessionStatusRead } from "./session-status.ts";
import { workspaceOutputSchema, workspaceSchema } from "./workspaces.ts";

// session lifecycle: core가 앱에 주는 session의 목록과 상태 event다. 앱은 입력에서 자기를 말하지 않는다: 앱 process는 자식
// credential이, 앱 화면은 shell main이 sender view에서 정한다. 앱이 보는 session은 그 앱 workspace에 사는 agent가 call로 닿을 수
// 있는 workspace의 것뿐이다(call 정책: private workspace는 안 보이고 같은 workspace는 늘 보인다).
// 상태는 한 곳(core의 session 상태 파생)에서 나온다. event는 상태가 바뀐 뒤(commit 뒤)에만 낸다.

export const SESSION_EVENTS = [
  "session.started",
  "session.running",
  "session.waiting",
  "session.idle",
  "session.ended",
] as const;
export type SessionEventName = (typeof SESSION_EVENTS)[number];

// lophn은 lophn runtime, harness는 headless harness runtime(claude-code·codex·opencode)의 session, terminal은 사람 터미널 탭에서
// 도는 coding agent CLI다. terminal은 core의 session이 아니라 shell main이 알려 준 것이라 id가 `term:<탭>`이다.
export const SESSION_KINDS = ["lophn", "harness", "terminal"] as const;
export const sessionKindSchema = z.enum(SESSION_KINDS);
export type SessionKind = z.infer<typeof sessionKindSchema>;

export const sessionRefSchema = z.union([
  idSchema("ses"),
  z.string().regex(/^term:.+$/),
]);

// 터미널 CLI의 상태. hook을 들은 적 없으면 unknown이다.
const sessionStateSchema = z.enum(["running", "waiting", "idle", "unknown"]);

export const sessionInfoSchema = z.object({
  session: sessionRefSchema,
  kind: sessionKindSchema,
  // agent가 있는 session(lophn·harness)의 handle, 보이는 이름, runtime. terminal은 null이다.
  agent: z
    .object({
      handle: z.string(),
      name: z.string(),
      runtime: z.string(),
    })
    .nullable(),
  // harness runtime의 harness나 terminal의 harness id. 아니면 null.
  harness: z.string().nullable(),
  // home이면 null이다.
  workspace: workspaceOutputSchema.nullable(),
  title: z.string().nullable(),
  state: sessionStateSchema,
  // waiting일 때 무엇을 기다리나. 아니면 null이다. terminal은 권한 물음이라 approval이다.
  waiting_for: z.enum(["approval", "question"]).nullable(),
  // 마지막 turn이 끝난(없으면 시작한) 시각. turn을 모르면 null이다.
  last_active_at: z.string().nullable(),
  // team spawn으로 열렸으면 연 session.
  spawned_by: idSchema("ses").nullable(),
  // session이 일하는 기본 폴더와 workspace의 폴더 목록. 없으면 null과 빈 목록이다. 터미널은 탭이 뜬 폴더다.
  cwd: z.string().nullable(),
  folders: z.array(z.string()),
  // terminal session만.
  terminal: z
    .object({
      harness: z.string(),
      // CLI 자신의 session id(hook이 알려 준 것). 모르면 null.
      cli_session: z.string().nullable(),
      // 터미널 탭 참조.
      tab: z.string(),
      // PTY shell의 pid. 모르면 null. CLI 자신의 pid가 아니다(process 목록은 앱이 shell pid에서 따라간다).
      shell_pid: z.number().int().positive().nullable(),
    })
    .nullable(),
});
export type SessionInfo = z.infer<typeof sessionInfoSchema>;

// shell main이 core에 알리는 터미널 coding agent 하나다. core는 메모리에만 두고 shell이 떨어지면 비운다.
export const terminalSessionReportSchema = z.strictObject({
  terminal_ref: z.string().min(1),
  project: idSchema("prj"),
  harness: z.string().min(1),
  state: sessionStateSchema,
  cli_session: z.string().min(1).nullable(),
  title: z.string().nullable(),
  cwd: z.string().nullable(),
  shell_pid: z.number().int().positive().nullable(),
});
export type TerminalSessionReport = z.infer<typeof terminalSessionReportSchema>;

const errors = [
  "invalid_input",
  "forbidden",
  "not_found",
  "conflict",
  "unavailable",
  "unauthorized",
] as const;

// 앱 자격이면 app은 자격이 정한 앱이고 입력에 두지 않는다. 사람 자격(shell main이 앱 화면을 대신한다)이면 app을 준다.
const onBehalf = { app: idSchema("app").optional() };

export const appSessionsList = defineMemory({
  resource: "app_sessions",
  method: "list",
  name: "app_sessions.list",
  input: z.strictObject({
    ...onBehalf,
    workspace: z
      .union([workspaceSchema, z.strictObject({ kind: z.literal("home") })])
      .optional(),
    state: z.enum(["running", "waiting", "idle", "unknown"]).optional(),
    harness: z.string().min(1).optional(),
    kind: sessionKindSchema.optional(),
    // 한 session만(보이면 그 한 줄, 아니면 빈 목록). 앱 화면의 ACP 붙이기가 보이는 session인지 묻는 데 쓴다.
    session: sessionRefSchema.optional(),
  }),
  output: z.object({ sessions: z.array(sessionInfoSchema) }),
  actors: ["app", "user"],
  errors,
});

// 보이지 않는 session은 없는 session과 같은 not_found다.
export const appSessionsStatus = defineMemory({
  resource: "app_sessions",
  method: "status",
  name: "app_sessions.status",
  input: z.strictObject({ ...onBehalf, session: idSchema("ses") }),
  output: sessionStatusRead.output,
  actors: ["app", "user"],
  errors,
});

// 도는 turn을 멈추고 그 turn에 딸린 process를 정리한다. 시야 안 모든 session에 열려 있다(승인·rewind·지움은 열지 않는다).
// 앱이 멈춘 것은 사람이 알 수 있게 기록된다(Inbox의 program 기록). terminal session은 그 CLI의 끊기 key를 보낸다:
// key가 없는 harness는 `unavailable`이다. 멈출 turn이 없으면 stopped가 false다.
export const appSessionsStop = defineMemory({
  resource: "app_sessions",
  method: "stop",
  name: "app_sessions.stop",
  changes: [],
  input: z.strictObject({ ...onBehalf, session: sessionRefSchema }),
  output: z.object({ stopped: z.boolean() }),
  actors: ["app", "user"],
  errors,
});

// 앱 화면이 session을 연다(view-first, 앱 process에는 이 길이 없다). workspace를 빼면 그 앱 workspace이고, 주면 그 앱이 call로 닿을 수 있는
// workspace(call 정책)에 연다. agent는 handle로 부르고(그 workspace에서 보이는 것: 전역, 그 workspace의 범위 agent, lophn), 열린 session은 이 앱이
// 열었다는 표시를 달고 나온다(앱은 그 session만 끝낸다). 제목은 겉모습이라 못 붙여도 열린다.
export const appSessionsOpen = defineMemory({
  resource: "app_sessions",
  method: "open",
  name: "app_sessions.open",
  changes: [{ name: "sessions", id: (_input, output) => output.session }],
  input: z.strictObject({
    app: idSchema("app"),
    agent: z.string().min(1),
    workspace: workspaceSchema.optional(),
    title: z.string().trim().min(1).optional(),
  }),
  output: z.object({ session: idSchema("ses") }),
  actors: ["user"],
  errors,
});

// 앱이 자기가 연 session을 끝낸다(archive와 같은 영향: 도는 turn 중단, 받은 call 실패, 대기 요청 취소, queue 비움). 남이 연
// session(사람이 연 것 포함)은 forbidden이고, 이미 끝난 session은 ended가 false다.
export const appSessionsEnd = defineMemory({
  resource: "app_sessions",
  method: "end",
  name: "app_sessions.end",
  changes: [{ name: "sessions", id: (input) => input.session }],
  input: z.strictObject({ app: idSchema("app"), session: idSchema("ses") }),
  output: z.object({ ended: z.boolean() }),
  actors: ["user"],
  errors,
});

// shell main이 터미널 coding agent의 지금 집합을 알린다(통째로 바꾼다). 호출이 곧 shell이 붙어 있다는 표시라 끊기면 core가 비운다.
export const terminalSessionsReport = defineMemory({
  resource: "terminal_sessions",
  method: "report",
  name: "terminal_sessions.report",
  changes: [],
  input: z.strictObject({
    sessions: z.array(terminalSessionReportSchema).max(64),
  }),
  output: z.strictObject({}),
  actors: ["user"],
  errors,
});

export const SESSION_LIFECYCLE_ROUTES = [
  appSessionsList,
  appSessionsStatus,
  appSessionsStop,
  appSessionsOpen,
  appSessionsEnd,
  terminalSessionsReport,
] as const;
