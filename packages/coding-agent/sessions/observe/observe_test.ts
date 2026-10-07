// session 관측 normalizer 시험이다(coding-agent#T39, sessions#R6–R10, harnesses#R11). 제품별 fixture event
// stream을 정규화해 상태·evidence·native ID를 본다. 실제 harness를 띄우지 않고 파일·process·socket도 열지 않는다.
import { assert, assertEquals, assertFalse } from "@std/assert";
import {
  acceptObservation,
  endedByProcessExit,
  type HarnessId,
  type HarnessSessionObservation,
  harnessSessionObservationSchema,
  observationAt,
  type SessionState,
  unknownObservation,
} from "../../../contracts/coding-agent/mod.ts";
import { HARNESS_CATALOG } from "../../harnesses/mod.ts";
import {
  observationFromPayload,
  type ObserveContext,
  observeStream,
} from "./mod.ts";

const NOW = "2026-10-07T01:00:00.000Z";
const CONTEXT: ObserveContext = { now: NOW };
const CWD = "/work/app";

// 한 stream의 상태 순서다. 상태 evidence가 아닌 event는 건너뛴다.
function statesOf(harness: HarnessId, stream: unknown[]): SessionState[] {
  const states: SessionState[] = [];
  for (const payload of stream) {
    const observation = observationFromPayload(harness, payload, CONTEXT);
    if (observation !== null) states.push(observation.state);
  }
  return states;
}

function observe(
  harness: HarnessId,
  payload: unknown,
): HarnessSessionObservation {
  const observation = observationFromPayload(harness, payload, CONTEXT);
  assert(observation !== null, `${harness} 상태 evidence가 있어야 한다`);
  return observation;
}

const claudeHook = (event: string, extra: Record<string, unknown> = {}) => ({
  hook_event_name: event,
  session_id: "claude-sess-1",
  transcript_path: "/home/u/.claude/projects/app/claude-sess-1.jsonl",
  cwd: CWD,
  ...extra,
});

const geminiHook = (event: string, extra: Record<string, unknown> = {}) => ({
  hook_event_name: event,
  session_id: "gemini-sess-1",
  transcript_path: "/home/u/.gemini/tmp/chats/gemini-sess-1.json",
  cwd: CWD,
  timestamp: "2026-10-07T00:59:59.000Z",
  ...extra,
});

const CLAUDE_STREAM = [
  claudeHook("SessionStart", { source: "startup" }),
  claudeHook("UserPromptSubmit", { prompt: "비밀 prompt 원문" }),
  claudeHook("PermissionRequest", { tool_name: "Bash" }),
  claudeHook("PostToolUse", { tool_name: "Bash" }),
  claudeHook("Stop"),
  claudeHook("SessionEnd", { reason: "prompt_input_exit" }),
];

const CODEX_STREAM = [
  { hook_event_name: "SessionStart", session_id: "codex-1", cwd: CWD },
  { hook_event_name: "UserPromptSubmit", session_id: "codex-1", cwd: CWD },
  { hook_event_name: "PermissionRequest", session_id: "codex-1", cwd: CWD },
  { hook_event_name: "PostToolUse", session_id: "codex-1", cwd: CWD },
  { hook_event_name: "Stop", session_id: "codex-1", cwd: CWD },
];

const GEMINI_STREAM = [
  geminiHook("SessionStart", { source: "startup" }),
  geminiHook("BeforeAgent", { prompt: "원문" }),
  geminiHook("BeforeTool", { tool_name: "run_shell_command" }),
  geminiHook("Notification", {
    notification_type: "ToolPermission",
    message: "Allow?",
    details: { type: "exec" },
  }),
  geminiHook("BeforeTool", { tool_name: "run_shell_command" }),
  geminiHook("AfterTool", { tool_name: "run_shell_command" }),
  geminiHook("AfterAgent"),
  geminiHook("SessionEnd", { reason: "exit" }),
];

const OPENCODE_STREAM = [
  {
    type: "session.status",
    properties: { sessionID: "ses_oc1", status: { type: "busy" } },
  },
  { type: "permission.asked", properties: { sessionID: "ses_oc1", id: "p1" } },
  {
    type: "permission.replied",
    properties: { sessionID: "ses_oc1", requestID: "p1", reply: "once" },
  },
  {
    type: "session.status",
    properties: { sessionID: "ses_oc1", status: { type: "retry" } },
  },
  {
    type: "session.status",
    properties: { sessionID: "ses_oc1", status: { type: "idle" } },
  },
  { type: "session.idle", properties: { sessionID: "ses_oc1" } },
];

