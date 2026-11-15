import { z } from "zod";
import { idSchema } from "../base/ids.ts";
import { defineMemory, defineRead } from "../base/route.ts";

// coding session: 사람 터미널 탭에서 도는 coding agent CLI 하나다. shell main(host)이 탭과 GUI handle을 갖고, core는
// host가 `/host-link`로 올린 보고와 ACP 상태 사본을 메모리에 둔다. ledger에는 행이 없다. session id는 desktop GUI 화면과 같은
// `ses_<터미널 탭 ULID>`(`guiSessionId`)이고 대화는 기존 `acp/snapshot`·`acp/send`·`AcpUpdated`로 읽고 쓴다.

// switch가 지금 막힌 까닭이다. no_session: CLI session id를 몰라 GUI로 다시 열 수 없다. not_running: 터미널에 GUI가 되는 coding
// agent가 돌지 않는다. extension_off: harness GUI extension이 꺼졌다. unsupported_os: 이 OS에서 GUI 전환을 못 한다.
const switchBlockedSchema = z.enum([
  "no_session",
  "not_running",
  "extension_off",
  "unsupported_os",
]);

export const codingSessionSchema = z.strictObject({
  session: idSchema("ses"),
  // 터미널 탭 참조(`trm_…`).
  terminal: z.string().min(1),
  harness: z.string().min(1),
  // harness의 보이는 이름(`Claude Code`). 모르는 harness면 id 그대로다.
  label: z.string(),
  project: idSchema("prj"),
  cwd: z.string().nullable(),
  title: z.string().nullable(),
  state: z.enum(["running", "waiting", "idle", "unknown"]),
  // 지금 탭이 보이는 것. gui면 대화가 폰에 오고, tui면 터미널 화면뿐이다.
  view: z.enum(["gui", "tui"]),
  // GUI로 넘길 때 CLI를 다시 띄우나(restart) 같은 대화를 나눠 보나(shared). GUI가 되지 않으면 null.
  handoff: z.enum(["restart", "shared"]).nullable(),
  cli_session: z.string().nullable(),
  last_active_at: z.string().nullable(),
  // null이면 다른 view로 바꿀 수 있다.
  switch: z.strictObject({ blocked: switchBlockedSchema }).nullable(),
});
export type CodingSession = z.infer<typeof codingSessionSchema>;

const errors = [
  "invalid_input",
  "unauthorized",
  "forbidden",
  "not_found",
  "conflict",
  "unavailable",
] as const;

// shell이 붙어 있지 않으면 `shell: absent`이고 목록이 비었다(폰이 깨우기를 보인다).
export const codingSessionsList = defineRead({
  resource: "coding_sessions",
  method: "list",
  name: "CodingSessionsList",
  input: z.strictObject({ project: idSchema("prj").optional() }),
  output: z.strictObject({
    shell: z.enum(["attached", "absent"]),
    sessions: z.array(codingSessionSchema),
  }),
  reads: ["coding_sessions"],
  actors: ["user"],
  errors: ["invalid_input", "unauthorized", "forbidden"],
});

// 바꾸기 전에 사람에게 보일 것: 어느 쪽으로 가고 무엇이 멈추나. tui→gui는 도는 CLI를 끝내고 다시 띄우므로 도는 turn이 끊긴다.
// gui→tui는 GUI 대화의 도는 turn, 도는 background task, 줄 선 메시지가 멈춘다.
export const codingSessionsSwitchPlan = defineRead({
  resource: "coding_sessions",
  method: "switch_plan",
  name: "CodingSessionsSwitchPlan",
  input: z.strictObject({ session: idSchema("ses") }),
  output: z.strictObject({
    to: z.enum(["gui", "tui"]),
    stops: z.strictObject({
      turn: z.boolean(),
      tasks: z.number().int().nonnegative(),
      queued: z.number().int().nonnegative(),
    }),
    blocked: switchBlockedSchema.exclude(["extension_off"]).nullable(),
  }),
  reads: [{ name: "coding_sessions", id: (input) => input.session }],
  actors: ["user"],
  errors: ["invalid_input", "unauthorized", "forbidden", "not_found"],
});

// 탭의 view를 바꾼다. 도는 turn이 끊기고 desktop 탭도 바뀌는 일이라 사람이 확인한 뒤에만 부른다: `confirmed: true`가 없으면
// `invalid_input`이다. 이미 그 view면 conflict, host가 없거나 연결이 닫히면 unavailable이다. host가 거절하면 그 code와
// `details.reason`(no_session|not_running|extension_off|unsupported_os|failed) 그대로다. 같은 key는 한 번만 보낸다.
export const codingSessionsSwitch = defineMemory({
  resource: "coding_sessions",
  method: "switch",
  name: "CodingSessionsSwitch",
  changes: [{ name: "coding_sessions", id: (input) => input.session }],
  input: z.strictObject({
    session: idSchema("ses"),
    to: z.enum(["gui", "tui"]),
    confirmed: z.literal(true),
    key: z.string().min(1).max(200),
  }),
  output: z.strictObject({ ok: z.literal(true) }),
  actors: ["user"],
  errors,
});

export const CODING_RELAY_ROUTES = [
  codingSessionsList,
  codingSessionsSwitchPlan,
  codingSessionsSwitch,
] as const;