const PI_STREAM = [
  {
    event: "session_start",
    reason: "startup",
    session_id: "pi-1",
    session_file: "/home/u/.pi/agent/sessions/pi-1.jsonl",
  },
  { event: "agent_start", session_id: "pi-1" },
  { event: "tool_execution_start", session_id: "pi-1" },
  { event: "agent_end", session_id: "pi-1" },
  { event: "agent_start", session_id: "pi-1" },
  { event: "agent_end", session_id: "pi-1" },
  { event: "agent_settled", session_id: "pi-1" },
  { event: "session_shutdown", reason: "quit", session_id: "pi-1" },
];

Deno.test("coding-agent/sessions#R6: 제품별 fixture stream은 정해진 상태 순서가 된다", () => {
  assertEquals(statesOf("claude", CLAUDE_STREAM), [
    "ready",
    "working",
    "waiting_input",
    "working",
    "ready",
    "ended",
  ]);
  assertEquals(statesOf("codex", CODEX_STREAM), [
    "ready",
    "working",
    "waiting_input",
    "working",
    "ready",
  ]);
  assertEquals(statesOf("gemini", GEMINI_STREAM), [
    "ready",
    "working",
    "working",
    "waiting_input",
    "working",
    "working",
    "ready",
    "ended",
  ]);
  assertEquals(statesOf("opencode", OPENCODE_STREAM), [
    "working",
    "waiting_input",
    "working",
    "working",
    "ready",
    "ready",
  ]);
});

Deno.test("coding-agent/sessions#R6: observation은 evidence 시각·출처·참조를 달고 계약 schema를 지킨다", () => {
  const cases: [HarnessId, unknown, string, string][] = [
    ["claude", CLAUDE_STREAM[1], "hook", "claude:UserPromptSubmit"],
    ["codex", CODEX_STREAM[2], "hook", "codex:PermissionRequest"],
    ["gemini", GEMINI_STREAM[3], "hook", "gemini:Notification:ToolPermission"],
    ["opencode", OPENCODE_STREAM[1], "plugin", "opencode:permission.asked"],
    ["pi", PI_STREAM[6], "extension", "pi:agent_settled"],
  ];
  for (const [harness, payload, source, ref] of cases) {
    const observation = observe(harness, payload);
    harnessSessionObservationSchema.parse(observation);
    assertEquals(observation.observed_at, NOW, harness);
    assertEquals(observation.evidence_source, source, harness);
    assertEquals(observation.evidence_ref, ref, harness);
    assertEquals(observation.freshness, "fresh", harness);
    assertEquals(observation.reason, null, harness);
  }
});

Deno.test("coding-agent/sessions#R6: Gemini의 ToolPermission Notification만 waiting_input이고 Before·After event로 추정하지 않는다", () => {
  const permission = observe("gemini", GEMINI_STREAM[3]);
  assertEquals(permission.state, "waiting_input");
  // 다른 notification과 Before/After event는 waiting_input이 아니다.
  const other = geminiHook("Notification", { notification_type: "Info" });
  assertEquals(observationFromPayload("gemini", other, CONTEXT), null);
  for (
    const event of ["BeforeAgent", "BeforeTool", "AfterTool", "AfterAgent"]
  ) {
    const observation = observe("gemini", geminiHook(event));
    assert(observation.state !== "waiting_input", event);
  }
});

Deno.test("coding-agent/sessions#R6: pi agent_settled는 ready이고 agent_end보다 강하며 session_shutdown·done·idle은 ended가 아니다", () => {
  // agent_end만으로는 retry·compaction이 남을 수 있어 ready가 아니다.
  assertEquals(
    observationFromPayload(
      "pi",
      { event: "agent_end", session_id: "pi-1" },
      CONTEXT,
    ),
    null,
  );
  assertEquals(observe("pi", { event: "agent_settled" }).state, "ready");
  // stream에서 agent_end가 끼어 있어도 ready는 agent_settled에서만 온다.
  assertEquals(statesOf("pi", PI_STREAM), [
    "ready",
    "working",
    "working",
    "working",
    "ready",
  ]);
  // runtime 교체인 session_shutdown과 다른 이름의 done·idle은 ended가 아니다.
  for (const reason of ["quit", "reload", "new", "resume", "fork"]) {
    const shutdown = { event: "session_shutdown", reason, session_id: "pi-1" };
    assertEquals(observationFromPayload("pi", shutdown, CONTEXT), null, reason);
  }
  for (const event of ["done", "idle"]) {
    assertEquals(observationFromPayload("pi", { event }, CONTEXT), null, event);
  }
  for (const state of statesOf("pi", PI_STREAM)) assert(state !== "ended");
});

Deno.test("coding-agent/sessions#R6: SessionEnd만 ended이고 Stop·AfterAgent·idle은 turn 끝이며 clear는 session 교체다", () => {
  assertEquals(observe("claude", claudeHook("Stop")).state, "ready");
  assertEquals(observe("gemini", geminiHook("AfterAgent")).state, "ready");
  assertEquals(
    observe("opencode", OPENCODE_STREAM[4]).state,
    "ready",
  );
  assertEquals(
    observe("claude", claudeHook("SessionEnd", { reason: "logout" })).state,
    "ended",
  );
  const cleared = claudeHook("SessionEnd", { reason: "clear" });
  assertEquals(observationFromPayload("claude", cleared, CONTEXT), null);
  const compact = claudeHook("SessionStart", { source: "compact" });
  assertEquals(observationFromPayload("claude", compact, CONTEXT), null);
  // subagent의 event는 main session 상태가 아니다.
  const sub = claudeHook("Stop", { agent_id: "agent-9", agent_type: "task" });
  assertEquals(observationFromPayload("claude", sub, CONTEXT), null);
});

Deno.test("coding-agent/sessions#R6: 관측이 없거나 낡거나 끊기면 unknown이고 process exit는 ended이며 ticket 완료가 아니다", () => {
  const working = observe("claude", claudeHook("UserPromptSubmit"));
  assertEquals(observationAt(null, NOW).state, "unknown");
  assertEquals(observationAt(working, NOW).state, "working");
  const later = "2026-10-07T01:16:00.000Z";
  const stale = observationAt(working, later);
  assertEquals(stale.state, "unknown");
  assertEquals(stale.freshness, "stale");
  assert(stale.reason !== null);
  // 수집 끊김은 unknown이다.
  const lost = unknownObservation(working, "관측 socket이 끊겼다");
  assertEquals(observationAt(lost, NOW).state, "unknown");
  // process exit는 ended다. 낡아도 ended로 남고 unknown으로 되돌아가지 않는다.
  const ended = endedByProcessExit(working, NOW);
  assertEquals(ended.state, "ended");
  assertEquals(ended.evidence_source, "process");
  harnessSessionObservationSchema.parse(ended);
  assertEquals(observationAt(ended, later).state, "ended");
  // 같은 generation의 늦은 작업 event로 되살리지 않는다.
  const revived = acceptObservation(ended, working);
  assertEquals(revived.state, "ended");
  assertEquals(unknownObservation(ended, "끊겼다").state, "ended");
  // ended 이후에도 ticket 필드·claim을 만들지 않는다.
  assertEquals(ended.ticket, null);
  assertEquals(ended.connection, null);
});

Deno.test("coding-agent/sessions#R6: 연속 관측을 받으면 SessionEnd에서 ended로 멈추고 이어지는 event로 되살아나지 않는다", () => {
  let current: HarnessSessionObservation | null = null;
  const seen: SessionState[] = [];
  for (const payload of GEMINI_STREAM) {
    const next = observationFromPayload("gemini", payload, CONTEXT);
    if (next === null) continue;
    current = acceptObservation(current, next);
    seen.push(current.state);
  }
  assertEquals(seen.at(-1), "ended");
  const late = observe("gemini", geminiHook("BeforeAgent"));
  assertEquals(acceptObservation(current, late).state, "ended");
});

Deno.test("coding-agent/sessions#R7: native ID는 hook·plugin·extension payload의 값뿐이고 session file은 ID와 따로 둔다", () => {
  const claude = observe("claude", claudeHook("SessionStart"));
  assertEquals(claude.provider_session?.id, "claude-sess-1");
  assertEquals(claude.provider_session?.source, "hook");
  assertEquals(
    claude.provider_session?.transcript_path,
    "/home/u/.claude/projects/app/claude-sess-1.jsonl",
  );
  assertEquals(
    observe("gemini", GEMINI_STREAM[0]).provider_session?.id,
    "gemini-sess-1",
  );
  const opencode = observe("opencode", OPENCODE_STREAM[0]);
  assertEquals(opencode.provider_session?.id, "ses_oc1");
  assertEquals(opencode.provider_session?.source, "plugin");
  const pi = observe("pi", PI_STREAM[0]);
  assertEquals(pi.provider_session?.id, "pi-1");
  assertEquals(pi.provider_session?.source, "extension");
  assertEquals(
    pi.provider_session?.transcript_path,
    "/home/u/.pi/agent/sessions/pi-1.jsonl",
  );
  // session file만 있고 ID가 없으면 ID는 없음이다.
  const fileOnly = observe("pi", {
    event: "agent_settled",
    session_file: "/home/u/.pi/agent/sessions/pi-2.jsonl",
  });
  assertEquals(fileOnly.provider_session, null);
});

Deno.test("coding-agent/sessions#R7: ID evidence가 없으면 null이고 터미널·connection·ses ID나 cwd로 채우지 않는다", () => {
  const decoys = {
    terminal_id: "term-1",
    runtime_ref: "term-1",
    connection: "cac_01h455vb4pex5v6nkc6gd5fdw1",
    ticket: "tkt_01h455vb4pex5v6nkc6gd5fdw1",
    lophn_session: "ses_01h455vb4pex5v6nkc6gd5fdw1",
    agent_session_id: "ses_01h455vb4pex5v6nkc6gd5fdw1",
  };
  const cases: [HarnessId, unknown][] = [
    ["claude", { hook_event_name: "Stop", cwd: CWD, ...decoys }],
    ["codex", { hook_event_name: "Stop", cwd: CWD, ...decoys }],
    ["gemini", { hook_event_name: "AfterAgent", cwd: CWD, ...decoys }],
    ["opencode", {
      type: "session.idle",
      properties: { ...decoys },
    }],
    ["pi", { event: "agent_settled", ...decoys }],
  ];
  for (const [harness, payload] of cases) {
    const observation = observe(harness, payload);
    assertEquals(observation.provider_session, null, harness);
  }
  // 값이 안전하지 않은 ID(제어 문자·leading dash)도 ID가 아니다.
  const unsafe = claudeHook("Stop", { session_id: "-bad" });
  assertEquals(observe("claude", unsafe).provider_session, null);
  const control = claudeHook("Stop", { session_id: "a\nb" });
  assertEquals(observe("claude", control).provider_session, null);
});

Deno.test("coding-agent/sessions#R6 coding-agent/sessions#R7: 미검증 Hermes·OpenClaw는 어떤 payload도 unknown이고 ID가 없다", () => {
  for (const harness of ["hermes", "openclaw"] as const) {
    for (
      const payload of [
        { hook_event_name: "UserPromptSubmit", session_id: "h-1" },
        { event: "agent_settled", session_id: "h-1" },
      ]
    ) {
      const observation = observe(harness, payload);
      assertEquals(observation.state, "unknown", harness);
      assertEquals(observation.provider_session, null, harness);
      assert(observation.reason !== null, harness);
      harnessSessionObservationSchema.parse(observation);
    }
  }
});

Deno.test("coding-agent/sessions#R8: 정규화한 관측은 소유·runtime·connection·ticket을 주장하지 않고 cwd가 같아도 합치지 않는다", () => {
  const claims = {
    origin: "lophn_terminal",
    runtime_ref: "term-1",
    connection: "cac_01h455vb4pex5v6nkc6gd5fdw1",
    ticket: "tkt_01h455vb4pex5v6nkc6gd5fdw1",
    started_by_lophn: true,
    prompt_delivered: true,
  };
  const first = observe("claude", claudeHook("Stop", claims));
  const second = observe(
    "claude",
    { ...claudeHook("UserPromptSubmit", claims), session_id: "claude-sess-2" },
  );
  for (const observation of [first, second]) {
    assertEquals(observation.origin, "external_terminal");
    assertEquals(observation.runtime_ref, null);
    assertEquals(observation.connection, null);
    assertEquals(observation.ticket, null);
    assertEquals(observation.cwd, CWD);
  }
  // 같은 cwd의 두 session은 서로의 ID와 상태를 건드리지 않는다.
  assertEquals(first.provider_session?.id, "claude-sess-1");
  assertEquals(second.provider_session?.id, "claude-sess-2");
  assertEquals(first.state, "ready");
  assertEquals(second.state, "working");
  // 상대 경로 cwd는 evidence가 아니다.
  assertEquals(
    observe("claude", claudeHook("Stop", { cwd: "relative/dir" })).cwd,
    null,
  );
});

Deno.test("coding-agent/sessions#R9: 관측 entry는 상태 evidence만 내고 claim 필드나 완료 판정을 만들지 않는다", () => {
  const outcome = observeStream(
    "claude",
    CLAUDE_STREAM.map((payload) => JSON.stringify(payload)).join("\n"),
    CONTEXT,
  );
  for (const observation of outcome.observations) {
    const keys = Object.keys(observation);
    assertFalse(keys.includes("claim"));
    assertFalse(keys.includes("completion"));
    assertEquals(observation.ticket, null);
  }
  // 마지막 observation이 ended여도 ticket 완료가 아니다. 완료는 소유 concern의 보고·검사 event다.
  assertEquals(outcome.observations.at(-1)?.state, "ended");
});

Deno.test("coding-agent/sessions#R10: lophn 재시작 뒤 이전 관측은 unknown이고 재관측만 상태를 되돌린다", () => {
  const working = observe("claude", claudeHook("UserPromptSubmit"));
  const restarted = unknownObservation(working, "lophn이 다시 시작되었다");
  assertEquals(restarted.state, "unknown");
  assertEquals(restarted.freshness, "stale");
  assertEquals(observationAt(restarted, NOW).state, "unknown");
  // 마지막 evidence는 지난 값으로 남는다.
  assertEquals(restarted.evidence_ref, working.evidence_ref);
  assertEquals(restarted.provider_session?.id, "claude-sess-1");
  // 재관측만 live 상태를 만든다. normalizer는 spawn·prompt 재전송을 만들지 않는다.
  const again = acceptObservation(
    restarted,
    observe("claude", claudeHook("Stop", { session_id: undefined })),
  );
  assertEquals(again.state, "ready");
  assertEquals(again.provider_session?.id, "claude-sess-1");
  assertEquals(observationAt(again, NOW).state, "ready");
});

Deno.test("coding-agent/sessions#R6: NDJSON stream을 observe entry에 넣으면 제품별 정규화 관측이 나온다", () => {
  const lines = [
    JSON.stringify(PI_STREAM[0]),
    "",
    JSON.stringify(PI_STREAM[1]),
    "not json",
    JSON.stringify(PI_STREAM[3]),
    JSON.stringify(PI_STREAM[6]),
    JSON.stringify(PI_STREAM[7]),
    "42",
  ];
  const outcome = observeStream("pi", lines.join("\n"), CONTEXT);
  assertEquals(
    outcome.observations.map((item) => item.state),
    ["ready", "working", "ready"],
  );
  assertEquals(
    outcome.observations.map((item) => item.evidence_ref),
    ["pi:session_start", "pi:agent_start", "pi:agent_settled"],
  );
  // agent_end·session_shutdown은 상태가 아니라 버리고 읽지 못한 두 줄은 센다.
  assertEquals(outcome.ignored, 2);
  assertEquals(outcome.rejected, 2);
  assertEquals(outcome.observations[0].provider_session?.id, "pi-1");
  // hook이 준 JSON 하나(여러 줄)는 payload 하나다.
  const single = observeStream(
    "claude",
    JSON.stringify(claudeHook("Stop"), null, 2),
    CONTEXT,
  );
  assertEquals(single.observations.map((item) => item.state), ["ready"]);
  // 빈 입력은 아무것도 만들지 않는다.
  assertEquals(observeStream("claude", "", CONTEXT).observations, []);
});

Deno.test("coding-agent/harnesses#R11: 상태 hook target은 검증하지 않은 version을 설치하지 않고 catalog event는 normalizer가 읽는다", () => {
  const statusEvents: Record<string, string[]> = {};
  for (const definition of HARNESS_CATALOG) {
    for (const hook of definition.hooks) {
      if (hook.purpose !== "status") continue;
      // 상태 hook의 payload와 env 생존을 검증한 version이 없어 모두 unverified다.
      assertEquals(hook.capability, "unverified", hook.event);
      (statusEvents[definition.harness_id] ??= []).push(hook.event);
    }
  }
  // 상태 수집 hook이 없는 제품은 unknown이다.
  assertEquals(statusEvents["hermes"], undefined);
  assertEquals(statusEvents["openclaw"], undefined);
  const payloadOf: Record<string, (event: string) => unknown> = {
    claude: (event) => claudeHook(event),
    codex: (event) => ({ hook_event_name: event, session_id: "c" }),
    gemini: (event) =>
      geminiHook(event, { notification_type: "ToolPermission" }),
    opencode: (event) => ({
      type: event,
      properties: { sessionID: "s", status: { type: "busy" } },
    }),
    pi: (event) => ({ event, session_id: "p" }),
  };
  for (const [harness, events] of Object.entries(statusEvents)) {
    for (const event of events) {
      const observation = observationFromPayload(
        harness as HarnessId,
        payloadOf[harness](event),
        CONTEXT,
      );
      assert(observation !== null, `${harness} ${event}`);
    }
  }
  assertEquals(Object.keys(statusEvents).sort(), [
    "claude",
    "codex",
    "gemini",
    "opencode",
    "pi",
  ]);
});
